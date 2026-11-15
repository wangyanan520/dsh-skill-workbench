# 2026-11 对抗式审查 · 第二轮

日期：2026-11-15（晚于第一轮 UI 审查与 0.3.3 修复，含 `94c3083` 工具链提交之后的工作区）

> **修复记录（同日）**：R1、R2、R3、R4、R5、R6、R7、R8、R9 与 P3 中的 R10、R11、R13、R14、R15、R16 已全部修复并验证（`node --check` 通过、client selftest 32/32、`SKIP_REAL_AGENTS_SCAN=1` host selftest 全绿、`check:contrast` 含新增 sticky 边栏用例全绿、`test:page` 新增 layers 透传与草稿救援断言后 ALL GREEN、host selftest 新增 restore 回写锁文件断言）。未修复的残余项见文末「残余（修复后）」。修复明细见 `CHANGELOG.md` 0.3.4。

## 范围与方法

- 对象：`client.js`（4014 行全读）、`host/`（routes/scan/store/translate/uninstall）、`scripts/`、测试与审计声明核对。
- 方法：先跑全套命令核对 AGENTS.md 声明；再按上一轮 11 项修复的不变量逐条反向攻击（找绕过路径）；宿主侧按安全清单攻击（路径穿越、越界写、锁文件、事务性、错误泄露）。关键发现已由主审逐条到源码复核行号。
- 边界：未在真实 DSH 宿主渲染（同第一轮限制）；结论对代码路径负责。

## 声明核对（全部属实）

| 命令 | 结果 |
|---|---|
| `node --check client.js` | 通过 |
| `node client.selftest.mjs` | 32/32 |
| `SKIP_REAL_AGENTS_SCAN=1 node host/selftest.mjs` | exit 0 |
| `node host/selftest.mjs`（默认） | exit 1，44/45，缺 `image-to-code`（环境项，已记录） |
| `npm run audit:zh` | exit 0，无 P1（P2 若干，属标识符保留取舍） |
| `npm run check:contrast` | 亮/暗全绿 |
| `npm run test:page` | ALL GREEN（51 行、拼音 27 命中、详情可开） |

## 判定

上一轮修复的**测试、审计、对比度体系可信**；但攻击找到了 **2 个 P1：一个使修复项 #4/#6 在生产数据路径整体失效，一个可静默丢工作**。宿主侧无 P1 安全问题（围栏、写路径、锁文件降级均验证良好），但有 2 个 P2 数据完整性缺口。

## P1（必须修）

### R1 `normalizeSkillView` 白名单丢弃 `layers` 与 `install`，四条功能链路整体死代码

- 位置：`client.js:706-726`（白名单无此二字段）；宿主确实下发：`host/scan.js:298`（layers）、`host/routes.js:363`（attachInstallSources）。
- 后果（均已复核到消费点）：
  1. `hasUserLayer`（2492）恒 false → **「清除中文覆盖」按钮永不渲染**，修复项 #4 的 5 秒确认在真实数据下是不可达死代码；
  2. `confirmReview`（2331-2337）恒 false → “AI 翻译后保存 = 确认审核”永不触发，反而落入 `noChanges` 分支并 `onBack(true)` 强制返回；
  3. `skill.install`（2583-2603）恒 undefined → 安装来源链接与「从安装源读取简介」永不渲染；
  4. `layerText`（2495-2502）恒为 “—” → 详情「中文来源」行信息错误。
- 测试为何没抓到：`client.selftest.mjs` 无 layers/install 断言；`test/page-regression-test.mjs` 打开详情只断言中文名编辑区出现。
- 修复方向：白名单补 `layers`（`toArray`）与 `install`（isObject）；回归补两条断言（“有用户层时清除按钮可见”“中文来源非 —”）。

### R2 未识别 hash 的 popstate 直接 return，绕过脏检查

- 位置：`client.js:3331-3337`。
- 场景：详情编辑中（dirty=true），宿主以 hash 切换面板/会话 → popstate → `parseRouteHash` 返回 null → 静默返回 → 组件卸载、表单销毁。`beforeunload` 管不了 SPA 内部导航。且插件 mount 时无条件 `replaceState` 到 `#library`（3315-3321），与宿主 hash 路由共用 namespace，冲突概率非纯理论。
- 修复方向：`!route` 且 `dirtyRef.current` 时同样走 `confirmDiscard`（fail-closed）。

## P2（破坏不变量 / 数据完整性，有缓解或窄触发）

| # | 问题 | 位置 | 摘要 |
|---|------|------|------|
| R3 | loadIndex 无请求代际：旧在途响应晚返回会用保存前数据覆盖新缓存（`/list` 写回无代际号，`client.js:751-783`） | client.js | 保存成功 → 30s 前发出的旧响应后到 → UI 回退最长 30s，形同“保存没生效” |
| R4 | DetailView 表单重置 effect 依赖 `updatedAt`（英文原文 mtime）+ `zh.name`，AI 重译后干净表单不刷新，用户在陈旧基线上盲改（`client.js:2198-2208`） | client.js | 补救：dirty 保护仍在，patch 只含改动字段 |
| R5 | 编辑中技能被外部卸载 → 静默刷新下发不含它的索引 → 表单卸载、无确认、`onDirtyChange(false)` 把脏标记清零（`client.js:3697-3720`） | client.js | “数据消失版”的丢工作路径 |
| R6 | `--skw-surface` / `--skw-border` 在 THEME_VARS 中**未定义**，sticky 操作栏兜底到硬编码 `#1b1f24`（亮色）与近透明 `rgba(127,127,127,.08)`（设置页）（`client.js:2736-2737,3167-3168`） | client.js | 主题不变量的漏网之鱼；check-contrast 清单不含这两个变量所以全绿 |
| R7 | 保存/审核在途时「清除覆盖」「卸载」不禁用（仅 `removing`/`uninstalling` 各自互斥），写操作可乱序互踩（`client.js:2742,2777,2791`） | client.js | 5 秒确认窗口使“先保存再手滑清除”容易发生 |
| R8 | 卸载非事务：先 move 后写 meta，中间失败产生回收站“隐形孤儿”（listTrash 只认 `*.meta.json`，`host/uninstall.js:83-109,152-154`） | host | 修复：先写 meta 再 move，或 listTrash 兜底无 meta 目录 |
| R9 | restore 不回写 `.skill-lock.json` 的 `lockEntry`（meta 里明明存了），恢复后安装来源永久丢失、`/source` 返回 `no-install-source`（`host/uninstall.js:114-132`） | host | 小改动收益明确 |

## P3（打磨；修 R1 时必须同步处理 ★）

- ★ R10 `href: skill.install.sourceUrl`（`client.js:2589`）是全文唯一把数据字段放进 HTML 属性的注入面，React 18 对 `javascript:` 只警告不拦截——修 R1 使该链路可达时必须加 `^https?:` 白名单。
- R11 `window.confirm` 抛异常时按“确认丢弃”处理（fail-open，`client.js:3342-3344,3374-3378`）；应 fail-closed。
- R12 静默刷新失败后错误横幅无自动清除、10s 重试门内反复重设，一次抖动可挂 30-40s（`client.js:3439-3442,3781`）。
- R13 深链打开详情时标题不自动聚焦（mount 时数据未到，`[selected]` 不再变化，`client.js:3392-3407`）——修复项 #6 声称的聚焦只覆盖插件内导航路径。
- R14 浏览器 popstate 回列表不回焦原行（回焦只在 `leaveDetail`，`3386-3390`）——修复项 #11 只覆盖插件内返回按钮。
- R15 `kind:'info'` 通知渲染成绿色成功样式（`client.js:1762-1763`）。
- R16 卸载/恢复/清除把含绝对路径的原始 `error.message` 发给客户端（`host/routes.js:831,846,857`）；响应形状也偏离契约 §2。
- R17 translate 模型流累积无上限（adapter 不守 maxTokens 时内存无界）、job 无并发上限（loopback 可刷出大量并发 LLM 调用）；413 路径 `req.destroy()` 可能让客户端收到 ECONNRESET 而非契约 JSON（`host/translate.js:208-210,155-164`、`host/routes.js:134-141`）。
- R18 `#library?filter=bogus` 不校验 → 全列表被过滤且无任何 `aria-pressed` 提示（有“清除筛选”兜底）；`#libraryfoo` 前缀误匹配（`client.js:3244,3237`）。
- R19 TrashCard：另一行操作在途时确认点击被 `busyId` 静默吞掉；任一行成功会把别的行正在倒计时的 armed 一并解除（`client.js:2859-2865`）。
- R20 `STATUS_COLORS` 硬编码色与 THEME_VARS 值漂移（当前是死代码兜底，`client.js:1682,1786-1793`）。

## 验证为良好（攻击未得手）

- 客户端：无 `innerHTML`/`dangerouslySetInnerHTML`；行内无嵌套 button；5 秒确认计时器清理完备；30s/1.5s 轮询、popstate/beforeunload、matchMedia/Observer 均有 cleanup；localStorage 访问全 try/catch。
- 宿主：loopback 围栏（socket 回环 + 代理头拒绝 + Host/Origin + sec-fetch-site）无绕过；路由参数不进路径拼接（name 只作 Map 键），`safeId` 正则严格；uninstall 有 realpath 双校验挡 symlink 逃逸，且不会误删 skills 根；用户 store 原子写 + 损坏先备份；锁文件 malformed 安全降级；500 不泄栈；1MB body 上限与 source 域名白名单到位。

## 与 03-known-issues 的关系

`docs/03-known-issues.md` 现有条目仍然成立，但缺本轮 R1-R9（尤其 R1 与「覆盖率 100%/未审核 0」第 1 条同属“标记不可信”家族：**修复项声称的兜底 UI 在生产链路不可达**）。建议修复后一并更新。

## 建议修复顺序

1. R1 + ★R10（一行级修复 + 回归断言）。
2. R2、R5（脏检查 fail-closed 补全）。
3. R3、R4（刷新代际与 effect 依赖）。
4. R6（补两个主题变量并纳入 check-contrast 清单）、R7（危险按钮禁用传播）。
5. 宿主 R8、R9（卸载事务与 lockEntry 回写）。
6. 其余 P3 择机。

## 残余（修复后）

- R12：静默刷新失败后错误横幅无自动清除、10s 重试门内会反复重设，一次网络抖动可能挂 30-40 秒（保留重试按钮可手动刷新，属打磨项）。
- R17：translate 模型流累积无上限（adapter 不守 maxTokens 时内存无界）、并发 job 数无上限；413 路径 `req.destroy()` 可能让客户端收到 ECONNRESET 而非契约 JSON。
- R18：`#library?filter=<非法值>` 不校验（有“清除筛选”兜底）、`#libraryfoo` 前缀误匹配。
- R19：回收站行间交互两个小瑕疵（busy 时确认点击被静默吞、任一行成功会解除另一行的 armed 倒计时）。
- R20：`STATUS_COLORS` 硬编码兜底值与 THEME_VARS 漂移（当前为死代码）。
- 设计取舍不变项：详见 `docs/03-known-issues.md`。
