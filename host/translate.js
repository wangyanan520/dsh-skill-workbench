// dsh-skill-workbench · 翻译任务（ctx.llm.stream，异步 job）
import { randomBytes } from 'node:crypto';
import {
  getService,
  isPlainObject,
  nowIso,
  trimString,
} from './util.js';
import {
  CATEGORY_FALLBACK,
  loadBuiltinPack,
  loadProjectStore,
  loadUserStore,
  mergeCategories,
  mergeZhLayers,
  mutateUserStore,
  normalizeZh,
} from './store.js';
import { scanSkills } from './scan.js';

export const PROMPT_VERSION = 1;

/** 契约 §4 固定提示词（版本化常量；调整需同步 catalog / 客户端文案） */
export const SYSTEM_PROMPT = `你是 DSH（DeepSeek Harness）技能目录的中文翻译与编目助手。
输入一个技能的英文元数据，输出严格 JSON（不要 markdown 代码块、不要解释）：
{"name":"中文名（≤10字，名词短语，不带“技能”二字）","alias":["可选别名"],"summary":"中文简介（≤40字，说清做什么+何时用）","description":"详细中文说明（1-3 句，保留专有名词英文）","whenToUse":"适用场景","notFor":"不适用边界","category":"从给定分类 id 中选最合适的一个","tags":["2-4个中文标签"],"keywords":["可用于搜索的专有名词/平台名"]}
category 只能取给定 id；无法判断时用 "uncategorized"。专有名词（TDD、SKILL.md、Figma、React 等）保留英文。不得编造技能没有的能力。`;

const ITEM_TIMEOUT_MS = 90_000;
const CONCURRENCY = 2;
const MAX_JOBS = 30;
const MAX_ATTEMPTS = 2; // 首次 + 失败重试 1 次
const LLM_UNAVAILABLE_CODES = new Set([
  'NO_ADAPTER',
  'MISSING_CREDENTIAL',
  'INVALID_CREDENTIAL',
  'AUTH',
  'UNAUTHORIZED',
]);
export const TRANSLATE_SCOPES = new Set(['untranslated', 'stale', 'selected', 'all']);

export function isTranslateScope(value) {
  return typeof value === 'string' && TRANSLATE_SCOPES.has(value);
}

function coerceStringArray(value, limit) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    const text = trimString(item);
    if (text !== '' && !result.includes(text)) result.push(text);
    if (result.length >= limit) break;
  }
  return result;
}

function clampChars(value, limit) {
  return Array.from(value).slice(0, limit).join('');
}

/** 校验 LLM 输出并归一化为 zh 条目；不合格返回 null（触发重试）。 */
export function normalizeModelZh(input, categoryIds) {
  if (!isPlainObject(input)) return null;
  const ids = categoryIds instanceof Set ? categoryIds : new Set(Array.isArray(categoryIds) ? categoryIds : []);
  const zh = {};
  const name = trimString(input.name);
  if (name) zh.name = clampChars(name, 10);
  const summary = trimString(input.summary);
  if (summary) zh.summary = clampChars(summary, 40);
  for (const field of ['description', 'whenToUse', 'notFor']) {
    const value = trimString(input[field]);
    if (value) zh[field] = value;
  }
  const category = trimString(input.category);
  zh.category = ids.has(category) ? category : CATEGORY_FALLBACK;
  const alias = coerceStringArray(input.alias, 5);
  if (alias.length > 0) zh.alias = alias;
  const tags = coerceStringArray(input.tags, 6);
  if (tags.length > 0) zh.tags = tags;
  const keywords = coerceStringArray(input.keywords, 10);
  if (keywords.length > 0) zh.keywords = keywords;
  if (!zh.name || !zh.summary) return null;
  return zh;
}

/** 从模型文本里提取第一个 JSON 对象（容忍 ``` 围栏）。 */
export function parseModelOutput(text, categoryIds) {
  let candidate = String(text ?? '').trim();
  if (candidate === '') return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(candidate);
  if (fenced) candidate = fenced[1].trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let parsed;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
  return normalizeModelZh(parsed, categoryIds);
}

export function buildUserPrompt(skill, categories) {
  const lines = [`技能 name: ${skill.name}`, `英文 description: ${skill.description}`];
  if (skill.whenToUse) lines.push(`whenToUse: ${skill.whenToUse}`);
  const categoryLines = (Array.isArray(categories) ? categories : []).map(
    (category) => `- ${category.id}: ${category.zh ?? category.id}`,
  );
  lines.push(`分类清单:\n${categoryLines.length > 0 ? categoryLines.join('\n') : '- uncategorized: 未分类'}`);
  return lines.join('\n');
}

function toFailure(error) {
  if (isPlainObject(error)) {
    const code = typeof error.code === 'string' && error.code !== '' ? error.code : 'ERR_TRANSLATE';
    const message = typeof error.message === 'string' ? error.message : '';
    return { code, message };
  }
  return { code: 'ERR_TRANSLATE', message: String(error?.message ?? error ?? '') };
}

function selectTargets(skills, scope, names) {
  const nameSet = new Set(Array.isArray(names) ? names.filter((name) => typeof name === 'string') : []);
  const isManual = (skill) => isPlainObject(skill.zh) && skill.zh.origin === 'manual';
  return skills.filter((skill) => {
    if (scope === 'selected') return nameSet.has(skill.name);
    if (isManual(skill)) return false;
    if (scope === 'untranslated') return skill.status === 'untranslated';
    if (scope === 'stale') return skill.status === 'stale';
    if (scope === 'all') return true;
    return false;
  });
}

export function createJobManager(ctx, options = {}) {
  const jobs = new Map();
  const logger = options.logger ?? console;
  const config = options.config;
  let disposed = false;

  const publicJob = (job) => ({
    id: job.id,
    kind: 'translate',
    state: job.state,
    total: job.total,
    done: job.done,
    failed: job.failed,
    current: job.current,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    error: job.error ? { ...job.error } : null,
  });

  function pruneJobs() {
    if (jobs.size <= MAX_JOBS) return;
    const finished = [...jobs.values()]
      .filter((job) => job.state !== 'running')
      .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
    for (const job of finished) {
      if (jobs.size <= MAX_JOBS) break;
      jobs.delete(job.id);
    }
  }

  async function callModel(job, skill, params) {
    const llm = getService(ctx, 'llm');
    if (!llm || typeof llm.stream !== 'function') {
      throw { code: 'NO_ADAPTER', message: '当前宿主未提供 LLM 服务' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    }, ITEM_TIMEOUT_MS);
    const onJobAbort = () => {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    };
    job.controller.signal.addEventListener('abort', onJobAbort, { once: true });
    try {
      let stream = llm.stream({
        provider: params.provider,
        model: params.model,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: buildUserPrompt(skill, params.categories) }],
          },
        ],
        signal: controller.signal,
        maxTokens: 800,
        reasoningEffort: 'off',
      });
      if (stream && typeof stream.then === 'function') stream = await stream;
      if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
        throw { code: 'NO_ADAPTER', message: 'LLM stream 不可用' };
      }
      let text = '';
      let finish = null;
      for await (const chunk of stream) {
        if (!isPlainObject(chunk)) continue;
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text;
        else if (chunk.type === 'finish') finish = isPlainObject(chunk.reason) ? chunk.reason : null;
      }
      if (job.cancelRequested || job.state !== 'running') throw { code: 'ABORTED', message: '任务已取消' };
      if (!finish) throw { code: 'ERR_NO_FINISH', message: 'LLM 流未返回 finish' };
      if (finish.kind !== 'stop') {
        const failure = isPlainObject(finish.failure) ? finish.failure : {};
        const code = typeof failure.code === 'string' && failure.code !== '' ? failure.code : 'ERR_LLM';
        const message = typeof failure.message === 'string' && failure.message !== '' ? failure.message : `LLM 结束原因：${String(finish.kind)}`;
        throw { code, message };
      }
      return text;
    } finally {
      clearTimeout(timer);
      job.controller.signal.removeEventListener('abort', onJobAbort);
    }
  }

  async function translateOne(job, skill, params) {
    let lastFailure = null;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      if (job.cancelRequested || job.state !== 'running') return { ok: false, error: { code: 'ABORTED', message: '任务已取消' } };
      try {
        const text = await callModel(job, skill, params);
        const zh = parseModelOutput(text, params.categoryIds);
        if (!zh) throw { code: 'ERR_BAD_JSON', message: '模型输出不是合法 JSON' };
        return { ok: true, zh };
      } catch (error) {
        lastFailure = toFailure(error);
        if (lastFailure.code === 'ABORTED' || job.cancelRequested || job.state !== 'running') {
          return { ok: false, error: lastFailure };
        }
      }
    }
    return { ok: false, error: lastFailure ?? { code: 'ERR_TRANSLATE', message: '翻译失败' } };
  }

  async function saveTranslation(skill, zhPatch) {
    await mutateUserStore((store) => {
      const existing = isPlainObject(store.entries[skill.name]) ? store.entries[skill.name] : {};
      const existingZh = isPlainObject(existing.zh) ? normalizeZh(existing.zh) : {};
      const merged = mergeZhLayers([zhPatch, existingZh]);
      merged.origin = 'llm';
      merged.review = 'draft';
      store.entries[skill.name] = {
        ...existing,
        dirName: skill.dirName ?? existing.dirName ?? null,
        bound: {
          kind: skill.source?.kind ?? null,
          rank: skill.source?.rank ?? null,
          path: skill.path ?? null,
        },
        hash: {
          frontmatter: skill.hash?.frontmatter ?? null,
          body: skill.hash?.body ?? null,
          at: nowIso(),
        },
        zh: merged,
        updatedAt: nowIso(),
      };
    });
  }

  async function runJob(job, targets, params) {
    const failures = [];
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        if (job.cancelRequested || job.state !== 'running' || disposed) return;
        const index = cursor;
        cursor += 1;
        if (index >= targets.length) return;
        const skill = targets[index];
        job.current = skill.name;
        const outcome = await translateOne(job, skill, params);
        if (job.cancelRequested || job.state !== 'running') return;
        if (!outcome.ok) {
          job.failed += 1;
          failures.push(outcome.error);
          continue;
        }
        try {
          await saveTranslation(skill, outcome.zh);
          job.done += 1;
        } catch (error) {
          logger.error('[dsh-skill-workbench] 写入翻译结果失败', error);
          job.failed += 1;
          failures.push({ code: 'ERR_SAVE', message: '写入翻译结果失败' });
        }
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, Math.max(targets.length, 1)) }, () => worker()));
    } catch (error) {
      logger.error('[dsh-skill-workbench] 翻译任务异常', error);
      if (job.state === 'running') {
        job.state = 'failed';
        job.error = { code: 'ERR_INTERNAL', message: '翻译任务异常终止' };
      }
    }
    job.current = null;
    if (job.state === 'running') {
      if (job.cancelRequested) {
        job.state = 'cancelled';
      } else if (targets.length > 0 && job.done === 0) {
        job.state = 'failed';
        const onlyUnavailable =
          failures.length > 0 && failures.every((failure) => LLM_UNAVAILABLE_CODES.has(failure?.code));
        if (onlyUnavailable) {
          job.error = { code: 'ERR_NO_LLM', message: `LLM 不可用（${failures[0].code}），请检查模型凭据与 provider 配置` };
        } else {
          job.error = {
            code: 'ERR_ALL_FAILED',
            message: failures[0]?.message ? `全部技能翻译失败：${failures[0].message}` : '全部技能翻译失败',
          };
        }
      } else {
        job.state = 'done';
        job.error = null;
      }
    }
    job.finishedAt = nowIso();
    pruneJobs();
  }

  async function start({ scope, names, cwd } = {}) {
    const userLoaded = loadUserStore();
    const builtin = loadBuiltinPack();
    const projectStore = loadProjectStore(cwd);
    const settings = userLoaded.store.settings;
    const scan = await scanSkills(ctx, {
      cwd,
      config,
      userStore: userLoaded.store,
      projectStore,
      builtin,
    });
    const categories = mergeCategories(builtin.categories, userLoaded.store.categories, projectStore.categories);
    const selected = selectTargets(scan.skills, scope, names);
    const job = {
      id: `job_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`,
      kind: 'translate',
      state: 'running',
      total: selected.length,
      done: 0,
      failed: 0,
      current: null,
      startedAt: nowIso(),
      finishedAt: null,
      error: null,
      controller: new AbortController(),
      cancelRequested: false,
    };
    jobs.set(job.id, job);
    const params = {
      provider: settings.translatorProvider,
      model: settings.translatorModel,
      categories,
      categoryIds: new Set(categories.map((category) => category.id)),
    };
    const llm = getService(ctx, 'llm');
    if (!llm || typeof llm.stream !== 'function') {
      job.state = 'failed';
      job.finishedAt = nowIso();
      job.error = { code: 'ERR_NO_LLM', message: '当前宿主未提供 LLM 服务，无法批量翻译' };
      pruneJobs();
      return { jobId: job.id, total: job.total };
    }
    if (selected.length === 0) {
      job.state = 'done';
      job.finishedAt = nowIso();
      pruneJobs();
      return { jobId: job.id, total: 0 };
    }
    void runJob(job, selected, params).catch((error) => {
      logger.error('[dsh-skill-workbench] 翻译任务失败', error);
      if (job.state === 'running') {
        job.state = 'failed';
        job.error = { code: 'ERR_INTERNAL', message: '翻译任务失败' };
        job.finishedAt = nowIso();
      }
    });
    return { jobId: job.id, total: job.total };
  }

  function cancel(jobId) {
    const job = jobs.get(jobId);
    if (!job) return false;
    if (job.state !== 'running') return false;
    job.cancelRequested = true;
    try {
      job.controller.abort();
    } catch {
      // ignore
    }
    job.state = 'cancelled';
    job.finishedAt = nowIso();
    job.current = null;
    return true;
  }

  function get(jobId) {
    const job = jobs.get(jobId);
    return job ? publicJob(job) : null;
  }

  function snapshot() {
    return [...jobs.values()]
      .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)))
      .map((job) => publicJob(job));
  }

  function dispose() {
    disposed = true;
    for (const job of jobs.values()) {
      if (job.state === 'running') {
        job.cancelRequested = true;
        try {
          job.controller.abort();
        } catch {
          // ignore
        }
        job.state = 'cancelled';
        job.finishedAt = nowIso();
        job.current = null;
      }
    }
  }

  return { start, cancel, get, snapshot, dispose };
}
