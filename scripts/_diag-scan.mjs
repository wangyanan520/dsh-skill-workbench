// 临时诊断脚本（verify 使用，非交付物）：定位翻译包 45 条 vs 宿主扫描 44 条的差异
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseSkillContent } from '../host/frontmatter.js';
import { scanSkills, listSkillRoots } from '../host/scan.js';
import { loadBuiltinPack, loadUserStore, defaultStore } from '../host/store.js';

const AGENTS = process.env.SKILLS_DIR || join(homedir(), '.agents', 'skills');
const dirs = readdirSync(AGENTS, { withFileTypes: true });
console.log('agents 顶层条目:', dirs.length, ' isDirectory:', dirs.filter((d) => d.isDirectory()).length);
const names = new Map();
for (const d of dirs) {
  const dir = d.name;
  const skillFile = join(AGENTS, dir, 'SKILL.md');
  const has = existsSync(skillFile);
  let parsed = null;
  let err = null;
  if (has) {
    try {
      parsed = parseSkillContent(readFileSync(skillFile, 'utf8'));
      if (!parsed) err = 'parseSkillContent→null';
    } catch (e) { err = String(e && e.message); }
  } else err = 'no SKILL.md';
  const isDir = d.isDirectory();
  if (!isDir) console.log('  [非目录]', dir, 'isSymbolicLink=', d.isSymbolicLink(), 'hasSKILL=', has, 'err=', err);
  if (err) console.log('  [跳过]', dir, 'isDir=', isDir, 'err=', err);
  if (parsed) {
    if (names.has(parsed.name)) console.log('  [重名]', dir, '同名已有目录:', names.get(parsed.name));
    else names.set(parsed.name, dir);
  }
}
console.log('可解析 name 数:', names.size);
const builtin = loadBuiltinPack();
console.log('内置包 entries:', Object.keys(builtin.entries).length, 'version=', builtin.version);
const missingInScan = Object.keys(builtin.entries).filter((n) => !names.has(n));
console.log('翻译包有但磁盘解析不到:', missingInScan);
console.log('磁盘有但翻译包没有:', [...names.keys()].filter((n) => !builtin.entries[n]));

console.log('--- roots ---');
for (const root of listSkillRoots({ cwd: null })) console.log(JSON.stringify({ dir: root.dir, kind: root.kind, rank: root.rank, skipSystem: root.skipSystem }));

const ctx = { skills: { list: async () => { throw new Error('no registry'); } } };
const stores = { userStore: defaultStore(), projectStore: { entries: {}, categories: [] }, builtin };
const result = await scanSkills(ctx, { cwd: null, ...stores });
console.log('scanSkills 技能数:', result.skills.length, 'coverage:', JSON.stringify(result.coverage));
const scanned = new Set(result.skills.map((s) => s.name));
console.log('翻译包有但扫描不到:', Object.keys(builtin.entries).filter((n) => !scanned.has(n)));
console.log('扫描到但翻译包没有:', [...scanned].filter((n) => !builtin.entries[n]));
