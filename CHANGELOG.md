# Changelog

## 0.4.1（2026-11-21）

### 修复

- 包元信息错误：`package.json` 的 `icon` 由 base64 data URI 改为 `assets/icon.svg`。DSH 只接受相对文件路径的图标声明，data URI 会被判成带 scheme 的地址，在「设置 → 插件」里显示「包元信息错误：… icon must be a relative file path」；改为相对路径后图标照常显示，面板不再报错。
- 从 npm 安装的 0.4.0 实例不会自动拿到该修复：需要更新到 0.4.1，或手动把已安装副本的 `package.json` 中 `icon` 换成 `assets/icon.svg`。

## 0.4.0（2026-11-21）

主题：**可信覆盖——缺口看得见，补齐点一下，状态不说谎。**

### 新功能

- 覆盖来源（F1）：覆盖率卡新增内置/本地/无中文/未知四桶与缺口入口，直接筛出未翻译或过期；旧宿主无 `layers` 时降级为未知/无中文/过期并提示升级。
- 批量 AI 翻译（F2）：按“未翻译/过期”启动，5 秒确认后一次提交；显示进度、当前技能、失败明细（最多 50 条，技能名可点）、失败重试与取消；429/旧宿主就地提示，不整表 loading。
- 技能体检（F3）：`layers[]` 增加逐层 `status`（fresh/stale/unverifiable）、`reviewedBy` 与 `active`；`/list.health` 下发孤儿、同名遮蔽与被遮蔽层；覆盖卡可展开体检，详情逐层显示来源、状态与审核来源；旧宿主无 health 时整块降级。

### 工程化

- 写路径测试桥（D1）：新增 `test/host-harness.mjs`（真实 `makeRoutes` + loopback fake req/res）与 `test/write-path-test.mjs`，覆盖保存、审核只落 review、脏检查四条离开路径、URL hash 前进后退；`npm run test:page` 同时跑页面回归与写路径测试，已进 `pre-commit` 与 CI。
- 审计基线（P0）：`audit:zh:ci` 改为只审内置包，不再把本机用户层/磁盘孤儿条目混入，避免干净 CI 绿、本机红的口径分叉；内置包 P1/P2 均为 0。
- 契约：`docs/API-CONTRACT.md` 同步 `reviewedBy`、`layers[].status/active`、`/list.health`、Job `failures`/`failuresTruncated` 与层顺序。

### 内容

- 内置中文包 53→98（C1）：新增 45 条，覆盖 48/48 本机磁盘技能；`audit:zh:ci` 98 条 P1=0、P2=0；抽审 12 条，路由与触发细节保留。原文本身是中文的条目仍是改写压缩，后续新增内容继续按 audit 与抽审把关。

### 文档

- 新增 `docs/SPEC-0.4.0.md`、`docs/PLAN-0.4.0.md`、`docs/TASKS-0.4.0.md`；README 已知限制与 `docs/03-known-issues.md` 按实际状态更新。

## 0.3.5（2026-11-18）

### 修复

- 宿主挂载改为「后挂载者接管」。旧实现用 `globalThis[Symbol.for('dsh-skill-workbench.mounted')]` 布尔守卫：HMR 重载时新实例看到旧标记直接跳过注册，旧 fiber 的 disposer 随后又删掉标记和路由，表现为热更新后 `/api/dsh-skill-workbench/*` 全部 404、侧栏「技能管理」消失。现在新 apply 先释放上一实例的注册，再登记带 token 的挂载；disposer 只卸载归属自己的挂载，迟到的旧 cleanup 不影响新实例。`host/selftest.mjs` 同步改为接管语义，断言旧路由被释放、旧 cleanup 不误删新挂载、清理后可重新挂载。
- 该缺陷不是 0.3.4 引入的，但它是「更新后插件变哑」的另一条独立路径；桌面端在运行中直接更新被 `bundle-in-use` 拒绝是宿主侧包解析问题，见 `docs/03-known-issues.md`。

### 文档

- 新增 `docs/HANDOFF-2026-11-18.md`：0.3.5 发版交接、桌面端更新失败根因与验收表。
- `docs/03-known-issues.md` 补充桌面端批量更新失败的现象、根因与重启规避。

## 0.3.4（2026-11-16）

### 工程化

- 新增 `docs/GIT-CONVENTIONS.md`、`docs/CODING-STANDARDS.md`：提交规范与编码规范，条款化（C-01～C-35），并配上 `.editorconfig`、`.github/pull_request_template.md`。
- 提交门禁落地：`commitlint`（`commitlint.config.mjs`）+ `husky` 钩子。`pre-commit` 跑语法检查、客户端自测、对比度、宿主自测与管理页离线回归（约 5 秒）；`commit-msg` 校验提交信息。提交信息标题按**显示宽度**计（中文占 2 列，上限 72），支持 `fix(ui+host)` 跨层 scope，放行 `fixup!`/`squash!`。
- CI 增加 `npm ci` 与四步校验：`check:contrast`、`test:page`、`audit:zh:selftest`、`audit:zh:ci`。`audit:zh` 新增 `--builtin-only`（只审内置中文包，CI 无本机技能目录时可用）与 `--require-data`（一条都没审到直接失败，杜绝空环境假绿）。
- 修正审计规则误报：`Web Interface Guidelines` 这类首字母大写的专有名词不再被判成「摘要里留有英文句子」；新增 `--self-test` 8 条用例锁住该行为。本机审计基线未变（51 个技能、P1 0、P2 13）。

### 修复（第二轮对抗式审查）

- `normalizeSkillView` 白名单丢弃宿主下发的 `layers` 与 `install`，导致「清除中文覆盖」按钮、`confirmReview`（AI 翻译后保存即确认审核）、「安装来源」链接整体不可达，详情「中文来源」恒显示"—"；现在透传两个字段，页面回归新增对应断言。
- 安装来源 `sourceUrl` 是全文唯一把数据字段放进 HTML 属性的位置，React 18 对 `javascript:` URL 只警告不拦截；现在只渲染 `http(s)` 链接，其余降级为纯文本。
- 未识别 hash 的 `popstate` 直接放行，宿主切面板可静默销毁编辑中的表单；现在同样走脏检查（confirm 抛错按"留在原地"处理），并新增**草稿救援**：脏表单持续镜像到 `sessionStorage`，再次打开详情时询问恢复/丢弃；技能被外部卸载导致的表单消失也有兜底提示。
- `loadIndex` 无请求代际：30 秒静默刷新的旧响应晚到会覆盖保存后的新缓存，UI 回退到保存前状态；现在晚到的旧响应直接让位给更新的缓存（成功与失败路径都守卫）。
- 详情表单重置 effect 只依赖 `zh.name`：AI 重译只改 `summary`/`description`，干净表单停在翻译前基线；现在依赖整个 `zh` 内容签名。
- `--skw-surface` / `--skw-border` 从未在 `THEME_VARS` 定义，sticky 操作栏在亮色主题兜底成硬编码深色 `#1b1f24`；现在亮/暗两套都有定义并纳入 `check:contrast` 清单（亮 3.25:1 / 暗 4.38:1）。
- 保存/审核在途时「清除覆盖」「卸载」「AI 重译」未禁用，写操作可乱序互踩；现在所有写操作互斥（函数守卫 + 按钮禁用传播）。
- 卸载改为「读锁 → 写 meta → 移动 → 清锁」事务顺序，移动失败回收 meta；`listTrash` 对 meta 丢失的孤儿目录生成兜底条目（可见、可永久删除），不再出现"技能消失却无法恢复/删除"的隐形孤儿。
- restore 回写卸载时摘出的 `.skill-lock.json` 安装记录，恢复后「安装来源」能力不再永久丢失；host selftest 新增对应断言。
- 卸载/恢复/永久删除的 500/400 响应不再透传含绝对路径的原始错误消息，细节转宿主日志。
- `kind:'info'` 的通知不再渲染成绿色成功横幅，改用中性样式；深链打开详情时数据到达后自动聚焦标题；浏览器后退回列表回焦原行；`window.confirm` 不可用时按"留在原地"处理（fail-closed），不再当作用户确认丢弃。

### 加固（第二轮残余项清扫）

- 后台静默刷新失败不再把整页顶成错误态：已有数据时降级为 8 秒自动消失的 warn 提示并保留上一次数据，下一次成功刷新会清掉；只有首次加载失败才用整页错误提示。
- 批量翻译加两道资源护栏：单技能模型输出累积上限 20000 字符（超限即刻中断上游并判失败，不写盘），同时运行的任务上限 2（超出 `ERR_BUSY` → HTTP 429）；占位在 `await` 之前同步建立，扫描失败也会释放，避免坏任务永久占住并发闸。
- 请求体超过 1MB 时不再 `req.destroy()`：改为停止累积 + `req.resume()` 排空，客户端能正常收到 413 JSON 而不是 ECONNRESET。
- hash 里的 `filter` 过白名单（`SKILL_FILTERS`），非法值退回 `all`，不再出现「列表被整空且没有任何按钮呈按下态」；`#libraryfoo` 这类前缀不再被误认成库路由。
- 回收站行间交互：别的行操作在途时不再把该行预置成「待确认」再被静默吞掉；一行成功/失败只解除它自己的倒计时，不再误清另一行的 armed 状态。
- 删除与 `THEME_VARS` 漂移的 `STATUS_COLORS` 硬编码色表：状态徽章统一走 `--skw-status-*`，缺失时用 `currentColor`，未知状态归到 `untranslated`。

### 测试

- 新增 `test/fixture.mjs`：在 `os.tmpdir()` 里真写 `SKILL.md` 与 `index.json`，再把 `DSH_HOME`/`DSH_AGENTS_HOME` 指过去，扫描仍走真实 `host/scan.js`。页面回归从此**不依赖本机技能目录**，本机与 CI 结果一致。
- `npm run test:page` 进入 `pre-commit` 与 CI——这是「控件永不渲染」类死代码缺陷（0.3.4 修的 R1）唯一的自动化防线。夹具内自带用户层、项目层与一条 `draft` 条目，`layers`/草稿救援断言不再因环境缺数据而静默跳过；新增非法 `filter` 断言。
- `host/selftest.mjs` 新增 3 项：并发闸 `ERR_BUSY`、`ERR_BUSY` 路由映射 429（且 500 不透传原始 message）、超长输出让任务失败且不写盘。原先断言「超大 body 应 destroy」的用例改为断言 drain——那条断言本身把缺陷写成了预期。
- `host/selftest.mjs` 的「真实技能目录扫描」不再写死 `image-to-code` 等 4 个技能名与 `agent-reach` 样本：期望值改为从 `~/.agents/skills` 现算（与 `scanRoot` 同口径解析 frontmatter name 后去重）。技能集是用户态数据，装一个卸一个都会让写死的断言变红，而红的那条并不代表插件坏了。
- `translations/validate.mjs` 不再把「内置包与本机技能目录不一致」当错误：内置包发给所有用户，覆盖的是精选技能集，与本机装了什么无关——卸一个装一批，缺条目/多条目就会变，而包一行没改。默认降为警告（附明细），`--strict` 才升级成错误；另补「与本机 0 命中」直接失败，那种情况是 `--skills` 指错了目录，不是漂移。

## 0.3.3

### 修复

- 亮色主题下错误横幅、危险操作文字不可读：改用主题感知语义色，正文对比度 ≥ 4.5:1；主按钮由 3.20:1 提升到 5.17:1。
- 未保存的中文编辑会因 30 秒后台刷新、返回列表或切换分区而静默丢失；现在有脏状态、离开确认、`beforeunload`，后台刷新不覆盖正在编辑的表单。
- 保存失败只在页顶显示 6 秒横幅；现在保存按钮旁内联显示 `role=alert`，并保留到用户处理。
- 清除覆盖、卸载、永久删除的二次确认没有超时；现在 5 秒自动复位，并提供取消。
- 列表行是 `div role=button` 且内嵌编辑按钮，造成 59 行约 118 个 tab stop；改为单一可聚焦链接，右侧只保留视觉提示。
- 详情页在 390px 下先显示英文原文、保存按钮在首屏外；窄屏中文表单前置，底部操作栏吸底，详情隐藏覆盖率卡和诊断。
- 覆盖率把“有中文”和“已审核”混在一起；增加“已审核”计数与说明，分类计数随搜索/状态筛选变化。
- 加载态只有“加载中…”，错误态没有说明，空态没有清除入口；补骨架、错误提示与重试、清除搜索与筛选。
- 设置页保存按钮埋在 AI 卡内，清除最近使用无确认；保存栏独立，破坏性操作二次确认并限时取消。
- 补齐 tablist/tab、`aria-selected`、progressbar、`aria-pressed`、详情标题焦点、pre 可聚焦、focus-visible、hover、reduced-motion 与触控目标。
- 搜索、筛选、详情状态不持久；同步到 URL hash 与 sessionStorage，支持浏览器前进后退，脏表单后退会确认。

### 文档

- README 中英文重写：补社区插件市场的安装方式，讲清中文层改的是显示、调用 token 和 `SKILL.md` 都不动。
- `docs/PUBLISH.md` 补社区收录流程（awesome-dsh-plugin 的 YAML 条目、CI 门槛、合并后生效时间），删掉“官方没有索引”的旧说法。
- `docs/SHARE.md`、`market/README.md` 同步更新，区分社区市场与自建索引。
- 新增 `assets/icon-180.png`，给插件市场卡片用。
- 新增 `AGENTS.md`、`docs/UI-REVIEW-2026-11.md`、`docs/03-known-issues.md`，沉淀项目约束、审查证据与残余风险。

## 0.3.2

### 新增

- 技能库「从安装源补简介」：对未翻译且有安装来源的个人技能批量读取 README 简介（只补空字段，标记「导入 / 未审核」，可再编辑确认；结果复用 7 天缓存）。

## 0.3.1

### 修复

- `export` 在本地没有扫描到任何技能时（如干净 CI 环境）会导出空包；现在 `scope=all` 会合并完整内置包，导出结果与机器技能集无关。

## 0.3.0

### 新增

- 技能安装来源：读取 `~/.agents/.skill-lock.json`，从技能安装的 GitHub 仓库 README 抓取中文简介（优先中文，回退英文），结果缓存 7 天；详情页可手动触发。
- 卸载个人技能：仅限 `~/.agents/skills`；移到插件回收站，可恢复；永久删除需二次确认；同步清理 `.skill-lock.json` 安装记录。
- 中文覆盖来源展示：详情页显示「内置 / 用户」层与 origin，可清除用户层覆盖。
- 保存只提交实际改动的字段；空中文不再被误标为「已翻译」。
- 保存后自动返回列表，并等待列表刷新完成；AI 翻译草稿可直接确认审核状态。

### 修复

- 技能列表无法滚动导致内容看不全。
- AI 翻译后保存没有反馈（Banner 在视口外、无改动时静默）。
- AI 翻译后返回列表看不到刚翻译的技能（索引 single-flight 复用了旧请求）。
- 客户端分类重复 id 未合并、保存未知分类未回退。

### 变更

- 面板名回到「技能管理」；与 skills-manager 的分工：本插件负责中文显示层与卸载/回收站，不替代其启停管理。
- 内置翻译包与机器技能集不一致时，只影响覆盖率展示，不影响使用。

## 更早版本

以 git 提交历史为准；0.3.0 之前的版本未单独维护变更记录。
