# dsh-skill-workbench · 0.4.0 Spec

最后核对：2026-11-21
状态：Specify / Approved v1.0（2026-11-21 评审通过；含 P0 audit 基线修正；Plan 与 Tasks 已按此基线推进）
上游：地图 [#1](https://github.com/wangyanan520/dsh-skill-workbench/issues/1) 的 [#4 resolution](https://github.com/wangyanan520/dsh-skill-workbench/issues/4)
本文件只定义 0.4.0 做什么、验收什么、依赖与降级；不包含实施代码。

## 0. 先纠正的假设

在往下读之前，先确认这六条。有异议现在说，改起来最便宜。

1. **覆盖卡不再声称「内置包覆盖 45 个」。** 它只报「内置包覆盖 W / 仅自己补 S / 没中文 N / 过期 T」，W+S+N 必须等于总数；「45」是当前机器上 N 的具体值，不是产品常量。
2. **技能体检不是内容质量评分。** 它只回答四件事：生效层能不能校验、索引里有没有孤儿条目、有没有同名遮蔽、审核来源是谁。它不判断翻译写得好不好。
3. **批量翻译只暴露「未翻译 / 过期」两个范围。** 宿主仍支持 `selected` 与 `all`；0.4.0 不把 `all` 放上 UI，避免把已 fresh 的内置条目再翻一遍、白烧模型调用。
4. **失败明细只给技能名 + 短原因。** 不展示 provider 原始报错、模型输出、绝对路径；详细堆栈只进宿主日志。
5. **团队翻译包与诊断包不在 0.4.0。** 团队包等 5–10 个团队访谈，诊断包等 0.5.0 或折进体检导出。
6. **「体检通过」不等于「全部已审核」。** 内置包条目没有原文 hash，永远只能标「无法校验」；这是事实，不是缺陷。

## 1. Objective

### 1.1 用户问题

当前机器 48 个磁盘技能里，只有 3 个命中内置中文包（`agent-reach`、`frontend-design`、`humanizer-zh`），45 个没有内置中文。真实覆盖率约 3/48，而不是校验脚本里那个容易误读的「本机命中 11」（其中 8 条是 DSH bundled 条目，不在用户磁盘）。

用户面对三个断点：

1. **看不见缺口。** 覆盖率卡只给总数和「未翻译/过期/草稿」，不告诉用户这些技能的中文是内置包给的、自己补的，还是根本没有；用户不知道那 45 个为何没中文。
2. **补得慢。** 中文层一次只能翻一个技能，45 个要重复 45 次；没有一个「按筛选范围补齐」的入口。
3. **补完也不可信。** 内置层没有 hash 却显示 fresh；旧条目没有 hash 也显示 fresh；`reviewed` 没有审核人字段；用户层里已卸载技能的孤儿条目、同名遮蔽的重复技能都不在 `/list` 里。批量翻译一旦上线，会把这些「假覆盖」放大。

### 1.2 0.4.0 目标

把「中文覆盖」从一句感觉，变成一条闭环：

> **发现缺口 → 批量补齐 → 体检可信。**

主题句：

> **0.4.0 · 可信覆盖：缺口看得见，补齐点一下，状态不说谎。**

三个用户可感知功能：

- **F1 内置包缺口发现**：覆盖率卡按来源拆开，点「没中文」直达未翻译技能。
- **F2 批量 AI 翻译**：按「未翻译 / 过期」一次发起，显示进度、失败明细、取消、重试失败项。
- **F3 技能体检**：报告生效层不可校验、过期层、索引孤儿、同名遮蔽、审核来源，不再把「内置无 hash」说成 fresh。

一个工程债：

- **D1 写路径测试桥**：把保存、审核、脏检查、URL hash 四类写路径接进真实宿主路由 + 临时夹具，进 pre-commit 与 CI。

### 1.3 非目标

- 不做安装、更新、启停、执行；启停仍归 skills-manager。
- 不做团队翻译包、诊断包、中文别名直呼、收藏分组、双语模式、使用统计、搜索增强、键盘导航、关联推荐、菜单内行内翻译。
- 不修改任何 `SKILL.md`，不修改技能的英文 `name`。
- 不新增运行时依赖，不引入构建步骤，不改 React 18 / `window.__ModuleLoader__` 运行模型。
- 不把覆盖率公式改成「已审核百分比」；那需要宿主提供独立审核字段，属 0.5.0 以后。
- 不在 0.4.0 内做 45 条内容的全量人工重写；内容按第 7 节单独验收、可顺延 0.4.1。

## 2. 冻结范围与实施顺序

### 2.1 范围

| 顺序 | ID | 交付 | 规模 | 直接依赖 |
|---|---|---|---|---|
| 0 | P0 | 修现有 8 条 audit P1（拼音缺字），让 CI 基线转绿 | 0.2 人日 | 无；当前 `audit:zh:ci` 是红的 |
| 1 | F1 | 内置包缺口发现：来源拆分 + 没中文/过期筛选入口 | S（0.5–1 人日） | 无；只用现有 `layers` |
| 2 | D1 | 写路径测试桥：真实宿主路由 + 四类断言 + 进门禁 | M（3–4 人日） | F1 的页面断言需要 F1 先落地 |
| 3 | F2 | 批量 AI 翻译：范围、进度、失败明细、取消、重试 | M（1.5–2 人日） | D1 的保存/审核断言先绿；F1 的缺口入口 |
| 4 | F3 | 技能体检：per-layer 状态、孤儿、遮蔽、审核来源 | M（2–3 人日） | F1 的覆盖卡位置；D1 的 normalize/页面测试 |
| 5 | C1 | 45 条内置包内容更新（数据，不占功能位） | 1–2 人日 | F2 的翻译管线；可顺延 0.4.1 |

总规模：P0 0.2 人日 + 功能 4–6 人日 + 债 3–4 人日 = **7.2–10.2 人日**；C1 另计 1–2 人日。

### 2.2 为什么是这个顺序

- **P0 先做**：当前 `audit:zh:ci` 有 8 条现存 P1，任何 0.4.0 PR 都会被卡；先花约 0.2 人日修掉，CI 才有意义。
- **F1 第二**：只读、最小、不改宿主，先把「缺口在哪」变成可点击的事实；没有它，F2 的「补齐」没有明确入口。
- **D1 第二**：F2 是写路径，D1 必须先能证明保存/审核/刷新是真的；否则批量翻译会把「假覆盖」写进索引，而且没有回归网。
- **F2 第三**：复用现成的 `host/translate.js` job manager，主要成本在客户端状态机与失败明细；D1 已保证写路径可测。
- **F3 第四**：它要改 `host/scan.js` / `host/store.js` / `docs/API-CONTRACT.md`，并且与 F2 同版收口；放最后可以一次把批量翻译放大的「假覆盖」收掉。
- **C1 最后**：内容可以独立于代码发布；代码 0.4.0 先发、内容未完成则 0.4.1，不在发布前卡死。

### 2.3 发布门禁

0.4.0 发布前必须同时满足：

0. 当前 `npm run audit:zh:ci` 的 8 条 P1 已修（见 7.0）；未修前 CI 本身是红的，不允许用「基线红」当发布理由。
1. `npm run test:page` 全绿，且新增写路径断言真实经过 `/save`、`/delete`、`/status`。
2. `npm run selftest` 全绿（client + host + translations validate）。
3. `npm run audit:zh:selftest`、`npm run audit:zh:ci` 全绿；P1 为 0；13 条现有 P2 的记录/处理结果写进 release note。
4. `npm run check:contrast` 全绿；新增 UI 变量必须同时进 `THEME_VARS` 亮/暗与 `scripts/check-contrast.mjs`。
5. F2 的保存/审核断言先绿，否则 F2 顺延，不允许「批量翻译单独发」。
6. `docs/API-CONTRACT.md`、`docs/03-known-issues.md`、`README.md` 已知限制、`CHANGELOG.md` 已按实际行为更新。
7. C1 若未完成：发布说明写明「45 条内置包内容顺延 0.4.1」，不得把 N 说成 0。

### 2.4 成功标准（可观测）

- 在 48 个磁盘技能的机器上，F1 后覆盖卡四桶之和为 48；点「没中文」显示 45，点「内置包」显示 3。
- F2 对 45 条发起一次任务，进度能到 100%，失败项可逐条重试，取消在 5s 内生效；索引新增条目数等于成功数。
- F3 体检不再把内置层说成 fresh；P0 修复后 `audit:zh:ci` 的 P1 为 0；孤儿与同名遮蔽各能造出 1 条夹具并正确显示。
- D1 四类写路径断言在 `npm run test:page` 中真实经过 `/save`、`/delete`、`/status`；页面回归仍小于 15s。
- 旧宿主（无 `layers` / `health`）不崩：F1 只显示「来源未知 / 没中文 / 过期」，F2/F3 隐藏不可用部分。

## 3. F1 内置包缺口发现

### 3.1 用户故事

作为中文 DSH 用户，我想在技能库一眼看到：哪些技能的中文是内置包给的、哪些是我自己补的、哪些完全没有中文、哪些已过期；点「没中文」就能只看这些技能，不用逐个点开。

### 3.2 数据口径（纯客户端，不改宿主）

对 `/list` 返回的每个 `SkillView` 计算，互斥分桶：

```js
// 只做归因，不改 status 语义
var hasBuiltin = skill.layers.some(function (layer) { return layer.source === 'builtin'; });
var hasLocal = !hasBuiltin && skill.layers.some(function (layer) {
  return layer.source === 'user' || layer.source === 'project';
});
var noZh = !skill.zh;
var sourceUnknown = Boolean(skill.zh) && (!skill.layers || skill.layers.length === 0);
```

- `builtin`：命中内置包（无论内置包条目是否 reviewed）。
- `local`：没命中内置包，但用户层或项目层有中文。
- `none`：没有中文。
- `unknown`：有中文，但宿主没下发 `layers`（旧宿主）——不能归因。
- 不变式：`builtin + local + none + unknown = total`。
- `stale`：`skill.status === 'stale'`，与上面四桶重叠，单独显示，不参与求和。
- `draft`：`skill.zh.review === 'draft'`，单独显示。
- `reviewed`：`skill.zh.review === 'reviewed'`，单独显示；审核来源拆分由 F3 提供，F1 不假装知道。

旧宿主（无 `layers`）时：不要显示「内置包 / 仅自己补」两个数；显示 `来源未知 U` + `没中文 N` + `过期 T`，并给一行说明「当前宿主不提供分层来源；升级 DSH / 插件后可看到内置包归因」。

### 3.3 UI

位置：管理页技能库的覆盖率卡（`client.js` 现有覆盖率卡区块），不加新路由、不加新页面。

在现有总数/已翻译/未翻译/过期/草稿/已审核之外，加一行「覆盖来源」：

- 正常宿主：`内置包 W · 仅自己补 S · 没中文 N`；若 `unknown > 0` 再加 `来源未知 U`。
- `N > 0` 时，旁边给按钮「查看没中文」；点击后走现有路由机制设 `filter=untranslated`，列表只显示没中文的技能。
- `T > 0` 时，已有「过期」筛选保持可用；再加一个「查看过期」按钮，设 `filter=stale`。
- `N = 0` 时不显示「查看没中文」；`total = 0` 时显示「还没有扫描到技能」。
- 全部由内置包覆盖时，显示「全部由内置包覆盖」而不是「仅自己补 0」。
- 按钮是 `<button type="button">`，不要用行内 `<a>` 冒充按钮；不要把按钮塞进列表行。
- 窄屏（约 360px）允许换行，不允许横向滚动；沿用现有 `--skw-*` 变量，不新造硬编码色。
- 新增文案同时加进 `locale/zh.json` 与 `locale/en.json`；不要在 `client.js` 里写死中文。
- 可访问性：数字有可读标签（如 `aria-label="内置包覆盖 1 个技能"`），按钮有明确文本，不靠颜色单独传达。

F1 不添加「批量翻译」按钮；那是 F2 的事。F1 单独合并时，只多一个「查看没中文」的筛选入口，不留死按钮。

### 3.4 验收标准

用 `test/fixture.mjs` 的临时夹具，至少造出：

- 1 个只有内置包中文的技能（名字取 `agent-reach`，确保在 `translations/zh-CN.builtin.json` 里）。
- 3 个用户层中文技能（现有 3 个 `lark-*`）。
- 1 个项目层中文技能（给 `project-only` 写项目层 `zh-index.json` 条目，或新增一个项目层技能）。
- 1 个完全没有中文的技能（现有 `plain-notes`）。
- 1 个过期技能（给某个用户层条目的 `hash.frontmatter` 写错，并写 `bound.path`）。

断言：

1. 覆盖来源行显示 `内置包 1 · 仅自己补 4 · 没中文 1`，且 `1 + 4 + 1 = 6`（若夹具总数是 6）。
2. 点「查看没中文」后，列表只剩 `plain-notes`，URL hash 含 `filter=untranslated`，再点「全部」恢复。
3. 点「查看过期」后，列表只剩过期技能，URL hash 含 `filter=stale`。
4. 旧宿主载荷（去掉所有 `layers`）时，不显示「内置包/仅自己补」，显示「来源未知」与说明；不崩。
5. 360px 宽度下不出现横向滚动；按钮可键盘聚焦。
6. 现有页面断言（中文名/英文 token、覆盖率卡、拼音搜索、清空恢复、详情、layers 透传、草稿救援、非法 filter 退 all）全部保留。

### 3.5 依赖与降级

- 依赖：现有 `/list` 的 `layers` 字段（`host/scan.js:298-303`）。无新路由、无新字段。
- 旧宿主降级：无 `layers` 时按 3.2 的 `unknown` 分支，功能不崩，只是不能归因。
- 若 `layers` 存在但 `source` 是未知值：归入 `unknown`，不猜。
- 若 `coverage` 与客户端重算不一致：以 `skills` 重算为准，覆盖卡不直接信任 `coverage.translated`；分歧写 `console.warn` 一次，不弹错。

## 4. D1 写路径测试桥

### 4.1 目标

现在的 `test/page-regression-test.mjs` 只测「渲染得像」：fetch mock 对 `/list` 返回固定 `PAYLOAD`，其他路径一律 `{}`。保存、审核、脏检查、hash 四条写路径在客户端侧零断言，`docs/03-known-issues.md` 已记为测试缺口。

D1 要证明的不是「组件能渲染」，而是：

> 用户改了一个字段、点了保存/审核、按了返回/切了分区/关了窗口/按了浏览器后退——索引里到底写了什么，界面回到了哪。

### 4.2 测试桥设计

新增 `test/host-harness.mjs`：

- 复用 `test/fixture.mjs` 的临时根与 `DSH_HOME` / `DSH_AGENTS_HOME`；不扫本机技能目录。
- 调 `host/routes.js` 的 `makeRoutes(ctx, { jobs, config })`（`host/routes.js:343`），传入：
  - `ctx = { workingDirectory: { get: () => fixture.projectRoot } }`（`resolveCwd` 从这里取项目根；`fixture` 需新增返回 `projectRoot`，当前只有 `root`；`registry` 缺失时 `scanSkills` 自然跳过）；
  - `jobs` 用最小 stub：`snapshot()`、`get()`、`cancel()`；
  - `config = {}`。
- 提供 `call(method, path, body)`：构造 fake `req`（`EventEmitter`、`method`、`url`、`headers.host='127.0.0.1'`、`socket.remoteAddress='127.0.0.1'`、`resume()`）与 fake `res`（`writeHead` / `end` / `headersSent` / `destroy`），返回 `{status, body}`；不监听真实端口。
- fake `req` 必须满足 `isLoopbackRequest` 与 `readJsonBody` 的接口；不要用真实 `http` 服务器，避免端口冲突与慢启动。
- 每个用例结束 `fixture.cleanup()`，并恢复 `DSH_HOME` / `DSH_AGENTS_HOME`。

页面测试有两种接法，选一种并写进测试文件顶部注释：

1. `fetch` mock 把 `/list`、`/save`、`/delete`、`/status`、`/translate`、`/cancel` 转发给 harness，返回真实响应；页面刷新后读真实索引。
2. 固定 `PAYLOAD` 只用于初始渲染；写路径另起 `test/write-path-test.mjs`，用 harness 断言索引，再用同一套 React 渲染 helper 驱动详情页。

推荐第 1 种：它让「保存后列表真的变了」成为一条端到端断言，而不是两个孤立断言。若渲染 helper 难复用，第 2 种也可接受，但必须在 `npm run test:page` 里一起跑。

### 4.3 四类断言

#### A. 保存写入链路

- 打开 `lark-doc` 详情，只改 `summary`，点保存。
- 断言请求体只含 `name`、`zh.summary`（以及必要的 `origin`），不把未改字段整包提交。
- 断言 `$DSH_HOME/dsh-skill-workbench/index.json` 里 `lark-doc.zh.summary` 已变，`origin === 'manual'`，`bound` / `hash` 已写，`updatedAt` 非空。
- 断言返回列表后行内显示新 summary；后台刷新不覆盖。
- 另测失败路径：让 `/save` 返回 400（例如空内容），断言错误出现在保存按钮附近（`role="alert"`），不是只在页顶横幅，且表单内容不丢。

#### B. 审核只落 review 状态（不丢内容）

- 打开已有用户层中文的详情，不改内容，点「确认审核」。
- 断言 `POST /save` 的 body 含 `review: 'reviewed'`；若为内置草稿建立用户层记录而提交完整表单，`zh` 必须与当前表单一致，不能静默改内容。
- 断言索引里内容字段未变，`review === 'reviewed'`，`reviewedBy === 'human'`（F3 落地后），`updatedAt` 更新。
- 断言列表状态从「草稿」变「已审核」，覆盖卡 `draft` 减一、`reviewed` 加一。
- 另测：无用户层中文时 review-only 被 400 拒绝，错误可行动，不把用户层写成空条目。

#### C. 脏检查

- 修改详情表单后点返回：`window.confirm` 返回 `false` 时留在详情，表单内容不丢；返回 `true` 时回列表，`sessionStorage['skw:draft:<name>']` 有镜像。
- 切分区（技能库 ↔ 设置）同样走确认；取消后分区不变。
- `beforeunload` 在脏状态下被注册；干净状态下不拦。
- `popstate`（浏览器后退）在脏状态下也要确认；取消后 URL hash 回到详情，不能出现「hash 已变、表单还在」的半状态。
- 重开详情时若有草稿，询问恢复/丢弃；选恢复后内容一致，选丢弃后镜像清除。
- 注意：现有页面测试的 sandbox 没有 `addEventListener` / `confirm` / `history`；D1 必须补这些 stub，不能绕过脏检查。

#### D. URL hash 前进后退

- `#library?filter=stale` 冷启动：stale 筛选按钮按下，列表正确。
- 点行进入 `#skill/lark-doc`；浏览器后退回 `#library?filter=stale`，筛选保持。
- `#library?filter=evil` 非法值：退回 `all`，列表不空，四个筛选按钮中「全部」按下。
- 详情页后退到列表后，原行重新聚焦（现有行为，不能回归）。
- hash 同步 `sessionStorage['skw:route']`；刷新后恢复。
- 复用现有 `filter=untranslated` / `filter=stale`，确认二者仍在 `SKILL_FILTERS` 白名单与 `parseRouteHash` 中；0.4.0 不新增筛选值。非法值仍退 `all`。

### 4.4 验收标准

1. `npm run test:page` 在干净临时目录、无 `~/.agents/skills` 的机器上全绿。
2. 上述 A/B/C/D 每类至少 1 条断言，断言文案用中文业务含义（如「保存后索引里的 summary 应为新值」），不是 `assert(x)` 裸断言。
3. 先红后绿：提交前至少有一次在旧实现上失败、在新实现上通过的记录（PR 描述或 commit message 写明）。
4. 新增测试运行时间 ≤3 秒（不含 fixture 创建）；`test:page` 总时长仍 <15 秒。
5. 生产代码只在测试暴露 P1 时改动；不为测试方便改契约或加后门。
6. 现有页面测试全部保留，不降断言、不跳过。

### 4.5 依赖与降级

- 依赖：`makeRoutes` 的 handler 形状、`test/fixture.mjs` 的环境变量与临时根。无新依赖。
- 若 fake `req/res` 与真实 Node HTTP 行为偏差导致误判：以 `node test/render-page-test.mjs` 的真实宿主联调为补充，但不把它塞进 CI（需要运行中的宿主）。
- 若某条路径在当前客户端确实不可测（例如 `beforeunload` 在假 DOM 里无法触发）：至少断言监听器注册/清理，并在 `docs/03-known-issues.md` 写明残余风险；不得直接删掉该类断言。

## 5. F2 批量 AI 翻译

### 5.1 用户故事

作为中文 DSH 用户，我想一次选中「所有没中文」或「所有过期」的技能，点一下开始翻译；我能看到进度、失败的是哪几个、随时取消；结束后失败项可以只重试失败的那几个。

### 5.2 宿主改动：Job 失败明细

现状：`host/translate.js` 的 `runJob` 在局部 `failures` 数组里记失败，但 `publicJob` 只暴露 `failed` 计数与第一个 `error`，客户端拿不到失败技能名，无法逐项重试。

改动：

- `Job` 增加：
  - `failures: [{ name, code, message }]`，最多 50 条；
  - `failuresTruncated: boolean`（超过 50 条时为 true）。
- `publicJob` 只暴露上述安全字段；不暴露 target 对象、prompt、模型输出、绝对路径。
- `message` 用固定中文短原因，按错误码映射：
  - `ERR_NO_LLM` → `模型不可用`
  - `ERR_SAVE` / 写盘失败 → `写入失败`
  - 解析/输出不合规 → `返回格式不符合要求`
  - 超时 → `超时`
  - 其他 → `翻译失败`
- 若底层 message 含路径，先脱敏（`/Users/...`、`/home/...`、`C:\...` → `<路径>`），再截断到 160 字符；原始错误只进宿主日志。
- `job.failed` 仍是总失败数；`failures` 截断不影响计数。
- 取消时，未开始的目标不计入 `failures`；已完成的保留。
- 全部失败时 `state='failed'`，`error` 仍给一句总原因；部分失败时 `state='done'`，`failed > 0`，`failures` 有明细。

同步更新 `docs/API-CONTRACT.md` 的 `Job` 形状与 `/status` 示例。

### 5.3 客户端 UI

位置：管理页技能库工具栏，与「从安装源补简介」并列；不加新页面、不加菜单项。

工具栏新增一组：

- 范围 `<select aria-label="批量翻译范围">`：`未翻译（N）` / `过期（N）`；不提供 `all`。
- 主按钮「批量翻译（N）」：`N = 当前范围对应数量`；`N = 0` 或已有 running job 时禁用。
- 点击后进入二次确认（5 秒自动复位）：
  - 文案：「将翻译 N 个技能；AI 结果标为草稿，不覆盖手动内容；失败可重试、可取消。」
  - 「确认翻译」与「取消」两个按钮；5 秒后回到未 armed 状态。
- 确认后 `POST /translate { scope: 'untranslated' | 'stale' }`，不传 `names`；与现有单条重译一致，不额外传 `cwd`。
- 若返回 429 `ERR_BUSY`：提示「已有翻译任务在运行」，保持列表可用，不进入假进度。
- 若返回 404/405（旧宿主）：提示「当前宿主不支持批量翻译，请升级插件」，不反复重试。

进度与结果放覆盖率卡下方（或工具栏下方）的独立面板：

- running：`翻译中 3/10 · 失败 1 · 正在处理：<当前技能>`；`role="progressbar"`，`aria-valuemin=0`、`aria-valuemax=total`、`aria-valuenow=done`；「取消」按钮。
- done：`完成 9 个，失败 1 个`；失败列表最多 20 条，每条 `技能名 — 短原因`；技能名是链接，指向 `#skill/<name>`（每行一个可聚焦入口）；「重试失败项（1）」。
- failed：`任务失败：<总原因>`；若已有部分完成，仍显示失败列表与重试。
- cancelled：`已取消：完成 X，失败 Y`；不自动重试。
- 失败明细缺失（旧宿主）：显示 `失败 1 个（当前宿主不提供明细）`，并提示用「未翻译 / 过期」筛选后重试；不要假装知道名字。
- 错误就近：启动失败、429、取消失败都显示在批量面板内（`role="alert"`），不只发页顶通知。

状态机（客户端）：

1. `idle` → 点主按钮 → `armed`（5s 定时器）。
2. `armed` → 确认 → `starting`（按钮禁用）→ 成功 → `running`；失败 → `idle` + 面板错误。
3. `running` → 轮询 `/status`（复用现有 1.5s 轮询）→ `done` / `failed` / `cancelled`。
4. `done` + `failed > 0` → 可「重试失败项」→ `starting`，`POST /translate {scope:'selected', names:[...]}`。
5. `done` / `failed` / `cancelled` → 刷新 `/list` 与 `/status`；面板保留到用户关闭或下一次启动。
6. 页面卸载/切分区：定时器清理；running job 留在宿主，回来仍从 `/status` 恢复；不要在前端伪造进度。

其他约束：

- 批量运行中，单条「重新翻译」仍可能 429；保持现有错误提示，不新增互斥弹窗。
- 不逐行加 spinner；不把列表整表重渲染成 loading；后台刷新不覆盖正在编辑的表单。
- 失败列表的技能名链接不嵌套按钮；「重试失败项」是列表外的独立按钮。
- 所有新文案进 `locale/zh.json` / `locale/en.json`；不要写死中文。
- 不新增 `--skw-*` 变量；若确实需要进度条新色，按 C-04 同时改 `THEME_VARS` 亮/暗与 `scripts/check-contrast.mjs`。

### 5.4 验收标准

1. 夹具里有 2 个未翻译、1 个过期；选「未翻译」显示 `2`，点按钮 → 确认 → `POST /translate {scope:'untranslated'}`，body 不含 `names`。
2. mock `/status` 先返回 running 1/2，再返回 running 2/2，最后 done 2/0；界面进度从 1/2 到 2/2，结束后列表刷新，两个技能出现中文且 `review==='draft'`。
3. mock 部分失败：done 1/2，`failures:[{name,code,message}]`；面板显示失败 1 个、技能名与短原因；点「重试失败项」发 `POST /translate {scope:'selected', names:[失败名]}`。
4. 点「取消」发 `POST /cancel {jobId}`；mock 返回 `cancelled` 后界面显示「已取消」，不再轮询。
5. 429：显示「已有翻译任务在运行」，按钮恢复可用，不出现进度条。
6. 旧宿主：`/status.jobs` 无 `failures` 时显示「不提供明细」，不崩。
7. 二次确认 5 秒后自动复位；取消后不发请求。
8. `role="progressbar"` 的 `aria-valuenow` 随 done 变化；`role="alert"` 只在错误时出现。
9. 新增文案中英文都有；`node client.selftest.mjs` 与 `npm run test:page` 全绿。

### 5.5 依赖与降级

- 依赖：`host/translate.js` 的 job manager（已有）、`/status` 的 jobs（已有）、`client.js` 现有 1.5s 轮询（已有）。
- 旧宿主无 `failures`：显示失败数 + 通用提示；重试退化为按范围重跑。
- 旧宿主无 `/translate`：提示升级；不影响单条重译与其他功能。
- 模型不可用（`ERR_NO_LLM`）：整个 job `failed`，面板显示「模型不可用」，不重试。
- 一个 job 最多 2 个并发；批量不会并发多个 job；超出由宿主 429 兜底。
- 成本护栏：只暴露 `untranslated` / `stale`；确认文案显示数量；取消保留已完成部分；不自动重试整个 job。

## 6. F3 技能体检

### 6.1 用户故事

作为中文 DSH 用户，我想知道我的中文层哪些是可信的、哪些只是「看起来有」：内置包条目没有原文 hash，旧条目可能没 hash，用户层里可能有已卸载技能的残留条目，同一个技能可能在多个层重复出现。我不想看到一个笼统的「fresh」。

### 6.2 数据模型

#### 6.2.1 `SkillView.layers[]` 增加字段

```jsonc
{
  "source": "project | user | builtin",
  "origin": "manual | llm | import | builtin | community | existing-zh | null",
  "review": "draft | reviewed | null",
  "reviewedBy": "human | assistant | import | builtin | unknown | null",
  "updatedAt": "ISO | null",
  "status": "fresh | stale | unverifiable",
  "active": true
}
```

- `layers` 仍按 project → user → builtin 低→高排列；`active` 只在第一个（生效层）为 true。
- `status` 是**该层自身**的可校验性，不是整技能状态：
  - `fresh`：该层有 `hash.frontmatter`，且与它绑定的当前文件 hash 一致。
  - `stale`：该层有 hash，但与当前文件不一致。
  - `unverifiable`：该层没有 hash（内置包、旧条目、或项目层未写 hash）。
- 被遮蔽的下层**不拿生效层的文件 hash 去比**；每层用自己 `bound.path` 找到对应候选文件再比。找不到候选文件时，该层标 `unverifiable`，并进 `health.orphanEntries`（如果该层是用户/项目层）。
- 内置层永远 `unverifiable`：`translations/zh-CN.builtin.json` 不存原文 hash，这是包格式事实，不在 0.4.0 改。
- `SkillView.status`（整技能）语义不变：`untranslated | stale | fresh`，仍按生效层算；`unverifiable` 的生效层在整技能上仍记 `fresh`，避免破坏现有筛选与契约；「无法校验」只在体检里说。

#### 6.2.2 `/list` 增加 `health`

```jsonc
{
  "health": {
    "orphanEntries": [
      { "name": "ghost-skill", "layer": "user", "zhName": "幽灵技能", "updatedAt": "ISO" }
    ],
    "shadowedSkills": [
      {
        "name": "lark-doc",
        "winner": { "kind": "project-dsh", "path": "/abs/path/SKILL.md" },
        "losers": [{ "kind": "user-agents", "path": "/abs/path/SKILL.md" }]
      }
    ]
  }
}
```

- `orphanEntries`：用户层/项目层有中文条目，但磁盘上已没有对应 `name` 的技能。
- `shadowedSkills`：同一 `name` 在多个来源出现，低 rank 胜出，其余被遮蔽；只报结构，不报中文内容。
- 路径只发给本机 loopback 客户端；不写日志、不进导出。若担心路径泄露，可只给 `kind` 和 `dirName`；但 detail 需要路径时已有 `path`，这里保持与 `SkillView.path` 一致。
- `health` 只由 `/list` 返回；`/status` 不变，避免两处真相。
- `scanSkills` 返回值增加 `health`；`routes.js` 的 `list` 透传。

#### 6.2.3 `reviewedBy`

- 存储位置：`index.json` 的 entry 顶层（与 `zh` 平级），不塞进 `zh`，避免 `normalizeZh` 白名单膨胀。
- 取值：`human | assistant | import | builtin | unknown`。
- 写入规则（服务端权威，不接受客户端 body 直接指定）：
  - `POST /save` 最终 `review === 'reviewed'`：写 `reviewedBy: 'human'`；最终 `review === 'draft'`：清空 `reviewedBy`。
  - `import` 写入 reviewed 条目：`reviewedBy: 'import'`；保留已有条目时保持原值。
  - 内置包条目：读取时默认 `builtin`（不写盘）。
  - 旧用户/项目条目：有 `reviewed` 但无 `reviewedBy`，读取时默认 `unknown`（不写盘）。
  - `assistant` 预留给未来的审计/助手审核；0.4.0 不主动写。
- `normalizeEntry` 保留 `reviewedBy`；项目层 `zh-index.json` 也接受同名字段（只读消费）。
- 体检卡显示「人工 / 来源未知 / 导入 / 内置 / 草稿」；不把 `unknown` 说成「未审核」，也不把 `builtin` 说成「人工审核」。

### 6.3 UI

位置：覆盖率卡内，新增一个可折叠 `<details>`「技能体检」；默认折叠，摘要显示「技能体检 · X 项可关注」或「技能体检 · 未见异常」。

内容三组：

1. **状态可信度**
   - `无法校验 A`：生效层 `unverifiable` 的技能数（主要是内置包）。
   - `已过期 B`：生效层 `stale` 的技能数（与现有 `stale` 一致）。
   - `被遮蔽层 C`：`layers.length > 1` 的技能数；展开显示每层的 `source + status`。
2. **索引结构**
   - `孤儿条目 D`：`health.orphanEntries.length`；列出 `name / layer / 中文名`，最多 5 条，其余显示「还有 N 条」。
   - `同名遮蔽 E`：`health.shadowedSkills.length`；列出 `name / 胜出来源 / 被遮蔽来源`，最多 5 条。
3. **审核来源**
   - `人工 F · 来源未知 G · 导入 H · 内置 I · 草稿 J`；按生效层的 `reviewedBy` 统计；`draft` 单列，不混进「人工」。
   - 数字为 0 的项可省略，但「人工」与「来源未知」总显示，避免用户以为全是人工。

交互：

- 每个技能名是 `<a data-skw-row href="#skill/<name>">`（孤儿条目无详情，用纯文本）。
- 一层列表最多 5 行；不嵌套按钮；「展开全部」用 `<details>` 或独立按钮，不要给每行加第二个焦点。
- 体检详情不新增路由；全部在覆盖率卡内。
- 详情页的层信息（`layerText`）同步升级：每层显示 `source + origin + status + reviewedBy`，例如：
  - `项目层 · 手动 · 新鲜 · 人工审核`
  - `用户层 · AI · 已过期 · 来源未知`
  - `内置包 · 内置 · 无法校验 · 内置包标记`
- 详情页仍只显示合并后的中文内容；层信息是说明，不是编辑入口。
- 旧宿主无 `health` / `layers[].status`：体检 `<details>` 不显示，详情层信息只显示现有 `source + origin + draft`，并给一行「当前宿主不提供技能体检」。
- 不新增主题变量；若新增，按 C-04 三处同步。

### 6.4 验收标准

1. `agent-reach`（内置层）：`layers[0].status === 'unverifiable'`，`active === true`；体检「无法校验」至少 1；详情显示「内置包 · 无法校验」。
2. 某个用户层条目 `hash.frontmatter` 写错：该层 `status === 'stale'`；整技能 `status === 'stale'`；体检「已过期」计数正确；详情显示「用户层 · 已过期」。
3. 用户层条目 `ghost-skill` 没有对应 SKILL.md：`/list.health.orphanEntries` 含它；覆盖总数不变；体检「孤儿条目」显示 1；点它不产生 404 详情。
4. 同一 `name` 在 project 与 user 各有一份 SKILL.md：`/list.health.shadowedSkills` 含 1 条，胜出 project；列表只出现一次；体检「同名遮蔽」显示 1。
5. `reviewedBy`：旧条目显示「来源未知」；`POST /save review=reviewed` 后显示「人工」；`import` 写入显示「导入」；内置显示「内置」；草稿显示「草稿」。
6. `normalizeSkillView` 保留 `layers[].status/reviewedBy`；`normalizeIndex` 保留 `health`；旧载荷缺字段不崩。
7. 体检列表每行只有一个可聚焦入口；孤儿条目是纯文本；窄屏不横向滚动。
8. 现有 `layers` 透传断言、覆盖率卡断言、详情页断言全部保留。

### 6.5 依赖与降级

- 依赖：`host/scan.js` 需要拿到去重前的候选集合（算每层绑定文件 hash、孤儿、遮蔽）；`host/store.js` 需要保留 `reviewedBy`；`routes.js` 透传 `health`。
- 旧宿主降级：无 `health` / `layers[].status` 时隐藏体检；详情层信息退回现有文案；不阻塞 F1/F2。
- 若“每层绑定文件 hash”实现成本过高：至少保证**生效层**状态正确，被遮蔽层统一标 `unverifiable`，并在 `docs/03-known-issues.md` 写明；不得把被遮蔽层误报成 `fresh` 或 `stale`。
- 若 `reviewedBy` 迁移引发旧索引兼容问题：读取默认 `unknown`，写入只在 `review` 变化时；不做一次性批量迁移。
- 不新增 `/health` 路由；用 `/list.health`，避免重复扫描与两处真相。

## 7. C1：45 条内置包内容更新

### 7.0 先修现有 8 条 P1（P0 前置）

`npm run audit:zh:ci` 当前不是绿的。109 个技能中 8 条报 P1「拼音疑似缺字（汉字 N，全拼首段 0）」：

- `ab-test-analysis`
- `analyze-feature-requests`
- `andrej-karpathy-skill`
- `ansoff-matrix`
- `api-and-interface-design`
- `archify`
- `banner-design`
- `beachhead-segment`

这 8 条是现有内置包的拼音字段缺失，不是 0.4.0 新引入的。修复方式：给对应 entries 补 `pinyin` / `pinyinInitials`，不改中文名、不改路由关键词；约 0.2 人日。**必须作为 0.4.0 的第一个 PR 或前置提交**，否则任何 0.4.0 PR 都会被 CI 卡住，也无法诚实地声称「发布门禁全绿」。

验收：

1. `npm run audit:zh:ci` 的 P1 从 8 降到 0；13 条 P2 保留记录，不强行清零。
2. 8 条条目的中文名、summary、category、路由关键词不变；只补拼音字段。
3. `node translations/validate.mjs` 仍 0 结构错误。

### 7.1 目标

把当前机器 45 个「磁盘有、内置包没有」的技能补进 `translations/zh-CN.builtin.json`，使新机器/新用户默认拿到中文，而不是每题都自己翻。

### 7.2 口径

- 生成：用同一套翻译管线（`host/translate.js` 的 prompt/校验）生成候选；可以用开发脚本批量跑，但**不把用户层条目当内置包**。写入内置包前必须经过人工抽审，不能直接把 LLM 输出 merge 进包。
- 质量：`docs/03-known-issues.md` 已说明 33/51 的原文 description 本来就是中文，中文层是改写压缩；审核重点是「有没有失真、有没有丢路由/触发细节」，不是文风。机翻条目必须抽审。
- 审核标记：内置包条目统一 `origin: 'builtin'`、`review: 'reviewed'`；不写 `reviewedBy`（读取默认 builtin）。
- 版本：内置包是数据，随 0.4.0 发布；不单独发 0.3.6。代码按期，内容未完成则先发代码版，内容随 0.4.1。
- 不做：不删除现有 53 条；不改已审核条目的中文名/路由关键词，除非审计发现 P1；不把 8 个 DSH bundled 条目塞进内置包（它们由 DSH 自己发）。

### 7.3 验收标准

1. `node translations/validate.mjs`：结构 0 错误；`磁盘有、包里没有` 的警告从 45 降到 0；当前机器 48 个磁盘技能全部命中。
2. `npm run audit:zh:selftest` 全绿；`npm run audit:zh:ci` 全绿；P1 为 0；P2 数量与处理记录写进 release note。
3. `translations/zh-CN.builtin.json` 条目数从 53 增加到 98（53 + 45），不重复、不缺 name。
4. 抽审记录：至少 10 条人工抽审（覆盖 manual/llm/import 三种来源），记录写在 PR 描述或 `research/` 笔记；抽审发现的问题已修。
5. 若 C1 未完成：0.4.0 release note 明确写「45 条内容顺延 0.4.1」，并把 `npm run audit:zh:ci` 的当前缺口数写出来；不得把 N 说成 0。P0 的 8 条 P1 不属于可顺延内容，必须先修。

## 8. 六核心区

### 8.1 Tech Stack

- DSH 插件运行时：宿主 Cordis 插件（ESM）+ 零构建客户端（`client.js`，React 18，`window.__ModuleLoader__`）。
- Node >= 24；DSH >= 0.2.2-rc.1。
- 不新增运行时依赖；不引入构建步骤；不改 `SKILL.md`。
- 数据：`$DSH_HOME/dsh-skill-workbench/index.json`（用户层）、`<project>/.dsh/skill-cn/zh-index.json`（项目层，只读）、`translations/zh-CN.builtin.json`（内置包）。

### 8.2 Commands

```bash
# 语法与自测
node --check client.js
node client.selftest.mjs
SKIP_REAL_AGENTS_SCAN=1 node host/selftest.mjs
npm run selftest

# 中文层质量
npm run audit:zh:selftest
npm run audit:zh:ci
npm run audit:zh:strict        # 可选，P2 也会失败，不作为 0.4.0 门禁

# UI 与页面
npm run check:contrast
npm run test:page

# 需要运行中的宿主（手动联调，不进 CI）
node test/render-page-test.mjs
node test/run-live.mjs
```

D1 落地后 `npm run test:page` 应同时跑 `page-regression-test.mjs` 与 `write-path-test.mjs`；pre-commit 与 CI 沿用现有命令，不新增并行入口。

### 8.3 Project Structure

```text
client.js                        客户端全部逻辑与内联样式（F1/F2/F3 UI、normalize、轮询）
host/scan.js                     扫描/分层/状态（F3 的 per-layer status、孤儿、遮蔽）
host/store.js                    索引读写/normalize（F3 的 reviewedBy）
host/routes.js                   HTTP 路由（F2 Job 透传、F3 /list.health）
host/translate.js                翻译 job manager（F2 failures）
locale/zh.json, locale/en.json    新增文案
test/fixture.mjs                 临时技能根与索引夹具（F1/F2/F3 场景）
test/host-harness.mjs            D1 的真实路由测试桥（新增）
test/page-regression-test.mjs    页面渲染与交互回归
test/write-path-test.mjs         D1 的四类写路径断言（新增）
test/render-page-test.mjs        真实宿主联调（手动）
docs/API-CONTRACT.md             F2/F3 契约更新
docs/DESIGN.md                   F3 数据模型说明（如需要）
docs/SPEC-0.4.0.md               本文件
docs/03-known-issues.md          已解决项移出，残余风险写入
README.md                        已知限制更新（批量翻译不再“未实现”）
CHANGELOG.md                     0.4.0 条目
AGENTS.md                        文档索引加本文件一行
```

### 8.4 Code Style

- `client.js`：`var` / `function` / 单引号 / 分号；**不用箭头函数与模板字符串**；新逻辑保持现有 `tr()`、`apiRequest()`、`apiPost()` 风格。
- `host/` / `test/` / `scripts/`：ESM、`const` 优先、`node:` 前缀、禁止 `var`。
- 2 空格缩进；单引号；文件末尾换行；新代码行宽 ≤110；中文注释解释「为什么」，不是复述代码。
- 新增 UI 变量必须同时进 `THEME_VARS` 亮/暗与 `scripts/check-contrast.mjs` 的 CASES；正文 4.5:1、大字 3:1、边框/焦点 3:1。
- 不在 `client.js` 里写死中文；新文案进 `locale/zh.json` 与 `locale/en.json`。
- 列表行仍是 `<a data-skw-row href="#skill/...">`，行内不嵌 `button`；破坏性操作 5s 二次确认并可取消。

### 8.5 Testing Strategy

| 层级 | 位置 | 覆盖 |
|---|---|---|
| 宿主单元/契约 | `host/selftest.mjs`（或新增 host 测试文件，挂进 `npm run selftest`） | per-layer status、孤儿、遮蔽、`reviewedBy`、Job failures、脱敏、截断 |
| 页面回归 | `test/page-regression-test.mjs` + `test/write-path-test.mjs` | F1 计数/筛选、F2 状态机、F3 体检、D1 四类写路径 |
| 内容审计 | `npm run audit:zh:selftest` / `audit:zh:ci` | 45 条内置包、P1 为 0 |
| 手动联调 | `node test/render-page-test.mjs` / `run-live.mjs` | 真实宿主下的批量翻译、取消、体检 |

要求：

- 先红后绿；断言中文业务含义；不降断言、不跳过。
- 新 `/list` 字段必须同时改 `normalizeSkillView` / `normalizeIndex` 白名单与页面断言（C-03）。
- 夹具必须确定：不扫本机技能目录；所有期望值从夹具事实现算，不写死具体技能数量以外的环境数据。
- 空数据要判失败：`audit:zh:ci` 的 `--require-data` 已有；页面测试若技能数为 0 也要显式断言失败，不能“绿灯通过”。

### 8.6 Boundaries

- **Always**：改逻辑同提交改测试；新增 docs 进 AGENTS.md 索引；改行为记 CHANGELOG；新增 `/list` 字段进 normalize 白名单；新增主题变量三处同步；跑 `npm run test:page` 与 `npm run selftest`。
- **Ask first**：新增 `/health` 等路由；改变 `/list.coverage` 公式；改变 `status` 的 `fresh/stale/untranslated` 语义；给 `Job` 增加除 `failures/failuresTruncated` 之外的字段；修改项目层写入策略；新增依赖。
- **Never**：修改 `SKILL.md` 或英文 `name`；写 `$DSH_HOME` 之外的用户数据；把项目层当可写；把 provider 原始错误/绝对路径透传给客户端；用 `innerHTML`；在列表行内嵌按钮；为了让测试过而删断言/跳过；把 45 条内容未完成说成已完成。

## 9. 风险与开放问题

### 9.1 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| 45 条内容做不完 | 覆盖卡仍显示 N=45 | 代码先发、内容 0.4.1；release note 写明；不阻塞代码门禁 |
| 批量翻译成本/时长超预期 | 用户等待、模型费用 | 只暴露未翻译/过期；确认框显示数量；取消；不自动重试整个 job |
| 失败明细泄露路径/原始错误 | 隐私/安全 | 只给 name + 固定短原因；宿主脱敏；测试断言无 `/Users`、`C:\` |
| 体检把「无法校验」说成「过期」 | 误导用户 | 文案分开；内置层永远 `unverifiable`；测试断言 |
| 被遮蔽层拿生效层 hash 比较 | 误报 stale | 每层用自己 bound.path 找候选；找不到标 `unverifiable`，不猜 |
| 旧宿主/新客户端字段缺失 | 页面崩 | normalize 默认值；无 `layers`/`health` 时隐藏对应 UI |
| 夹具扩太多导致测试脆 | 门禁不稳 | 期望值从夹具事实现算；不依赖本机技能目录；新增场景集中在 fixture |
| 现有 audit 基线 8 条 P1 | 任何 0.4.0 PR 无法合并 | P0 先修（7.0）；CI 门禁不降级；P2 记录不强行清零 |
| 98 条内置包 audit 出 P1 | 发版卡住 | 内容审核提前；P1 必修；P2 记录；不把 `strict` 当门禁 |

### 9.2 开放问题（不阻塞起草，评审时确认）

1. 体检 `<details>` 默认折叠还是展开？本 spec 选折叠，摘要显示「X 项可关注」。
2. 批量失败技能名是否做成详情链接？本 spec 选「是」，每行一个链接；若担心离开页面丢进度，可改纯文本。
3. `reviewedBy` 是否在列表行显示？本 spec 选「不显示」，只在详情层信息与体检里显示，避免列表过密。
4. 45 条内容是否必须在 0.4.0 发布前完成？已拍板：代码与内容可分开，内容未完成顺延 0.4.1。
5. 是否给 `health` 增加顶层计数（如 `activeUnverifiable`）？本 spec 选「不加」，客户端从 `skills`/`health` 现算，减少两处真相。

## 10. 评审清单

评审时请逐项确认：

- [ ] 第 0 节六条假设成立；没有需要纠正的。
- [ ] 第 2 节顺序与总规模（P0 0.2 + 功能/债 7–10 人日 + 1–2 人日内容）可接受；同意先修 8 条现存 P1。
- [ ] F1 的四桶口径（内置/本地/没中文/来源未知）与 UI 位置正确。
- [ ] D1 的四类断言足够；测试桥用 fake req/res，不依赖真实宿主。
- [ ] F2 只暴露未翻译/过期；失败明细字段与脱敏规则可接受。
- [ ] F3 的 `layers[].status/reviewedBy`、`/list.health`、`reviewedBy` 写入规则可接受。
- [ ] 旧宿主/旧索引降级路径没有遗漏。
- [ ] 第 9.2 节五个开放问题的默认选择可接受。
- [ ] 同意后进入 Plan（技术方案）与 Tasks（可执行任务拆解），不直接写代码。

评审通过后的下一步：按第 2 节顺序拆 Plan/Tasks；F1 先做，D1 紧随，F2 与 F3 在 D1 绿后依次落地；C1 内容可与 F2 并行准备，但不阻塞代码版。
