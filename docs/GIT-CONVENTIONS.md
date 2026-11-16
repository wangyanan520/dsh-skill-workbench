# Git 提交规范

适用范围：本仓库 `dsh-skill-workbench` 的所有提交、分支、PR、发布动作。
最后核对：2026-11-16

本规范不是通用模板，而是从本仓库现有 24 次提交里归纳出来的既有风格，加上两轮对抗式审查踩过的坑固化成的硬规则。

---

## 1. 一句话原则

**提交信息是给「三个月后的自己」和「release note」看的，不是给 `git log` 凑数的。**
一条提交必须能回答三个问题：改了什么、为什么改、怎么验证的。

---

## 2. 提交信息格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 2.1 标题行（subject）

| 规则 | 级别 | 说明 |
|---|---|---|
| 必须以合法 `type` 开头 | 必须 | 见 2.2 |
| `scope` 可选，但同仓库内必须来自固定表 | 应该 | 见 2.3，禁止自创同义词 |
| `type(scope)` 后必须是英文冒号 + **一个空格** | 必须 | `fix(ui): 修正对比度`，不是 `fix(ui):修正` |
| 中文描述，动词开头，不加句号 | 必须 | 「修正亮色主题下错误横幅不可读」 |
| 标题显示宽度 ≤ 72（ASCII 计 1 列、汉字/全角标点计 2 列，约 36 个汉字） | 必须 | 由 commitlint 的 `header-display-width` 校验；超了就砍细节，细节放 body |
| 不加 emoji、不加 `[WIP]`、不写 `update`/`changes`/`修改一下` 这类空词 | 禁止 | 空词等于没写 |

### 2.2 type 表

| type | 用途 | 进 CHANGELOG | 会发版 |
|---|---|---|---|
| `feat` | 新增用户可见能力 | 是 | minor |
| `fix` | 修复缺陷（含回归、安全、数据丢失） | 是 | patch |
| `perf` | 性能优化，行为不变 | 是 | patch |
| `refactor` | 重构，行为不变 | 否 | — |
| `docs` | 只改文档、注释、README | 否 | — |
| `test` | 只改测试与夹具 | 否 | — |
| `build` | 打包产物、依赖、`package.json`、`files` 字段 | 视情况 | — |
| `ci` | `.github/workflows` 等 CI 配置 | 否 | — |
| `chore` | 杂项：市场索引刷新、发版准备、脚手架 | 视情况 | — |
| `style` | 纯格式（缩进/引号），不含逻辑 | 否 | — |
| `revert` | 回滚提交，body 必须写 `This reverts commit <sha>.` | 是 | 视被回滚项 |

> 判断口径：**用户能感知到差别吗？** 能 → `feat`/`fix`；不能 → `refactor`/`docs`/`test`/`chore`。

### 2.3 scope 表（本仓库唯一合法取值）

| scope | 覆盖范围 |
|---|---|
| `client` | `client.js`（含内联样式、i18n 表、菜单装饰器、管理页） |
| `host` | `host/`（路由、扫描、存储、翻译、卸载） |
| `ui` | 界面/交互/样式，但只改 `client.js` 的呈现层时也可用 `client` |
| `i18n` | `locale/`、`translations/`、中文包内容 |
| `tooling` | `scripts/`（审计、对比度、市场索引构建） |
| `test` | `test/`、`*.selftest.mjs` |
| `docs` | `docs/`、`README*`、`AGENTS.md` |
| `market` | `market/` 市场索引数据 |
| `release` | 版本号、tag 准备、发布说明 |
| `deps` | 依赖升级 |

跨两个层的改动用 `+` 连接（已有先例）：`fix(ui+host): ...`。
**不要写** `fix(client.js)`、`fix(skill-workbench)`、`feat(all)` 这类非表内取值。

### 2.4 body（正文）

按需出现，但以下情况**必须**写：

- 修复非显而易见的 bug（含根因）；
- 改动涉及数据写入、删除、路径、URL、权限；
- 一次性改了 5 个以上文件；
- 有用户需要知道的取舍或降级行为。

写法：

- 每行 ≤ 76 个字符（中文按宽度折算），段间空行；
- 用 `-` 列表逐条列改动面，按「客户端 / 宿主 / 文档」分段；
- 必须包含**验证方式**一行，写清跑了哪些命令。

### 2.5 footer

```
BREAKING CHANGE: <破坏了什么，用户需要怎么做>
Closes #12
Refs #7, #9
```

`BREAKING CHANGE:` 触发条件（任一满足）：改了 HTTP 路由/参数、改了锁文件或索引结构、改了 `package.json` 的 `dsh` 字段、用户数据需要迁移。

### 2.6 正反例（都取自本仓库真实历史）

```
✅ fix(ui+host): land round-2 adversarial review fixes
✅ feat(tooling): add Chinese-layer audit, contrast check and offline page regression
✅ fix(i18n): correct agent-reach platform count in built-in pack
✅ docs: record the Chinese-layer cleanup, audit rules and remaining gaps

❌ fix bug                    ← 无对象、无根因
❌ update client.js           ← 文件清单当描述
❌ 修复了一些问题，优化了体验   ← 评审无法据此判断风险
❌ feat(ui): 新增功能。        ← 句号多余，且没说是什么功能
```

---

## 3. 提交粒度

1. **一次提交只做一件事。** 修 bug 时顺手发现的重构，单独提 `refactor`；改行为 + 改格式拆两次（先 `style` 再 `fix`，或反之，保证任一次都能单独通过测试）。
2. **每个提交必须自洽可跑。** 提交前至少：
   ```bash
   node --check client.js
   node client.selftest.mjs
   SKIP_REAL_AGENTS_SCAN=1 node host/selftest.mjs
   ```
   CI 会对 `main` 的每个 push 和每个 PR 跑 `client.selftest` + `host.selftest`，本地不过就是 CI 红。
3. **`client.js` 是单文件大 bundle**，改动天然跨「菜单装饰 / 管理页 / i18n」多个分区。这种情况允许一个提交，但 body 必须按分区列出改动点，方便评审定位。
4. **禁止把不相关的东西混进同一个提交。** 尤其是：调试脚本、临时日志、本机路径、`.workbuddy/`、`node_modules`。
5. **已推送的历史不改写。** 不用 `git commit --amend` 修已 push 的提交，不用 `git push --force` 到 `main`；改错了就 `git revert` 再补一条。

---

## 4. 分支

| 项 | 约定 |
|---|---|
| 主干 | `main`，始终可发布（对应 `v0.3.x` 系列 tag） |
| 特性分支 | `feat/<英文小写连字符 slug>`，≤ 4 个词 |
| 修复分支 | `fix/<slug>` |
| 文档/工具 | `docs/<slug>`、`chore/<slug>` |
| 生命周期 | ≤ 5 个工作日；超过就 `git rebase main` 后继续，避免长期分叉 |
| 命名示例 | `feat/draft-rescue`、`fix/theme-surface-vars`、`chore/release-0.3.4` |

`slug` 用英文，不要用中文分支名（多数 CI/工具对非 ASCII 分支名支持不一致）。

---

## 5. PR 与合并

### 5.1 PR 标题

**等于最终提交标题**（因为用 squash 合并）。标题不合规 = 主干历史不合规。

### 5.2 PR 描述模板（四个问题，缺一不可）

```markdown
## 改了什么
- （列表，对应 body）

## 为什么
- 触发场景 / 用户影响 / 根因

## 怎么验证
- [ ] node --check client.js
- [ ] node client.selftest.mjs
- [ ] SKIP_REAL_AGENTS_SCAN=1 node host/selftest.mjs
- [ ] npm run audit:zh
- [ ] npm run check:contrast
- [ ] npm run test:page
- [ ] 手工步骤：（写清点击路径）

## 风险与回滚
- 影响面 / 降级行为 / 回滚方式（revert 即可？需要数据修复？）
```

### 5.3 合并方式

- 用 **squash merge**，保持 `main` 线性历史，一个 PR 一条提交；
- 不保留「PR 内十几个 wip 提交」；
- 合并后立即删分支。

### 5.4 必须双人复核的改动（红线）

即使团队只有 1～2 人，此类改动也要求「作者自查清单 + 至少一名他人过一遍」：

1. `host/uninstall.js`（**会删/移用户文件**）；
2. `host/store.js`、`host/routes.js` 里的写盘与校验逻辑；
3. 任何 `path.join` / `path.resolve` / `realpath` 相关改动（路径穿越面）；
4. 任何把外部数据放进 `href` / `innerHTML` / 文件名的改动（注入面）；
5. 新增运行时依赖、改 `package.json` 的 `dsh`/`files` 字段。

---

## 6. 版本与发布

- 遵循语义化版本；`0.x` 阶段**破坏性变更走 minor**（`0.3.x` → `0.4.0`），并在 `BREAKING CHANGE:` 里写明迁移方式。
- tag 用带注释标签：`git tag -a v0.3.4 -m "0.3.4"`，与 `CHANGELOG.md` 同一次提交完成。
- 发版提交类型固定为 `chore(release): 0.3.4`（或 `chore: release 0.3.4`，沿用现有历史）。
- `CHANGELOG.md` 按版本 + `### 修复 / ### 新增 / ### 变更` 分组，**每条写用户可感知的差别，不写「优化代码」**。

---

## 7. 绝对不入库

| 内容 | 原因 |
|---|---|
| `node_modules/` | 已有 `.gitignore` |
| `.workbuddy/` | 本机会话记忆，已在 `.gitignore` |
| `.env`、令牌、账号 ID、`~/.agents` 里的真实数据 | 密钥与隐私 |
| 含绝对路径的本机文件（`/Users/xxx/...`） | 文档一律用 `${DSH_HOME}`、`<project>` 占位符（历史提交 `c44b74e` 就是为此） |
| 调试产物（`*.log`、`_diag-*` 输出、截图） | 除测试夹具外不入库 |
| 技能原文 `SKILL.md` 的任何修改 | **硬约束：本插件永不修改 `SKILL.md` 与英文 `name`** |

---

## 8. 落地实现（已就位）

规范不再只靠自律，分三层门禁：

| 层 | 触发时机 | 跑什么 | 耗时 |
|---|---|---|---|
| 编辑器 | 保存时 | `.editorconfig`：缩进 2 空格 / LF / UTF-8 / 末尾换行 | 0 |
| git 钩子 | `git commit` | `.husky/pre-commit`：`node --check client.js` + client selftest + 对比度 + host selftest（SKIP 模式）<br>`.husky/commit-msg`：commitlint 校验提交信息 | ≈1 秒 |
| CI | push `main` / PR | 双 selftest + `check:contrast` + 审计规则自检 + 内置包审计 | ≈10 秒 |

新增命令：

```bash
npm run audit:zh:ci        # CI 用：只审内置中文包，且"一条都没审到"直接失败
npm run audit:zh:selftest  # 校验审计规则自身：专有名词不误报、英文句子必须命中
```

钩子绕过方式（需要在 PR 里说明原因，不要静默绕过）：

- `git commit --no-verify` —— 跳过本次的 pre-commit 与 commit-msg；
- `HUSKY=0 git commit ...` —— 本次完全禁用钩子；
- 钩子检测不到 `node_modules/.bin/commitlint` 时**只警告、不阻断**，保证「新克隆还没 `npm i`」不会卡住提交。

> **唯一真源**：`type` / `scope` 列表定义在 `commitlint.config.mjs`，本文的表格与之同步维护。改一处必须改另一处，否则文档会变成骗人的。

---

## 8.1 两项落地中的冲突与兼顾方案

落地「CI 加审计」与「commitlint + husky」时出现六个真实冲突，处理方式如下。

| # | 冲突 | 现象 | 兼顾方案 | 代价 |
|---|---|---|---|---|
| 1 | CI 跑 `audit:zh` 无数据 | CI 没有 `~/.agents/skills`，待审集合为空 → 打印「审计通过」exit 0，**什么都没查** | 新增 `--builtin-only`（改审随仓库提交的 53 条内置包）+ `--require-data`（0 条即 exit 1） | CI 覆盖不到本机用户层数据，仍需本地跑 |
| 2 | 审计规则误报专有名词 | 内置包 `web-design-guidelines` 摘要「按 **Web Interface Guidelines** 审查界面代码」被「连续 3 个英文词」规则判成英文句子 → 加进 CI 必红 | 规则改为「含全小写实词或英文虚词才算句子」，专有名词（首字母大写）放行；并新增 `--self-test` 8 条用例锁死行为 | 规则变复杂，靠自检用例防退化 |
| 3 | 「零构建 / 不加运行时依赖」 vs 工具链 | 项目硬约束是不引构建步骤，commitlint + husky 是 71 个包 | 只进 `devDependencies`；不进 `files` 白名单，发布包体积不变；不引入任何编译/打包步骤；钩子缺失自动降级 | 新克隆需 `npm i` 才有钩子 |
| 4 | squash merge vs 逐条校验 | PR 分支里的 `wip:` / `fixup!` 提交会被 commit-msg 拦住 | 放行 `fixup!` / `squash!` / `amend!` 与 `Merge` 提交；其余提交仍要求合规（squash 后只留一条，标题即最终信息） | 仍需开发者写像样的中间提交信息 |
| 5 | 中文标题的"长度" | `header-max-length` 按字符数算，36 个汉字与 36 个字母同权，判不出真实宽度 | 自定义 `header-display-width`：CJK/全角按 2 列，上限 72；关闭内置 `header-max-length` | 纯中文标题实际约 36 字，需更凝练 |
| 6 | `fix(ui+host)` 跨层 scope | 内置 `scope-enum` 把 `ui+host` 当整体，报未知 scope | 关闭 `scope-enum`，自定义 `scope-known` 按 `+` 拆分后逐段校验 | scope 白名单要在配置里维护 |

附带结论：现有 20 条历史提交里有 1 条超过 72 列（`feat(tooling): add Chinese-layer audit, contrast check and offline page regression`，84 列）。**不追溯改写历史**，新提交一律按 72 列执行。

---

## 9. 提交前 30 秒自查

- [ ] `type(scope)` 在表内，冒号后有空格，标题 ≤ 50 字符、无句号；
- [ ] 一次提交只做一件事，没有夹带调试代码；
- [ ] 本地 `node --check` + 双 selftest 绿；
- [ ] 改了行为 → 同步 `CHANGELOG.md`；
- [ ] 新增 `docs/` 文件 → 在 `AGENTS.md` 文档索引加一行（项目硬规则）；
- [ ] 没有 `SKILL.md` 改动、没有绝对路径、没有密钥。

---

## 10. 与其它文档的关系

- 编码层面的规则见 [`CODING-STANDARDS.md`](./CODING-STANDARDS.md)。
- 验证命令与发布前检查见 [`VERIFY.md`](./VERIFY.md)。
- UI 硬不变量（脏检查、主题变量、normalize 白名单等）见 `AGENTS.md`「UI 不变量」段与 [`UI-REVIEW-2026-11-ROUND2.md`](./UI-REVIEW-2026-11-ROUND2.md)。
