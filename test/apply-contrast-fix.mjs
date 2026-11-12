// 一次性提升「技能管理」页面文字对比度与字号：改用 inherit + opacity，避免依赖未知主题变量
import fs from 'node:fs';

const FILE = decodeURIComponent(new URL('../client.js', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
let src = fs.readFileSync(FILE, 'utf8');

const edits = [
  [
    'page: {\n        padding: \'20px 24px 32px\',\n        maxWidth: \'1120px\',\n        margin: \'0 auto\',\n        fontSize: \'13px\',\n        lineHeight: 1.55,\n        color: \'var(--dsh-text-primary, #e6e6e6)\',',
    'page: {\n        padding: \'20px 24px 32px\',\n        maxWidth: \'1120px\',\n        margin: \'0 auto\',\n        fontSize: \'14px\',\n        lineHeight: 1.6,\n        color: \'inherit\',',
  ],
  [
    "subtitle: { color: 'var(--dsh-text-secondary, #9aa0a6)', margin: '6px 0 0', maxWidth: '760px' },",
    "subtitle: { color: 'inherit', opacity: 0.8, fontSize: '13px', margin: '6px 0 0', maxWidth: '760px' },",
  ],
  [
    "muted: { color: 'var(--dsh-text-secondary, #9aa0a6)' },",
    "muted: { color: 'inherit', opacity: 0.75 },",
  ],
  ["small: { fontSize: '11px' },", "small: { fontSize: '12px' },"],
  ["padding: '4px 10px',\n        fontSize: '12px',", "padding: '5px 12px',\n        fontSize: '13px',"],
  ["padding: '5px 12px',\n        fontSize: '12px',", "padding: '6px 14px',\n        fontSize: '13px',"],
  [
    "border: '1px solid var(--dsh-border, rgba(127,127,127,0.35))',\n        background: 'transparent',\n        color: 'inherit',\n        borderRadius: '6px',\n        padding: '5px 8px',\n        fontSize: '13px',",
    "border: '1px solid var(--dsh-border, rgba(127,127,127,0.35))',\n        background: 'transparent',\n        color: 'inherit',\n        borderRadius: '6px',\n        padding: '6px 9px',\n        fontSize: '14px',",
    true,
  ],
  [
    "        color: 'var(--dsh-text-secondary, #9aa0a6)',\n        padding: '6px 12px',\n        fontSize: '13px',",
    "        color: 'inherit',\n        opacity: 0.75,\n        padding: '7px 12px',\n        fontSize: '13px',",
  ],
  [
    "        fontWeight: 500,\n        color: 'var(--dsh-text-secondary, #9aa0a6)',\n        whiteSpace: 'nowrap',",
    "        fontWeight: 500,\n        fontSize: '12.5px',\n        color: 'inherit',\n        opacity: 0.85,\n        whiteSpace: 'nowrap',",
  ],
  [
    "        padding: '1px 7px',\n        borderRadius: '10px',\n        fontSize: '11px',\n        lineHeight: 1.6,\n        border: '1px solid rgba(127,127,127,0.4)',",
    "        padding: '2px 8px',\n        borderRadius: '10px',\n        fontSize: '12px',\n        lineHeight: 1.6,\n        color: 'inherit',\n        border: '1px solid rgba(127,127,127,0.5)',",
  ],
  [
    "label: { display: 'block', fontSize: '12px', color: 'var(--dsh-text-secondary, #9aa0a6)', marginBottom: '2px' },",
    "label: { display: 'block', fontSize: '13px', fontWeight: 500, color: 'inherit', opacity: 0.85, marginBottom: '3px' },",
  ],
  [
    "mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '12px' },",
    "mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '12.5px' },",
  ],
  [
    "diag: { fontSize: '11px', color: 'var(--dsh-text-secondary, #9aa0a6)', marginTop: '6px', wordBreak: 'break-word' },",
    "diag: { fontSize: '12px', color: 'inherit', opacity: 0.72, marginTop: '6px', wordBreak: 'break-word' },",
  ],
  // 卡片：中文名 16px、/name 与简介更清楚
  [
    "{ style: { fontSize: '15px', fontWeight: 600, lineHeight: 1.35 } },",
    "{ style: { fontSize: '16px', fontWeight: 600, lineHeight: 1.35, color: 'inherit' } },",
  ],
  [
    "h('span', { style: sx(STYLES.mono, STYLES.muted) }, '/' + row.name)",
    "h('span', { style: sx(STYLES.mono, { color: 'inherit', opacity: 0.78 }) }, '/' + row.name)",
  ],
  [
    "                        fontSize: '12px',\n                        lineHeight: '1.5',\n                        color: 'var(--dsh-text-secondary, #9aa0a6)',\n                        marginTop: '2px',",
    "                        fontSize: '13px',\n                        lineHeight: '1.6',\n                        color: 'inherit',\n                        opacity: 0.88,\n                        marginTop: '3px',",
  ],
  // 分类分组头
  [
    "                  margin: r === 0 ? '6px 6px 0' : '16px 6px 0',\n                  fontSize: '12px',\n                  fontWeight: 600,\n                  letterSpacing: '0.02em',\n                  color: 'var(--dsh-text-secondary, #9aa0a6)',",
    "                  margin: r === 0 ? '8px 6px 0' : '20px 6px 0',\n                  fontSize: '13px',\n                  fontWeight: 600,\n                  letterSpacing: '0.02em',\n                  color: 'inherit',\n                  opacity: 0.95,",
  ],
  // 分类徽章
  [
    "h('span', { style: sx(STYLES.badge, { color: 'var(--dsh-text-secondary, #9aa0a6)' }) }, categoryText(index, rowZh && rowZh.category)),",
    "h('span', { style: sx(STYLES.badge, { color: 'inherit', borderColor: 'rgba(127,127,127,0.45)' }) }, categoryText(index, rowZh && rowZh.category)),",
  ],
  // 状态徽章：文字继承主题色，颜色只用于边框
  [
    "return h('span', { style: sx(STYLES.badge, { borderColor: color, color: color }) }, tr('status.' + key));",
    "return h('span', { style: sx(STYLES.badge, { borderColor: color, color: 'inherit', fontWeight: 500 }) }, tr('status.' + key));",
  ],
];

let failed = 0;
for (const entry of edits) {
  const oldText = entry[0];
  const newText = entry[1];
  const allowMultiple = entry[2] === true;
  const count = src.split(oldText).length - 1;
  if (count < 1 || (!allowMultiple && count !== 1)) {
    console.error('EDIT FAILED, occurrences=' + count + ' for: ' + oldText.slice(0, 60).replace(/\n/g, '\\n'));
    failed += 1;
    continue;
  }
  src = src.split(oldText).join(newText);
}
if (failed > 0) {
  console.error('ABORT: ' + failed + ' edit(s) not applied');
  process.exit(1);
}
fs.writeFileSync(FILE, src, 'utf8');
console.log('APPLIED ' + edits.length + ' edits to client.js');
