# Tasks: 0.4.0 可信覆盖

状态：`Tasks / Draft v0.1`

Spec：[docs/SPEC-0.4.0.md](SPEC-0.4.0.md)（Specify / Approved v1.0）

Plan：[docs/PLAN-0.4.0.md](PLAN-0.4.0.md)（Plan / Approved v1.0，第 8 节按 A/A/A/A/A）

日期：2026-11-21

范围：只拆任务，不写代码。本文评审通过后进入 Implement；每个任务单独会话完成，完成后勾选。

## 执行原则

- 按依赖顺序做，不按“看起来重要”跳做；同一文件的任务串行，避免并行写冲突。
- 代码/测试任务先让至少一条断言在当前代码上失败，再改到绿；不删断言、不跳过、不为绿改测试语义。纯文档任务以读回核对代替红绿。
- 每个任务只动“文件”列出的文件；超出时先回 Plan/Spec 更新，不顺手扩范围。
- 任务完成判据是“验收 + 验证”都过，不是“代码写完”。
- P0/T00 必须最先合并；否则 `audit:zh:ci` 红，后续 PR 没有可用门禁基线。
- 不新增运行时依赖/构建步骤；不改 `SKILL.md`、英文 `name`、安装/启停/执行。
- 新增 `/list` 字段必须同时进 `normalizeSkillView`/`normalizeIndex` 白名单与页面断言；新增 UI 文案进 `locale/zh.json`/`locale/en.json`。

## 依赖与并行

```text
T00（P0）
  └─ T01（F1）
       └─ T02（D1 harness）
            ├─ T03（D1-A 保存）
            │    └─ T04（D1-B 审核）
            ├─ T05（D1-C 脏检查）
            │    └─ T06（D1-D hash）
            └─ T07（D1 文档）────── T08（F2 宿主）
                                       └─ T09（F2 启动/工具栏）
                                            └─ T10（F2 进度/失败/重试）
                                                 ├─ T11（F3 scan）
                                                 │    └─ T12（F3 store/routes）
                                                 │         └─ T13（F3 client 数据）
                                                 │              └─ T14（F3 UI）
                                                 └─ T15（C1 内容，可与 T11–T14 并行）
                                                      └─ T16（文档/release note）
                                                           └─ T17（全量门禁）
```

- 单人执行按“同一文件串行”排：T02 依赖 T01（两者都改 `test/fixture.mjs` 与页面回归）；Plan 允许 F1/D1 并行，但需要先拆 fixture/page-test 所有权，当前 Tasks 采用安全串行顺序。
- T03/T04 与 T05/T06 可并行（写路径测试 vs 页面回归测试，文件不重叠）；T03 改 `test/fixture.mjs`，合并时先 T03/T04。
- T15 在 T10 后可启动；内容准备与 F3 实现并行，发布顺序按 Spec：代码先、内容可 0.4.1。
- T08 必须在 T07 之后；T11 必须在 T10 之后；T16 必须在 T14/T15 之后。

## 任务清单

### T00 修 8 条 audit P1

- [ ] T00：给内置包 8 条 P1 补拼音，恢复 CI 基线
  - 依赖：无
  - 验收：
    - `ab-test-analysis`、`analyze-feature-requests`、`andrej-karpathy-skill`、`ansoff-matrix`、`api-and-interface-design`、`archify`、`banner-design`、`beachhead-segment` 都有合法 `pinyin`/`pinyinInitials`，或按审计规则可判为通过。
    - 只补拼音字段；中文名、summary、category、路由关键词、英文 name 不变；不重新生成整条 entry。
    - `npm run audit:zh:ci` 的 P1 从 8 到 0；13 条 P2 原样保留并记录。
    - 单独一个提交/PR，不夹带功能改动。
  - 验证：
    ```bash
    npm run audit:zh:selftest
    npm run audit:zh:ci
    node translations/validate.mjs
    git diff -- translations/zh-CN.builtin.json
    ```
  - 文件：`translations/zh-CN.builtin.json`

### T01 F1 内置包缺口发现

- [ ] T01：覆盖率卡四桶 + 现有筛选入口 + 旧宿主降级
  - 依赖：T00
  - 验收：
    - `computeGapBuckets(skills)` 返回 `{builtin, local, none, unknown, stale, draft, total}`；`builtin+local+none+unknown === skills.length`；`stale`/`draft` 独立，不进四桶。
    - `builtin` 有中文且 layers 含 `source==='builtin'`；`local` 有中文、不含 builtin、含 user/project；`none` 无中文；`unknown` 有中文但 layers 缺失/为空。
    - 正常宿主显示「内置包 W · 仅自己补 S · 没中文 N」；`unknown>0` 才追加「来源未知 U」。
    - 「查看没中文」调用现有 `setFilter('untranslated')`；「查看过期」调用 `setFilter('stale')`；不新增 filter 值。
    - 旧宿主无 layers：只显示来源未知/没中文/过期 + 升级说明，不崩；`total=0` 显示「还没有扫描到技能」；全部内置显示「全部由内置包覆盖」。
    - 数字有 `aria-label`；按钮是 `<button type="button">`；窄屏换行不横向滚动；文案全进 locale，颜色走现有 `--skw-*`。
    - `test/fixture.mjs` 增加真实 `agent-reach`（命中内置包），`FIXTURE.total=6`；预期 `builtin=1`、`local=3`（3 个 lark 用户层）、`none=2`（plain-notes 与 project-only 都无用户层中文）、`unknown=0`；现有 5 条夹具断言改为从夹具现算。
    - 页面测试补：正常四桶、旧宿主无 layers、`total=0`、四桶和等于总数、按钮切到正确筛选。
  - 验证：
    ```bash
    node --check client.js
    node client.selftest.mjs
    npm run test:page
    ```
  - 文件：`client.js`、`locale/zh.json`、`locale/en.json`、`test/fixture.mjs`、`test/page-regression-test.mjs`

### T02 D1 测试桥骨架

- [ ] T02：`host-harness` + fixture 返回 `projectRoot` + `test:page` 双脚本
  - 依赖：T01（共享 `test/fixture.mjs` 与页面回归；单人执行先 F1 后 D1）
  - 验收：
    - 新增 `test/host-harness.mjs`：直接调用真实 `makeRoutes`，用 fake `req/res` 发 loopback 请求；至少能 `GET /list` 并解析 JSON；不 mock `scanSkills`、不复制 handler。
    - fake `req` 是 `EventEmitter`，带 `method/url/headers/socket.remoteAddress`，body 用 `setImmediate` 发 `data/end`；fake `res` 支持 `writeHead/end/headersSent/destroy`。
    - `test/fixture.mjs` 的 `createFixture()` 返回 `projectRoot`，现有字段不变。
    - 新增 `test/write-path-test.mjs`；`package.json` 的 `test:page` 改成依次跑页面回归与写路径测试。
    - 先确认新测试入口在未接 harness 时是红的（`/save` 仍走 `{}` 或没有路由），接上 harness 后转绿；A/B 若当前实现已满足，保留为防回归，不为了红而改产品行为。
  - 验证：
    ```bash
    npm run test:page
    node test/write-path-test.mjs
    ```
  - 文件：`test/host-harness.mjs`（新增）、`test/write-path-test.mjs`（新增）、`test/fixture.mjs`、`package.json`

### T03 D1-A 保存写入链路

- [ ] T03：保存只改显式字段 + bound/hash/updatedAt + 空内容拒绝
  - 依赖：T02
  - 验收：
    - 通过 harness `POST /save` 只提交 `zh.summary` 一个字段；读回 `index.json`/`GET /list` 后，其他 `zh` 字段保持不变。
    - entry 有 `bound`/`hash`/`updatedAt`；`/list` 的 `layers` 与 `install` 没被 normalize 丢掉（保存前后对比）。
    - 空内容 `POST /save` 返回 `ERR_EMPTY_ZH`（400），且不写盘。
    - 夹具给一个技能写 `.skill-lock.json`，覆盖 `install` 透传。
  - 验证：
    ```bash
    npm run test:page
    ```
  - 文件：`test/write-path-test.mjs`、`test/fixture.mjs`

### T04 D1-B 审核只落 review

- [ ] T04：review-only 不丢内容；内置草稿完整表单不静默改变内容
  - 依赖：T03
  - 验收：
    - 用 `lark-im` 的 draft 条目，记录 `index.json` 的 `zh`。
    - `POST /save {name:'lark-im', zh:{}, review:'reviewed'}` 返回 200；`review==='reviewed'`；`zh` 与之前 deep equal；origin 不被改成 manual；`bound/hash` 未被无意义重写（`updatedAt` 可变）。
    - 内置草稿走完整表单提交时，最终内容与表单一致，不静默改变；这是“允许完整表单、但不改写内容”的路径。
    - 若测试暴露生产 P1，单独提交修复并写 `docs/03-known-issues.md`；不改测试语义。
  - 验证：
    ```bash
    npm run test:page
    ```
  - 文件：`test/write-path-test.mjs`

### T05 D1-C 脏检查

- [ ] T05：返回/切分区/关窗的脏检查真实触发
  - 依赖：T02；可与 T03/T04 并行
  - 验收：
    - 给 sandbox `window` 加 `confirm`（可切换 true/false）、`addEventListener/removeEventListener`、`history`（`pushState/replaceState` 更新 `location.hash`）；不改测试断言绕过。
    - 详情改字段后点返回/切分区：`confirm=false` 仍留在详情，表单内容不丢；`confirm=true` 离开，草稿救援仍可恢复。
    - 捕获 `beforeunload` handler：dirty 时调用 `preventDefault`；干净时不拦。
    - 断言 `sessionStorage['skw:draft:<name>']` 在脏时存在，离开后按现有规则处理。
  - 验证：
    ```bash
    npm run test:page
    ```
  - 文件：`test/page-regression-test.mjs`

### T06 D1-D URL hash 前进后退

- [ ] T06：filter/detail 的 hash 前进后退与非法值
  - 依赖：T05
  - 验收：
    - `location.hash='#library?filter=untranslated'` 触发 `popstate`，列表筛选为未翻译。
    - 后退到 `#library`，筛选回到 `all`。
    - `#library?filter=not-a-filter` 退回 `all`，没有按钮呈按下态。
    - 详情 `#skill/<name>` 前进/后退能打开/关闭详情；脏表单后退先 `confirm`。
  - 验证：
    ```bash
    npm run test:page
    ```
  - 文件：`test/page-regression-test.mjs`

### T07 D1 文档收口

- [ ] T07：把写路径测试缺口从 known-issues 移除并补验证命令
  - 依赖：T06
  - 验收：
    - `docs/03-known-issues.md` 不再把「保存写入链路/脏检查/审核提交/hash 前进后退」列为未覆盖；写明由 `npm run test:page` 覆盖。
    - `docs/VERIFY.md` 增加页面回归 + 写路径测试的命令与预期。
    - 不写“全部测试已覆盖”这类超出事实的表述；残余项照实保留。
  - 验证：
    ```bash
    git diff -- docs/03-known-issues.md docs/VERIFY.md
    ```
  - 文件：`docs/03-known-issues.md`、`docs/VERIFY.md`

### T08 F2 宿主失败明细

- [ ] T08：Job 增加 `failures`/`failuresTruncated`，失败原因脱敏
  - 依赖：T07
  - 验收：
    - `publicJob` 增加 `failures:[{name,code,message}]` 最多 50 条，`failuresTruncated` 为 `job.failed > failures.length`。
    - `runJob` 记录失败技能名；`code` 取错误码；`message` 按固定映射（`ERR_NO_LLM→模型不可用`、`ERR_SAVE→写入失败`、解析/输出不合规→`返回格式不符合要求`、超时→`超时`、其他→`翻译失败`）。
    - 底层 message 含绝对路径时替换为 `<路径>` 再截断 160 字符；不保存 target/prompt/模型输出。
    - `job.failed` 继续累加；部分失败 `state='done'` + `failed>0` + failures；全部失败 `state='failed'`；取消时未开始的目标不计入 failures。
    - 不改 `MAX_RUNNING_JOBS=2`、`CONCURRENCY=2`、`MAX_OUTPUT_CHARS=20000`；不新增路由。
    - `host/selftest.mjs` 覆盖：2 个目标 1 失败、51 个失败截断、路径脱敏、部分/全部失败、取消。
    - `docs/API-CONTRACT.md` 的 Job 示例与 `/status` 同步。
  - 验证：
    ```bash
    node host/selftest.mjs
    npm run selftest
    ```
  - 文件：`host/translate.js`、`host/selftest.mjs`、`docs/API-CONTRACT.md`

### T09 F2 批量入口与启动

- [ ] T09：工具栏范围选择 + 5 秒二次确认 + 启动/429
  - 依赖：T08
  - 验收：
    - `Page` 新增 `batchScope`（`untranslated|stale`）、`batchArmedUntil`、`batchJobId`、`batchError`、`batchNotice`；`runningJobId` 保留给单条重译；批量轮询按 `batchJobId` 查 job，不随便取第一个 running。
    - `LibraryTab` 工具栏加范围 `<select aria-label="批量翻译范围">`（未翻译 N / 过期 N）和「批量翻译（N）」；`N=0` 或已有 running job 时禁用。
    - 点击先 armed，显示「确认翻译/取消」；5 秒复位；确认文案含数量、AI 结果标草稿、不覆盖手动内容、失败可重试/取消。
    - 启动 `POST /translate {scope: batchScope}`，不传 `names`；429 `ERR_BUSY` 面板内 `role=alert`；404/405 提示升级插件；不进入假进度。
    - 成功后记 `batchJobId`；切分区/卸载时清理 timer。
    - 页面测试 mock `/translate` 记录 body，断言 scope 正确、无 names；429、旧宿主无接口、5 秒复位。
  - 验证：
    ```bash
    node --check client.js
    node client.selftest.mjs
    npm run test:page
    ```
  - 文件：`client.js`、`locale/zh.json`、`locale/en.json`、`test/page-regression-test.mjs`

### T10 F2 进度、失败、重试、取消

- [ ] T10：批量进度面板与失败重试
  - 依赖：T09
  - 验收：
    - running：`翻译中 3/10 · 失败 1 · 正在处理：<name>`；`role=progressbar` + `aria-valuemin/max/now`；「取消」按钮。
    - done：`完成 9 个，失败 1 个`；失败列表最多 20 条，每条 `技能名 — 短原因`；技能名 `<a data-skw-row href="#skill/<name>">`；「重试失败项（N）」在列表外。
    - failed：`任务失败：<总原因>`；有部分完成时仍显示失败列表与重试。
    - cancelled：`已取消：完成 X，失败 Y`；不自动重试。
    - 旧宿主无 `failures`：显示 `失败 N 个（当前宿主不提供明细）`，不假装知道名字。
    - 重试有名字时 `POST /translate {scope:'selected', names:[...]}`；无名字时按当前 scope 重跑并提示可能重复成功项。
    - done/failed/cancelled 后刷新 `/list` + `/status`；运行中不整表 loading，不覆盖正在编辑的表单；错误就近 `role=alert`。
    - 页面测试：running 1/2→2/2→done；done 1/2+failures；重试 body；429；旧宿主；取消；`aria-valuenow` 变化。
  - 验证：
    ```bash
    node --check client.js
    node client.selftest.mjs
    npm run test:page
    ```
  - 文件：`client.js`、`locale/zh.json`、`locale/en.json`、`test/page-regression-test.mjs`

### T11 F3 scan 层状态与健康

- [ ] T11：per-layer status/active/health/遮蔽
  - 依赖：T10
  - 验收：
    - `scanSkills` 保留 `candidateMap`，新增 `allCandidates` 与 `shadowed`；`insertCandidate` 记录 loser，按 name 合并，同名不再静默丢弃。
    - `buildSkillViews` 按 `layer.entry.bound.path` 优先找候选，找不到→`unverifiable`；`layerStatus` 用该层自己的 frontmatter/body hash 判 `fresh|stale|unverifiable`；`active` 只在第一层 true。
    - `reviewedBy`：entry 合法值直接用；builtin 层默认 `builtin`；reviewed 无字段→`unknown`；draft→`null`。
    - `health.orphanEntries` 覆盖 user/project 有中文但无 SKILL.md 的条目；`health.shadowedSkills` 含 winner/losers；`scanSkills` 返回 `health`，不塞进每个 skill。
    - 整技能 `computeSkillStatus` 不变；内置层 `unverifiable` 但整技能仍可 `fresh`。
    - `host/selftest.mjs` 覆盖内置 unverifiable、用户层 stale、孤儿、同名遮蔽、旧索引不崩。
  - 验证：
    ```bash
    node host/selftest.mjs
    npm run selftest
    ```
  - 文件：`host/scan.js`、`host/selftest.mjs`

### T12 F3 store/routes 写入与透传

- [ ] T12：`reviewedBy` 持久化与 `/list.health`
  - 依赖：T11
  - 验收：
    - `normalizeEntry` 保留 `reviewedBy`，合法值白名单 `human|assistant|import|builtin|unknown`；非法/缺失为 `null`。
    - 读取默认只在 `buildSkillViews` 计算：builtin→`builtin`；旧 reviewed 无字段→`unknown`；draft→`null`；不写盘、不迁移。
    - `save` 最终 `review==='reviewed'` → `reviewedBy='human'`；`draft` → `null`；客户端传 `reviewedBy` 忽略。
    - `import` 的 reviewed 条目 → `reviewedBy='import'`；保留已有条目保持原值。
    - `/list` 返回 `health`；`/status` 不变；`docs/API-CONTRACT.md` 同步字段与写入规则。
    - `host/selftest.mjs` 覆盖五种 reviewedBy、save/import、旧索引。
  - 验证：
    ```bash
    node host/selftest.mjs
    npm run selftest
    ```
  - 文件：`host/store.js`、`host/routes.js`、`host/selftest.mjs`、`docs/API-CONTRACT.md`

### T13 F3 客户端数据透传与夹具

- [ ] T13：normalize 保留层字段/health，夹具补 ghost/shadow/stale
  - 依赖：T12
  - 验收：
    - `normalizeSkillView.layers[]` 保留 `source/origin/review/reviewedBy/updatedAt/status/active`；缺 `status`→`unverifiable`，缺 `reviewedBy`→`null`，缺 `active`→第一项 true；非法值收敛。
    - `normalizeIndex` 保留 `health`，缺省 `{orphanEntries:[],shadowedSkills:[]}`；旧宿主无 health 不崩。
    - 夹具加 `ghost-skill`（用户层孤儿）、project/user 同名遮蔽、用户层 stale；断言 `/list` 数据正确，列表仍只出现一次。
    - 页面测试断言 layers.status/reviewedBy 与 health 没被 normalize 丢掉；旧载荷缺字段不崩。
  - 验证：
    ```bash
    node --check client.js
    node client.selftest.mjs
    npm run test:page
    ```
  - 文件：`client.js`、`test/fixture.mjs`、`test/page-regression-test.mjs`

### T14 F3 体检面板与详情层信息

- [ ] T14：覆盖率卡体检 `<details>` + `layerText`
  - 依赖：T13
  - 验收：
    - 覆盖率卡新增「技能体检」`<details>`：`X 项可关注`/`未见异常`；无法校验 A、已过期 B、被遮蔽层 C、孤儿 D、同名遮蔽 E、人工 F、来源未知 G、导入 H、内置 I、草稿 J；各最多 5 条，其余「还有 N 条」；技能名 `<a data-skw-row>`，孤儿纯文本，不嵌套按钮。
    - 人工/来源未知总显示；0 可省略；窄屏不横向滚动；不新增主题变量（若新增按 C-04 三处同步）。
    - 详情 `layerText` 显示每层 `source + origin + status + reviewedBy`，仍只显示合并后的中文内容，不是编辑入口。
    - 旧宿主无 `health`/`layers[].status` 时隐藏体检 `<details>`，详情退回现有文案 + 「当前宿主不提供技能体检」。
    - 页面测试覆盖体检计数、5 条截断、详情层文案、旧宿主降级；原 layers/覆盖卡/详情断言保留。
  - 验证：
    ```bash
    node --check client.js
    node client.selftest.mjs
    npm run test:page
    ```
  - 文件：`client.js`、`locale/zh.json`、`locale/en.json`、`test/page-regression-test.mjs`

### T15 C1 45 条内置包内容

- [ ] T15：补齐 45 条，53→98，P1 0
  - 依赖：T10；可与 T11–T14 并行
  - 验收：
    - 用 F2 批量管线/UI 生成候选；不把用户层条目直接当内置包；P0 的 8 条中文名/路由不变。
    - 新增 45 个 entries，内置包 53→98；无重复、无缺 name；48 个磁盘技能全命中（`磁盘有、包里没有=0`）。
    - 至少人工抽审 10 条，覆盖 manual/llm/import 来源；重点查失真、丢路由/触发细节；抽审记录放 PR 描述或 `research/` 笔记。
    - 写入条目 `origin:'builtin'`、`review:'reviewed'`；不写 `reviewedBy`（读取默认 builtin）；不删除现有 53 条；不把 8 个 DSH bundled 条目塞进内置包。
    - `npm run audit:zh:ci` P1 0；P2 记录；C1 未完成时 release note 写「45 条顺延 0.4.1」及当前缺口数，不把 N 说成 0。
  - 验证：
    ```bash
    node translations/validate.mjs
    npm run audit:zh:selftest
    npm run audit:zh:ci
    ```
  - 文件：`translations/zh-CN.builtin.json`

### T16 文档与 release note

- [ ] T16：README/known-issues/CHANGELOG 对齐 0.4.0 实际状态
  - 依赖：T14、T15
  - 验收：
    - `README.md` 的已知限制第 2 条「翻译一次只处理一个技能」按实际状态更新；不做批量功能没做到就写成已做。
    - `docs/03-known-issues.md` 记录残余风险（F3 被遮蔽层降级、C1 未完成时的缺口、13 条 P2 的处理）。
    - `CHANGELOG.md` 增加 0.4.0 条目：可信覆盖、F1/F2/F3/D1/P0、C1 状态。
    - 不新增文档；不把 45 条未完成说成已覆盖。
  - 验证：
    ```bash
    git diff -- README.md docs/03-known-issues.md CHANGELOG.md
    grep -n "批量\|45\|可信覆盖" README.md docs/03-known-issues.md CHANGELOG.md
    ```
  - 文件：`README.md`、`docs/03-known-issues.md`、`CHANGELOG.md`

### T17 全量门禁与发布前验收

- [ ] T17：跑完整门禁，记录结果
  - 依赖：T16
  - 验收：
    - 门禁全绿：`node --check client.js`、`npm run selftest`、`npm run test:page`、`npm run check:contrast`、`npm run audit:zh:selftest`、`npm run audit:zh:ci`。
    - `audit:zh:ci` P1 0；内置包条数与磁盘命中符合 T15 结果；C1 未完成时记录顺延。
    - 有真实宿主时手动跑 `node test/render-page-test.mjs` 与 `node test/run-live.mjs`；没有则记录未跑原因，不写成已通过。
    - 把结果写进 `docs/VERIFY.md`；发布说明由 T16 负责。
  - 验证：
    ```bash
    node --check client.js
    npm run selftest
    npm run test:page
    npm run check:contrast
    npm run audit:zh:selftest
    npm run audit:zh:ci
    ```
  - 文件：`docs/VERIFY.md`

## 任务完成定义

- 所有任务勾选；T17 门禁全绿；P1 0。
- F1/F2/F3 的 `/list` 新字段都进客户端白名单并有页面断言，没有“整块 UI 变死代码”。
- D1 的 A/B/C/D 四类断言都在 `npm run test:page` 中真实经过宿主/页面，不靠 `{}` mock。
- F2 的失败明细不泄露路径/prompt/模型输出；最多 50 条、`failed` 计数不缩水。
- F3 的整技能 `status` 语义未改；旧索引/旧宿主有降级用例。
- C1 要么 98 条、P1 0、抽审可查；要么 release note 明确写顺延与缺口。
- 没有改 `SKILL.md`、英文 `name`、安装/启停/执行；没有新增运行时依赖/构建步骤。

## 评审清单

- [ ] 任务粒度可在一个会话完成，单个任务 ≤5 个文件。
- [ ] 依赖顺序与 Plan §4 一致；T01→T02 串行、T03/T04 与 T05/T06 并行、T15 与 F3 并行的安排可接受。
- [ ] 每个任务的验收可测，验证命令能直接跑。
- [ ] D1 的 A/B/C/D 四类都覆盖，且没有“为绿改测试语义”。
- [ ] F2 的宿主/客户端拆分、失败明细与重试范围可接受。
- [ ] F3 的 per-layer 状态、reviewedBy 写入规则、health 降级可接受。
- [ ] C1 的发布形态（代码先、内容可 0.4.1）可接受。
- [ ] 同意后才进入 Implement；Tasks 阶段不写实施代码。

评审通过后的下一步：按 T00 开始实现；每个任务单独分支/提交，完成后勾选并报告验证命令输出。
