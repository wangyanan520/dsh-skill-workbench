#!/usr/bin/env node
/**
 * dsh-skill-workbench · 初始中文翻译包校验器
 *
 * 校验 translations/zh-CN.builtin.json：
 *   1. JSON 合法 + 顶层结构（schemaVersion/version/lang/categories/entries）
 *   2. 7 个一级分类 id/zh/order/icon 正确；entries[].zh.category 必须是一级分类 id
 *   3. 技能集合与磁盘 SKILL.md frontmatter name 一致（磁盘技能 0 缺 0 多）；
 *      另外允许 8 个 DSH 内置（bundled）技能的条目——它们不在用户技能磁盘上，
 *      但会出现在 / 菜单里，需要内置中文显示名。
 *   4. 每条 zh 必填字段非空；中文名 ≤10 字、summary ≤40 字；tags 2-4 个
 *   5. pinyin 为小写纯字母、pinyinInitials 为小写字母且与中文名逐字数量一致（中文名全 CJK 时）
 *   6. 中文名全局不重复
 *   7. origin=builtin / review=reviewed
 *
 * 用法：
 *   node validate.mjs                    # 使用默认技能目录
 *   node validate.mjs --skills <目录>    # 指定技能目录（也可用环境变量 SKILLS_DIR）
 *   node validate.mjs --help
 *
 * 退出码：0 = 全部通过；1 = 校验失败。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACK_PATH = join(HERE, 'zh-CN.builtin.json');
const DEFAULT_SKILLS_ROOT = 'C:\\Users\\Administrator\\.agents\\skills';

/** 7 个一级分类（菜单分组依赖，契约规定） */
const REQUIRED_TOP = [
  { id: 'project', zh: '项目与需求', order: 10, icon: '📋' },
  { id: 'tooling', zh: '技术设计与开发', order: 20, icon: '🛠' },
  { id: 'quality', zh: '质量与发布', order: 30, icon: '✅' },
  { id: 'frontend', zh: '前端与视觉设计', order: 40, icon: '🎨' },
  { id: 'image', zh: '图像与创意生成', order: 50, icon: '🖼' },
  { id: 'research', zh: '信息数据与可视化', order: 60, icon: '🔎' },
  { id: 'writing', zh: '内容创作与写作', order: 70, icon: '✍' },
];

const REQUIRED_ZH_FIELDS = [
  'name', 'summary', 'description', 'whenToUse', 'notFor', 'category',
  'tags', 'keywords', 'pinyin', 'pinyinInitials', 'origin', 'review',
];

/**
 * 允许的「磁盘技能之外」条目：DSH bundled 技能（source=rank 600）。
 * 它们不落在用户技能目录里，但会出现在 / 菜单，缺中文就只能回退英文。
 */
const BUNDLED_PACK_EXTRA = new Set([
  'diagnose-windows-sandbox-acl',
  'office',
  'office-docx',
  'office-export-pdf',
  'office-pptx',
  'office-recalculate',
  'office-render',
  'office-xlsx',
]);
const NAME_MAX = 10;
const SUMMARY_MAX = 40;
const TAGS_MIN = 2;
const TAGS_MAX = 4;

const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

/** 按 Unicode 码点计长度（emoji / 中文均算 1 个字） */
const cpLen = (s) => [...s].length;
const isPureCJK = (s) => /^[\u4e00-\u9fff]+$/u.test(s);
const unquote = (raw) => {
  let s = String(raw).trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s.trim();
};

function parseArgs(argv) {
  let skillsRoot = process.env.SKILLS_DIR || DEFAULT_SKILLS_ROOT;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--skills' || a === '-s') {
      const v = argv[i + 1];
      if (!v) {
        console.error('❌ --skills 需要一个目录参数');
        process.exit(1);
      }
      skillsRoot = v;
      i += 1;
    } else if (a === '--help' || a === '-h') {
      console.log('用法: node validate.mjs [--skills <技能目录>]');
      process.exit(0);
    } else {
      console.error(`❌ 未知参数: ${a}`);
      process.exit(1);
    }
  }
  return skillsRoot;
}

/** 读取 SKILL.md 的 frontmatter 键值（只需单行 name，不引入 YAML 依赖） */
function parseFrontmatter(text) {
  const s = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  if (!s.startsWith('---\n')) return null;
  const end = s.indexOf('\n---', 4);
  if (end < 0) return null;
  const block = s.slice(4, end);
  const fields = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m && !(m[1] in fields)) fields[m[1]] = m[2];
  }
  const name = fields.name ? unquote(fields.name) : '';
  return { fields, name };
}

/** 递归找出技能目录下所有 SKILL.md */
function findSkillFiles(dir, acc = [], depth = 0) {
  if (depth > 6) return acc;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    err(`无法读取目录 ${dir}: ${e.message}`);
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.name.startsWith('.')) continue;
    let st = null;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) findSkillFiles(full, acc, depth + 1);
    else if (st.isFile() && entry.name === 'SKILL.md') acc.push(full);
  }
  return acc;
}

function loadExpectedSkills(skillsRoot) {
  const expected = new Map(); // frontmatter name -> SKILL.md path
  if (!existsSync(skillsRoot)) {
    err(`技能目录不存在: ${skillsRoot}`);
    return expected;
  }
  const files = findSkillFiles(skillsRoot);
  if (files.length === 0) err(`技能目录下未找到任何 SKILL.md: ${skillsRoot}`);
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (e) {
      err(`无法读取 ${file}: ${e.message}`);
      continue;
    }
    const fm = parseFrontmatter(text);
    if (!fm) {
      err(`SKILL.md 缺少合法 YAML frontmatter: ${file}`);
      continue;
    }
    if (!fm.name) {
      err(`SKILL.md frontmatter 缺少 name: ${file}`);
      continue;
    }
    if (expected.has(fm.name)) {
      err(`frontmatter name 重复: "${fm.name}"（${expected.get(fm.name)} 与 ${file}）`);
      continue;
    }
    expected.set(fm.name, file);
  }
  return expected;
}

function loadPack() {
  if (!existsSync(PACK_PATH)) {
    console.error(`❌ 找不到翻译包: ${PACK_PATH}`);
    process.exit(1);
  }
  const raw = readFileSync(PACK_PATH, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.error(`❌ JSON 解析失败: ${PACK_PATH}\n${e.message}`);
    process.exit(1);
  }
}

function checkTopStructure(pack) {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) {
    err('翻译包顶层必须是 JSON 对象');
    return;
  }
  if (pack.schemaVersion !== 1) err(`schemaVersion 必须为数字 1，实际: ${JSON.stringify(pack.schemaVersion)}`);
  if (pack.lang !== 'zh-CN') err(`lang 必须为 "zh-CN"，实际: ${JSON.stringify(pack.lang)}`);
  if (typeof pack.version !== 'string' || !pack.version.trim()) err('version 必须为非空字符串');
  if (!Array.isArray(pack.categories) || pack.categories.length === 0) {
    err('categories 必须为非空数组');
  }
  if (!pack.entries || typeof pack.entries !== 'object' || Array.isArray(pack.entries)) {
    err('entries 必须为对象（键 = frontmatter name）');
  }
}

/** 校验分类定义，返回 { topIds, allIds, byId } */
function checkCategories(pack) {
  const topIds = new Set();
  const allIds = new Set();
  const byId = new Map();
  if (!Array.isArray(pack.categories)) return { topIds, allIds, byId };

  for (const [i, cat] of pack.categories.entries()) {
    const where = `categories[${i}]`;
    if (!cat || typeof cat !== 'object' || Array.isArray(cat)) {
      err(`${where} 必须是对象`);
      continue;
    }
    if (typeof cat.id !== 'string' || !cat.id.trim()) {
      err(`${where}.id 必须为非空字符串`);
      continue;
    }
    if (allIds.has(cat.id)) err(`${where}.id 重复: "${cat.id}"`);
    allIds.add(cat.id);
    byId.set(cat.id, cat);
    if (typeof cat.zh !== 'string' || !cat.zh.trim()) err(`${where}.zh 必须为非空字符串`);
    if (typeof cat.order !== 'number' || !Number.isFinite(cat.order)) err(`${where}.order 必须为数字`);
    if (typeof cat.icon !== 'string' || !cat.icon.trim()) err(`${where}.icon 必须为非空字符串`);
  }

  // 二级分类：parent 必须指向存在的一级分类
  for (const [id, cat] of byId) {
    if (cat.parent === undefined) {
      topIds.add(id);
      continue;
    }
    if (typeof cat.parent !== 'string' || !allIds.has(cat.parent)) {
      err(`categories[${id}].parent 指向不存在的分类: ${JSON.stringify(cat.parent)}`);
    } else if (byId.get(cat.parent)?.parent !== undefined) {
      err(`categories[${id}].parent 必须是一级分类（不能挂二级）`);
    }
  }

  // 契约要求的 7 个一级分类
  for (const need of REQUIRED_TOP) {
    const cat = byId.get(need.id);
    if (!cat) {
      err(`缺少一级分类 "${need.id}"（${need.zh}）`);
      continue;
    }
    if (cat.parent !== undefined) err(`分类 "${need.id}" 必须是一级分类（不应有 parent）`);
    if (cat.zh !== need.zh) err(`分类 "${need.id}" 的 zh 应为 "${need.zh}"，实际: ${JSON.stringify(cat.zh)}`);
    if (cat.order !== need.order) err(`分类 "${need.id}" 的 order 应为 ${need.order}，实际: ${JSON.stringify(cat.order)}`);
    if (typeof cat.icon !== 'string' || [...cat.icon][0] !== [...need.icon][0]) {
      err(`分类 "${need.id}" 的 icon 应为 "${need.icon}"，实际: ${JSON.stringify(cat.icon)}`);
    }
  }
  return { topIds, allIds, byId };
}

function isSubsequence(sub, str) {
  let i = 0;
  for (const ch of str) {
    if (i < sub.length && ch === sub[i]) i += 1;
  }
  return i === sub.length;
}

function checkEntry(name, entry, topIds, zhNameSeen) {
  const tag = `entries["${name}"]`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    err(`${tag} 必须是对象`);
    return;
  }
  const zh = entry.zh;
  if (!zh || typeof zh !== 'object' || Array.isArray(zh)) {
    err(`${tag}.zh 必须是对象`);
    return;
  }

  for (const field of REQUIRED_ZH_FIELDS) {
    if (!(field in zh)) err(`${tag}.zh 缺少字段 "${field}"`);
  }

  // name：≤10 字、非空、不带“技能”
  if (typeof zh.name === 'string' && zh.name.trim()) {
    const zhName = zh.name.trim();
    if (cpLen(zhName) > NAME_MAX) err(`${tag}.zh.name 超过 ${NAME_MAX} 字（${cpLen(zhName)}）: "${zhName}"`);
    if (zhName.includes('技能')) err(`${tag}.zh.name 不应包含“技能”二字: "${zhName}"`);
    if (zhNameSeen.has(zhName)) err(`中文名重复: "${zhName}"（${zhNameSeen.get(zhName)} 与 ${name}）`);
    else zhNameSeen.set(zhName, name);
  } else if ('name' in zh) {
    err(`${tag}.zh.name 必须为非空字符串`);
  }

  // summary：≤40 字
  if (typeof zh.summary === 'string' && zh.summary.trim()) {
    if (cpLen(zh.summary.trim()) > SUMMARY_MAX) {
      err(`${tag}.zh.summary 超过 ${SUMMARY_MAX} 字（${cpLen(zh.summary.trim())}）: "${zh.summary}"`);
    }
  } else if ('summary' in zh) {
    err(`${tag}.zh.summary 必须为非空字符串`);
  }

  // 文本字段非空
  for (const field of ['description', 'whenToUse', 'notFor']) {
    if (typeof zh[field] !== 'string' || !zh[field].trim()) err(`${tag}.zh.${field} 必须为非空字符串`);
  }

  // category 必须是一级分类 id
  if (typeof zh.category !== 'string' || !zh.category.trim()) {
    err(`${tag}.zh.category 必须为非空字符串`);
  } else if (!topIds.has(zh.category)) {
    err(`${tag}.zh.category 不是一级分类 id: ${JSON.stringify(zh.category)}（可用: ${[...topIds].join(', ')}）`);
  }

  // tags：2-4 个非空字符串
  if (!Array.isArray(zh.tags)) {
    err(`${tag}.zh.tags 必须是数组`);
  } else {
    if (zh.tags.length < TAGS_MIN || zh.tags.length > TAGS_MAX) {
      err(`${tag}.zh.tags 需要 ${TAGS_MIN}-${TAGS_MAX} 个，实际 ${zh.tags.length} 个`);
    }
    if (zh.tags.some((t) => typeof t !== 'string' || !t.trim())) err(`${tag}.zh.tags 含空值或非字符串`);
    if (new Set(zh.tags).size !== zh.tags.length) err(`${tag}.zh.tags 存在重复项`);
  }

  // keywords：至少 1 个非空字符串
  if (!Array.isArray(zh.keywords) || zh.keywords.length === 0) {
    err(`${tag}.zh.keywords 必须为非空数组`);
  } else if (zh.keywords.some((k) => typeof k !== 'string' || !k.trim())) {
    err(`${tag}.zh.keywords 含空值或非字符串`);
  }

  // alias：可选，存在时须为数组且元素非空
  if ('alias' in zh) {
    if (!Array.isArray(zh.alias)) err(`${tag}.zh.alias 必须是数组`);
    else if (zh.alias.some((a) => typeof a !== 'string' || !a.trim())) err(`${tag}.zh.alias 含空值或非字符串`);
    else if (new Set(zh.alias).size !== zh.alias.length) err(`${tag}.zh.alias 存在重复项`);
  }

  // pinyin / pinyinInitials
  const pinyinOk = typeof zh.pinyin === 'string' && /^[a-z]+$/.test(zh.pinyin);
  if (!pinyinOk) err(`${tag}.zh.pinyin 必须为小写纯字母（无空格/声调）: ${JSON.stringify(zh.pinyin)}`);
  const initialsOk = typeof zh.pinyinInitials === 'string' && /^[a-z]+$/.test(zh.pinyinInitials);
  if (!initialsOk) err(`${tag}.zh.pinyinInitials 必须为小写纯字母: ${JSON.stringify(zh.pinyinInitials)}`);

  if (typeof zh.name === 'string' && typeof zh.pinyin === 'string' && typeof zh.pinyinInitials === 'string') {
    const zhName = zh.name.trim();
    if (isPureCJK(zhName)) {
      // 中文名全为汉字时，首字母数量必须等于字数，且字母顺序与全拼一致
      if (zh.pinyinInitials.length !== cpLen(zhName)) {
        err(`${tag}.zh.pinyinInitials 长度 ${zh.pinyinInitials.length} != 中文名字数 ${cpLen(zhName)}`);
      }
      if (pinyinOk && initialsOk) {
        if (zh.pinyin[0] !== zh.pinyinInitials[0]) err(`${tag}: pinyin 首字母与 pinyinInitials 不一致`);
        if (!isSubsequence(zh.pinyinInitials, zh.pinyin)) {
          err(`${tag}: pinyinInitials "${zh.pinyinInitials}" 不是 pinyin "${zh.pinyin}" 的首字母序列`);
        }
      }
    } else if (pinyinOk && initialsOk && zh.pinyin[0] !== zh.pinyinInitials[0]) {
      err(`${tag}: pinyin 首字母与 pinyinInitials 不一致`);
    }
  }

  // origin / review
  if (zh.origin !== 'builtin') err(`${tag}.zh.origin 必须为 "builtin"，实际: ${JSON.stringify(zh.origin)}`);
  if (zh.review !== 'reviewed') err(`${tag}.zh.review 必须为 "reviewed"，实际: ${JSON.stringify(zh.review)}`);
}

function main() {
  const skillsRoot = parseArgs(process.argv.slice(2));
  const pack = loadPack();
  checkTopStructure(pack);

  const expected = loadExpectedSkills(skillsRoot);
  const { topIds } = checkCategories(pack);

  const entries = pack.entries && typeof pack.entries === 'object' && !Array.isArray(pack.entries) ? pack.entries : {};
  const entryNames = Object.keys(entries);

  // 与磁盘真实技能集合比对：磁盘技能 0 缺 0 多；bundled 技能允许额外条目
  const missing = [...expected.keys()].filter((n) => !(n in entries)).sort();
  const extra = entryNames.filter((n) => !expected.has(n) && !BUNDLED_PACK_EXTRA.has(n)).sort();
  if (missing.length) err(`缺少 ${missing.length} 个技能条目: ${missing.join(', ')}`);
  if (extra.length) err(`多出 ${extra.length} 个技能条目（磁盘上不存在对应 frontmatter name）: ${extra.join(', ')}`);

  const zhNameSeen = new Map();
  for (const name of entryNames.sort()) checkEntry(name, entries[name], topIds, zhNameSeen);

  // 统计
  const dist = new Map();
  for (const name of entryNames) {
    const cat = entries[name]?.zh?.category;
    dist.set(cat, (dist.get(cat) ?? 0) + 1);
  }
  const catRows = [...topIds]
    .map((id) => ({ id, ...(REQUIRED_TOP.find((c) => c.id === id) ?? { zh: id, order: 999 }) }))
    .sort((a, b) => a.order - b.order);

  console.log('── dsh-skill-workbench 初始中文包校验 ──');
  console.log(`技能目录: ${skillsRoot}`);
  console.log(`磁盘技能: ${expected.size} 个 SKILL.md / ${expected.size} 个 frontmatter name`);
  console.log(`翻译条目: ${entryNames.length} 个${missing.length || extra.length ? '（与磁盘不一致）' : '（与磁盘一致）'}`);
  console.log('分类分布:');
  for (const row of catRows) {
    console.log(`  ${row.id.padEnd(9, ' ')} ${(row.zh ?? row.id).padEnd(10, ' ')} ${dist.get(row.id) ?? 0}`);
  }

  if (warnings.length) {
    console.log(`\n⚠️  警告 ${warnings.length} 条:`);
    for (const w of warnings) console.log(`  - ${w}`);
  }

  if (errors.length) {
    console.error(`\n❌ 校验失败：${errors.length} 个错误`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  console.log(`\n✅ 校验通过：${entryNames.length}/${expected.size} 覆盖，0 缺失，0 多余，0 错误`);
}

main();
