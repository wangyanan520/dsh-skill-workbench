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
// 单个技能的输出累积上限：adapter 不守 maxTokens 时，流可以无界增长（R17）。
// 正常结果只有几百字符，20k 留足了余量；超出即视为异常输出，避免内存被吃穿。
const MAX_OUTPUT_CHARS = 20_000;
// 同时运行的翻译任务上限：任务彼此独立，但共享同一个模型服务与内存（R17）。
const MAX_RUNNING_JOBS = 2;
const MAX_ATTEMPTS = 2; // 首次 + 失败重试 1 次
// 失败明细只公开安全摘要（T08）：最多 50 条，message 固定短原因或脱敏截断。
const MAX_FAILURES = 50;
const MAX_FAILURE_MESSAGE_CHARS = 160;
const MAX_FAILURE_CODE_CHARS = 64;
const LLM_UNAVAILABLE_CODES = new Set([
  'ERR_NO_LLM',
  'NO_ADAPTER',
  'MISSING_CREDENTIAL',
  'INVALID_CREDENTIAL',
  'AUTH',
  'UNAUTHORIZED',
]);
const SAVE_FAILURE_CODES = new Set(['ERR_SAVE', 'ERR_WRITE', 'EACCES', 'EPERM', 'ENOSPC', 'EROFS']);
const FORMAT_FAILURE_CODES = new Set([
  'ERR_BAD_JSON',
  'ERR_NO_FINISH',
  'ERR_TOO_LONG',
  'ERR_BAD_OUTPUT',
  'ERR_OUTPUT_INVALID',
  'ERR_INVALID_OUTPUT',
]);
const TIMEOUT_FAILURE_CODES = new Set(['ERR_TIMEOUT', 'ETIMEDOUT', 'TIMEOUT', 'ABORTED', 'ABORT_ERR']);
const ABSOLUTE_PATH_PATTERNS = [
  /\/(?:Users|home)\/[A-Za-z0-9._~@%+\-/]+/g,
  /[A-Za-z]:\\[A-Za-z0-9._~@%+\-\\]+/g,
];
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

/** 脱敏（绝对路径 → <路径>）并截断；公开的失败明细绝不含原始路径。 */
function sanitizeFailureText(value) {
  let text = String(value ?? '');
  for (const pattern of ABSOLUTE_PATH_PATTERNS) text = text.replace(pattern, '<路径>');
  return clampChars(text.trim(), MAX_FAILURE_MESSAGE_CHARS);
}

/** 固定中文短原因；未归类错误才回落到脱敏后的底层说明。 */
function failureMessage(code, message) {
  if (LLM_UNAVAILABLE_CODES.has(code)) return '模型不可用';
  if (SAVE_FAILURE_CODES.has(code)) return '写入失败';
  if (FORMAT_FAILURE_CODES.has(code)) return '返回格式不符合要求';
  if (TIMEOUT_FAILURE_CODES.has(code)) return '超时';
  return sanitizeFailureText(message) || '翻译失败';
}

/** 只保留 name/code/message，不携带 target、prompt、模型输出或路径。 */
function toFailureEntry(name, error) {
  const failure = toFailure(error);
  const code = sanitizeFailureText(failure.code) || 'ERR_TRANSLATE';
  return {
    name: String(name ?? ''),
    code: clampChars(code, MAX_FAILURE_CODE_CHARS),
    message: failureMessage(failure.code, failure.message),
  };
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
    error: job.error
      ? {
          code: typeof job.error.code === 'string' ? job.error.code : 'ERR_TRANSLATE',
          message: sanitizeFailureText(job.error.message),
        }
      : null,
    failures: (Array.isArray(job.failures) ? job.failures : []).map(({ name, code, message }) => ({
      name,
      code,
      message,
    })),
    // 截断不改变 failed 总数；两者都来自宿主侧计数。
    failuresTruncated: job.failed > (Array.isArray(job.failures) ? job.failures.length : 0),
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
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
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
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
          text += chunk.text;
          if (text.length > MAX_OUTPUT_CHARS) {
            // 立刻中断上游，别等整条流跑完才知道要丢弃。
            try {
              controller.abort();
            } catch {
              // ignore
            }
            throw { code: 'ERR_TOO_LONG', message: `模型输出超过 ${MAX_OUTPUT_CHARS} 字符上限` };
          }
        } else if (chunk.type === 'finish') finish = isPlainObject(chunk.reason) ? chunk.reason : null;
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
    } catch (error) {
      // 90s 定时器触发的中止统一记为超时；用户取消走 job.cancelRequested，不在此改写。
      if (timedOut) throw { code: 'ERR_TIMEOUT', message: '翻译超时' };
      throw error;
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
      // 手动内容优先：手动条目重译时只补空字段，绝不覆盖用户已填写的内容。
      const manual = existingZh.origin === 'manual';
      const merged = manual ? mergeZhLayers([existingZh, zhPatch]) : mergeZhLayers([zhPatch, existingZh]);
      merged.origin = manual ? 'manual' : 'llm';
      merged.review = manual ? (existingZh.review ?? 'reviewed') : 'draft';
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
    let cursor = 0;
    let unavailableOnly = true;
    let firstFailureDetail = '';
    // 明细只存安全摘要；job.failed 独立累加，截断不影响总数。
    const recordFailure = (name, error) => {
      const failure = toFailure(error);
      if (!LLM_UNAVAILABLE_CODES.has(failure.code)) unavailableOnly = false;
      if (firstFailureDetail === '') firstFailureDetail = sanitizeFailureText(failure.message);
      job.failed += 1;
      if (job.failures.length < MAX_FAILURES) job.failures.push(toFailureEntry(name, error));
      job.failuresTruncated = job.failed > job.failures.length;
    };
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
          recordFailure(skill.name, outcome.error);
          continue;
        }
        try {
          await saveTranslation(skill, outcome.zh);
          job.done += 1;
        } catch (error) {
          logger.error('[dsh-skill-workbench] 写入翻译结果失败', error);
          recordFailure(skill.name, { code: 'ERR_SAVE', message: '写入翻译结果失败' });
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
        const onlyUnavailable = job.failed > 0 && unavailableOnly;
        if (onlyUnavailable) {
          job.error = { code: 'ERR_NO_LLM', message: '模型不可用，请检查模型凭据与 provider 配置' };
        } else {
          job.error = {
            code: 'ERR_ALL_FAILED',
            message: firstFailureDetail ? `全部技能翻译失败：${firstFailureDetail}` : '全部技能翻译失败',
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
    // 并发闸（R17）：先同步占位再 await，两个并发请求不会同时通过检查。
    const running = [...jobs.values()].filter((job) => job.state === 'running').length;
    if (running >= MAX_RUNNING_JOBS) {
      throw { code: 'ERR_BUSY', message: `已有 ${running} 个翻译任务在运行，请等待结束或先取消` };
    }
    const job = {
      id: `job_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`,
      kind: 'translate',
      state: 'running',
      total: 0,
      done: 0,
      failed: 0,
      current: null,
      startedAt: nowIso(),
      finishedAt: null,
      error: null,
      failures: [],
      failuresTruncated: false,
      controller: new AbortController(),
      cancelRequested: false,
    };
    jobs.set(job.id, job);

    const userLoaded = loadUserStore();
    const builtin = loadBuiltinPack();
    const projectStore = loadProjectStore(cwd);
    const settings = userLoaded.store.settings;
    let scan;
    try {
      scan = await scanSkills(ctx, {
        cwd,
        config,
        userStore: userLoaded.store,
        projectStore,
        builtin,
      });
    } catch (error) {
      // 扫描失败也要释放占位，否则并发闸会被一个坏任务永久占住。
      job.state = 'failed';
      job.error = { code: 'ERR_SCAN', message: '扫描技能失败，无法开始翻译' };
      job.finishedAt = nowIso();
      pruneJobs();
      throw error;
    }
    const categories = mergeCategories(builtin.categories, userLoaded.store.categories, projectStore.categories);
    const selected = selectTargets(scan.skills, scope, names);
    job.total = selected.length;
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
