// dsh-skill-workbench · 用户级 store / 内置翻译包 / 项目层 / 三层合并 / 原子写
import { copyFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  atomicWriteJson,
  builtinPackPath,
  diagnosticsPath,
  findProjectRoot,
  isPlainObject,
  nowIso,
  readJsonFile,
  trimString,
  userStorePath,
} from './util.js';

export const SCHEMA_VERSION = 1;
export const LANG = 'zh-CN';
export const CATEGORY_FALLBACK = 'uncategorized';
export const REVIEW_STATES = new Set(['draft', 'reviewed']);
export const ORIGINS = new Set(['manual', 'llm', 'import', 'builtin', 'community', 'existing-zh']);
export const SETTINGS_MODES = new Set(['decorate', 'overlay', 'off']);

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  mode: 'decorate',
  pinyinSearch: true,
  showRecent: true,
  translatorProvider: 'deepseek-account',
  translatorModel: 'deepseek-flash',
});

const STRING_ZH_FIELDS = ['name', 'summary', 'description', 'whenToUse', 'notFor', 'category', 'pinyin', 'pinyinInitials'];
const ARRAY_ZH_FIELDS = ['alias', 'tags', 'keywords'];
const CONTENT_ZH_FIELDS = [...STRING_ZH_FIELDS, ...ARRAY_ZH_FIELDS];

export function defaultSettings() {
  return { ...DEFAULT_SETTINGS };
}

export function defaultStore() {
  return {
    schemaVersion: SCHEMA_VERSION,
    lang: LANG,
    updatedAt: null,
    settings: defaultSettings(),
    categories: [],
    entries: {},
  };
}

export function sanitizeSettings(input, base = DEFAULT_SETTINGS) {
  const next = defaultSettings();
  if (isPlainObject(base)) {
    if (typeof base.enabled === 'boolean') next.enabled = base.enabled;
    if (typeof base.mode === 'string' && SETTINGS_MODES.has(base.mode)) next.mode = base.mode;
    if (typeof base.pinyinSearch === 'boolean') next.pinyinSearch = base.pinyinSearch;
    if (typeof base.showRecent === 'boolean') next.showRecent = base.showRecent;
    const provider = trimString(base.translatorProvider);
    if (provider) next.translatorProvider = provider;
    const model = trimString(base.translatorModel);
    if (model) next.translatorModel = model;
  }
  if (!isPlainObject(input)) return next;
  if (typeof input.enabled === 'boolean') next.enabled = input.enabled;
  if (typeof input.mode === 'string' && SETTINGS_MODES.has(input.mode)) next.mode = input.mode;
  if (typeof input.pinyinSearch === 'boolean') next.pinyinSearch = input.pinyinSearch;
  if (typeof input.showRecent === 'boolean') next.showRecent = input.showRecent;
  const provider = trimString(input.translatorProvider);
  if (provider) next.translatorProvider = provider;
  const model = trimString(input.translatorModel);
  if (model) next.translatorModel = model;
  return next;
}

/** 只保留 zh 契约字段，去除空值（用于合并与落盘）。 */
export function normalizeZh(input) {
  if (!isPlainObject(input)) return {};
  const zh = {};
  for (const field of STRING_ZH_FIELDS) {
    const value = trimString(input[field]);
    if (value !== '') zh[field] = value;
  }
  for (const field of ARRAY_ZH_FIELDS) {
    if (!Array.isArray(input[field])) continue;
    const list = [];
    for (const item of input[field]) {
      const value = trimString(item);
      if (value !== '' && !list.includes(value)) list.push(value);
    }
    if (list.length > 0) zh[field] = list;
  }
  if (typeof input.origin === 'string' && ORIGINS.has(input.origin)) zh.origin = input.origin;
  if (typeof input.review === 'string' && REVIEW_STATES.has(input.review)) zh.review = input.review;
  return zh;
}

export function hasAnyZh(zh) {
  if (!isPlainObject(zh)) return false;
  for (const field of CONTENT_ZH_FIELDS) {
    const value = zh[field];
    if (Array.isArray(value)) {
      if (value.length > 0) return true;
    } else if (typeof value === 'string' && value.trim() !== '') {
      return true;
    }
  }
  return false;
}

/** 三层字段级合并：layers 由高到低，第一个非空值生效。 */
export function mergeZhLayers(layers) {
  const merged = {};
  for (const layer of layers) {
    if (!isPlainObject(layer)) continue;
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined || value === null) continue;
      const present = merged[key];
      if (Array.isArray(value)) {
        if (value.length === 0) continue;
        if (Array.isArray(present) && present.length > 0) continue;
        merged[key] = [...value];
        continue;
      }
      if (typeof value === 'string') {
        if (value.trim() === '') continue;
        if (typeof present === 'string' && present.trim() !== '') continue;
        merged[key] = value;
        continue;
      }
      if (present === undefined) merged[key] = value;
    }
  }
  return merged;
}

/** 分类 patch 只保留显式提供的字段，便于字段级覆盖内置分类。 */
export function normalizeCategoryPatches(list) {
  if (!Array.isArray(list)) return [];
  const result = [];
  const seen = new Set();
  for (const raw of list) {
    if (!isPlainObject(raw)) continue;
    const id = trimString(raw.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const patch = { id };
    const zh = trimString(raw.zh);
    if (zh) patch.zh = zh;
    if (Number.isFinite(raw.order)) patch.order = raw.order;
    const icon = trimString(raw.icon);
    if (icon) patch.icon = icon;
    const parent = trimString(raw.parent);
    if (parent) patch.parent = parent;
    result.push(patch);
  }
  return result;
}

/** layers 由低到高（内置 → 用户 → 项目），返回补全默认值并排序后的分类。 */
export function mergeCategories(...layers) {
  const map = new Map();
  for (const layer of layers) {
    if (!Array.isArray(layer)) continue;
    for (const raw of layer) {
      if (!isPlainObject(raw)) continue;
      const id = trimString(raw.id);
      if (!id) continue;
      const existing = map.get(id) ?? { id };
      const next = { ...existing };
      const zh = trimString(raw.zh);
      if (zh) next.zh = zh;
      if (Number.isFinite(raw.order)) next.order = raw.order;
      const icon = trimString(raw.icon);
      if (icon) next.icon = icon;
      const parent = trimString(raw.parent);
      if (parent) next.parent = parent;
      map.set(id, next);
    }
  }
  const result = [...map.values()];
  result.forEach((category, index) => {
    if (!category.zh) category.zh = category.id;
    if (!Number.isFinite(category.order)) category.order = (index + 1) * 10;
    if (category.icon === undefined) category.icon = null;
  });
  result.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return result;
}

function normalizeHash(hash) {
  if (!isPlainObject(hash)) return null;
  const frontmatter = trimString(hash.frontmatter);
  const body = hash.body === null || hash.body === undefined ? null : trimString(hash.body);
  const at = trimString(hash.at);
  if (!frontmatter && !body) return null;
  return { frontmatter: frontmatter || null, body: body || null, at: at || null };
}

export function normalizeEntry(input) {
  if (!isPlainObject(input)) return null;
  const entry = {};
  const dirName = trimString(input.dirName);
  if (dirName) entry.dirName = dirName;
  if (isPlainObject(input.bound)) {
    const kind = trimString(input.bound.kind);
    const rank = Number.isFinite(input.bound.rank) ? input.bound.rank : null;
    const path = input.bound.path === null || input.bound.path === undefined ? null : trimString(input.bound.path);
    if (kind) entry.bound = { kind, rank, path: path || null };
  }
  const hash = normalizeHash(input.hash);
  if (hash) entry.hash = hash;
  const zh = normalizeZh(input.zh);
  if (Object.keys(zh).length > 0) entry.zh = zh;
  const updatedAt = trimString(input.updatedAt);
  if (updatedAt) entry.updatedAt = updatedAt;
  return Object.keys(entry).length > 0 ? entry : null;
}

export function normalizeEntries(input) {
  const entries = {};
  if (!isPlainObject(input)) return entries;
  for (const [rawName, rawEntry] of Object.entries(input)) {
    const name = trimString(rawName);
    if (!name) continue;
    const entry = normalizeEntry(rawEntry);
    if (entry) entries[name] = entry;
  }
  return entries;
}

export function normalizeStore(data) {
  const store = defaultStore();
  if (!isPlainObject(data)) return store;
  const lang = trimString(data.lang);
  if (lang) store.lang = lang;
  const updatedAt = trimString(data.updatedAt);
  if (updatedAt) store.updatedAt = updatedAt;
  store.settings = sanitizeSettings(data.settings);
  store.categories = normalizeCategoryPatches(data.categories);
  store.entries = normalizeEntries(data.entries);
  return store;
}

export function loadUserStore() {
  const file = userStorePath();
  const result = readJsonFile(file);
  if (result.status === 'missing') return { store: defaultStore(), status: 'missing', file };
  if (result.status !== 'ok' || !isPlainObject(result.data)) return { store: defaultStore(), status: 'invalid', file };
  const version = result.data.schemaVersion;
  if (version !== undefined && version !== null && version !== SCHEMA_VERSION) {
    return { store: defaultStore(), status: 'incompatible', file, version };
  }
  return { store: normalizeStore(result.data), status: 'ok', file };
}

function emptyPack() {
  return { schemaVersion: SCHEMA_VERSION, version: null, lang: LANG, categories: [], entries: {} };
}

/** 标准化翻译包（导入接口与内置包共用）。 */
export function normalizePack(data) {
  const pack = emptyPack();
  if (!isPlainObject(data)) return pack;
  const version = trimString(data.version);
  if (version) pack.version = version;
  const lang = trimString(data.lang);
  if (lang) pack.lang = lang;
  pack.categories = normalizeCategoryPatches(data.categories);
  const rawEntries = isPlainObject(data.entries) ? data.entries : {};
  for (const [rawName, rawEntry] of Object.entries(rawEntries)) {
    const name = trimString(rawName);
    if (!name || !isPlainObject(rawEntry)) continue;
    const zh = normalizeZh(isPlainObject(rawEntry.zh) ? rawEntry.zh : rawEntry);
    if (!hasAnyZh(zh)) continue;
    if (!zh.origin) zh.origin = 'builtin';
    if (!zh.review) zh.review = 'reviewed';
    pack.entries[name] = { zh };
  }
  return pack;
}

let builtinCache = null;

export function loadBuiltinPack() {
  const file = builtinPackPath();
  let signature = null;
  try {
    const stat = statSync(file);
    signature = `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return emptyPack();
  }
  if (builtinCache && builtinCache.signature === signature) return builtinCache.pack;
  const result = readJsonFile(file);
  const pack = result.status === 'ok' ? normalizePack(result.data) : emptyPack();
  builtinCache = { signature, pack };
  return pack;
}

export function loadProjectStore(cwd) {
  const none = { status: 'missing', root: null, file: null, entries: {}, categories: [] };
  if (typeof cwd !== 'string' || cwd.trim() === '') return none;
  const projectRoot = findProjectRoot(cwd);
  if (!projectRoot) return none;
  const file = join(projectRoot, '.dsh', 'skill-cn', 'zh-index.json');
  const result = readJsonFile(file);
  if (result.status !== 'ok' || !isPlainObject(result.data)) {
    return { status: result.status, root: projectRoot, file, entries: {}, categories: [] };
  }
  const data = result.data;
  let rawEntries;
  if (isPlainObject(data.entries)) rawEntries = data.entries;
  else if (!('entries' in data)) rawEntries = data;
  else rawEntries = {};
  return {
    status: 'ok',
    root: projectRoot,
    file,
    entries: normalizeEntries(rawEntries),
    categories: normalizeCategoryPatches(data.categories),
  };
}

export function loadDiagnostics() {
  const result = readJsonFile(diagnosticsPath());
  if (result.status !== 'ok' || !isPlainObject(result.data)) return null;
  const data = result.data;
  return {
    at: trimString(data.at) || null,
    mode: trimString(data.mode) || null,
    decorated: data.decorated === true,
    rows: Number.isFinite(data.rows) ? data.rows : 0,
    error: trimString(data.error) || null,
  };
}

export function saveDiagnostics(record) {
  atomicWriteJson(diagnosticsPath(), record);
}

let mutationChain = Promise.resolve();

/**
 * 串行化读-改-写；store 损坏/版本不兼容时先备份原文件（index.json.corrupt-<ts>.bak）再以空 store 重建，
 * 保证任何一次写都不会静默覆盖无法解析的旧文件。
 */
export function mutateUserStore(mutator) {
  const execute = () => {
    const loaded = loadUserStore();
    if ((loaded.status === 'invalid' || loaded.status === 'incompatible') && loaded.file) {
      try {
        copyFileSync(loaded.file, `${loaded.file}.corrupt-${Date.now()}.bak`);
      } catch {
        // 备份失败不阻塞写入（文件可能已不存在）
      }
    }
    const store = loaded.status === 'ok' ? loaded.store : defaultStore();
    const result = mutator(store);
    store.schemaVersion = SCHEMA_VERSION;
    store.lang = LANG;
    store.updatedAt = nowIso();
    atomicWriteJson(loaded.file, store);
    return result;
  };
  const next = mutationChain.then(execute);
  mutationChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

export function applySettingsPatch(store, patch) {
  store.settings = sanitizeSettings(patch, store.settings);
  return store.settings;
}
