# dsh-skill-workbench 项目指南

最后核对：2026-11-18（补 0.3.5 发版交接与桌面端更新排查）

## 这是什么

DSH 客户端插件：给英文技能目录加一层中文显示。`/` 菜单按中文分类显示中文名与简介，调用 token 仍为英文 `/name`。管理页编辑中文名、简介、分类、标签，查看覆盖率与安装源简介，可选 AI 重译，个人技能卸载到回收站。

硬约束：

- **绝不修改 `SKILL.md`**，也不改技能的英文 `name`。
- 用户数据只写 `$DSH_HOME/dsh-skill-workbench/`；卸载个人技能才写 `~/.agents/skills` 与 `~/.agents/.skill-lock.json`。
- 项目层中文层在 `<project>/.dsh/skill-cn/zh-index.json`，合并优先级高于用户层。
- 页面是零构建客户端插件，运行在 DSH 的 React 18 / `window.__ModuleLoader__` 环境里；不引入构建步骤。

## 目录

- `client.js`：客户端全部逻辑与内联样式。`apply` 注册 `sidebar.panellist` 与 `main`；管理页与 `/` 菜单装饰都在这里。
- `host/`：Cordis 主机插件。`routes.js` 提供 17 条 exact HTTP 路由；`scan.js` 扫描技能与 coverage；`store.js` 读写索引；`translate.js` 调宿主模型；`uninstall.js` 管理回收站。
- `translations/`：内置中文包与 `validate.mjs`。
- `test/`：`fixture.mjs` 在临时目录造确定的技能根（写盘 + 走真实 `scan.js`）；`page-regression-test.mjs` 用 react-test-renderer 渲染管理页；`render-page-test.mjs` 对真实宿主联调；`run-live.mjs` 对真实 DSH 做联调。
- `docs/`：设计与接口契约；新增文档必须在本文件“文档索引”加一行。
- `commitlint.config.mjs` + `.husky/`：提交信息规则与提交前门禁（`.editorconfig` 管格式）。

## 数据流

1. `scan.js` 扫描技能根目录与 registry，生成 `SkillView`、coverage、diagnostics。
2. `store.js` 合并内置包、用户层、项目层；`/list`、`/status` 返回给客户端。
3. `client.js` 的 `loadIndex` 带 30s TTL 缓存；Page 每 30s 静默刷新（不闪加载态）。
4. 保存只提交改动字段；改内容会把草稿标为 `reviewed`；详情页另有“确认审核”只提交 review。
5. 菜单装饰只改渲染行的 label/description/section/icon，不改调用 token。

## 常用命令

```bash
node --check client.js
node client.selftest.mjs                      # 32 组断言，必须全绿
node host/selftest.mjs                        # 有 ~/.agents/skills 就跑真实扫描（期望值现算，不写死技能名）
SKIP_REAL_AGENTS_SCAN=1 node host/selftest.mjs # 跳过本机技能目录扫描（CI 与 pre-commit 用这个）
npm run selftest                              # client + host + translations/validate
npm run audit:zh                              # 中文层质量审计（对照磁盘 SKILL.md 原文，有 P1 时 exit 1）
npm run audit:zh:strict                       # P2 也算失败
npm run audit:zh:ci                           # CI 用：--builtin-only 只审内置包 + --require-data（0 条即失败）
npm run audit:zh:selftest                     # 审计规则自检（专有名词不误报 / 英文句子必命中）
npm run check:contrast                        # 主题配色对比度核算（亮/暗两套，WCAG 4.5:1 / 3:1）
npm run test:page                             # 管理页离线回归（临时目录夹具，不依赖本机技能目录/运行中宿主）
node test/render-page-test.mjs                # 需要运行中的宿主（真实 HTTP API）
node test/run-live.mjs                        # 真实 DSH 联调，需要运行中的宿主
```

提交门禁（`npm i` 后由 husky 自动装到 `.husky/_`，`core.hooksPath` 已指向那里）：

- `pre-commit`：`node --check client.js` + client selftest + check-contrast + host selftest（`SKIP_REAL_AGENTS_SCAN=1`）+ 管理页离线回归，约 5 秒；
- `commit-msg`：commitlint（`commitlint.config.mjs`，与 `docs/GIT-CONVENTIONS.md` 同步维护）；
- 绕过：`git commit --no-verify`（本次）或 `HUSKY=0 git commit`（完全禁用）；未装依赖时钩子只警告不阻断（页面回归缺 `react-test-renderer` 时跳过并提示）。
- CI（`.github/workflows/selftest.yml`）先 `npm ci`，再跑：双 selftest + `check:contrast` + `test:page` + `audit:zh:selftest` + `audit:zh:ci`。

当前环境注意：

- `node client.selftest.mjs`、`node host/selftest.mjs`（不加 SKIP）、`npm run selftest` 在本机全绿。
- 门禁**不得**把本机技能集当契约，这是 2026-11-16 修过的一类缺陷：`host/selftest.mjs` 曾写死 `image-to-code` 等 4 个技能名与 `agent-reach` 样本，技能一卸载就变红；`translations/validate.mjs` 曾把「内置包与本机技能目录不一致」当错误（内置包发给所有用户，覆盖精选技能集，与本机装了什么无关）。现在前者从磁盘现算期望值，后者默认只报警告、`--strict` 才升级、`--skills` 指错目录（0 命中）仍直接失败。**再往这两处加断言时，不要写死具体技能名。**
- `translations/validate.mjs` 在本机仍会打印一条漂移警告（内置包 53 条与本机 48 个技能命中 11 条），属环境数据，退出码 0。
- `test/page-regression-test.mjs` 的载荷由 `test/fixture.mjs` 在 `os.tmpdir()` 里造：真写 `SKILL.md` 与 `index.json`，再把 `DSH_HOME`/`DSH_AGENTS_HOME` 指过去，扫描仍走真实 `host/scan.js`。因此它不随本机技能目录变化，CI 与本机结果一致，已进门禁——**不要改回扫本机目录**，否则 CI 会因为没有 `~/.agents/skills` 直接红。
- `test/render-page-test.mjs` 需要运行中的宿主（默认 `127.0.0.1:51825`），离线跑会失败——离线回归用 `npm run test:page`。
- **CI 里不要用默认 `audit:zh`**：没有 `~/.agents/skills` 时待审集合为空，会打印「审计通过」却什么都没查；CI 用 `audit:zh:ci`（审内置包 + 空数据即失败）。
- `react` / `react-test-renderer` 已在 `devDependencies` 里，`npm i` 后即可跑页面测试；`node_modules` 不入库。

## UI 不变量（2026-11 两轮审查后）

- 主题色统一走 `--skw-*` 变量；亮/暗色都必须满足正文 4.5:1、大字 3:1、控件边框 3:1。不要再硬编码 `#ff9d9d`、`#4c8dff` 这类颜色。新增 UI 用到的变量必须同时加进 `THEME_VARS` 亮暗两套**和** `scripts/check-contrast.mjs` 的 CASES 清单（`--skw-surface`/`--skw-border` 曾因只引用不定义而漏网）。
- 宿主 `/list` 下发的字段在客户端 `normalizeSkillView` 透传时逐个核对：新增字段必须进白名单（`layers`/`install` 曾被丢弃，整块 UI 变死代码），并在 `test/page-regression-test.mjs` 加断言。
- 任何会丢失编辑的离开路径必须走脏检查：详情返回、切换分区、窗口关闭、popstate（含未识别 hash）。后台刷新不能覆盖正在编辑的表单。拦不住的路径靠草稿救援兜底：脏表单镜像 `sessionStorage['skw:draft:<name>']`，重开时询问恢复/丢弃。
- 详情页的写操作（保存/审核/清除/卸载/重译）互斥：函数守卫 + 按钮禁用双向传播，禁止在途请求交叉。
- 保存失败必须出现在保存按钮附近（`role=alert`），不能只发一个 6 秒后消失的页顶横幅。
- 破坏性操作必须二次确认并限时复位（5s），同时提供取消；不要恢复无超时的 armed 状态。
- 列表每行只能有一个可聚焦入口；不要再把 `button` 嵌进 `role=button` 行。行使用 `<a data-skw-row href="#skill/...">`。
- 详情页先给中文编辑区：窄屏 `.skw-detail-zh` 排到英文原文卡之前；底部操作栏 sticky；覆盖卡与诊断只在库列表显示。
- 覆盖率讲“有中文”，不等于“已审核”；不要再把两者混成一个百分比。
- 交互状态（tab/filter/搜索/详情）同步到 URL hash 与 `sessionStorage['skw:route']`；浏览器前进/后退要能恢复路由，后退离开脏表单前必须确认。
- 后台静默刷新失败**不得**把已有数据的页面顶成错误态：降级为会自动消失的提示（8s），列表保持上一次数据；只有首次加载失败才用整页错误态。
- hash 里的筛选值必须过白名单（`SKILL_FILTERS`），非法值退回 `all`；否则列表会被整空且没有任何按钮呈按下态。
- 行内状态色一律走 `--skw-status-*`，不要再维护第二份硬编码色表（`STATUS_COLORS` 曾与 `THEME_VARS` 漂移）。

## 宿主不变量

- translate 任务必须有并发上限（`MAX_RUNNING_JOBS`，超出返回 `ERR_BUSY` → HTTP 429）与单次输出上限（`MAX_OUTPUT_CHARS`）；adapter 不守 `maxTokens` 时不能让它把内存吃穿。
- 请求体超限时**不要** `req.destroy()`：那会让客户端收到 ECONNRESET 而不是 413 JSON。正确做法是停止累积 + `req.resume()` 排空。
- 卸载/恢复/永久删除的错误响应不得透传含绝对路径的原始 message。

## 文档索引

- `docs/README.en.md`：英文摘要（仅定位与安装步骤），功能说明以中文 `README.md` 为唯一真源，不同步细节以免漂移。
- `docs/GIT-CONVENTIONS.md`：提交信息格式（type/scope 表）、提交粒度与拆分判据、分支、PR 与合并、版本与发版、不入库清单、三层门禁与落地冲突取舍。
- `docs/CODING-STANDARDS.md`：编码规范（条款号 C-01～C-35）：两套语法基线、格式、命名、注释、错误处理、安全红线、React 状态纪律、测试要求、门禁分层。
- `docs/DESIGN.md`：完整设计、菜单装饰机制、数据模型。
- `docs/API-CONTRACT.md`：客户端与宿主 HTTP 契约。
- `docs/VERIFY.md`：验证步骤与发布前检查。
- `docs/UI-REVIEW-2026-11.md`：本轮对抗式 UI/UX 审查结论、修复映射与证据。
- `docs/UI-REVIEW-2026-11-ROUND2.md`：第二轮对抗式审查（normalize 丢 `layers`/`install`、popstate 绕脏检查、宿主卸载事务等）；P1/P2 与主要 P3 已于当日修复，残余项见文末。
- `docs/03-known-issues.md`：已知问题、环境性失败与设计取舍。
- `docs/HANDOFF-2026-11-16.md`：0.3.4 发版归档（npm 2FA 与凭据解锁链路、七个坑、验收结果表）。§3 那条链路下一次发版可直接照抄。
- `docs/HANDOFF-2026-11-18.md`：0.3.5 发版交接（挂载接管修复、桌面端 `bundle-in-use` 根因与重启规避、npm 401 卡点、待执行的发布/索引/tag/Release 命令与验收表）。
