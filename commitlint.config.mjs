// 提交信息校验（commitlint）
//
// 这里是 type / scope 的**唯一真源**，docs/GIT-CONVENTIONS.md 的表格与之同步维护。
// 改这里必须同步改文档，反之亦然。
//
// 与通用配置的三处有意偏差：
//  1. header 长度按「显示宽度」而非字符数：中文一个汉字占 2 列，用默认的
//     header-max-length（计数按字符）会把 36 个汉字的合规标题判成 36 字符通过，
//     也会让 50 个汉字的标题被误判。这里自定义 header-display-width（上限 72）。
//  2. scope 允许用 `+` 连接多层（fix(ui+host)），默认 scope-enum 会把 `ui+host` 当整体。
//  3. 放行 git autosquash 前缀（fixup!/squash!/amend!），否则 rebase -i 流程被卡死。
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const conventional = require('@commitlint/config-conventional');

const TYPES = [
  'feat', // 新增用户可见能力
  'fix', // 修复缺陷
  'perf', // 性能优化
  'refactor', // 重构，行为不变
  'docs', // 文档
  'test', // 测试
  'build', // 打包/依赖/清单
  'ci', // CI 配置
  'chore', // 杂项（发版准备、市场索引）
  'style', // 纯格式
  'revert', // 回滚
];

const SCOPES = [
  'client',
  'host',
  'ui',
  'i18n',
  'tooling',
  'test',
  'docs',
  'market',
  'release',
  'deps',
];

// 全角/CJK 字符按 2 列计算（覆盖中文、日文、韩文、全角标点）
const WIDE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

function displayWidth(text) {
  let width = 0;
  for (const char of String(text || '')) width += WIDE.test(char) ? 2 : 1;
  return width;
}

export default {
  extends: ['@commitlint/config-conventional'],
  ignores: [
    // git rebase -i / commit --fixup 生成的提交，交给 autosquash 处理
    (message) => /^(fixup|squash|amend)!\s/.test(message),
    // 合并提交
    (message) => /^Merge\b/.test(message),
  ],
  plugins: [
    {
      rules: {
        'header-display-width': ({ header }) => {
          const width = displayWidth(header);
          return [
            width <= 72,
            `标题显示宽度 ${width}，上限 72（中文按 2 列计，约 36 个汉字）。超了就砍细节，细节放正文。`,
          ];
        },
        'scope-known': ({ scope }) => {
          if (!scope) return [true];
          const parts = String(scope)
            .split('+')
            .map((part) => part.trim())
            .filter(Boolean);
          const unknown = parts.filter((part) => !SCOPES.includes(part));
          return [
            unknown.length === 0,
            `未知 scope：${unknown.join('、')}。允许 ${SCOPES.join(' / ')}，跨层用 + 连接（如 ui+host）。`,
          ];
        },
        // 内置 subject-full-stop 的第三个参数只接受单个字符串，传数组会被字符串化成
        // "。 ， ；" 整体做 endsWith，导致中文句号拦不住（实测放过 fix(ui): 修正某处。）。
        'subject-no-stop': ({ subject }) => {
          if (!subject) return [true];
          return [
            !/[。，；、.!,;]$/.test(String(subject).trim()),
            '标题不要用句号/逗号结尾（中文标点同样禁止）',
          ];
        },
      },
    },
  ],
  rules: {
    ...conventional.rules,

    'type-enum': [2, 'always', TYPES],
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],

    // 用自定义规则校验，允许多层 scope；默认 scope-enum 见上方说明
    'scope-enum': [0],
    'scope-case': [0],
    'scope-known': [2, 'always'],

    // 标题按显示宽度算，默认的字符计数规则关闭
    'header-max-length': [0],
    'header-display-width': [2, 'always'],
    'header-trim': [2, 'always'],

    'subject-empty': [2, 'never'],
    // 中文标题不该有句号/逗号收尾（内置 subject-full-stop 不支持多标点，改用自定义规则）
    'subject-full-stop': [0],
    'subject-no-stop': [2, 'always'],
    // 中文没有大小写，config-conventional 的 lower-case 会误伤
    'subject-case': [0],

    'body-max-line-length': [2, 'always', 110],
    'footer-max-line-length': [2, 'always', 110],
    'body-leading-blank': [2, 'always'],
    'footer-leading-blank': [2, 'always'],
  },
};
