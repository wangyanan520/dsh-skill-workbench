// 中文层质量审计（只读，不改数据）
//
// 用法：
//   node scripts/audit-zh.mjs                       # 输出 P1/P2 清单；有 P1 时 exit 1
//   node scripts/audit-zh.mjs --strict              # P2 也算失败
//   node scripts/audit-zh.mjs --builtin-only        # 只审内置中文包（不依赖本机技能目录，供 CI）
//   node scripts/audit-zh.mjs --require-data        # 一个技能都没审到就失败，防止空环境假绿
//
// 为什么需要 --builtin-only / --require-data：
//   CI 里既没有 ~/.agents/skills 也没有用户层数据，默认模式下待审集合为空，
//   “P1 0 条 → 审计通过”会给出一个什么都没检查的绿灯。
//   加上这两个开关后，CI 审计的对象改为随仓库提交的 translations/zh-CN.builtin.json，
//   并且一旦待审集合为空直接失败，不允许静默通过。
//
// 判定分两级：
//   P1 = 硬规则违规（中文名缺失/超长、摘要里留英文句子、无分类、缺拼音、磁盘找不到原文等），必须修
//   P2 = 待人工判断（原文标识符未全部保留、摘要过长/过短、别名过短等），多数可接受
//
// 注意：器械化规则必须区分“普通英文词应翻译”与“专有名词/标识符应保留”，
// 否则会把正常翻译报成“术语丢失”。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkillContent } from '../host/frontmatter.js';
import { loadUserStore, loadBuiltinPack } from '../host/store.js';
import { listSkillRoots, resolveLocalization, rankOfKind } from '../host/scan.js';

const CJK = /[\u3400-\u4DBF\u4E00-\u9FFF]/;
const cjkCount = (s) => [...String(s || '')].filter((c) => CJK.test(c)).length;

// 判定“摘要里留了英文句子”。
// 关键取舍：连续英文词不等于英文句子。规范/产品专有名词（Web Interface Guidelines、
// Claude Code、Markdown Parser）按规则应当保留原文，而它们的形态都是“首字母大写”。
// 真正的未翻译句子一定含全小写实词或英文虚词（the/of/use/when/...）。
// 旧实现只看“连续 3 个英文词”，会把内置包里的正当专有名词报成 P1。
function looksLikeEnglishSentence(text) {
  const sequences = String(text || '').match(/[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){2,}/g) || [];
  for (const sequence of sequences) {
    const words = sequence.split(/\s+/);
    if (words.some((word) => word.length >= 3 && word === word.toLowerCase())) return true;
  }
  // 两个英文词 + 虚词（如 “for Claude”）同样视为未翻译
  return /[A-Za-z]{2,}\s+(?:the|of|and|use|when|in|to|for|is|are|with|not|you|this|that)\b/i.test(String(text || ''));
}
const strict = process.argv.includes('--strict');
const builtinOnly = process.argv.includes('--builtin-only');
const requireData = process.argv.includes('--require-data');

// 1) 磁盘原文：按 rank 去重（数字小者优先，与 host/scan.js 一致）
const disk = new Map();
for (const root of listSkillRoots({ cwd: process.cwd(), config: {} })) {
  if (!existsSync(root.dir)) continue;
  for (const entry of readdirSync(root.dir, { withFileTypes: true })) {
    const path = entry.isDirectory() ? join(root.dir, entry.name, 'SKILL.md') : join(root.dir, entry.name);
    if (!existsSync(path)) continue;
    let parsed;
    try {
      parsed = parseSkillContent(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    if (!parsed) continue;
    const existing = disk.get(parsed.name);
    const candidate = { ...parsed, path, rank: root.rank, kind: root.kind };
    if (!existing || candidate.rank < existing.rank) disk.set(parsed.name, candidate);
  }
}

// 2) 合并层：内置包 + 用户层 + 项目层（与客户端实际看到的层级一致）
const stores = {
  userStore: loadUserStore().store,
  projectStore: { entries: {} },
  builtin: loadBuiltinPack(),
};

// 英文虚词：作为“术语”统计时排除，避免把正常翻译误判成术语丢失
const STOP = new Set(['the', 'and', 'for', 'use', 'when', 'with', 'you', 'user', 'users', 'not', 'do', 'does', 'a', 'an', 'of', 'to', 'in', 'on', 'is', 'are', 'it', 'this', 'that', 'or', 'should', 'must', 'please', 'skill', 'skills', 'your', 'can', 'by', 'as', 'be', 'from', 'into', 'if', 'only', 'also', 'but', 'all', 'any', 'more', 'than', 'then', 'there', 'their', 'its', 'has', 'have', 'was', 'were', 'will', 'would', 'may', 'might', 'up', 'out', 'no', 'yes', 'after', 'before', 'other', 'each', 'such', 'so', 'we', 'they', 'them', 'my', 'me', 'i', 'us', 'our', 'at', 'over', 'about', 'per', 'via', 'using', 'need', 'needs', 'want', 'file', 'files', 'task', 'tasks', 'data', 'api', 'apis', 'tool', 'tools', 'code', 'one', 'two', 'new', 'get', 'set', 'run', 'make', 'give', 'take', 'help', 'work', 'line', 'like', 'just', 'some', 'how', 'what', 'which', 'who', 'workflow', 'section', 'step', 'steps', 'example', 'examples', 'based', 'across', 'support', 'supports', 'allow', 'allows']);

// 已确认保留英文的专有名词：只用于“摘要英文残留”判定
const KEEP_LATIN = /Markdown|OpenAPI|note_id|lark-cli|CLI|API|Base|OKR|PRD|TDD|AGENTS\.md|Git|JSON|HTML|CSS|SQL|CSV|YAML|URL|LLM|AI/g;

// 规则自检：专有名词不得误报，英文句子必须命中。改动 looksLikeEnglishSentence 前先跑这个。
const ENGLISH_CASES = [
  ['按 Web Interface Guidelines 审查界面代码并给出定位', false],
  ['用 Claude Code 批量重构旧模块', false],
  ['按 Markdown 规范整理文档结构', false],
  ['审查 UI 代码是否符合可访问性最佳实践', false],
  ['Review the interface code and report issues', true],
  ['Use this skill when user asks for a UI review', true],
  ['Superpowers for Claude Code', true],
  ['Pull the latest guidelines before reviewing', true],
];
if (process.argv.includes('--self-test')) {
  let failed = 0;
  for (const [text, expected] of ENGLISH_CASES) {
    const actual = looksLikeEnglishSentence(text.replace(KEEP_LATIN, ' '));
    if (actual !== expected) {
      failed += 1;
      console.error(`  FAIL 期望 ${expected ? '命中' : '不命中'}：${text}`);
    }
  }
  console.log(failed ? `规则自检失败 ${failed}/${ENGLISH_CASES.length} 项` : `规则自检通过 ${ENGLISH_CASES.length} 项`);
  process.exit(failed ? 1 : 0);
}

// --builtin-only 是 CI 门禁：只审随仓库提交的内置包，不能把本机
// $DSH_HOME 用户层、项目层或磁盘技能混进来。否则同一份代码在作者机器上
// 会因为孤儿条目/本机技能变红，在干净 CI 上却变绿，门禁结果不可复现。
let names;
if (builtinOnly) {
  stores.userStore = { entries: {} };
  stores.projectStore = { entries: {} };
  disk.clear();
  names = new Set(Object.keys(stores.builtin.entries || {}));
} else {
  names = new Set([...Object.keys(stores.userStore.entries), ...disk.keys()]);
}
const rows = [];
const stats = { reviewed: 0, draft: 0, untranslated: 0 };

for (const name of names) {
  const zh = resolveLocalization(name, stores).zh || {};
  const origin = disk.get(name);
  const p1 = [];
  const p2 = [];

  if (!zh.name) {
    stats.untranslated += 1;
    p1.push('没有中文名（未翻译）');
  } else if (zh.review === 'reviewed') stats.reviewed += 1;
  else stats.draft += 1;

  const nameCjk = cjkCount(zh.name);
  if (nameCjk > 10) p1.push(`中文名 ${nameCjk} 汉字（规则 ≤10）`);
  // “技能”二字只在技能本身不是主题时才违规；名字本身带 skill / 标签含技能的属于正当用法
  const aboutSkills = /skill/i.test(name) || (zh.tags || []).some((t) => /技能|skill/i.test(t));
  if (/技能/.test(zh.name || '') && !aboutSkills) p1.push('中文名含“技能”二字（规则禁止）');
  if (zh.name && nameCjk === 0) p1.push('中文名没有汉字');

  // 英文残留只认“英文句子”，单个专有名词属于规则要求保留（判定细节见 looksLikeEnglishSentence）
  const summaryNoTerms = String(zh.summary || '').replace(KEEP_LATIN, ' ');
  if (looksLikeEnglishSentence(summaryNoTerms)) p1.push('摘要里留有英文句子');

  if (!zh.category || zh.category === 'uncategorized') p1.push('无分类');
  if (zh.description && zh.description === zh.summary) p1.push('description 与 summary 完全相同');
  if (nameCjk > 0) {
    const managed = String(zh.pinyin || '').split(/\s+/)[0] || '';
    if (managed.length < nameCjk) p1.push(`拼音疑似缺字（汉字 ${nameCjk}，全拼首段 ${managed.length}）`);
  }
  if (!zh.whenToUse) p1.push('缺 whenToUse');
  if (!zh.notFor) p1.push('缺 notFor');

  const summaryLen = [...String(zh.summary || '')].length;
  if (summaryLen > 40) p2.push(`summary ${summaryLen} 字（规则 ≤40）`);
  if (summaryLen > 0 && summaryLen < 10) p2.push(`summary 仅 ${summaryLen} 字，可能过空泛`);
  for (const alias of zh.alias || []) if ([...alias].length <= 1) p2.push(`别名 “${alias}” 只有 1 字`);

  // 专有名词保留：只认标识符型术语（含大写/数字/路径分隔符），普通英文词按规则应翻译
  if (origin) {
    if (!origin.description) {
      p2.push('磁盘原文缺 description，无法核对');
    } else {
      const idLike = (origin.description.match(/[A-Za-z][A-Za-z0-9.+#_/-]*/g) || [])
        .filter((t) => (/[A-Z]/.test(t) || /[0-9]/.test(t) || /[/._-]/.test(t)) && t.length >= 3 && !STOP.has(t.toLowerCase()));
      const tokens = new Set(idLike.map((t) => t.toLowerCase()));
      const zhText = [zh.name, zh.summary, zh.description, zh.whenToUse, zh.notFor, (zh.alias || []).join(' '), (zh.keywords || []).join(' '), (zh.tags || []).join(' ')]
        .filter(Boolean).join(' ').toLowerCase();
      const lost = [...tokens].filter((t) => !zhText.includes(t));
      if (tokens.size >= 2 && lost.length >= 2) {
        p2.push(`原文标识符未保留 ${lost.length}/${tokens.size}：${lost.slice(0, 6).join(', ')}`);
      }
    }
  } else if (!builtinOnly) {
    // CI 模式（--builtin-only）本来就没有磁盘原文，这条不能报，否则每条都是假 P1
    p1.push('磁盘上找不到该技能');
  }

  if (p1.length || p2.length) rows.push({ name, zhName: zh.name, review: zh.review, origin: zh.origin, p1, p2 });
}

const total = names.size;
const p1Count = rows.filter((r) => r.p1.length).length;
const p2Count = rows.filter((r) => !r.p1.length && r.p2.length).length;
const clean = total - rows.length;

// 空集合必须失败：0 个待审对象时“没有 P1”不代表质量合格，只代表什么都没查。
if (total === 0 && (requireData || builtinOnly)) {
  console.error('审计失败：待审技能数为 0，没有可审计的数据。');
  console.error('本机请先安装技能或检查技能目录；CI 请用 --builtin-only 审内置中文包。');
  process.exit(1);
}

if (builtinOnly) console.log('模式：内置中文包（translations/zh-CN.builtin.json）· 跳过依赖磁盘原文的规则');
console.log(`技能 ${total} 个 · 有中文名 ${total - stats.untranslated} · 已审核 ${stats.reviewed} · 草稿 ${stats.draft} · 未翻译 ${stats.untranslated}`);
console.log(`P1 ${p1Count} 条 · P2 ${p2Count} 条 · 干净 ${clean} 条\n`);
for (const row of rows) {
  console.log(`[${row.review || '-'}/${row.origin || '-'}] ${row.name} → ${row.zhName || '(无中文名)'}`);
  for (const x of row.p1) console.log(`  P1 ${x}`);
  for (const x of row.p2) console.log(`  P2 ${x}`);
}

if (p1Count > 0) {
  console.error(`\n审计失败：${p1Count} 条 P1 违规。`);
  process.exit(1);
}
if (strict && p2Count > 0) {
  console.error(`\n严格模式失败：${p2Count} 条 P2 待复核。`);
  process.exit(1);
}
console.log('\n审计通过：没有 P1 违规。');
