// dsh-skill-workbench · 技能扫描（文件系统为主 + ctx.skills 注册表补充）
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { parseSkillContent } from './frontmatter.js';
import {
  agentsHome,
  dshHome,
  findProjectRoot,
  getService,
  hashBody,
  hashFrontmatter,
  isPlainObject,
  nowIso,
  stripFrontmatter,
  trimString,
} from './util.js';
import {
  CATEGORY_FALLBACK,
  hasAnyZh,
  loadBuiltinPack,
  loadProjectStore,
  loadUserStore,
  mergeZhLayers,
  normalizeZh,
} from './store.js';

/** 与 skill-explorer / dsh-skill-filesystem 对齐的来源 rank（数字小者优先）。 */
export const SOURCE_RANK = new Map([
  ['project-dsh', 100],
  ['project-agents', 200],
  ['runtime', 250],
  ['custom', 300],
  ['user-dsh', 400],
  ['user-agents', 500],
  ['bundled', 600],
]);

export function rankOfKind(kind) {
  return SOURCE_RANK.get(kind) ?? 999;
}

export function listSkillRoots({ cwd, config } = {}) {
  const roots = [];
  const seen = new Set();
  const add = (dir, kind, options = {}) => {
    if (typeof dir !== 'string' || dir.trim() === '') return;
    if (seen.has(dir)) return;
    seen.add(dir);
    roots.push({ dir, kind, rank: rankOfKind(kind), skipSystem: options.skipSystem === true });
  };
  if (typeof cwd === 'string' && cwd.trim() !== '' && isAbsolute(cwd)) {
    const projectRoot = findProjectRoot(cwd);
    if (projectRoot) {
      add(join(projectRoot, '.dsh', 'skills'), 'project-dsh');
      add(join(projectRoot, '.agents', 'skills'), 'project-agents');
    }
  }
  const customDirs = Array.isArray(config?.customSkillDirs) ? config.customSkillDirs : [];
  for (const dir of customDirs) {
    if (typeof dir === 'string' && isAbsolute(dir)) add(dir, 'custom');
  }
  add(join(dshHome(), 'skills'), 'user-dsh', { skipSystem: true });
  add(join(agentsHome(), 'skills'), 'user-agents');
  const bundledDir = process.env.DSH_BUNDLED_SKILL_DIR;
  if (typeof bundledDir === 'string' && bundledDir.trim() !== '') add(bundledDir.trim(), 'bundled');
  return roots;
}

function readSkillCandidate(filePath, root) {
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const parsed = parseSkillContent(content);
  if (!parsed) return null;
  return {
    name: parsed.name,
    description: parsed.description,
    whenToUse: parsed.whenToUse,
    modelInvocable: parsed.modelInvocable,
    userInvocable: parsed.userInvocable,
    path: filePath,
    kind: root.kind,
    rank: root.rank,
    hash: {
      frontmatter: hashFrontmatter(parsed.name, parsed.description),
      body: hashBody(content),
    },
    bodyPreview: parsed.body.slice(0, 3000),
    dirName: null,
    provider: 'filesystem',
    virtual: false,
  };
}

function scanRoot(root, map) {
  let entries;
  try {
    entries = readdirSync(root.dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (root.skipSystem && entry.name === '.system') continue;
    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();
    if (entry.isSymbolicLink()) {
      try {
        const stat = statSync(join(root.dir, entry.name));
        isDirectory = stat.isDirectory();
        isFile = stat.isFile();
      } catch {
        continue;
      }
    }
    if (!isDirectory && !(isFile && entry.name.endsWith('.md'))) continue;
    const skillPath = isDirectory ? join(root.dir, entry.name, 'SKILL.md') : join(root.dir, entry.name);
    const candidate = readSkillCandidate(skillPath, root);
    if (!candidate) continue;
    candidate.dirName = isDirectory ? entry.name : basename(root.dir);
    insertCandidate(map, candidate);
  }
}

async function registrySummaries(ctx, cwd) {
  const registry = getService(ctx, 'skills');
  if (!registry) return [];
  const hasCwd = typeof cwd === 'string' && cwd.trim() !== '' && isAbsolute(cwd);
  if (typeof registry.list === 'function') {
    try {
      const list = hasCwd ? await registry.list({ cwd }) : await registry.list();
      if (Array.isArray(list)) return list;
    } catch {
      try {
        const list = await registry.list();
        if (Array.isArray(list)) return list;
      } catch {
        return [];
      }
    }
  }
  if (typeof registry.snapshot === 'function') {
    try {
      const snapshot = hasCwd ? await registry.snapshot({ cwd }) : await registry.snapshot();
      if (Array.isArray(snapshot?.skills)) return snapshot.skills;
    } catch {
      return [];
    }
  }
  return [];
}

function registryCandidate(summary) {
  const name = trimString(summary.name);
  const description = trimString(summary.description);
  if (!name || !description) return null;
  const sourceRaw =
    typeof summary.source === 'string'
      ? summary.source
      : isPlainObject(summary.source)
        ? trimString(summary.source.kind)
        : '';
  const kind = sourceRaw || 'runtime';
  const rank = rankOfKind(kind);
  const path = typeof summary.path === 'string' && summary.path.trim() !== '' ? summary.path.trim() : null;
  const whenToUse = trimString(summary.whenToUse) || null;
  const invocation = isPlainObject(summary.invocation) ? summary.invocation : {};
  const hash = { frontmatter: hashFrontmatter(name, description), body: null };
  let bodyPreview = '';
  let virtual = true;
  if (path) {
    try {
      const content = readFileSync(path, 'utf8');
      hash.body = hashBody(content);
      bodyPreview = stripFrontmatter(content).trim().slice(0, 3000);
      virtual = false;
    } catch {
      // path 读不到时保持 virtual（hash.body=null）
    }
  }
  return {
    name,
    description,
    whenToUse,
    modelInvocable: invocation.modelInvocable !== false,
    userInvocable: invocation.userInvocable !== false,
    path,
    kind,
    rank,
    hash,
    bodyPreview,
    dirName: path ? basename(dirname(path)) : name,
    provider: typeof summary.provider === 'string' ? summary.provider : null,
    virtual,
  };
}

function mergeCandidate(winner, loser) {
  const merged = { ...winner };
  if (!merged.whenToUse && loser.whenToUse) merged.whenToUse = loser.whenToUse;
  if (!merged.path && loser.path) merged.path = loser.path;
  if (!merged.bodyPreview && loser.bodyPreview) merged.bodyPreview = loser.bodyPreview;
  if (merged.hash && merged.hash.body === null && loser.hash && typeof loser.hash.body === 'string') {
    merged.hash = { ...merged.hash, body: loser.hash.body };
  }
  if (!merged.provider && loser.provider) merged.provider = loser.provider;
  return merged;
}

function insertCandidate(map, candidate) {
  const existing = map.get(candidate.name);
  if (!existing) {
    map.set(candidate.name, candidate);
    return;
  }
  if (candidate.rank < existing.rank) {
    map.set(candidate.name, mergeCandidate(candidate, existing));
    return;
  }
  if (candidate.rank > existing.rank) return;
  // 同 rank：保留已有（文件系统扫描更完整），只补缺失元数据
  if (!existing.whenToUse && candidate.whenToUse) existing.whenToUse = candidate.whenToUse;
  if (!existing.bodyPreview && candidate.bodyPreview) existing.bodyPreview = candidate.bodyPreview;
  if (!existing.path && candidate.path) {
    existing.path = candidate.path;
    existing.dirName = candidate.dirName;
  }
  if (existing.hash?.body === null && candidate.hash?.body) existing.hash = { ...existing.hash, body: candidate.hash.body };
}

function layerFromEntry(entry) {
  if (!isPlainObject(entry) || !hasAnyZh(entry.zh)) return null;
  const zh = normalizeZh(entry.zh);
  if (!hasAnyZh(zh)) return null;
  return {
    entry,
    zh,
    hash: isPlainObject(entry.hash) ? entry.hash : null,
    updatedAt: typeof entry.updatedAt === 'string' && entry.updatedAt !== '' ? entry.updatedAt : null,
  };
}

/** 三层合并：项目 > 用户 > 内置，均字段级非空覆盖。 */
export function resolveLocalization(name, stores) {
  const layers = [];
  const projectLayer = layerFromEntry(stores?.projectStore?.entries?.[name]);
  if (projectLayer) layers.push({ source: 'project', ...projectLayer });
  const userLayer = layerFromEntry(stores?.userStore?.entries?.[name]);
  if (userLayer) layers.push({ source: 'user', ...userLayer });
  const builtinLayer = layerFromEntry(stores?.builtin?.entries?.[name]);
  if (builtinLayer) layers.push({ source: 'builtin', ...builtinLayer });
  if (layers.length === 0) return { zh: null, origin: null, updatedAt: null, layers: [] };
  const zh = mergeZhLayers(layers.map((layer) => layer.zh));
  if (!zh.category) zh.category = CATEGORY_FALLBACK;
  return { zh, origin: layers[0].source, updatedAt: layers[0].updatedAt, layers };
}

/** 状态：untranslated（无 zh）| stale（有 zh 且有 hash 与当前文件不一致）| fresh（其余）。 */
export function computeSkillStatus(localization, candidate) {
  if (!localization.zh || localization.layers.length === 0) return 'untranslated';
  const currentFrontmatter = candidate.hash?.frontmatter ?? null;
  const currentBody = candidate.hash?.body ?? null;
  for (const layer of localization.layers) {
    const hash = layer.hash;
    if (!isPlainObject(hash) || typeof hash.frontmatter !== 'string' || hash.frontmatter === '') continue;
    let mismatched = hash.frontmatter !== currentFrontmatter;
    if (!mismatched && typeof hash.body === 'string' && hash.body !== '') {
      if (currentBody === null || hash.body !== currentBody) mismatched = true;
    }
    return mismatched ? 'stale' : 'fresh';
  }
  return 'fresh';
}

export function buildSkillViews(candidates, stores) {
  const views = candidates.map((candidate) => {
    const localization = resolveLocalization(candidate.name, stores);
    return {
      name: candidate.name,
      description: candidate.description,
      whenToUse: candidate.whenToUse ?? null,
      modelInvocable: candidate.modelInvocable !== false,
      path: candidate.path ?? null,
      source: { kind: candidate.kind, rank: candidate.rank },
      hash: {
        frontmatter: candidate.hash?.frontmatter ?? null,
        body: candidate.hash?.body ?? null,
      },
      bodyPreview: candidate.bodyPreview ?? '',
      status: computeSkillStatus(localization, candidate),
      zh: localization.zh,
      origin: localization.origin,
      updatedAt: localization.updatedAt,
      dirName: candidate.dirName ?? candidate.name,
    };
  });
  views.sort((a, b) => a.name.localeCompare(b.name));
  return views;
}

export function computeCoverage(skills) {
  let translated = 0;
  let draft = 0;
  let stale = 0;
  let untranslated = 0;
  for (const skill of skills) {
    if (!skill.zh) {
      untranslated += 1;
      continue;
    }
    if (skill.status === 'stale') stale += 1;
    else translated += 1;
    if (skill.zh.review === 'draft') draft += 1;
  }
  return { total: skills.length, translated, draft, stale, untranslated };
}

/**
 * 扫描并合并三层中文数据。stores 可由调用方传入（translate/routes 复用），缺省时重新读取。
 * 返回 {skills, coverage, stores, generatedAt}
 */
export async function scanSkills(ctx, options = {}) {
  const cwd = typeof options.cwd === 'string' && options.cwd !== '' ? options.cwd : null;
  const stores = {
    userStore: options.userStore ?? loadUserStore().store,
    projectStore: options.projectStore ?? loadProjectStore(cwd),
    builtin: options.builtin ?? loadBuiltinPack(),
  };
  const candidateMap = new Map();
  for (const root of listSkillRoots({ cwd, config: options.config })) scanRoot(root, candidateMap);
  for (const summary of await registrySummaries(ctx, cwd)) {
    if (!isPlainObject(summary)) continue;
    const candidate = registryCandidate(summary);
    if (candidate) insertCandidate(candidateMap, candidate);
  }
  const skills = buildSkillViews([...candidateMap.values()], stores);
  return { skills, coverage: computeCoverage(skills), stores, generatedAt: nowIso() };
}
