# dsh-skill-workbench「技能管理」· 交付前最终核对（Lead）

- 日期：2026-11-12
- 插件目录：`D:\开发\dev\dsh-skill-workbench`
- 包名：`dsh-skill-workbench`（v0.3.0；中文可见名「技能管理」）
- 安装位置：desktop profile（`C:\Users\Administrator\.dsh\profiles\desktop`，依赖 `link:D:/开发/dev/dsh-skill-workbench`）
- 运行中 App：`http://127.0.0.1:51825`（插件宿主路由与客户端 bundle 均已装载，见「六、迁移记录」）
- 历史包名：`dsh-skill-i18n`（v0.2.0，目录 `D:\工作区\dsh-skill-i18n` 仅作归档，已从 profile 移除、不再加载）

## 一、功能核对

| 需求 | 证据 | 状态 |
| --- | --- | --- |
| `/` 菜单按中文分类显示中文名与简介 | `render-test/menu-live-test.mjs`：真实 `/list` 52 条，装饰后 52/52 行有中文 label 与中文 section；query「调研」、拼音「qwdy」均命中 agent-reach | ✅ |
| 调用 token 保持英文 | 同一测试：`onPick` 返回 `/agent-reach `；行内 name 仍为英文 | ✅ |
| 管理页可改显示名 | 真实 HTTP：`save` 改 `agent-reach`→「全网调研（测试）」后 `/list` 立即生效；`delete` 后回退内置名，无脏数据 | ✅ |
| 管理页可编辑简介 / 分类 / 覆盖率 | 真实 React 渲染测试：详情页有「显示名称（中文名）」「采用原文简介」、分类下拉；顶部有中文覆盖率卡片 | ✅ |
| 初始中文显示包 | `translations/zh-CN.builtin.json` v1.1.0：53 条（45 用户技能 + 8 内置），校验器 0 缺失/0 多余/0 错误 | ✅ |
| 不做强制翻译 | 批量翻译页签已移除；AI 重译仅详情页可选按钮；默认使用内置显示包 | ✅ |
| 侧栏页面可见名 | 渲染测试：`sidebar.panellist` 注册 label = 「技能管理」 | ✅ |
| 列表可读性 | 卡片列表（15px 中文名 + 两行简介 + 分类分组头 + 分类筛选下拉） | ✅ |

## 二、测试与校验（全部通过）

- `node --check index.js / client.js / host/routes.js`
- `node host/selftest.mjs` → ALL GREEN（36 checks，expectedSkills 44）
- `node client.selftest.mjs` → 32 项断言组全绿
- `node translations/validate.mjs` → 53/45 覆盖，0 缺失，0 多余，0 错误
- `render-test/render-page-test.mjs` → RENDER TEST ALL GREEN（52 卡片、分组头、分类筛选、详情编辑、采用原文简介）
- `render-test/menu-live-test.mjs` → MENU LIVE TEST ALL GREEN（真实数据 52/52 中文）
- `render-test/test-extra.mjs` → EXTRA TEST ALL GREEN：
  - overlay 兼容模式（`settings.mode='overlay'`）自注册「技能」分组，52 行中文候选，`onPick` 仍插入英文 token；
  - 项目级 store（`<project>/.dsh/skill-cn/zh-index.json`）读取覆盖生效、不串味，删除后回退；
  - 测试后已复原 settings.mode=decorate，agent-reach 回退内置「全网调研」，无残留。

## 可读性修复（用户反馈"文字灰色看不清"后）

- 页面文字不再写死 `--dsh-text-secondary/#9aa0a6`，改为 `color: inherit`（继承宿主主题正文色）+ opacity 表达层级，避免浅色主题下灰字对比度不足。
- 字号整体放大：页面正文 13→14px、卡片中文名 15→16px、中文简介 12→13px（行高 1.6）、分组头 12→13px、表单标签 12→13px、徽章 11→12px；输入框/按钮同步放大。
- 状态徽章文字改为继承主题色，仅用边框颜色区分状态；`/name` 与简介透明度分别 0.78/0.88。
- 已通过 `node --check`、client.selftest（32 组）、render-page-test（含 52 卡片/分组头/分类筛选）；unlag 热重载 op7，i18n rev `479aaf94f513`，bundle 101769B 已含修复。

## 三、运行态证据（当前进程）

- `GET /api/dsh-skill-workbench/health` → 200 `{"ok":true,"version":"0.1.0"}`
- `GET /api/dsh-skill-workbench/list?cwd=D:\工作区` → 200，coverage：`total=52 translated=52 untranslated=0`
- `GET /api/dsh-skill-workbench/status` → `diagnostics.lastClientDecorate = {"decorated":true,"rows":52,"error":null}`
- 最新客户端 bundle rev：`d0747791be82`（bundle 内含「全部分类」「技能管理」，语法校验通过）

## 四、剩余动作（仅差用户）

页面重建只能由页面自身发起：点右上角刷新按钮或 `Ctrl+R`（或重启 App）。刷新后确认：
1. 侧栏入口显示「技能管理」；
2. `/` 菜单为 7 个中文分类、52 条全中文；
3. 管理页卡片列表 + 分类分组头 + 分类筛选下拉。

## 五、回滚

1. 停用：在 DSH 插件列表关闭 `dsh-skill-workbench`（或 profile `cordis.patch.yml` 对应行 `disabled: true`）；
2. 卸载：`dsh plugin --profile desktop remove dsh-skill-workbench`，并从 profile `package.json` 的 `dsh.profile.bundles` 删掉该行；
3. 备份：`D:\工作区\_dsh_design\backup\`（profile package.json / cordis.patch.yml 原始版本）；
4. 插件不改任何 SKILL.md、不写技能目录，删除插件即完全回退。

## 六、迁移记录（dsh-skill-i18n → dsh-skill-workbench，2026-11-12）

1. 新目录 `D:\工作区\dsh-skill-workbench` 建立，代码/文案/文档全库改名为 `dsh-skill-workbench`（包名、插件 id、HTTP 基路径 `/api/dsh-skill-workbench/`、存储目录 `$DSH_HOME/dsh-skill-workbench/`、面板 id、`localStorage` 键均一致）。
2. 用户数据迁移：`C:\Users\Administrator\.dsh\dsh-skill-i18n\index.json` 复制到 `C:\Users\Administrator\.dsh\dsh-skill-workbench\index.json`（当时 entries 为空、settings 已保留）。
3. profile 迁移：`dsh plugin --profile desktop add link:D:\工作区\dsh-skill-workbench` → 自动追加依赖与 bundles；`dsh plugin --profile desktop remove dsh-skill-i18n` → 自动移除依赖与旧 bundle 行；手工删除残留符号链接 `profiles\desktop\node_modules\dsh-skill-i18n`。
4. 热重载：`POST /dsh-unlag/reload?requestId=lead-workbench-migrate` → `{"status":"done","completion":"full","operationId":1}`；`/dsh-unlag/graph` 中 entry `id=dsh-skill-workbench`、`rev=19db4fbbfa8d`。
5. 迁移后实测：
   - `GET /api/dsh-skill-workbench/health` → 200 `{"ok":true,"version":"0.3.0"}`；
   - `GET /api/dsh-skill-workbench/status` → 200，userPath 指向新目录，builtinVersion `1.1.0`；
   - `GET /api/dsh-skill-workbench/list?cwd=D:\工作区` → 200，coverage `{"total":52,"translated":52,"draft":0,"stale":0,"untranslated":0}`，7 个分类；
   - 旧路径 `/api/dsh-skill-i18n/health` → 401（未注册，符合预期）；
   - `node test/run-live.mjs`（origin=51825）→ **LIVE TESTS ALL GREEN**：render-page-test 20 项、menu-live-test 16 项、test-extra 14 项全部通过。
6. 仍需用户执行一次页面刷新（Ctrl+R 或右上角刷新按钮）以载入新客户端 bundle（运行中页面仍持有旧 bundle；旧页面调用旧 API 会 401）。刷新后确认：侧栏「技能管理」、页面字号/对比度、`/` 菜单中文分类。

## 七、目录迁移记录（2026-11-12，搬迁到 D:\开发\dev）

1. 插件目录从 `D:\工作区\dsh-skill-workbench` 整体移动到 `D:\开发\dev\dsh-skill-workbench`。
2. profile 迁移：`dsh plugin --profile desktop remove dsh-skill-workbench`（清依赖与旧 bundle 行）→ `add link:D:\开发\dev\dsh-skill-workbench`（自动追加依赖与新 bundle 行），`node_modules\dsh-skill-workbench` 链接目标已变为 `..\..\..\..\..\开发\dev\dsh-skill-workbench` 且可解析。
3. 文档中的安装/开发路径同步更新（README、DESIGN、VERIFY）；代码内无绝对路径（测试用 `import.meta.url` 相对定位，仅测试夹具 `cwd` 仍用 `D:\工作区`）。
4. 迁移后需热重载一次（`POST /dsh-unlag/reload`）让宿主按新路径加载；页面刷新后生效。
