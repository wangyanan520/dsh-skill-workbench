// dsh-skill-workbench · Host HTTP 路由（loopback 围栏 + 统一 JSON 响应 + 原子写）
import { isAbsolute } from 'node:path';
import {
  isPlainObject,
  nowIso,
  pluginVersion,
  resolveCwd,
  trimString,
  userStorePath,
} from './util.js';
import {
  SETTINGS_MODES,
  applySettingsPatch,
  hasAnyZh,
  loadBuiltinPack,
  loadDiagnostics,
  loadProjectStore,
  loadUserStore,
  mergeCategories,
  mergeZhLayers,
  mutateUserStore,
  normalizeZh,
  saveDiagnostics,
} from './store.js';
import { scanSkills } from './scan.js';
import { createJobManager, isTranslateScope } from './translate.js';

export const API_BASE = '/api/dsh-skill-workbench/';
export const JSON_BODY_MAX_BYTES = 1024 * 1024;
export const IMPORT_STRATEGIES = new Set(['fill', 'overwrite-same-origin', 'all']);
export const MOUNT_SYMBOL = Symbol.for('dsh-skill-workbench.mounted');

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
};

export function writeJson(res, status, body) {
  if (!res || res.headersSent) return;
  try {
    res.writeHead(status, { ...JSON_HEADERS });
    res.end(JSON.stringify(body));
  } catch {
    try {
      res.destroy();
    } catch {
      // ignore
    }
  }
}

function ok(res, data) {
  writeJson(res, 200, { ok: true, ...(isPlainObject(data) ? data : {}) });
}

function fail(res, status, code, message) {
  writeJson(res, status, { ok: false, code, message });
}

function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false;
  if (address === '::1') return true;
  const normalized = address.startsWith('::ffff:') ? address.slice(7) : address;
  return normalized.startsWith('127.');
}

function isLoopbackHostname(hostname) {
  if (typeof hostname !== 'string') return false;
  const value = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return value === 'localhost' || value === '::1' || value.startsWith('127.');
}

function isProxiedRequest(request) {
  const headers = request?.headers;
  if (!headers) return false;
  return typeof headers['cf-connecting-ip'] === 'string' || typeof headers['x-forwarded-for'] === 'string';
}

/** 只信任本机回环直连：loopback socket + 无代理头 + Host/Origin 均为 loopback + 非跨站请求。 */
export function isLoopbackRequest(request) {
  if (!request || !request.socket) return false;
  if (!isLoopbackAddress(request.socket.remoteAddress)) return false;
  if (isProxiedRequest(request)) return false;
  const host = request.headers?.host;
  if (typeof host !== 'string') return false;
  let hostUrl;
  try {
    hostUrl = new URL(`http://${host}`);
  } catch {
    return false;
  }
  if (!isLoopbackHostname(hostUrl.hostname)) return false;
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return new URL(origin).host === hostUrl.host;
  } catch {
    return false;
  }
}

/** 读取 JSON body，限制 1MB；返回 {ok:true,data} 或 {ok:false,reason:'invalid'|'empty'|'too-large'} */
export function readJsonBody(req, maxBytes = JSON_BODY_MAX_BYTES) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        finish({ ok: false, reason: 'too-large' });
        try {
          req.destroy();
        } catch {
          // ignore
        }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      let text;
      try {
        text = Buffer.concat(chunks).toString('utf8').trim();
      } catch {
        finish({ ok: false, reason: 'invalid' });
        return;
      }
      if (text === '') {
        finish({ ok: false, reason: 'empty' });
        return;
      }
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        finish({ ok: false, reason: 'invalid' });
        return;
      }
      if (!isPlainObject(data)) {
        finish({ ok: false, reason: 'invalid' });
        return;
      }
      finish({ ok: true, data });
    });
    req.on('error', () => finish({ ok: false, reason: 'invalid' }));
  });
}

function queryOf(req) {
  try {
    return new URL(req.url ?? '/', 'http://localhost').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

async function readBody(req, res) {
  const result = await readJsonBody(req);
  if (result.ok) return result.data;
  if (result.reason === 'too-large') {
    fail(res, 413, 'ERR_BODY_TOO_LARGE', '请求体超过 1MB 限制');
  } else {
    fail(res, 400, 'ERR_BAD_REQUEST', '请求体必须是合法 JSON 对象');
  }
  return null;
}

function isAbsolutePath(value) {
  try {
    return isAbsolute(value);
  } catch {
    return false;
  }
}

/** 校验并解析可选的 cwd（只接受绝对路径；缺省回退 ctx.workingDirectory）。 */
function pickCwd(ctx, raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, cwd: resolveCwd(ctx, null) };
  if (typeof raw !== 'string') return { ok: false };
  const value = raw.trim();
  if (value === '') return { ok: true, cwd: resolveCwd(ctx, null) };
  if (!isAbsolutePath(value)) return { ok: false };
  return { ok: true, cwd: resolveCwd(ctx, value) };
}

function makeHandler(method, handler) {
  return async (req, res) => {
    try {
      if (!isLoopbackRequest(req)) {
        fail(res, 403, 'ERR_FORBIDDEN', '仅允许从本机回环地址访问');
        return;
      }
      if (req.method !== method) {
        fail(res, 405, 'ERR_METHOD', `不支持的请求方法：${String(req.method)}`);
        return;
      }
      await handler(req, res);
    } catch (error) {
      console.error('[dsh-skill-workbench] 路由处理失败', error);
      if (res.headersSent) {
        try {
          res.destroy();
        } catch {
          // ignore
        }
        return;
      }
      fail(res, 500, 'ERR_INTERNAL', '服务器内部错误');
    }
  };
}

function buildImportPlan(skills, pack, strategy) {
  const byName = new Map(skills.map((skill) => [skill.name, skill]));
  const preview = { added: 0, updated: 0, skipped: 0, conflict: 0, stale: 0 };
  const entries = [];
  const packEntries = isPlainObject(pack.entries) ? pack.entries : {};
  for (const [rawName, rawEntry] of Object.entries(packEntries)) {
    const name = trimString(rawName);
    if (!name || !isPlainObject(rawEntry)) {
      preview.skipped += 1;
      continue;
    }
    const skill = byName.get(name);
    if (!skill) {
      preview.skipped += 1;
      continue;
    }
    if (skill.status === 'stale') preview.stale += 1;
    const packZh = normalizeZh(isPlainObject(rawEntry.zh) ? rawEntry.zh : rawEntry);
    if (!hasAnyZh(packZh)) {
      preview.skipped += 1;
      continue;
    }
    const origin = typeof packZh.origin === 'string' && packZh.origin !== '' ? packZh.origin : 'import';
    const review = packZh.review === 'draft' ? 'draft' : 'reviewed';
    const existingZh = isPlainObject(skill.zh) && hasAnyZh(skill.zh) ? skill.zh : null;
    if (!existingZh) {
      preview.added += 1;
      entries.push({ name, skill, patch: packZh, origin, review, mode: 'add' });
      continue;
    }
    if (existingZh.origin === 'manual') {
      preview.conflict += 1;
      continue;
    }
    const sameOrigin = (existingZh.origin ?? '') === origin;
    if (strategy === 'fill') {
      const missing = {};
      for (const [field, value] of Object.entries(packZh)) {
        if (field === 'origin' || field === 'review') continue;
        const current = existingZh[field];
        if (Array.isArray(value)) {
          if (value.length > 0 && (!Array.isArray(current) || current.length === 0)) missing[field] = [...value];
        } else if (typeof value === 'string' && value.trim() !== '') {
          if (typeof current !== 'string' || current.trim() === '') missing[field] = value;
        }
      }
      if (Object.keys(missing).length === 0) {
        preview.skipped += 1;
        continue;
      }
      preview.updated += 1;
      entries.push({ name, skill, patch: missing, origin, review, mode: 'fill' });
      continue;
    }
    if (strategy === 'overwrite-same-origin' && !sameOrigin) {
      preview.skipped += 1;
      continue;
    }
    preview.updated += 1;
    entries.push({ name, skill, patch: packZh, origin, review, mode: 'overwrite' });
  }
  return { preview, entries };
}

function writeEntryForSkill(store, item, existingZh) {
  const skill = item.skill;
  const merged = mergeZhLayers([item.patch, existingZh]);
  if (item.mode === 'fill') {
    merged.origin = typeof existingZh.origin === 'string' && existingZh.origin !== '' ? existingZh.origin : item.origin;
    merged.review = typeof existingZh.review === 'string' && existingZh.review !== '' ? existingZh.review : item.review;
  } else {
    merged.origin = item.origin;
    merged.review = item.review;
  }
  const existing = isPlainObject(store.entries[item.name]) ? store.entries[item.name] : {};
  store.entries[item.name] = {
    ...existing,
    dirName: skill.dirName ?? existing.dirName ?? null,
    bound: { kind: skill.source.kind, rank: skill.source.rank, path: skill.path ?? null },
    hash: {
      frontmatter: skill.hash?.frontmatter ?? null,
      body: skill.hash?.body ?? null,
      at: nowIso(),
    },
    zh: merged,
    updatedAt: nowIso(),
  };
}

export function makeRoutes(ctx, { jobs, config } = {}) {
  const routes = [];
  const register = (path, method, handler) => {
    routes.push({ kind: 'exact', path: `${API_BASE}${path}`, handler: makeHandler(method, handler) });
  };

  const collectState = async (cwd) => {
    const userLoaded = loadUserStore();
    const builtin = loadBuiltinPack();
    const projectStore = loadProjectStore(cwd);
    const scan = await scanSkills(ctx, {
      cwd,
      config,
      userStore: userLoaded.store,
      projectStore,
      builtin,
    });
    return {
      userLoaded,
      builtin,
      projectStore,
      categories: mergeCategories(builtin.categories, userLoaded.store.categories, projectStore.categories),
      ...scan,
    };
  };

  register('list', 'GET', async (req, res) => {
    const picked = pickCwd(ctx, queryOf(req).get('cwd'));
    if (!picked.ok) {
      fail(res, 400, 'ERR_BAD_REQUEST', 'cwd 必须是绝对路径');
      return;
    }
    const state = await collectState(picked.cwd);
    ok(res, {
      generatedAt: state.generatedAt,
      store: { userPath: userStorePath(), builtinVersion: state.builtin.version },
      settings: state.userLoaded.store.settings,
      categories: state.categories,
      skills: state.skills,
      coverage: state.coverage,
    });
  });

  register('status', 'GET', async (req, res) => {
    const userLoaded = loadUserStore();
    const builtin = loadBuiltinPack();
    ok(res, {
      version: pluginVersion(),
      settings: userLoaded.store.settings,
      store: { userPath: userStorePath(), builtinVersion: builtin.version },
      jobs: jobs.snapshot(),
      diagnostics: { lastClientDecorate: loadDiagnostics() },
    });
  });

  register('save', 'POST', async (req, res) => {
    const body = await readBody(req, res);
    if (!body) return;
    const name = trimString(body.name);
    if (!name) {
      fail(res, 400, 'ERR_BAD_REQUEST', '缺少技能 name');
      return;
    }
    if (!isPlainObject(body.zh)) {
      fail(res, 400, 'ERR_BAD_REQUEST', 'zh 必须是对象');
      return;
    }
    let review;
    if (body.review !== undefined) {
      if (body.review !== 'draft' && body.review !== 'reviewed') {
        fail(res, 400, 'ERR_BAD_REQUEST', 'review 只能是 draft 或 reviewed');
        return;
      }
      review = body.review;
    }
    const picked = pickCwd(ctx, body.cwd);
    if (!picked.ok) {
      fail(res, 400, 'ERR_BAD_REQUEST', 'cwd 必须是绝对路径');
      return;
    }
    const state = await collectState(picked.cwd);
    const skill = state.skills.find((item) => item.name === name);
    if (!skill) {
      fail(res, 404, 'ERR_NOT_FOUND', `未找到技能：${name}`);
      return;
    }
    const patch = normalizeZh(body.zh);
    if (Object.keys(patch).length === 0) {
      fail(res, 400, 'ERR_BAD_REQUEST', 'zh 没有可保存的字段');
      return;
    }
    const entry = await mutateUserStore((store) => {
      const existing = isPlainObject(store.entries[name]) ? store.entries[name] : {};
      const existingZh = isPlainObject(existing.zh) ? normalizeZh(existing.zh) : {};
      const merged = mergeZhLayers([patch, existingZh]);
      if (typeof patch.origin === 'string') merged.origin = patch.origin;
      else if (typeof existingZh.origin === 'string' && existingZh.origin !== '') merged.origin = existingZh.origin;
      else merged.origin = 'manual';
      if (review) merged.review = review;
      else if (!merged.review) merged.review = 'reviewed';
      const next = {
        ...existing,
        dirName: skill.dirName ?? existing.dirName ?? null,
        bound: { kind: skill.source.kind, rank: skill.source.rank, path: skill.path ?? null },
        hash: {
          frontmatter: skill.hash?.frontmatter ?? null,
          body: skill.hash?.body ?? null,
          at: nowIso(),
        },
        zh: merged,
        updatedAt: nowIso(),
      };
      store.entries[name] = next;
      return next;
    });
    ok(res, { entry });
  });

  register('delete', 'POST', async (req, res) => {
    const body = await readBody(req, res);
    if (!body) return;
    const name = trimString(body.name);
    if (!name) {
      fail(res, 400, 'ERR_BAD_REQUEST', '缺少技能 name');
      return;
    }
    await mutateUserStore((store) => {
      delete store.entries[name];
    });
    ok(res, { deleted: true });
  });

  register('translate', 'POST', async (req, res) => {
    const body = await readBody(req, res);
    if (!body) return;
    const scope = trimString(body.scope);
    if (!isTranslateScope(scope)) {
      fail(res, 400, 'ERR_BAD_REQUEST', 'scope 必须是 untranslated/stale/selected/all');
      return;
    }
    let names;
    if (body.names !== undefined) {
      if (!Array.isArray(body.names) || body.names.some((item) => typeof item !== 'string')) {
        fail(res, 400, 'ERR_BAD_REQUEST', 'names 必须是字符串数组');
        return;
      }
      names = body.names;
    }
    if (scope === 'selected' && (!names || names.length === 0)) {
      fail(res, 400, 'ERR_BAD_REQUEST', 'scope=selected 时必须提供 names');
      return;
    }
    const picked = pickCwd(ctx, body.cwd);
    if (!picked.ok) {
      fail(res, 400, 'ERR_BAD_REQUEST', 'cwd 必须是绝对路径');
      return;
    }
    const started = await jobs.start({ scope, names, cwd: picked.cwd });
    ok(res, { jobId: started.jobId, total: started.total });
  });

  register('cancel', 'POST', async (req, res) => {
    const body = await readBody(req, res);
    if (!body) return;
    const jobId = trimString(body.jobId);
    if (!jobId) {
      fail(res, 400, 'ERR_BAD_REQUEST', '缺少 jobId');
      return;
    }
    if (!jobs.get(jobId)) {
      fail(res, 404, 'ERR_NOT_FOUND', `未找到翻译任务：${jobId}`);
      return;
    }
    const cancelled = jobs.cancel(jobId);
    ok(res, { cancelled });
  });

  register('import', 'POST', async (req, res) => {
    const body = await readBody(req, res);
    if (!body) return;
    if (!isPlainObject(body.pack)) {
      fail(res, 400, 'ERR_BAD_REQUEST', 'pack 必须是翻译包对象');
      return;
    }
    const strategy = trimString(body.strategy);
    if (!IMPORT_STRATEGIES.has(strategy)) {
      fail(res, 400, 'ERR_BAD_REQUEST', 'strategy 必须是 fill/overwrite-same-origin/all');
      return;
    }
    const apply = body.apply === true;
    const picked = pickCwd(ctx, body.cwd);
    if (!picked.ok) {
      fail(res, 400, 'ERR_BAD_REQUEST', 'cwd 必须是绝对路径');
      return;
    }
    const state = await collectState(picked.cwd);
    const plan = buildImportPlan(state.skills, body.pack, strategy);
    if (apply && plan.entries.length > 0) {
      await mutateUserStore((store) => {
        for (const item of plan.entries) {
          const existing = isPlainObject(store.entries[item.name]) ? store.entries[item.name] : {};
          const existingZh = isPlainObject(existing.zh) ? normalizeZh(existing.zh) : {};
          writeEntryForSkill(store, item, existingZh);
        }
      });
    }
    ok(res, { preview: plan.preview, applied: apply });
  });

  register('export', 'GET', async (req, res) => {
    const scope = trimString(queryOf(req).get('scope') ?? 'all') || 'all';
    if (scope !== 'all' && scope !== 'translated') {
      fail(res, 400, 'ERR_BAD_REQUEST', 'scope 必须是 all 或 translated');
      return;
    }
    const state = await collectState(null);
    const entries = {};
    for (const skill of state.skills) {
      if (!isPlainObject(skill.zh) || !hasAnyZh(skill.zh)) continue;
      if (scope === 'translated' && skill.status !== 'fresh') continue;
      const zh = { ...skill.zh };
      if (!zh.origin) zh.origin = skill.origin === 'builtin' ? 'builtin' : 'import';
      if (!zh.review) zh.review = 'reviewed';
      if (!zh.category) zh.category = 'uncategorized';
      entries[skill.name] = { zh };
    }
    // 契约 §2 该路由直接返回 BuiltinPack（不套 {ok:true}），便于另存为 import 包
    writeJson(res, 200, {
      schemaVersion: 1,
      version: state.builtin.version ?? '1.0.0',
      lang: 'zh-CN',
      categories: state.categories,
      entries,
    });
  });

  register('diag', 'POST', async (req, res) => {
    const body = await readBody(req, res);
    if (!body) return;
    const mode = trimString(body.mode);
    if (!mode) {
      fail(res, 400, 'ERR_BAD_REQUEST', '缺少 mode');
      return;
    }
    if (typeof body.decorated !== 'boolean') {
      fail(res, 400, 'ERR_BAD_REQUEST', 'decorated 必须是布尔值');
      return;
    }
    if (!Number.isFinite(body.rows)) {
      fail(res, 400, 'ERR_BAD_REQUEST', 'rows 必须是数字');
      return;
    }
    const at = trimString(body.at) || nowIso();
    const error = trimString(body.error);
    saveDiagnostics({
      at,
      mode,
      decorated: body.decorated,
      rows: body.rows,
      error: error || null,
    });
    ok(res, {});
  });

  register('config', 'POST', async (req, res) => {
    const body = await readBody(req, res);
    if (!body) return;
    if (!isPlainObject(body.settings)) {
      fail(res, 400, 'ERR_BAD_REQUEST', 'settings 必须是对象');
      return;
    }
    if (body.settings.mode !== undefined && !SETTINGS_MODES.has(body.settings.mode)) {
      fail(res, 400, 'ERR_BAD_REQUEST', 'mode 必须是 decorate/overlay/off');
      return;
    }
    const settings = await mutateUserStore((store) => applySettingsPatch(store, body.settings));
    ok(res, { settings });
  });

  register('health', 'GET', async (req, res) => {
    ok(res, { version: pluginVersion() });
  });

  return routes;
}

/**
 * 插件入口（由 index.js 调用）：任何异常只 console.error，绝不让宿主 boot 失败。
 * 单实例守卫：同一宿主进程重复 apply 时只注册一次路由。
 */
export function applyHostPlugin(ctx, config) {
  try {
    if (!ctx || typeof ctx.effect !== 'function') {
      console.error('[dsh-skill-workbench] ctx.effect 不可用，跳过插件注册');
      return;
    }
    if (!ctx.webServer || typeof ctx.webServer.register !== 'function') {
      console.error('[dsh-skill-workbench] webServer 服务不可用，跳过插件注册');
      return;
    }
    const globalObject = globalThis;
    if (globalObject[MOUNT_SYMBOL]) {
      console.warn('[dsh-skill-workbench] 插件已挂载，跳过重复注册');
      return;
    }
    const jobs = createJobManager(ctx, { config, logger: console });
    const routes = makeRoutes(ctx, { jobs, config });
    ctx.effect(() => {
      const disposers = routes.map((route) => {
        try {
          return ctx.webServer.register(route);
        } catch (error) {
          console.error('[dsh-skill-workbench] 路由注册失败', route.path, error);
          return () => {};
        }
      });
      return () => {
        for (const dispose of disposers) {
          try {
            dispose();
          } catch {
            // ignore
          }
        }
        jobs.dispose();
        try {
          delete globalObject[MOUNT_SYMBOL];
        } catch {
          // ignore
        }
      };
    }, 'dsh-skill-workbench: routes');
    globalObject[MOUNT_SYMBOL] = true;
  } catch (error) {
    console.error('[dsh-skill-workbench] 插件初始化失败', error);
  }
}
