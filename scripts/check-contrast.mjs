// 主题配色对比度审计：从 client.js 抽出 THEME_VARS，按 WCAG 2.1 计算实际对比度。
//
// 用法：
//   node scripts/check-contrast.mjs
//   node scripts/check-contrast.mjs --bg-light=#ffffff --bg-dark=#16181d
//
// 说明：宿主背景色无法在离线环境测量，这里用 CLI 参数假定（默认白 / 深灰）。
// 有运行中的真实 DSH 时，应把实测背景色传进来再跑一次，才算“真实宿主复核”。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(join(root, 'client.js'), 'utf8');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
};
const HOST_BG = { light: arg('bg-light', '#ffffff'), dark: arg('bg-dark', '#16181d') };

// 从源码里抽 THEME_VARS 的两套调色板
function readPalette(theme) {
  const start = source.indexOf(`${theme}: {`);
  if (start < 0) throw new Error(`client.js 里找不到 ${theme} 调色板`);
  const end = source.indexOf('},', start + theme.length);
  const block = source.slice(start, end);
  const palette = new Map();
  for (const m of block.matchAll(/'--skw-[a-z-]+':\s*'([^']+)'/g)) {
    palette.set(m[0].split("'")[1], m[1]);
  }
  return palette;
}

const parseColor = (text) => {
  const s = String(text).trim();
  let m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) return { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16), a: 1 };
  m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) return { r: parseInt(m[1][0] + m[1][0], 16), g: parseInt(m[1][1] + m[1][1], 16), b: parseInt(m[1][2] + m[1][2], 16), a: 1 };
  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(',').map((x) => parseFloat(x.trim()));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  throw new Error(`无法解析颜色：${s}`);
};

const composite = (fg, bg) => ({
  r: fg.r * fg.a + bg.r * (1 - fg.a),
  g: fg.g * fg.a + bg.g * (1 - fg.a),
  b: fg.b * fg.a + bg.b * (1 - fg.a),
  a: 1,
});

const luminance = (c) => {
  const channel = (v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
};

const ratio = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

// [前景, 背景（可指向调色板里的 -bg）, 最低要求, 说明]
const CASES = [
  ['--skw-danger', '--skw-danger-bg', 4.5, '危险提示正文'],
  ['--skw-success', '--skw-success-bg', 4.5, '成功提示正文'],
  ['--skw-warning', '--skw-warning-bg', 4.5, '警告提示正文'],
  ['--skw-status-fresh', '--skw-status-fresh-bg', 4.5, '已翻译状态徽标'],
  ['--skw-status-stale', '--skw-status-stale-bg', 4.5, '过期状态徽标'],
  ['--skw-status-untranslated', '--skw-status-untranslated-bg', 4.5, '未翻译状态徽标'],
  ['--skw-status-draft', '--skw-status-draft-bg', 4.5, '草稿状态徽标'],
  ['--skw-on-primary', '--skw-primary', 4.5, '主按钮文字'],
  ['--skw-field-border', null, 3.0, '输入框边框（非文本，3:1）'],
  ['--skw-focus', null, 3.0, '焦点环（非文本，3:1）'],
];

let failures = 0;
for (const theme of ['light', 'dark']) {
  const palette = readPalette(theme);
  const hostBg = parseColor(HOST_BG[theme]);
  console.log(`\n${theme === 'light' ? '亮色' : '暗色'}主题（宿主背景 ${HOST_BG[theme]}）`);
  for (const [fgKey, bgKey, min, label] of CASES) {
    const fgRaw = palette.get(fgKey);
    if (!fgRaw) {
      console.log(`  ! ${label}：调色板缺 ${fgKey}`);
      failures += 1;
      continue;
    }
    const fg = parseColor(fgRaw);
    const bg = bgKey ? composite(parseColor(palette.get(bgKey)), hostBg) : hostBg;
    const got = ratio(composite(fg, bg), bg);
    const ok = got >= min;
    if (!ok) failures += 1;
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}：${got.toFixed(2)}:1（要求 ${min}:1）${fgKey}${bgKey ? ' / ' + bgKey : ''}`);
  }
}

console.log(failures === 0 ? '\n对比度审计通过。' : `\n对比度审计失败：${failures} 项不达标。`);
process.exit(failures === 0 ? 0 : 1);
