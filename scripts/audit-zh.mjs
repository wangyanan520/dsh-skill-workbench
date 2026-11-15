// 中文层质量审计（只读，不改数据）
//
// 用法：
//   node scripts/audit-zh.mjs             # 输出 P1/P2 清单；有 P1 时 exit 1
//   node scripts/audit-zh.mjs --strict    # P2 也算失败，适合放进 CI
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
const strict = process.argv.includes('--strict');

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

const names = new Set([...Object.keys(stores.userStore.entries), ...disk.keys()]);
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

  // 英文残留只认“连续英文短语”，单个专有名词属于规则要求保留
  const summaryNoTerms = String(zh.summary || '').replace(KEEP_LATIN, ' ');
  const englishPhrase = /[A-Za-z]{2,}\s+[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(summaryNoTerms)
    || /[A-Za-z]{2,}\s+(?:the|of|and|use|when|in|to|for|is|are|with|not|you|this|that)\b/i.test(summaryNoTerms);
  if (englishPhrase) p1.push('摘要里留有英文句子');

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
  } else {
    p1.push('磁盘上找不到该技能');
  }

  if (p1.length || p2.length) rows.push({ name, zhName: zh.name, review: zh.review, origin: zh.origin, p1, p2 });
}

const total = names.size;
const p1Count = rows.filter((r) => r.p1.length).length;
const p2Count = rows.filter((r) => !r.p1.length && r.p2.length).length;
const clean = total - rows.length;

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
