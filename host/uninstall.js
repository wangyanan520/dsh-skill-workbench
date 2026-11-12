// dsh-skill-workbench · 技能卸载（回收站）
// 只处理 ~/.agents/skills 下的个人技能目录：移到插件数据目录的 trash/ 后
// 可在设置页恢复或永久删除。不写回 SKILL.md，也不触碰项目技能与内置技能。
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { atomicWriteJson, isPlainObject, nowIso, pluginDataDir, trimString } from './util.js';

export const SKILL_LOCK_FILE = '.skill-lock.json';

const META_SUFFIX = '.meta.json';
const ID_PATTERN = /^\d{8,14}-[a-z0-9]+(?:-[a-z0-9]+)*-[a-z0-9]{4}$/;

export function trashRoot() {
  return join(pluginDataDir(), 'trash');
}

function safeId(id) {
  const text = trimString(id);
  return ID_PATTERN.test(text) ? text : null;
}

function entryDir(id) {
  return join(trashRoot(), id);
}

function metaPath(id) {
  return join(trashRoot(), id + META_SUFFIX);
}

function readMeta(id) {
  try {
    return JSON.parse(readFileSync(metaPath(id), 'utf8'));
  } catch {
    return null;
  }
}

function moveDirectory(source, target) {
  try {
    renameSync(source, target);
    return;
  } catch (error) {
    if (!error || error.code !== 'EXDEV') throw error;
    cpSync(source, target, { recursive: true, verbatimSymlinks: true });
    rmSync(source, { recursive: true, force: true });
  }
}

function slugOf(name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'skill';
}

function makeId(name) {
  const stamp = nowIso().replace(/[^0-9]/g, '').slice(0, 14);
  const random = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `${stamp}-${slugOf(name)}-${random}`;
}

/**
 * 把个人技能目录移到回收站：
 * - 只接受 ~/.agents/skills 的直接子目录；realpath 校验阻止借由 symlink 删到别处。
 * - 同步清理 .skill-lock.json 中的安装记录（失败不影响卸载本身）。
 */
export function uninstallSkill(options) {
  const name = trimString(options && options.name);
  const dir = trimString(options && options.dir);
  const agentsDir = trimString(options && options.agentsDir);
  const lockPath = trimString(options && options.lockPath);
  if (!name || !dir || !agentsDir) throw new Error('缺少卸载参数');
  if (!existsSync(dir)) throw new Error(`技能目录不存在：${dir}`);
  if (!statSync(dir).isDirectory()) throw new Error('技能路径不是目录');
  const realAgents = realpathSync(agentsDir);
  const realDir = realpathSync(dir);
  if (dirname(realDir) !== realAgents) throw new Error('只能卸载 ~/.agents/skills 下的个人技能');

  const id = makeId(name);
  const target = entryDir(id);
  mkdirSync(trashRoot(), { recursive: true });
  moveDirectory(realDir, target);

  let lockEntry = null;
  if (lockPath && existsSync(lockPath)) {
    try {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
      if (isPlainObject(lock) && isPlainObject(lock.skills) && isPlainObject(lock.skills[name])) {
        lockEntry = lock.skills[name];
        delete lock.skills[name];
        atomicWriteJson(lockPath, lock);
      }
    } catch {
      // 锁文件损坏时不影响卸载；安装记录留在原处，用户可手动清理。
    }
  }

  const meta = {
    id,
    name,
    originalPath: realDir,
    agentsDir: realAgents,
    source: 'user-agents',
    trashedAt: nowIso(),
    lockEntry,
  };
  atomicWriteJson(metaPath(id), meta);
  return { id, name, originalPath: realDir, trashedAt: meta.trashedAt, lockEntry };
}

/** 把回收站条目移回 ~/.agents/skills/<name>；同名技能已存在时报错，不覆盖。 */
export function restoreSkill(options) {
  const id = safeId(options && options.id);
  const agentsDir = trimString(options && options.agentsDir);
  if (!id) throw new Error('回收站条目无效');
  const meta = readMeta(id);
  if (!meta) throw new Error('回收站条目不存在');
  const target = trimString(meta.originalPath);
  if (!target) throw new Error('回收站条目缺少原路径');
  const source = entryDir(id);
  if (!existsSync(source)) throw new Error('回收站里的技能目录已不存在');
  const currentAgents = agentsDir && existsSync(agentsDir) ? realpathSync(agentsDir) : trimString(meta.agentsDir);
  if (!currentAgents) throw new Error('找不到技能目录');
  if (dirname(target) !== currentAgents) throw new Error('原路径不在当前技能目录下，无法恢复');
  if (existsSync(target)) throw new Error(`同名技能已存在：${basename(target)}`);
  mkdirSync(dirname(target), { recursive: true });
  moveDirectory(source, target);
  rmSync(metaPath(id), { force: true });
  return { id, name: trimString(meta.name), originalPath: target };
}

/** 永久删除回收站条目（连同 meta）；调用方负责二次确认。 */
export function purgeSkill(options) {
  const id = safeId(options && options.id);
  if (!id) throw new Error('回收站条目无效');
  const root = resolve(trashRoot());
  const dir = resolve(entryDir(id));
  if (!dir.startsWith(root + sep)) throw new Error('回收站路径越界');
  if (!existsSync(dir)) throw new Error('回收站条目不存在');
  rmSync(dir, { recursive: true, force: true });
  rmSync(metaPath(id), { force: true });
  return { id, purged: true };
}

/** 回收站列表（按 trashedAt 降序）；目录已被外部删除的条目也会显示，便于用户清理 meta。 */
export function listTrash() {
  const root = trashRoot();
  if (!existsSync(root)) return [];
  const entries = [];
  for (const file of readdirSync(root)) {
    if (!file.endsWith(META_SUFFIX)) continue;
    const id = file.slice(0, -META_SUFFIX.length);
    if (!safeId(id)) continue;
    const meta = readMeta(id);
    if (!meta) continue;
    entries.push({
      id,
      name: trimString(meta.name),
      originalPath: trimString(meta.originalPath),
      trashedAt: trimString(meta.trashedAt),
      present: existsSync(entryDir(id)),
    });
  }
  entries.sort((a, b) => String(b.trashedAt).localeCompare(String(a.trashedAt)));
  return entries;
}
