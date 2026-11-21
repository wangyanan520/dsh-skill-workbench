# Plan: 0.4.0 可信覆盖（技术方案）

状态：`Plan / Approved v1.0`

评审：2026-11-21 通过；第 8 节按推荐方案 A/A/A/A/A。

Spec：[docs/SPEC-0.4.0.md](SPEC-0.4.0.md)（Specify / Approved v1.0）

日期：2026-11-21

范围：只做技术方案，不写实施代码；本文评审通过后，才进入 Tasks（任务拆解）。

## 0. 这份 Plan 回答什么

1. 每个工作包改哪里、依赖谁、先做什么。
2. 哪些部分可以并行，哪些必须串行。
3. 每个检查点用什么命令证明没坏。
4. 哪些设计取舍需要本人拍板。

不回答：具体函数逐行怎么写、每个提交怎么切。那些留给 Tasks。

## 1. 技术基线

### 1.1 现有数据流

```text
client.js
  → GET  /list   → routes.list → collectState → scanSkills → buildSkillViews → SkillView[]
  → GET  /status → routes.status → jobs.snapshot()
  → POST /save   → routes.save → normalizeZh → mutateUserStore → index.json
  → POST /translate → routes.translate → createJobManager.start() → runJob
  → GET  /status → Job{state,total,done,failed,current,error}
```

关键事实：

- `host/scan.js` 的 `resolveLocalization` 已按 project → user → builtin 收集完整层；`buildSkillViews` 目前只下发 `source/origin/review/updatedAt`，**丢掉了每层的 hash、bound 和审核来源**。
- `computeSkillStatus` 只拿「第一个有 frontmatter hash 的层」和 winner 比；内置层没有 hash，被跳过，最后 fallback `fresh`。这是「上层 fresh 掩盖下层 stale」「内置永远 fresh」的根因。
- `insertCandidate` 同名去重时只保留 winner，loser 直接丢弃，所以同名遮蔽不可见。
- `buildSkillViews` 只遍历 candidateMap，用户层里没有对应 SKILL.md 的孤儿条目不显示。
- `host/store.js` 的 `normalizeEntry` 没有 `reviewedBy`，`reviewed` 分不清人审/助手/导入/内置。
- `host/translate.js` 的 `failures` 是 `runJob` 局部数组；`publicJob` 只暴露 `failed` 计数与第一个 `error`，不暴露失败技能名。
- `makeRoutes(ctx,{jobs,config})` 返回**路由数组**，不是对象；可直接用 fake `req/res` 调用，不需要真实 DSH 宿主。`host/selftest.mjs` 已有同类 fake HTTP 工具可参考。
- 页面测试的 `window` 只有 `__ModuleLoader__`、`location`、`matchMedia`，没有 `confirm/history/addEventListener`；`fetch` 对 `/list` 返回夹具，其它路径一律 `{}`。所以现有写路径没有断言。

### 1.2 不能动的边界

- 不改 `SKILL.md`、英文 `name`、安装/启停/执行。
- 不新增运行时依赖、不引入构建步骤。
- 不新增 `/health` 路由；F3 的体检数据走 `/list.health`。
- 不改 `SkillView.status` 的 `fresh/stale/untranslated` 语义；`unverifiable` 只出现在 layer 体检里。
- 用户数据只写 `$DSH_HOME/dsh-skill-workbench/`；项目层只读。
- 新增 `/list` 字段必须同时进 `normalizeSkillView` / `normalizeIndex` 白名单与页面断言。

## 2. 目标架构

### 2.1 新增/变化的数据形状

**`SkillView.layers[]`（F3，additive）**

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

- `active` 只在第一个生效层为 `true`；其余为 `false`。
- `status` 是该层自身可校验性，不是整技能状态；内置层永远 `unverifiable`。
- 整技能 `status` 不变；生效层 `unverifiable` 时整技能仍按现有规则记 `fresh`。

**`/list.health`（F3，additive）**

```jsonc
{
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
```

- 只由 `/list` 返回；`/status` 不变，避免两处真相。
- 路径只发给 loopback 客户端，不进日志、不进导出。

**`Job`（F2，additive）**

```jsonc
{
  "id": "job_...",
  "kind": "translate",
  "state": "running | done | failed | cancelled",
  "total": 10,
  "done": 9,
  "failed": 1,
  "current": "plain-notes",
  "startedAt": "ISO",
  "finishedAt": "ISO | null",
  "error": "翻译失败",
  "failures": [
    { "name": "plain-notes", "code": "ERR_SAVE", "message": "写入失败" }
  ],
  "failuresTruncated": false
}
```

- `failures` 最多 50 条；`failed` 仍是总失败数，不因截断而变小。
- `message` 只给固定短原因/脱敏后的短文本，不透传原始错误、prompt、模型输出、绝对路径。

**`index.json` entry（F3，additive）**

```jsonc
{
  "dirName": "lark-doc",
  "bound": { "kind": "user-agents", "rank": 500, "path": "/abs/path/SKILL.md" },
  "hash": { "frontmatter": "...", "body": "...", "at": "ISO" },
  "zh": { "...": "..." },
  "reviewedBy": "human",
  "updatedAt": "ISO"
}
```

- `reviewedBy` 放在 entry 顶层，不塞进 `zh`，避免 `normalizeZh` 白名单继续膨胀。
- 旧索引没有该字段时读取默认：`reviewed` → `unknown`，`draft` → `null`；内置包 → `builtin`。
- 不做一次性迁移；只在 review 变化或 import 写入时落新字段。

### 2.2 兼容矩阵

| 场景 | 行为 |
|---|---|
| 新宿主 + 新客户端 | 全部功能；F1/F2/F3 正常 |
| 新宿主 + 旧客户端 | 旧客户端忽略 `health`、`layers[].status/reviewedBy`、`failures`；无破坏 |
| 旧宿主 + 新客户端（无 `layers`） | F1 只显示「来源未知/没中文/过期」；F2/F3 隐藏对应 UI 并给升级提示 |
| 旧宿主 + 新客户端（有 `layers` 无 `health`） | F1 正常；F3 只隐藏体检 `<details>`，详情层信息退回现有文案 |
| 旧索引无 `reviewedBy` | 读取默认 `unknown`/`builtin`/`null`，不写盘、不迁移 |
| 旧 `/status.jobs` 无 `failures` | F2 显示「失败 N 个（当前宿主不提供明细）」，不假装知道名字 |

### 2.3 请求/状态流

```text
F1：GET /list → skills[].layers → computeGapBuckets → 覆盖卡按钮 → 现有 filter
F2：POST /translate {scope} → Job → 1.5s GET /status → progress/failures → 完成/取消/重试
F3：GET /list → skills[].layers[].status + health → 覆盖卡体检/详情层信息
D1：test/write-path-test.mjs → makeRoutes() → fake req/res → 真实 save/delete/status
```

## 3. 工作包

### 3.0 P0：先修 8 条 audit P1（0.2 人日）

**目标**：把当前 CI 的 8 条 P1 清零，让任何 0.4.0 PR 有可用的门禁基线。

**改哪里**

- `translations/zh-CN.builtin.json`：给 8 个 entries 补 `pinyin` / `pinyinInitials`，不改中文名、summary、category、路由关键词：
  `ab-test-analysis`、`analyze-feature-requests`、`andrej-karpathy-skill`、`ansoff-matrix`、`api-and-interface-design`、`archify`、`banner-design`、`beachhead-segment`。

**实现要点**

- 只补字段；不重新生成整条 entry。
- 拼音按现有审计规则生成，不硬造首字母；补完先跑 `audit:zh:ci`，P1 从 8 到 0。
- 单独一个 PR/提交，放在 F1 之前；不夹带功能改动。

**验证**

```bash
npm run audit:zh:selftest
npm run audit:zh:ci          # P1 0；13 条 P2 保留记录
node translations/validate.mjs
```

**完成判据**：P1 0；8 条中文名/路由关键词 diff 为空；P2 数量与处理记录留在 release note。

---

### 3.1 F1：内置包缺口发现（纯客户端，0.5–1 人日）

**目标**：在覆盖率卡上把「内置包 / 仅自己补 / 没中文 / 来源未知」分开，并给出可点的现有筛选入口。

**改哪里**

- `client.js`：覆盖率卡区块（约 3864 行起）。
- `locale/zh.json`、`locale/en.json`：新增文案。
- `test/fixture.mjs`、`test/page-regression-test.mjs`：新增/调整断言。

**设计**

1. 在 `client.js` 增加一个纯函数 `computeGapBuckets(skills)`：
   - `layers = Array.isArray(skill.layers) ? skill.layers : []`，先防旧宿主没有数组。
   - `builtin`：有中文且 `layers` 含 `source === 'builtin'`。
   - `local`：有中文、不含 builtin，但含 `source === 'user' | 'project'`。
   - `none`：无中文。
   - `unknown`：有中文但 `layers` 为空/不存在（旧宿主）。
   - 返回 `{ builtin, local, none, unknown, stale, draft, total }`；四桶之和必须等于 `skills.length`。
   - `stale` 用 `skill.status === 'stale'`；`draft` 用 `skill.zh.review === 'draft'`；两者独立显示，不进四桶。
2. 覆盖率卡增加一行「覆盖来源」：
   - 正常宿主：`内置包 W · 仅自己补 S · 没中文 N`；`unknown > 0` 时追加 `来源未知 U`。
   - `N > 0` 显示「查看没中文」按钮，点击调用现有 `setFilter('untranslated')`（已有路由机制），不新增 filter 值。
   - 已有「过期」筛选保留；额外「查看过期」按钮调用 `setFilter('stale')`。
   - `N = 0` 不显示对应按钮；`total = 0` 显示「还没有扫描到技能」；全部内置时显示「全部由内置包覆盖」。
3. 旧宿主（无 `layers`）：
   - 不显示「内置包 / 仅自己补」两个数；显示 `来源未知 U · 没中文 N · 过期 T`。
   - 给一行说明「当前宿主不提供分层来源；升级 DSH / 插件后可看到内置包归因」。
4. 可访问性/布局：
   - 数字有 `aria-label`；按钮是 `<button type="button">`；不塞进列表行。
   - 窄屏允许换行，不横向滚动；颜色走现有 `--skw-*`，不新增主题变量。
   - 文案全部进 locale，不在 `client.js` 写死中文。

**测试设计**

- 夹具新增一个 `agent-reach` 技能（无用户层中文；它命中仓库内置包），使 `FIXTURE.total = 6`：
  - 预期：`builtin=1`、`local=3`（3 个用户层 lark-*）、`none=2`（plain-notes 与 project-only 都无用户层中文）、`unknown=0`；四桶和 = 6。
  - 现有 5 条夹具断言改为从 `FIXTURE` 现算，不写死 5。
- 旧宿主用例：把 PAYLOAD 复制一份删掉所有 `layers`，渲染后断言显示来源未知、没中文、过期，且不崩。
- `total=0` 用例：空 skills 渲染「还没有扫描到技能」。
- 断言中文业务含义：`内置包 1 个`、`没中文 1 个`、四桶和等于总数、旧宿主说明文案。

**降级/边界**

- 不改宿主；旧宿主只降级展示，不阻塞列表/详情。
- 不新增 filter 值；「查看没中文/过期」只复用现有 `untranslated`/`stale`。
- 不把 `unknown` 说成「内置包」或「仅自己补」。

---

### 3.2 D1：写路径测试桥（3–4 人日）

**目标**：让保存写入链路、审核只落 review、脏检查、URL hash 前进后退四类行为在 `npm run test:page` 中真实经过 `/save`、`/delete`、`/status`，而不是 `{}`。

**改哪里**

- `test/host-harness.mjs`（新增）：真实 `makeRoutes` + fake `req/res`。
- `test/write-path-test.mjs`（新增）：保存写入链路、审核只落 review。
- `test/page-regression-test.mjs`：补脏检查、hash 前进后退的 window stub 与断言。
- `test/fixture.mjs`：返回 `projectRoot`；新增 `agent-reach`；给一个技能写 `.skill-lock.json` 以覆盖 `install`。
- `package.json`：`test:page` 改为同时跑两个脚本。
- 生产代码：仅当测试暴露 P1 时才改；否则不动。

**设计：`test/host-harness.mjs`**

```js
// 形状示意，不是实现
export async function createHarness({ cwd, jobs, config }) {
  const routes = makeRoutes(
    { workingDirectory: { get: () => cwd }, skills: { list: async () => [] } },
    { jobs, config }
  );
  const byPath = new Map(routes.map((route) => [route.path, route]));
  return {
    async call(method, path, body, options) { /* fake req/res + loopback */ },
    close() {}
  };
}
```

- `makeRoutes` 返回数组，不是 `{routes}`；harness 用 `Map` 按 path 查。
- fake `req`：`EventEmitter`，带 `method/url/headers/socket.remoteAddress`；body 用 `setImmediate` 发 `data/end`。
- fake `res`：`writeHead(status, headers)`、`end(text)`、`headersSent`、`destroy()`；解析 JSON。
- `jobs` 对保存/审核测试用 stub：`{ snapshot: () => [], start: async () => { throw new Error('not used'); }, cancel: async () => {} }`。
- 需要真实 `Job` 的 F2 测试另行用 `createJobManager` + fake LLM；D1 不依赖 LLM。
- `ctx.skills.list` 返回空数组即可；`scanSkills` 会走真实磁盘；不要 mock `scanSkills`。

**设计：`test/write-path-test.mjs`**

A. 保存写入链路：

1. `createFixture()`，记录原始 `index.json`。
2. 通过 harness `POST /save`，只提交 `zh.summary` 一个字段。
3. 读回 `index.json` / `GET /list`，断言：
   - 只改 summary，其他 `zh` 字段保持不变；
   - entry 有 `bound`/`hash`/`updatedAt`；
   - `/list` 的 `layers` 与 `install` 没被 normalize 丢掉（保存前后对比）。
4. 断言 `POST /save` 空内容仍返回 `ERR_EMPTY_ZH`，且不写盘。

B. 审核只落 review 状态：

1. 用 `lark-im` 的 draft 条目。
2. 记录 `index.json` 的 `zh` 内容。
3. `POST /save { name:'lark-im', zh:{}, review:'reviewed' }`。
4. 断言 200；`review === 'reviewed'`；`zh` 内容 deep equal 之前（不丢内容、不改 origin）；`bound/hash` 未被无意义重写（updatedAt 可变）。
5. 对内置草稿走完整表单提交时，断言最终内容与表单一致，不静默改变。

C. 脏检查（放在 `test/page-regression-test.mjs`）：

- 给 sandbox `window` 加 `confirm`（可切换 true/false）、`addEventListener/removeEventListener`、`history`（pushState/replaceState 更新 `location.hash`）。
- 打开详情，改一个字段，点返回/切分区：
  - `confirm` 返回 false：仍留在详情，表单内容不丢；
  - `confirm` 返回 true：离开，草稿救援仍可恢复。
- 关窗：捕获 `beforeunload` handler，断言 dirty 时调用 `preventDefault`；干净时不拦。
- 断言草稿镜像 `sessionStorage['skw:draft:<name>']` 在脏时存在、离开后按现有规则处理。

D. URL hash 前进后退（放在 `test/page-regression-test.mjs`）：

- `location.hash = '#library?filter=untranslated'`，触发 `popstate`，断言列表筛选为未翻译。
- 后退到 `#library`，断言筛选回到 all。
- 非法 filter `#library?filter=not-a-filter`，断言退回 all，且没有按钮呈按下态。
- 详情 hash `#skill/<name>` 前进/后退，断言详情打开/关闭；脏表单后退先 confirm。

**测试入口**

- `package.json`：

```json
"test:page": "node test/page-regression-test.mjs && node test/write-path-test.mjs"
```

- pre-commit 与 CI 沿用 `npm run test:page`，不新增并行入口。
- 目标：新增写路径断言总耗时 ≤ 3 秒；整个页面回归仍 < 15 秒。

**先红后绿**

- 先在当前代码上跑 A/B/C/D，确认四类至少各 1 条失败（现有 fetch mock 返回 `{}` / 没有 window stub，必然红）。
- 再按失败原因修测试桥或暴露的 P1；不为过测试删断言。

**降级/边界**

- 不依赖端口、真实宿主、本机技能目录。
- 测试桥与生产共用 `makeRoutes` / `scanSkills` / `mutateUserStore`，不复制业务逻辑。
- 只改 `test/` 与 `package.json`；若发现生产 P1，单独提交并写 `03-known-issues`。

---

### 3.3 F2：批量 AI 翻译（1.5–2 人日）

**目标**：复用现有 job manager，给管理页一个「未翻译/过期 → 确认 → 进度 → 失败明细 → 重试/取消」的批量入口；不新增路由。

**改哪里**

- `host/translate.js`：Job 增加 `failures`/`failuresTruncated`；`runJob` 记录失败技能名；映射/脱敏。
- `host/routes.js`：`/status` 已经 `jobs.snapshot()`；确认 `publicJob` 新字段透传，无需新路由。
- `client.js`：`Page` 状态机、`LibraryTab` 工具栏、批量面板、轮询、重试/取消。
- `locale/zh.json`、`locale/en.json`：新增文案。
- `docs/API-CONTRACT.md`：Job 形状与 `/status` 示例。
- `host/selftest.mjs`、`test/page-regression-test.mjs`：断言。

**宿主设计**

1. `publicJob` 增加：
   - `failures`: 安全副本 `[{name, code, message}]`，最多 50 条；
   - `failuresTruncated`: `job.failed > failures.length`。
2. `runJob`：
   - `job.failures = []` 初始化；
   - 失败时 `recordFailure(job, target.name, error)`：
     - `code` 取错误码；
     - `message` 按固定映射：`ERR_NO_LLM → 模型不可用`、`ERR_SAVE → 写入失败`、解析/输出不合规 → `返回格式不符合要求`、超时 → `超时`、其他 → `翻译失败`；
     - 若底层 message 含绝对路径，先替换为 `<路径>`，再截断 160 字符；
     - 前 50 条入数组，超出只置 `failuresTruncated=true`；
   - `job.failed` 继续累加；`job.error` 保留一句总原因（全部失败时），不保存 target/prompt/模型输出；
   - 取消时未开始的目标不计入 failures；已完成/已失败保留；
   - 部分失败：`state='done'` + `failed>0` + failures；全部失败：`state='failed'`。
3. 不改 `MAX_RUNNING_JOBS=2`、`CONCURRENCY=2`、`MAX_OUTPUT_CHARS=20000`；不新增路由。
4. 契约更新：`Job` 示例、`/status`、失败明细字段、脱敏规则。

**客户端设计**

1. `Page` 新增状态：`batchScope`（`untranslated|stale`）、`batchArmedUntil`、`batchJobId`、`batchError`、`batchNotice`。
   - 现有 `runningJobId` 保留给单条重译；批量轮询优先用 `batchJobId`，按 job id 从 `/status.jobs` 查找，不能随便取第一个 running。
   - 5 秒二次确认用 `batchArmedUntil` + `setTimeout` 复位；卸载/切分区清理 timer。
2. `LibraryTab` 工具栏（「从安装源补简介」旁）新增：
   - 范围 `<select aria-label="批量翻译范围">`：`未翻译（N）` / `过期（N）`；不提供 all。
   - 主按钮「批量翻译（N）」：`N=0` 或已有 running job 时禁用；点击先 armed，再显示「确认翻译 / 取消」。
   - 确认文案包含数量、AI 结果标草稿、不覆盖手动内容、失败可重试/取消。
3. 启动：
   - `POST /translate { scope: batchScope }`，不传 `names`；
   - 429 `ERR_BUSY` → 面板内 `role=alert`「已有翻译任务在运行」；404/405 → 「当前宿主不支持批量翻译，请升级插件」；不进入假进度。
   - 成功后记 `batchJobId`，进入 running。
4. 进度/结果面板（工具栏下方）：
   - running：`翻译中 3/10 · 失败 1 · 正在处理：<name>`；`role=progressbar` + `aria-valuemin/max/now`；「取消」按钮。
   - done：`完成 9 个，失败 1 个`；失败列表最多 20 条，每条 `技能名 — 短原因`，技能名是 `<a data-skw-row href="#skill/<name>">`；「重试失败项（N）」在列表外。
   - failed：`任务失败：<总原因>`；有部分完成时仍显示失败列表与重试。
   - cancelled：`已取消：完成 X，失败 Y`；不自动重试。
   - 旧宿主无 `failures`：显示 `失败 N 个（当前宿主不提供明细）`，不假装知道名字。
   - 错误就近：启动失败、429、取消失败都在面板内 `role=alert`。
5. 重试：
   - 失败列表有名字：`POST /translate { scope:'selected', names:[...] }`；
   - 旧宿主无名字：退回按当前 scope 重跑，并提示可能重复成功项。
6. 结束：done/failed/cancelled 后刷新 `/list` + `/status`；面板保留到用户关闭或下一次启动；批量运行中不整表重渲染成 loading，不覆盖正在编辑的表单。
7. 所有新文案进 locale；不新增主题变量；进度条颜色用现有 `--skw-*`。

**测试设计**

- `host/selftest.mjs`：
  - 构造 2 个目标，其中一个失败，断言 `failures` 有 name/code/message，`failed` 计数正确；
  - 构造 51 个失败，断言只保留 50 条、`failuresTruncated=true`、`failed=51`；
  - 构造含 `/Users/...` 的错误 message，断言客户端可见 message 不含绝对路径；
  - 全部失败 `state=failed`，部分失败 `state=done`；取消未开始不计 failures。
- 页面测试：
  - mock `/translate` 记录 body，断言 scope 正确、无 names；
  - `/status` 序列：running 1/2 → running 2/2 → done 2/0；断言进度；
  - done 1/2 + failures；断言失败列表、重试 body `{scope:'selected',names:[失败名]}`；
  - 429；旧宿主无 failures；取消；5 秒 armed 复位；`aria-valuenow` 变化。
- 先红后绿；断言中文文案。

**降级/边界**

- 只暴露 `untranslated`/`stale`；不提供 all。
- 旧宿主无 `/translate`：提示升级；不影响单条重译。
- 不自动重试整个 job；重试只针对失败名单。
- 最多 2 个 job；批量不并发多个 job；429 由宿主兜底。
- 不把失败明细写日志/导出；不暴露 prompt/模型输出。

---

### 3.4 F3：技能体检（2–3 人日）

**目标**：让「不可校验」「上层掩盖下层」「孤儿条目」「同名遮蔽」「审核来源」可见；整技能 `status` 语义不变。

**改哪里**

- `host/scan.js`：per-layer status、`health`、`reviewedBy` 透传。
- `host/store.js`：`normalizeEntry` 保留 `reviewedBy`；默认值。
- `host/routes.js`：`/list` 透传 `health`；`save`/`import` 写 `reviewedBy`。
- `client.js`：`normalizeSkillView`/`normalizeIndex` 白名单、体检面板、`layerText`。
- `docs/API-CONTRACT.md`：`SkillView.layers[]`、`/list.health`、`reviewedBy` 写入规则。
- `host/selftest.mjs`、`test/fixture.mjs`、`test/page-regression-test.mjs`：断言。

**宿主设计：`host/scan.js`**

1. 候选集合：
   - `scanSkills` 保留 `candidateMap`；新增 `allCandidates` 数组与 `shadowed` 数组。
   - `insertCandidate(map, candidate, shadowed)`：
     - 新 name：直接放入；
     - 新 candidate rank 更小：旧 winner 进 `shadowed`（loser），新 winner 放入；
     - 新 candidate rank 更大：新 candidate 进 `shadowed`；
     - 同 rank：新 candidate 进 `shadowed`，保留已有。
   - `shadowed` 记录 `{name, winner:{kind,path}, losers:[{kind,path}]}`；按 name 合并同组 loser。
2. per-layer status：
   - `buildSkillViews` 需要按 name 找候选：优先 `layer.entry.bound.path` 精确匹配，其次同名 candidate；找不到 → `unverifiable`。
   - `layerStatus(layer, candidate)`：
     - `layer.hash` 不是对象/没有 frontmatter → `unverifiable`；
     - 有 frontmatter 且与 candidate 不一致 → `stale`；
     - body hash 存在且与 candidate 不一致 → `stale`；
     - 否则 `fresh`。
   - `active`: 第一个 layer 为 true，其余 false。
   - `reviewedBy`：
     - `layer.entry.reviewedBy` 合法值直接用；
     - 内置层默认 `builtin`；
     - `review === 'reviewed'` 但无字段 → `unknown`；
     - `review === 'draft'` → `null`。
3. `health`：
   - `orphanEntries`：遍历 `userStore.entries` 与 `projectStore.entries`，有中文但 name 不在 candidateMap；输出 `{name, layer, zhName, updatedAt}`。
   - `shadowedSkills`：来自 `shadowed` 数组。
   - `scanSkills` 返回 `{skills, coverage, stores, generatedAt, health}`；`buildSkillViews` 不把 health 塞进每个 skill。
4. 整技能 `computeSkillStatus` 不变；内置层仍 `unverifiable` 但整技能可 `fresh`。

**宿主设计：`host/store.js` / `routes.js`**

1. `normalizeEntry` 增加 `reviewedBy`：合法值白名单 `human|assistant|import|builtin|unknown`；非法/缺失保留 `null`。
2. 读取默认：
   - 内置包条目：`reviewedBy='builtin'`；
   - 用户/项目旧条目：`review==='reviewed'` 且无字段 → `unknown`；`draft` → `null`。
   - 默认值只在 `buildSkillViews` 计算，不写盘。
3. `save` 写入规则（服务端权威）：
   - 最终 `review==='reviewed'` → `reviewedBy='human'`；
   - 最终 `review==='draft'` → `reviewedBy=null`；
   - 客户端 body 不能直接指定 `reviewedBy`（即使传也忽略）。
4. `import`：写入 reviewed 条目 → `reviewedBy='import'`；保留已有条目时保持原值。
5. `routes.list`：`ok({..., health: state.health})`；`status` 不变。

**客户端设计**

1. `normalizeSkillView`：
   - `layers` 每项保留 `source/origin/review/reviewedBy/updatedAt/status/active`；
   - 缺 `status` → `unverifiable`；缺 `reviewedBy` → `null`；缺 `active` → 第一项 true；
   - 非法值收敛到安全默认。
2. `normalizeIndex`：保留 `health`，缺省 `{orphanEntries:[],shadowedSkills:[]}`；旧宿主无 health 不崩。
3. 覆盖率卡新增 `<details>`「技能体检」：
   - 摘要：`技能体检 · X 项可关注` / `未见异常`；
   - 状态可信度：`无法校验 A`、`已过期 B`、`被遮蔽层 C`；
   - 索引结构：`孤儿条目 D`、`同名遮蔽 E`；各最多 5 条，其余「还有 N 条」；
   - 审核来源：`人工 F · 来源未知 G · 导入 H · 内置 I · 草稿 J`；0 可省略，但人工/来源未知总显示；
   - 技能名 `<a data-skw-row>`；孤儿纯文本；不嵌套按钮；窄屏不横向滚动。
4. 详情页 `layerText`：
   - 每层 `source + origin + status + reviewedBy`，例如 `项目层 · 手动 · 新鲜 · 人工审核`、`用户层 · AI · 已过期 · 来源未知`、`内置包 · 内置 · 无法校验 · 内置包标记`；
   - 仍只显示合并后的中文内容；层信息不是编辑入口。
5. 旧宿主：无 `health`/`layers[].status` 时隐藏体检 `<details>`；详情退回现有 `source+origin+draft`，并显示「当前宿主不提供技能体检」。
6. 不新增主题变量；若新增按 C-04 三处同步。

**测试设计**

- `host/selftest.mjs`：
  - 内置层 `status=unverifiable`、`active=true`；
  - 用户层 hash 写错 → layer `stale`、整技能 `stale`；
  - 用户层 `ghost-skill` 无 SKILL.md → `health.orphanEntries` 含它，coverage 总数不变；
  - project/user 同名 → `health.shadowedSkills` 1 条，winner=project，列表只出现一次；
  - `reviewedBy`：旧条目 unknown、save reviewed→human、import→import、builtin→builtin、draft→null；
  - 旧索引无 reviewedBy 不崩。
- 页面测试：
  - 夹具加 ghost/shadow/stale 场景；断言体检计数与列表；
  - `normalizeSkillView` 保留 layers.status/reviewedBy；`normalizeIndex` 保留 health；
  - 旧载荷缺字段不崩；
  - 详情层信息文案正确；原来 layers 透传/覆盖卡/详情断言保留。
- 契约测试：`docs/API-CONTRACT.md` 示例与实现一致。

**降级/边界**

- 若「每层 bound.path 找候选」成本过高：至少保证生效层正确；被遮蔽层统一 `unverifiable`，写入 `03-known-issues`；不得误报 fresh/stale。
- 旧索引不迁移；默认值只在读取时计算。
- 不新增 `/health`；不把 health 放 `/status`。
- 路径只给 loopback；不写日志、不进导出。

---

### 3.5 C1：45 条内置包内容更新（1–2 人日，数据）

**目标**：把当前机器 45 个「磁盘有、包里没有」的技能补进内置包；代码 0.4.0 可先发，内容未完成顺延 0.4.1。

**改哪里**

- `translations/zh-CN.builtin.json`：新增 45 个 entries（53 → 98）。
- `docs/03-known-issues.md`、`README.md`、`CHANGELOG.md`：发布说明。
- 抽审记录：PR 描述或 `research/` 笔记。

**做法**

1. P0 的 8 条 P1 先修；C1 不碰它们的中文名/路由。
2. 用 F2 的批量翻译 UI 或同一套 `host/translate.js` 管线生成候选；**不把用户层条目直接当内置包**。
3. 人工抽审至少 10 条，覆盖 manual/llm/import 来源；重点查失真、丢路由/触发细节，不查文风。
4. 通过后写入内置包：`origin:'builtin'`、`review:'reviewed'`；不写 `reviewedBy`（读取默认 builtin）。
5. 不删除现有 53 条；不把 8 个 DSH bundled 条目塞进内置包；不改英文 name/SKILL.md。
6. 若 C1 未完成：release note 写「45 条顺延 0.4.1」，并写出当前缺口数；不得把 N 说成 0。

**验证**

```bash
node translations/validate.mjs          # 结构 0 错误；磁盘有、包里没有 = 0
npm run audit:zh:selftest
npm run audit:zh:ci                    # P1 0；P2 记录
```

**完成判据**：98 条、无重复/缺 name；48 个磁盘技能全命中；抽审记录可查；P1 0。

## 4. 顺序、并行与检查点

### 4.1 关键路径

```text
P0（0.2d）
  → F1（0.5–1d） ─┐
  → D1 测试桥（3–4d） ─┴→ F2（1.5–2d） → F3（2–3d） → 发布
                         C1（1–2d，F2 后可与 F3 并行） ─┘
```

- P0 必须第一；否则 CI 红，后续 PR 无法合。
- F1 与 D1 的 harness 骨架可以并行：F1 改覆盖率卡；D1 先搭 fake `req/res` 与 fixture。D1 的页面类断言等 F1 的覆盖率卡落地后再补。
- F2 必须在 D1 之后：批量翻译是写路径，D1 要先能证明 `/save`、`/status`、刷新真的经过宿主。
- F3 在 F2 之后：两者都改 `client.js`，串行减少冲突；F3 的 health 也要等 F2 的失败面板稳定后再动覆盖率卡。
- C1 在 F2 之后（需要批量管线）；内容准备可与 F3 并行，但发布顺序按 Spec：代码先、内容可 0.4.1。

### 4.2 可并行/不可并行

| 工作 | 可并行 | 必须串行 |
|---|---|---|
| P0 | 无 | 先于所有 PR |
| F1 | 与 D1 harness 骨架 | F1 的页面断言先于 D1 页面类 |
| D1 | 与 F1（不同文件） | D1 绿后才合 F2 |
| F2 | 宿主改动与客户端 mock 可并行 | 必须在 D1 之后 |
| F3 | 宿主 scan/store 与客户端展示可并行 | 在 F2 之后（同 `client.js`） |
| C1 | 与 F3 内容并行 | 在 F2 之后（需要批量 UI/管线） |

### 4.3 检查点

**CP0（P0 后）**

```bash
npm run audit:zh:selftest
npm run audit:zh:ci
node translations/validate.mjs
```

要求：P1 0；8 条中文名/路由 diff 为空；P2 记录。

**CP1（F1 后）**

```bash
node --check client.js
node client.selftest.mjs
npm run test:page
```

要求：四桶和 = total；内置/本地/没中文/未知各有用例；旧宿主降级不崩；无宿主改动。

**CP2（D1 后）**

```bash
npm run test:page     # page + write-path
```

要求：四类断言各至少 1 条先红后绿；`/save`、`/delete`、`/status` 真实经过；页面回归 < 15s；新增 ≤ 3s；无生产代码改动（除 P1）。

**CP3（F2 后）**

```bash
npm run selftest
npm run test:page
```

要求：Job failures 有 name/code/message；51 → 50 截断；路径脱敏；部分失败 done / 全部失败 failed；429 不假进度；重试 selected；取消；旧宿主降级。

**CP4（F3 后）**

```bash
npm run selftest
npm run test:page
```

要求：内置 unverifiable；用户层 stale；孤儿/遮蔽夹具正确；reviewedBy 五种来源；旧索引不迁移；旧宿主隐藏体检；`normalize` 白名单与页面断言同步。

**CP5（C1 后）**

```bash
node translations/validate.mjs
npm run audit:zh:selftest
npm run audit:zh:ci
```

要求：98 条；磁盘 48 全命中；P1 0；抽审记录；C1 未完成则 release note 写顺延。

## 5. 文件级改动地图

| 文件 | P0 | F1 | D1 | F2 | F3 | C1 |
|---|---|---|---|---|---|---|
| `translations/zh-CN.builtin.json` | 8 条拼音 | — | — | — | — | 45 条 |
| `client.js` | — | 覆盖率卡四桶 | 脏检查/hash 断言配合 | 工具栏/面板/轮询 | 体检/层信息/normalize | — |
| `locale/zh.json`、`locale/en.json` | — | 四桶/按钮 | — | 批量文案 | 体检/层信息 | — |
| `host/translate.js` | — | — | — | failures/脱敏 | — | — |
| `host/scan.js` | — | — | — | — | per-layer/health | — |
| `host/store.js` | — | — | — | — | reviewedBy | — |
| `host/routes.js` | — | — | — | `/status` 透传 | `/list.health`、save/import | — |
| `test/fixture.mjs` | — | 加 `agent-reach` | 返 `projectRoot`、lock、ghost/shadow | 翻译夹具 | 体检夹具 | — |
| `test/host-harness.mjs` | — | — | 新增 | 可复用 | 可复用 | — |
| `test/write-path-test.mjs` | — | — | 新增 A/B | — | 可扩展 reviewedBy | — |
| `test/page-regression-test.mjs` | — | 四桶断言 | 新增 C/D | 批量断言 | 体检断言 | — |
| `host/selftest.mjs` | — | — | — | Job failures | scan/store | — |
| `package.json` | — | — | `test:page` 双脚本 | — | — | — |
| `docs/API-CONTRACT.md` | — | — | — | Job | layers/health/reviewedBy | — |
| `docs/03-known-issues.md` | — | — | — | — | 残余风险 | 内容进度 |
| `README.md` | — | — | — | 批量不再是「未实现」 | 体检说明 | — |
| `CHANGELOG.md` | — | — | — | — | — | 0.4.0 |
| `AGENTS.md` | — | — | — | — | — | 加本 Plan 索引 |

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| P0 未先修，CI 红 | 任何 PR 无法合 | P0 单独第一提交；CP0 不过不开始 F1 |
| D1 测试桥与生产分叉 | 测试绿但真实路由坏 | harness 直接调 `makeRoutes`/真实 `scanSkills`；不复制 handler |
| 测试桥把 `window` stub 成假通过 | 脏检查/hash 实际仍坏 | 断言先红；stub 必须触发真实 handler；不删断言 |
| F1 `layers` 缺失时抛错 | 旧宿主页面崩 | `Array.isArray` 守卫；旧宿主用例 |
| F2 失败明细泄露路径 | 隐私/安全 | 固定 message + 脱敏；断言不含 `/Users`、`C:\`；不存 prompt |
| F2 多 job 轮询串台 | 进度错乱/取消错 job | 用 `batchJobId` 按 id 查；单条 `runningJobId` 分开 |
| F3 被遮蔽层拿生效层 hash 比 | 误报 stale/fresh | 每层用自己 `bound.path` 找候选；找不到 `unverifiable` |
| F3 reviewedBy 兼容 | 旧索引/项目层读坏 | add-only；读取默认；不做一次性迁移 |
| F3 体检扫描变慢 | 页面变慢 | 只在 `/list` 算 health；不新增扫描；限制列表条数 |
| C1 内容质量 | 失真/丢路由 | 抽审 10 条；audit:zh:ci 把关；不直接 merge LLM |
| C1 做不完 | 覆盖仍 45 | 代码先发、内容 0.4.1；release note 写清 |
| 并行改 `client.js` 冲突 | 返工 | F1→F2→F3 串行；每包单独 PR |

## 7. 验证策略

- **单元/契约**：`host/selftest.mjs` 覆盖 Job failures、layer status、health、reviewedBy。
- **页面**：`test/page-regression-test.mjs` 覆盖 F1/F2/F3/D1 的 C/D；`test/write-path-test.mjs` 覆盖 D1 的 A/B。
- **内容**：`translations/validate.mjs` + `audit:zh:selftest` + `audit:zh:ci`。
- **手动**：`node test/render-page-test.mjs` / `run-live.mjs` 在真实宿主上过一遍批量翻译、取消、体检；不进 CI。
- **先红后绿**：每个包先让至少一条断言在当前代码上失败；不为绿而删断言/跳过。
- **空数据/旧数据**：`audit:zh:ci` 的 `--require-data`；页面测试 total=0 显式失败；旧索引/旧宿主各有用例。

## 8. 需要拍板的设计取舍

1. **D1 的测试文件拆分**
   - 方案 A（推荐）：A/B 放 `test/write-path-test.mjs`，C/D 放 `test/page-regression-test.mjs`；`test:page` 跑两个。
   - 方案 B：四类都塞进 `page-regression-test.mjs`，单文件但更长、宿主/DOM 混在一起。
   - 代价：A 多一个文件；B 单文件更难定位失败。

2. **F2 进度面板位置**
   - 方案 A（推荐）：工具栏下方，操作与进度相邻；覆盖率卡只保留数字。
   - 方案 B：覆盖率卡下方，和 F3 体检同区，信息集中但离触发按钮远。
   - 代价：A 页面稍长；B 需要滚动才能看到操作。

3. **F3 `health` 里的路径**
   - 方案 A（推荐）：`shadowedSkills` 带 `kind+path`，与 `SkillView.path` 一致，便于定位；只走 loopback。
   - 方案 B：只给 `kind+dirName`，隐私更稳，但同名遮蔽难以点开确认。
   - 代价：A 要求客户端不把 path 写日志/导出；B 需要额外目录名映射。

4. **F1 内置包夹具**
   - 方案 A（推荐）：夹具加 `agent-reach`（真实内置包命中），`FIXTURE.total=6`；断言从夹具现算。
   - 方案 B：只 mock `layers`，不加真实技能；快但少了真实 `resolveLocalization` 链路。
   - 代价：A 要改现有 5 条断言；B 夹具更假。

5. **C1 与 0.4.0 发布**
   - 方案 A（推荐）：代码 0.4.0 先发；C1 未完成则内容 0.4.1，release note 写清缺口。
   - 方案 B：等 C1 完成再发 0.4.0；发布晚 1–2 天，但覆盖数字一次到位。
   - 代价：A 发布说明要诚实写缺口；B 代码已好但被内容卡住。

## 9. Plan 评审清单

- [ ] 第 4 节顺序与并行关系可接受；P0 先于所有 PR。
- [ ] D1 用 `makeRoutes` + fake `req/res`，A/B 与 C/D 拆文件，可接受。
- [ ] F2 的 Job failures 字段、脱敏、50 条截断、重试 selected 可接受。
- [ ] F3 的 per-layer `status`、`active`、`reviewedBy` 写入规则、`/list.health` 可接受。
- [ ] F1 四桶口径与旧宿主降级可接受。
- [ ] 文件地图没有漏掉 `normalize` 白名单、契约、locale、测试入口。
- [ ] 第 8 节五个取舍的推荐方案可接受，或指定替代。
- [ ] 同意后才进入 Tasks；Plan 阶段不写实施代码。

评审通过后的下一步：把每个工作包拆成可在单次会话完成、带验收与验证命令的 Tasks；先做 P0，再做 F1/D1，随后 F2/F3，C1 内容并行。
