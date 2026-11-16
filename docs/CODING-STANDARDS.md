# 编码规范

适用范围：`dsh-skill-workbench` 全部源码（`client.js`、`host/`、`scripts/`、`test/`、`translations/`、`locale/`）。
最后核对：2026-11-16

规范分四级：**必须**（违反即评审打回）、**应该**（有理由可偏离，需在 PR 里说明）、**可以**（建议做法）、**禁止**（无例外）。
条款编号（`C-xx`）用于评审时直接引用，例如「这条违反 C-14」。

---

## 0. 先理解这个项目的特殊性

它是一个**零构建**的 DSH 客户端插件：浏览器端代码手写 `window.__ModuleLoader__.load`，直接扔进宿主的 React 18 环境执行，没有 babel、没有打包、没有 tree-shaking。宿主侧是 Node 24 原生 ESM。

这带来三条贯穿全文的后果：

1. **不能用「构建期能解决」的方案**（TS、JSX、别名、按需 polyfill 全都不行）。
2. **浏览器端代码的语法风格必须与 4200 行存量保持一致**，否则每次改动都会产生大面积 diff 噪音。
3. **错误会直接暴露给用户**，没有构建期类型检查兜底，所以运行时校验、默认值、降级路径要自己写扎实。

---

## 1. 运行时与语法基线

### C-01（必须）两个世界，两套语法

| 维度 | `client.js`（浏览器 bundle） | `host/`、`scripts/`、`test/`（Node） |
|---|---|---|
| 模块 | 手写 `__ModuleLoader__.load({ id, factory })` | 原生 ESM：`import` / `export` |
| 变量声明 | `var`（存量 464 处，无 `const`/`let`） | `const` 优先，需要重赋值才用 `let`。**禁止 `var`** |
| 函数 | `function` 声明与表达式 | 同左，可用箭头函数 |
| 箭头函数 | **不用**（存量 0 处） | 可以用（回调、短函数） |
| 模板字符串 | **不用**（存量 0 处，用 `+` 拼接） | 可以用 |
| `async/await` | 可以用（`apiRequest`、`loadIndex` 已在用） | 必须用，禁止裸 `.then` 链 |
| 内置模块 | 无 | 必须加 `node:` 前缀：`node:path`、`node:fs` |
| 严格模式 | 文件级 `'use strict'` | ESM 自带，不写 |

> 为什么 `client.js` 还在用 `var`：不是运行时限制（宿主是 Chromium，`async/await` 都能跑），而是**一致性优先**。在一个 4200 行的单文件里混用 `var`/`const` 只会让 diff 变脏、评审看不清逻辑。
> 换风格的唯一方式：单独立一个 `refactor(client)` 提交把整个文件切过去，并保证 selftest 全绿；不要边改功能边换语法。

### C-02（禁止）新增运行时依赖与构建步骤

`client.js` 只允许 `require('react')`，不 import 任何 `@deepseek-ai/*` 内部包。宿主侧不新增 npm 依赖，除非在 PR 里写明「为什么标准库做不了」。

### C-03（必须）宿主下发字段必须进 `normalizeSkillView` 白名单

这是**已经踩过的 P1**：`layers` / `install` 两个字段被白名单丢掉，导致「清除中文覆盖」按钮、`confirmReview`、「安装来源」链接整块 UI 是生产环境死代码，而测试没抓到。

规则：

1. 宿主 `/list` 新增任何字段 → 客户端 `normalizeSkillView` 必须显式透传（含类型收敛与默认值）；
2. 同一个提交内，必须在 `test/page-regression-test.mjs` 加一条「该字段驱动出的控件真实渲染」断言；
3. 不接受「客户端以后再用」的预留字段——不下发，或下发就透传。

### C-04（必须）新增主题变量必须三处同时改

这个也踩过：`--skw-surface` / `--skw-border` 只在样式里被引用，从未在 `THEME_VARS` 定义，亮色主题下 sticky 操作栏兜底成硬编码深色 `#1b1f24`；而 `check:contrast` 的清单里没有这两个变量，所以审计照样全绿。

新增一个 `--skw-*` 变量，必须同时：

1. `THEME_VARS` 的**亮色**一套里定义；
2. `THEME_VARS` 的**暗色**一套里定义；
3. `scripts/check-contrast.mjs` 的 `CASES` 里加对比度用例（正文 4.5:1 / 大字 3:1 / 边框与焦点环 3:1）。

---

## 2. 格式

### C-05（必须）基础格式（`.editorconfig` 约束，pre-commit 兜底）

- 缩进 **2 个空格**，不用 tab；
- 字符串统一**单引号**（`'use strict'`），只有字符串内含单引号时才用双引号；
- 语句**必须**以分号结尾；
- 编码 UTF-8，换行 LF，文件末尾保留一个换行。

### C-06（应该）行宽 ≤ 110 字符

存量有少量 130～154 的长行（多为路由注册与正则），不强制回改；**新代码不要超过 110**，超了就用换行或先赋值给变量。

### C-07（应该）多行字面量保留尾随逗号

```js
export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  mode: 'decorate',
  pinyinSearch: true,
});
```
好处是以后加行只动一行。`import` 列表同样保留尾随逗号。

### C-08（必须）保留现有分区注释

`client.js` 用 `/* ---- 分区名 ---- */` 分隔「常量 / 工具函数 / 菜单装饰 / 管理页 / 样式表」。新增大块逻辑要放进对应分区，不要堆在文件末尾。

---

## 3. 命名

| 对象 | 规则 | 实例 |
|---|---|---|
| 常量（模块级） | `UPPER_SNAKE_CASE` | `API_BASE`、`INDEX_TTL_MS`、`MAX_RECENT` |
| 变量/函数 | `camelCase`，动词开头 | `loadIndex`、`saveOverride`、`scanSkills` |
| 布尔值 | `is` / `has` / `can` / `should` 前缀 | `isPlainObject`、`hasAnyZh`、`dirty` |
| 私有工具 | 不加 `_` 前缀，靠不导出表达私有 | `function emptyForm(...)` |
| 文件 | `kebab-case.js` | `uninstall.js`、`audit-zh.mjs` |
| 测试文件 | `*.selftest.mjs`（可跑）、`*-test.mjs`（回归/联调） | `client.selftest.mjs` |
| CSS 类 | `skw-` 前缀 + kebab | `skw-detail-zh` |
| data 属性 | `data-skw-*` | `data-skw-row`、`data-skw-detail-title` |
| 主题变量 | `--skw-<语义>`，用语义不用颜色值 | `--skw-danger`，不要 `--skw-red` |
| i18n key | `<域>.<camelCase>` | `detail.draftFound`、`page.discardConfirm` |
| HTTP 路由 | 小写单词，动作用动词 | `list`、`save`、`trash`、`restore`、`purge` |
| JSON 字段 | `camelCase` | `schemaVersion`、`updatedAt` |

**禁止**：拼音缩写命名（`zhName` 可以，`zwmc` 不行）、`data`/`info`/`temp`/`obj` 这类无语义名（作用域只有 3 行时除外）。

---

## 4. 注释

### C-09（必须）注释用中文，解释「为什么」，不解释「是什么」

```js
// ✅ 说明约束与后果
// 后台 30s 刷新会换掉 skill 对象；用户正在编辑时不能拿服务端数据覆盖表单。
if (dirtyRef.current) return;

// ❌ 复述代码
// 如果 dirty 为 true 就返回
```

### C-10（必须）文件头与对外函数要有说明

- 每个源文件顶部一段块注释：**职责 + 约束**（`client.js` 顶部是范例，写明了 A/B/C 三块职责与「只 require react」的约束）；
- `host/` 里对外导出的函数用 JSDoc 块（`host/uninstall.js` 的 `uninstallSkill` 是范例），写清：做什么、边界条件、会写哪些路径、失败时抛出什么。

### C-11（必须）踩过的坑必须留注释

凡是「看起来可以删、但删了就出事」的代码，就近写一句为什么。例子（现存代码）：

- 「confirm 抛错按留在原地处理（fail-closed）」；
- 「晚到的旧响应让位给更新的缓存」；
- 「先写 meta 再 move，失败回滚 meta」；
- 「只渲染 http(s) 链接」。

### C-12（禁止）
- 注释掉的死代码（要留就留在 git 历史里）；
- `TODO` / `FIXME` 不写条件与归属（格式：`TODO(2026-Q1 #12): 条件满足时改法`）；
- 把需求文档、评审结论大段抄进代码。

---

## 5. 错误处理、日志与响应

### C-13（必须）区分「可降级」与「必须失败」

| 场景 | 做法 |
|---|---|
| 菜单装饰器、可选 UI 增强 | `try/catch` 静默降级到原始行为，并 `console.error('[dsh-skill-workbench] ...', err)` |
| 读索引、读锁文件、读缓存 | 失败即用默认值/空集，不抛 |
| 写用户数据、移动/删除文件 | **必须抛出**，由路由层转成明确错误，不允许吞掉 |
| 调模型（translate） | 必须有超时；失败回传可读错误，不阻塞其它路由 |

`catch` 里**禁止**空块（`catch (e) {}`）——唯一例外是「console 本身都可能失败的兜底路径」，且要加注释说明（现存 `client.js` 顶部初始化就有这种写法，属有意为之）。

### C-14（必须）HTTP 层统一响应，不泄漏内部信息

- 成功 `{ ok: true, ... }`，失败 `{ ok: false, code, message }`，用 `ok()` / `fail()` 统一出口；
- 500 响应**禁止**透传原始 `error.message`（会带绝对路径、内部结构）；细节只进宿主日志，响应给一句人能看懂的中文；
- 400 可以给具体原因（如「同名技能已存在」），但同样不带路径。

### C-15（必须）写盘必须原子

所有 JSON 落盘走 `atomicWriteJson()`（临时文件 + rename），不要直接 `writeFileSync` 覆盖。并发写同一文件的场景要显式考虑「后写覆盖前写」是否符合预期。

### C-16（必须）多个文件系统动作必须定事务顺序

卸载是范例：**读锁 → 写 meta → 移动目录 → 清锁**，移动失败要回收 meta。任何「先删后写」「先移后记」的顺序都要问一句：中间失败会留下什么？用户能不能自己收拾干净？

### C-17（必须）用户可见的错误必须可行动

中文、说清下一步。反例：`Error: ENOENT`。正例：「同名技能已存在，请先重命名或卸载」。

---

## 6. 安全红线（本项目最要紧的一节）

### C-18（禁止）永不修改 `SKILL.md` 与技能英文 `name`

中文层的全部数据旁路存储在 `$DSH_HOME/dsh-skill-workbench/`。这是产品的立身之本，也是评审一票否决项。

### C-19（必须）用户数据只写 `$DSH_HOME/dsh-skill-workbench/`

唯一例外：卸载/恢复个人技能时写 `~/.agents/skills` 与 `~/.agents/.skill-lock.json`。项目层中文层写 `<project>/.dsh/skill-cn/zh-index.json`，且合并优先级高于用户层。

### C-20（必须）把一切外部输入当不可信

- 技能名只作 Map 键 / 展示文本，**不要**直接拼进路径再 `join`；
- 真要拼路径：先 `trimString` → 形态校验（正则白名单）→ `path.resolve` → `realpath` 后比对父目录是否为目标目录，**两道校验都要有**；
- 拒绝 `..`、编码斜杠（`%2F`）、空字节（`\0`）、超长名；
- 服务端围栏：只接受 loopback 请求。

### C-21（必须）渲染层只用 React 的安全通道

- **禁止** `dangerouslySetInnerHTML`、`innerHTML`、`insertAdjacentHTML`、`document.write`；
- 外部数据放进 `href` 前必须做 scheme 白名单（只放行 `https?`），否则降级为纯文本——`sourceUrl` 就是这条的由来（React 18 对 `javascript:` 只警告不拦）；
- 列表行用 `<a data-skw-row href="#skill/...">`，**禁止**把 `<button>` 嵌在 `role=button`/`<a>` 行里（可聚焦入口必须唯一）。

### C-22（必须）依赖安装动作要能自证

装/卸/恢复类动作必须能回答：动了哪个路径、失败后用户能看到什么、能不能撤销。回收站条目丢失 meta 时要兜底生成可见条目（现存 `listTrash` 已实现），不允许出现「技能消失但既不能恢复也不能删除」的隐形孤儿。

---

## 7. 状态与副作用纪律（React）

### C-23（必须）请求要有代际守卫

晚到的旧响应不得覆盖新状态。`loadIndex` 的写法是范例：比较缓存时间戳，旧响应直接让位。任何「保存成功后刷新」的链路都要检查这一点，否则表现为「保存没生效」。

### C-24（必须）`useEffect` 依赖必须覆盖所有读取的服务端字段

Form 重置的依赖不能只写 `zh.name`——AI 重译只改 `summary`/`description` 时 effect 不触发，用户会在陈旧基线上盲改。用「内容签名」而非单个字段。

### C-25（必须）脏状态离开路径一律 fail-closed

任何会丢失编辑的离开路径都要过脏检查：详情返回、切分区、关窗（`beforeunload`）、`popstate`（**含未识别的 hash**）。
`window.confirm` 不可用时按「留在原地」处理，不能当作用户同意丢弃。
拦不住的路径（宿主切面板、技能被外部卸载）靠草稿救援兜底：脏表单镜像 `sessionStorage['skw:draft:<name>']`，重开详情时询问恢复/丢弃。

### C-26（必须）写操作互斥

保存 / 审核 / 清除覆盖 / 卸载 / AI 重译，五个动作必须互相排斥：函数级守卫（`if (saving || reviewing) return;`）+ 按钮 `disabled` 双向传播。不允许在途请求交叉。

### C-27（必须）计时器与监听器必须成对清理

`setTimeout` / `setInterval` / `addEventListener`（`hashchange`、`popstate`、`beforeunload`）在 `useEffect` 的 cleanup 里注销。破坏性操作的「二次确认 armed 状态」必须 5 秒自动复位并提供取消，不得留下无超时的 armed 状态。

### C-28（必须）存储访问要容错

`localStorage` / `sessionStorage` 在隐私模式、配额满、被禁用时会抛异常。所有访问走 `safeLocalStorage()` 之类的包装，失败降级为「功能不可用但页面不白屏」。

---

## 8. 测试要求

### C-29（必须）改逻辑必须改测试

- 修 bug：**先**写一条能复现的断言（红灯），再改代码（绿灯），断言留在仓库里当回归文档；
- 新增控件/字段：加「它真的渲染出来了」的断言，而不是只断言「页面没崩」——R1 那个 P1 就是「控件永不渲染但测试全绿」；
- 断言文案用中文描述业务含义（`'脏表单镜像到 sessionStorage（草稿救援）'`），失败时直接当说明书读。

### C-30（必须）不许用「降低断言」换通过

测试红先判断是代码错还是夹具错。夹具依赖本机环境时（`test/page-regression-test.mjs` 由 `host/scan.js` 就地生成），断言只依赖相对值（总数、某类条数），不写死条数；环境缺数据时降级为显式跳过并打日志，不能静默跳过。

### C-31（应该）按影响面选测试层级

| 改了 | 至少跑 |
|---|---|
| `client.js` 任何逻辑 | `node --check client.js` + `node client.selftest.mjs` + `npm run test:page` |
| `host/` | `SKIP_REAL_AGENTS_SCAN=1 node host/selftest.mjs`（本机有完整技能集则跑全量） |
| 样式/主题变量 | `npm run check:contrast` |
| `locale/`、`translations/` | `node translations/validate.mjs` + `npm run audit:zh` |
| `scripts/audit-zh.mjs` 的判定规则 | `npm run audit:zh:selftest`（规则自检）+ `npm run audit:zh`（本机基线不得漂移） |
| 发布前 | `npm run selftest` 全家桶 + `npm run audit:zh:ci` |

CI 跑：双 selftest、`check:contrast`、`audit:zh:selftest`、`audit:zh:ci`（内置包）。用户层数据、`test:page`、`translations/validate` 仍是本机责任——**不要因为「CI 绿了」就认为可以合并**。

### C-35（必须）门禁分层：确定性检查进钩子，外部数据检查进 CI

钩子（`.husky/pre-commit`）只允许跑**结果与机器环境无关**的检查：语法、client selftest、对比度、宿主 selftest（`SKIP_REAL_AGENTS_SCAN=1`）。
依赖本机技能目录或用户层数据的检查（全量 `host/selftest`、`audit:zh` 默认模式、`test:page`）**不得进钩子**——环境漂移会把正常提交挡在门外，团队很快就会习惯 `--no-verify`，门禁随之失效。

同理，任何"待审集合可能为空"的检查都必须能识别空集合并失败（参考 `--require-data`）；**空数据上的绿灯比红灯更有害**。

---

## 9. 文档与变更记录

### C-32（必须）改行为必须记 CHANGELOG

写「用户能感知的差别」，按 `### 修复 / ### 新增 / ### 变更` 分组。禁止「优化代码」「调整逻辑」这类无信息条目。

### C-33（必须）新增 `docs/` 文件必须在 `AGENTS.md` 文档索引加一行

这是项目硬规则，评审会查。

### C-34（应该）文档也解释「为什么」

取舍、残余风险、已知缺陷写进 `docs/03-known-issues.md`，别藏着。评审文档（`UI-REVIEW-*.md`）保留证据：文件行号 + 代码引用 + 复现路径。

---

## 10. 提交前自查清单（可直接贴 PR）

- [ ] 语法基线对：`client.js` 用 `var`/`function`/单引号/分号，`host/` 用 ESM/`const`/`node:` 前缀；
- [ ] 没有新增运行时依赖，没引入构建步骤；
- [ ] 宿主新字段已进 `normalizeSkillView` 白名单 + 有渲染断言；（C-03）
- [ ] 新主题变量已进亮/暗两套 `THEME_VARS` + `check-contrast` CASES；（C-04）
- [ ] 所有路径拼接都有形态校验 + `realpath` 父目录比对；（C-20）
- [ ] 没有任何 `innerHTML` 类调用，外链做过 `https?` 白名单；（C-21）
- [ ] 写盘走原子写，多步文件操作有失败回退；（C-15、C-16）
- [ ] 5xx 响应不含堆栈、绝对路径、内部字段；（C-14）
- [ ] 新增 effect 有 cleanup，新请求有代际守卫，新写操作参与互斥；（C-23～C-27）
- [ ] 测试：断言覆盖到「控件真的渲染 / 副作用真的发生」，失败文案可读；（C-29）
- [ ] `CHANGELOG.md` 已更新，新文档已进 `AGENTS.md` 索引；（C-32、C-33）
- [ ] 提交信息符合规范（钩子已拦；用了 `--no-verify` 就必须自己核一遍）；
- [ ] 新增的检查脚本能区分「空数据」与「合格」，不会给出假绿；（C-35）
- [ ] 未触碰 `SKILL.md`、技能英文 `name`、`node_modules`、`.workbuddy/`。

---

## 11. 相关文档

- [`GIT-CONVENTIONS.md`](./GIT-CONVENTIONS.md)：提交、分支、PR、发版规范。
- [`VERIFY.md`](./VERIFY.md)：验证步骤与发布前检查。
- [`API-CONTRACT.md`](./API-CONTRACT.md)：客户端与宿主 HTTP 契约（改路由先读这个）。
- [`03-known-issues.md`](./03-known-issues.md)：已知问题、环境性失败、明确的设计取舍。
- `AGENTS.md`：项目硬约束与 UI 不变量总表。
