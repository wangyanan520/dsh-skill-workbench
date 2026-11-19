# DSH 宿主插件能力边界调研（0.4.0 候选前置）

- 研究票：wayfinder 地图「0.4.0 功能与优化候选清单」下研究票 #6「调研 DSH 宿主插件能力边界」
- 日期：2026-11-19
- 分支：research/dsh-plugin-capabilities
- 工作树：/private/tmp/swb-research-host
- 被测宿主：DeepSeek Harness 桌面运行时 0.2.2-rc.5（/Applications/DeepSeek Harness.app/Contents/Resources/app.asar 内 dsh/package.json）
- 仓库基线：dsh-skill-workbench 0.3.5，engines 要求 DSH >= 0.2.2-rc.1

## 0. 结论速览

| # | 0.4.0 候选能力 | 四档结论 | 一句话结论 | 关键证据 |
|---|---|---|---|---|
| 1 | 中文别名直呼（/万能调研 → /agent-reach） | 可通过现有 API 实现 | 客户端 '/' 输入源可在 Enter 时返回自定义 claim，把中文别名改写为英文 canonical 后再提交；菜单选择路径更简单，直接返回英文文本即可 | input-trigger types.ts:160-215；controller.ts:386-397；machine.ts:156-176；ui-commands service.ts:316-317 |
| 2 | 菜单内行内翻译（Ctrl+T 就地翻译当前行） | 宿主已支持 | 浮层槽、会话输入状态、菜单高亮与刷新、快捷键观察面都存在；但 Ctrl+T 在 Web 是浏览器保留键，页面收不到，桌面端待实测，产品必须提供备用键 | apply.ts:470；InputBar.tsx:467-469；shortcuts index.ts:83/89；controller.ts:457-465 |
| 3 | 使用统计驱动排序 | 可通过现有 API 实现 | 宿主没有现成的技能使用计数；host 插件可订阅 tool 结果与用户 /调用事件自建统计，并用 sessionProjection 增量、sessionQuery 回填历史 | dsh-tools events.ts:49；tool-skill index.ts:181-208；session-projection index.ts:322-336；session-query index.ts:186/196 |
| 4 | AI 自动归类 | 可通过现有 API 实现 | 现有 translate 链路已经调用宿主 llm.stream 并在提示词里选 category；对已有人工条目重新归类需要新增独立任务与产品策略，不需要宿主改动 | translate.js:24-27/109-117/193-206；store.js:32-34 |
| 5 | 批量翻译 | 宿主已支持 | 现有链路是逐技能调用，2 并发、单技能 90 秒、单次输出上限 20000 字符、最多 2 次尝试；任务最多保留 30 个，但公开 job 没有逐项失败明细，批量 UI 无法定位/重试失败项 | translate.js:29-37/147-158/290-350；routes.js:505-543 |
| 6 | 团队翻译包导入/导出（项目层 .dsh/skill-cn/zh-index.json） | 可通过现有 API 实现 | pack 模型与项目层合并已够，但 /import 只写用户层，/export 用 collectState(null) 不含项目层，项目层 store 只读，前端也没有导入/导出入口；不只缺 UI，还缺项目层写入与带 cwd 的导出 | store.js:261-280/300-322；routes.js:561-591/593-630；client.js 全文无 /import /export |
| 7 | 技能体检 | 可通过现有 API 实现 | 安装源锁文件、路径、来源桶、frontmatter/body 哈希、registry complete 都可读；但无 mtime、哈希不覆盖 whenToUse 等 frontmatter 字段、状态只看第一层、根目录失败只写日志，需要插件补扫与聚合 | install-source.js:19-47；util.js:125-131；scan.js:262-276；skill-filesystem index.ts:185-207 |
| 8 | 双语模式 | 可通过现有 API 实现 | zh store 与 pack 都不存英文，纯中文包不能反推英文；但 /list 含已安装技能的英文 name/description/whenToUse，可生成双语视图。中文层不进入模型上下文，模型只看到 registry 的英文元数据 | store.js:32-34/199-217；scan.js:278-309；tool-skill index.ts:53-61/217-255；dsh-skill index.ts:21 |

补充说明：四档是「能力可行性」的判断，不代表具体交互在每种运行环境都成立。本调研里明确不可行的子项有三个：把中文名注册成真正的技能名；在 Web 浏览器里拦截 Ctrl+T；从纯中文 pack 反向还原英文。另有若干「需要宿主改动」的假设都不成立：除 Web 键位这类环境限制外，8 项都可在插件内完成，不需要改 DSH。

## 1. 范围、方法与证据口径

### 1.1 调研问题

围绕产品已定边界「中文显示层 + 管理 + 卸载回收站，可扩发现/理解，不碰安装/启停/执行」，判断 8 个 0.4.0 候选功能在 DSH 宿主侧是否可做、怎么做、边界在哪。

### 1.2 环境与证据来源

证据按优先级分三层：

1. 本机已安装 DSH 运行时的真实源码。app.asar 内 dsh/ 下的 @deepseek-ai 包随包发布 TypeScript 源码与 README，版本 0.2.2-rc.5。抽取到 /tmp/dsh-asar 后直接读源文件与行号。
2. 本仓库现有实现。host/ 下的 routes.js、scan.js、store.js、translate.js、install-source.js、util.js，以及 client.js 的菜单装饰与管理页。
3. 第三方插件生产先例。~/.dsh/profiles/desktop/node_modules 下已安装的 dsh-btw、dsh-better-sidebar 等，用来验证扩展点不是纸面 API。

本机没有找到与这 8 项一一对应的官方公开文档页面；DSH 包内 README 与源码是当前可得的一手资料。本报告未使用网上检索，也不依赖二手博客或社区帖子；结论均可回溯到本地源码或包内 README。

### 1.3 方法说明与限制

本次调研本身是一个子代理任务，委派深度为 1/1，无法再派生后台子代理，因此所有取证由本会话直接完成。这一点影响的是取证并行度，不影响证据来源。

行号以本机抽取版本为准。DSH 是快速迭代的桌面运行时，0.2.2-rc.5 的包内 API 不承诺跨版本稳定；仓库声明兼容 >= 0.2.2-rc.1，但本次没有逐版本回归，属于未决问题。

### 1.4 四档定义

- 宿主已支持：宿主已经提供公开扩展点或稳定数据面，插件按现有契约接入即可。
- 可通过现有 API 实现：宿主没有现成功能，但公开服务、事件或数据足够，插件自己补逻辑即可，不需要改 DSH。
- 需要宿主改动：现有公开面缺关键能力，必须 DSH 增加服务、事件、字段或路由。
- 不可行：受浏览器/协议/安全模型限制，或与宿主硬约束冲突。

## 2. 八项逐项结论

### 2.1 中文别名直呼：/万能调研 自动改写为 /agent-reach

**档位：可通过现有 API 实现。**

#### 机制

客户端插件可以向 inputTriggers 注册一个 '/' 输入源。输入源在 Enter 裁决阶段可以返回一个自定义 CommandClaim，claim.submit 拿到参数与会话级 ctx，在提交事务里把中文别名替换成英文 canonical 再发送。菜单选择路径不经过 Enter 裁决，onPick 直接返回英文文本即可。

关键不是「能不能读到用户输入」，而是「在 Enter 路径上返回什么」。输入状态机只认 claim：

- onEnter 在 draft 以 '/' 开头且尚未 claimed 时进入 adjudicating 阶段（machine.ts:138-154）。
- onAdjudicated 只有 outcome.claim 才调用 begin-submit；outcome 为 undefined 时当普通消息发送；返回 text、insert 或 handled 时状态回到 plain，内容被静默丢弃，不插入也不发送（machine.ts:156-176）。
- 因此「matchEnter 返回 text 做改写」是无效路径。菜单 pick 和空格路径才吃 text。

#### 证据

- 输入源契约：@deepseek-ai/dsh-client-ui-input-trigger/src/types.ts:160-215。candidates 在 168，onPick 在 182，matchSpace 在 184，matchEnter 在 195-200，matchClaim 在 208。
- 注册只校验 trigger 与 name 唯一：同包 src/client/service.ts:55-77。重复注册会抛 slash source 已注册。
- Enter 裁决按注册序轮询：同包 src/client/controller.ts:386-397。只要 line 以该 source 的 trigger 开头且 source 实现了 matchEnter，就会询问；第一个非 undefined 胜出，不要求 candidates 非空。
- 自定义 claim 的执行：controller.ts:482-497。claim 走 slash/input-begin-command，text 走 slash/input-insert-text，insert 走 slash/input-insert-reference。
- claim 契约：@deepseek-ai/dsh-client-ui-conversation/src/client/contract/input.ts:40-55。name 不含斜杠；token 是 composer 显示的拼写；submit(args, actx, attachments) 返回 SubmitOutcome。
- 参数提取：同包 src/client/input/machine.ts:22-32。argsAfter 先按 claim.token 精确匹配，失败再按 token.trimEnd() 匹配，都不匹配返回空串。token 末尾的空格不会吃掉参数。
- 提交事务传入会话级 ctx：同包 src/client/input/facade.ts:815-836，claim.submit(args, this.deps.actx, attachments)；facade.ts:44 注释说明这是 session-scope ctx。
- 官方本地化命令先例：@deepseek-ai/dsh-client-ui-commands/src/client/service.ts:316-317 注释明确，输入 /计划 可以解析到 plan 描述符并按 /plan 执行；319-366 的 matchEnter 对未知 token 返回 undefined，因此后注册的自定义源可以接管；395-405 的 leadingClaim 用输入拼写做 token，submit 时发 canonical 名。
- 技能工具与宿主识别：@deepseek-ai/dsh-tool-skill/src/index.ts:429 的 SKILL_GESTURE 只识别 /[a-z0-9-]+；dsh-skill/src/index.ts:21 的 SKILL_NAME 只允许小写 kebab。中文不能成为真正的 registry name，只能是客户端别名。
- 当前实现：client.js:1370-1407 的 overlaySource 只注册 candidates 与 onPick，没有 matchEnter/matchClaim；client.js:1186-1225 的菜单装饰只改 label/description/section/icon，不改调用 token。
- 第三方生产先例：@michengai/dsh-btw/lib/client.js:15872-15888 定义自定义 claim（name、token、hint、submit），15889-15894 注册输入源，15952-15957 用 ctx.inject 管理生命周期。说明自定义 claim 在真实插件里可用，虽然它是 '@' 源且部分靠包装官方 source。

#### 对 0.4.0 的实现路径

建议分两层，不要一上来做全量拦截：

1. 别名菜单层。注册一个可见的 '/' source，candidates 返回中文 label（如「万能调研」）与英文 name（agent-reach 的候选身份），onPick 返回 { text: '/agent-reach ' }。这条路径最稳，走官方菜单 pick 的 insert-text，不需要 claim。
2. 直接输入层。注册一个隐藏的 '/' source（candidates 返回空数组，只实现 matchEnter），解析行首第一个 token。如果 token 命中中文别名表：
   - 返回 claim，name 用英文技能名（用于 hint 文案），token 用用户实际输入的别名拼写并补一个尾随空格，保证 argsAfter 能拿到参数。
   - submit(args, actx, attachments) 内构造 '/canonical ' + args，取会话 scope 的 sessions 服务，用 sessionOf(actx) 拿 SessionFace，再调用 session.prompt([{ type:'text', text }, ...attachments], 'queue')。
   - 不要用 conversation.send：它只接受文本，会丢附件（ui-conversation service.ts:203-213）。
   - claim.attachments 必须为 true，否则 facade.ts:405-425 会在有附件时直接报错并保留附件；beginSubmit 也只在 attachments 为 true 时序列化附件（facade.ts:821-829）。
3. 可选的可视化改写。matchSpace 在用户输入别名后按空格时返回 { text: '/canonical ' }，走 input-insert-text，让草稿当场变成英文。这条路径的体验更好，但要确认与官方 commands 源的 matchSpace 轮询顺序不冲突；官方 skill 源没有 matchSpace，commands 源对未知 token 的行为需要在原型里验证。

别名表直接复用现有 zh.alias 字段（host/store.js:32-34 已定义 alias 数组），不需要新数据模型。别名冲突、大小写、拼音、同名技能、userInvocable=false 的技能都要在匹配前过滤。

#### 风险与未决

- claim.submit 内再调 session.prompt 是否会与当前提交事务或队列冲突，尚未实跑。这是唯一需要原型验证的高风险点。
- 附件路径没有实测；至少要在原型里覆盖图片与文件回执。
- 中文别名与官方斜杠命令重名时的优先级要明确；建议只接管「别名表命中且 registry 中存在该技能」的情况，其他一律返回 undefined。
- 输入法组合态、大小写、前后空格、多个斜杠、URL 中的斜杠都要测。
- 不能把中文注册成技能名，也不能拦截不以 '/' 开头的普通文本；这两点是产品边界，不是实现细节。

### 2.2 菜单内行内翻译：Ctrl+T 就地翻译当前行

**档位：宿主已支持（浮层、快捷键、输入状态、菜单高亮与刷新都齐备）；Ctrl+T 键位在 Web 不可行，桌面待实测。**

#### 机制

会话级浮层槽 conversation.input.overlay 允许第三方挂组件。组件能拿到 sessionId、useInput、inputActions，因此可以读草稿、读菜单状态、替换选区。快捷键服务提供 registerFixed 与 observeFixedInput，可以在 window keydown 阶段观察按键并 consume。输入触发器控制器暴露 menu 快照与 refreshOpenMenu，可以在不移动高亮的情况下刷新菜单行。

「当前行」有两种解释：

- 菜单当前高亮行：读 menu 快照的 highlight，取对应 candidate 的 name/description，翻译后刷新菜单，或直接在浮层显示译文。这是最贴合「菜单内行内翻译」的路径。
- composer 当前文本行：InputState 只有 draft/draftRev/phase/claim/occurrences/queue，没有 caret 或 selection 字段（contract/input.ts:305-326）。只能通过 inputActions.captureInsertion() 拿当前选区，再用 insertText 替换；没有选区就无法可靠知道「当前行」。因此不建议承诺「翻译光标所在行」，应改成「翻译选中文本」或「翻译菜单高亮项」。

#### 证据

- 浮层槽声明：@deepseek-ai/dsh-client-ui-conversation/src/client/apply.ts:465-474，conversation.input.overlay 为 list/session。
- 浮层容器：同包 src/client/skeleton/InputBar.tsx:467-469，data-composer-overlay。
- 会话标准 props：dsh-client-ui-conversation/src/client/contract/slots.ts:395-411，SessionStandardProps 含 useInput 与 inputActions；dsh-client-ui-renderer/src/client/scoped-slots.tsx:521-547 按 scope 合并标准 props。
- 第三方浮层范例：@deepseek-ai/dsh-client-ui-input-trigger/src/client/index.ts:62-86，官方 MenuView 就是注册到同一个槽，inject 拿 sessionId 后解析 controller。
- 输入动作：contract/input.ts:264-293。captureInsertion 返回 revision-guarded 的当前选区；insertText 在草稿变化或提交锁定时返回 false；setDraft 替换整份草稿；persistDraft 走挂载的持久化回调。
- 菜单状态：@deepseek-ai/dsh-client-ui-input-trigger/src/client/controller.ts:62 暴露 readonly menu: SnapshotStore<MenuState>；同包 src/core/contract.ts:33-46 的 MenuState 含 open、hit、generation、groups、highlight。
- 刷新：controller.ts:457-465 的 refreshOpenMenu 注释明确「Re-fetch the currently open menu without changing its hit or visible rows.」因此翻译完成后刷新不会跳走高亮行。
- 快捷键服务：@deepseek-ai/dsh-client-shortcuts/src/client/index.ts:47 super(ctx,'shortcuts')；83 registerFixed；89 observeFixedInput；94-106 依次回调监听器并传递 consumed。
- 快捷键上下文：同包 src/client/types.ts:5-14 的 ShortcutContext 只有 source、region、modal、target，没有 sessionId；dom.ts:64-94 在 window keydown 计算 region，input/textarea/select/contenteditable 归为 editable，target 是 composedPath 的第一个 Element，consume 执行 preventDefault。
- 官方 README：同包 README.md:30 功能插件在 ctx.effect 里通过 ctx.shortcuts 注册；32 用 registerFixed 贡献只读序列、observeFixedInput 观察本地仲裁输入；82 明确「Operating-system shortcuts that do not reach the window cannot be intercepted.」
- Web 可用绑定：同包 src/binding.ts:96-111 的允许列表没有 Ctrl+T 这种单修饰键组合；registry.ts:50-60 的 registerFixed 本身不做 Web 可用性检查。
- 桌面 Electron：从 app.asar 抽出的 /tmp/dsh-main.js:21373 Menu.setApplicationMenu；accelerator 只有 Shift+Command+V（21268）、Option+Shift+Command+V（21272）、F12（21366），没有 CmdOrCtrl+T。桌面端 Ctrl+T 理论上会到达渲染层，但仍需实测。
- 浏览器侧：Ctrl+T 是浏览器新建标签页的保留快捷键，页面收不到 keydown，preventDefault 也无效。这是 Web 环境的硬限制，不是 DSH 的缺陷。

#### 对 0.4.0 的实现路径

1. 在 conversation.input.overlay 注册一个会话级组件，组件 inject 拿 sessionId，内部用 useInput 订阅输入状态。组件只在菜单打开时挂 keydown，避免全局监听干扰。
2. 按键触发后读 inputTriggers.sessionOf(actx).menu.getSnapshot()，取 highlight 指向的 group item。candidate 里有 name、description，中文 label 可能已经是中文；需要翻译的是英文 description，或用户明确选中的行。
3. 调宿主新增的翻译路由（建议 /translate-line 或 /explain-line），不要在客户端直接调模型。宿主侧复用现有 provider/model 设置与错误处理，客户端只拿结果。
4. 翻译结果按 candidate.name + description 哈希缓存，避免每次按键都请求。刷新菜单前把缓存写进包装后的 candidates 返回值，再 refreshOpenMenu；或者用浮层直接展示译文，不依赖菜单刷新。
5. 键位策略：桌面默认 Ctrl+T，但必须在设置里提供备用键；Web 默认 primary+alt+T 或 primary+shift+T，并在 UI 说明 Ctrl+T 被浏览器占用。更稳的做法是菜单行右侧放一个翻译按钮，快捷键只是加速器。
6. 若产品坚持「翻译 composer 当前行」，只能做成「翻译选中文本」：captureInsertion 拿选区，翻译后用 insertText 替换。没有选区时提示用户先选中，不要猜光标位置。

#### 风险与未决

- 全局 fixed 快捷键没有 sessionId，无法直接定位当前会话的 controller。可行做法是把 keydown 挂在 overlay 组件上（已知 sessionId），或从 target 反查当前 composer；后者不是稳定契约。
- 菜单可能同时有多个会话的实例；必须按 session 隔离，避免一个会话的快捷键刷新另一个会话的菜单。
- 异步翻译返回时用户可能已经移动高亮或关闭菜单；要用 generation/highlight 做乐观校验，过期结果丢弃。
- 翻译失败、模型不可用、限流都要降级为行内提示，不能阻塞输入或把菜单顶成错误态。
- Ctrl+T 桌面可达性、输入法组合态、Electron 与 Web 的键位差异都需要实测；本报告只能给出源码层判断。

### 2.3 使用统计驱动排序

**档位：可通过现有 API 实现（宿主没有现成统计，需要 host 插件自建）。**

#### 机制

宿主没有「技能被使用了几次」的现成事件或聚合。可用的数据面有三类：

1. 工具执行事件。模型通过 skill 工具加载技能时，tools/result 会带 ToolExecution，name 为 skill，arguments 含技能名。host 插件可以订阅并计数。
2. 用户手打 /技能。这条路径不经过工具，dsh-tool-skill 在 agent/pre-step 扫描 source.kind 为 user 的消息，首行匹配 /name 后注入 source 为 skill-invocation 的消息。host 插件可以挂同一阶段，或通过 sessionProjection 折叠会话事件。
3. 历史回填。sessionQuery 提供 listSessions 与 readSession，可读完整原始事件日志；sessionProjection 提供增量投影注册，可以按会话折叠 user/message 与 tool/call。

统计结果需要插件自己持久化。跨会话全局排序不能在单个投影里完成，必须由 host 插件汇总到自己的 store，再通过 HTTP 路由给客户端。

#### 证据

- 技能注册表只有失效事件：@deepseek-ai/dsh-skill/src/index.ts:288-296，skills/change 无 payload，不是使用事件。
- 工具事件：@deepseek-ai/dsh-tools/src/events.ts:18 tools/pre-execute（waterfall）、29 tools/execute（around）、41 tools/post-execute、49 tools/result（emit）、56 tools/change。tools/result 的 listener 异常被隔离。
- 技能工具名与参数：@deepseek-ai/dsh-tool-skill/src/index.ts:130-160，defineTool 的 name 是 skill，execute 参数含 name。
- 用户 /name 注入：同文件 181-208。只扫 source.kind 为 user 的消息，首行匹配后注入 source 为 skill-invocation 的消息；200 行给出 source 结构。
- 会话事件：@deepseek-ai/dsh-session/src/types.ts:315 user/message、369 tool/call、383 tool/result；dsh-session/src/index.ts:79 的 session/event 是 emit。
- 会话投影：@deepseek-ai/dsh-session-projection/src/index.ts:296 super(ctx,'sessionProjections')；83-133 ProjectionDefinition；322-336 register；473-480 onChanged。README.md:28-36 与 56-64 给出注册、stateOf、snapshot 的用法。
- 历史查询：@deepseek-ai/dsh-session-query/src/index.ts:106 super(ctx,'sessionQuery')；186 listSessions；196 readSession；292 filterEvents；322 readSurface。README.md:34-45 是方法表，49-51 说明 text filter 是字面扫描，151-154 说明精确读取会重放整条日志。
- 过滤结果不含 source：dsh-session-query/src/types.ts:61-72 的 SessionEventRecord 只有 sessionId、seq、type、time、surface；216-221 的 filter 支持 seq/time/type/surface/text；227-230 的 search doc 只多 text。因此不能直接用 filterEvents 筛 skill-invocation，必须 readSession 读完整事件再扫。
- 现有 session-stats 只统计 turns、steps、llmMs、toolMs、ttft、decode，没有按工具或按技能计数；见 @deepseek-ai/dsh-session-stats/README.md 与 src/index.ts:22。
- 本机磁盘有 ~/.dsh/sessions/<项目编码>/<session-id>/session.v4.jsonl.zstd；这是 zstd 压缩 JSONL，没有公开读取契约，不建议直接解析。
- 客户端面拿不到全量历史：@deepseek-ai/dsh-api-session-controller/src/client/contract/session.ts 的 ISession 没有消息历史或工具调用查询接口；只有已保留会话的 eventSource 窗口，而且注释说明它是 Conversation 专用。

#### 对 0.4.0 的实现路径

建议做「本地使用统计」，不做云端上报：

1. 在 host 插件新增 usage store，路径放在 DSH_HOME/dsh-skill-workbench/usage.json，与现有用户数据同目录。记录每个技能：menuPicks、userInvocations、modelInvocations、lastUsedAt、firstUsedAt、updatedAt。
2. 增量采集：
   - menuPicks 在客户端菜单 onPick 时上报，或客户端本地累计后批量提交。它代表「用户从菜单选择」，不等于技能执行成功。
   - userInvocations 由 host 的 agent/pre-step 或 sessionProjection 折叠 user/message，识别 source.kind 为 skill-invocation。
   - modelInvocations 订阅 tools/result，过滤 name 为 skill，解析 arguments.name；同一 callId 去重，避免重试重复计数。
3. 历史回填：启动后后台跑一次 sessionQuery.listSessions，再逐会话 readSession，扫 user/message 与 tool/call。按会话记录已回填标记，支持断点续跑。回填应分页、限速、可取消，避免阻塞宿主启动。
4. 聚合与排序：客户端 /list 可附带 usage 摘要，或新增 /usage 路由。排序分数建议 count 与 lastUsedAt 的加权，不要只按次数，否则老技能会长期占顶。提供「最近使用」「最常用」「默认」三种排序，避免统计替代用户意图。
5. 隐私与可控：默认只存本地聚合计数，不存 prompt 内容；提供关闭统计与清空统计；文档说明数据位置与用途。

#### 风险与未决

- 统计口径必须在产品上定义清楚：菜单选择、用户 /调用、模型 skill 工具调用是三件事，不能混成一个「使用次数」。
- 重复计数：用户 /name 注入后模型可能再调一次 skill 工具；重试、fork、会话恢复都可能重复。需要按 callId/消息 id 去重。
- sessionQuery 的精确读取会重放整条日志，历史大时成本高；搜索默认是关闭的（session-query-sqlite 配置 openAt:never），不能依赖全文检索。
- 客户端插件拿不到全量历史，统计必须放 host 侧；如果未来要做跨设备同步，需要额外的隐私与服务端设计，不在 0.4.0 范围。
- DSH 的 tool 事件与投影 API 在 rc 版本里是否稳定，需要逐版本回归。

### 2.4 AI 自动归类

**档位：可通过现有 API 实现。**

#### 机制

现有 translate 链路已经在做「翻译 + 归类」：SYSTEM_PROMPT 要求输出 category，并限定从给定分类 id 中选；buildUserPrompt 传入技能英文元数据与分类清单；callModel 通过宿主 llm.stream 调用模型。也就是说，首次翻译时 AI 归类已经隐式存在。

缺的是两件事：

1. 对已有人工条目/已翻译条目重新归类。selectTargets 对 manual 条目一律跳过，翻译任务不会碰它们。
2. 归类结果的复核与批量接受。现在 category 只是写入 zh 的一个字段，没有「建议/置信度/原因」的独立呈现。

#### 证据

- SYSTEM_PROMPT 在 host/translate.js:24-27，要求严格 JSON，name 不超过 10 字、summary 不超过 40 字，category 从给定 id 选，无法判断用 uncategorized。
- buildUserPrompt 在 host/translate.js:109-117，只传 skill.name、description、whenToUse 与分类清单。
- callModel 在 host/translate.js:171-241；llm.stream 在 193-206，参数含 provider、model、system、messages、signal、maxTokens:800、reasoningEffort:'off'。
- 输出上限与错误：217-224 超过 MAX_OUTPUT_CHARS 即 abort 并抛 ERR_TOO_LONG；finish 缺失为 ERR_NO_FINISH，finish.kind 不是 stop 时按 failure.code 或 ERR_LLM。
- 分类校验：normalizeModelZh 在 host/translate.js:67-89，category 不在 id 集合就退回 uncategorized；name 与 summary 缺一即视为无效。
- manual 跳过：selectTargets 在 host/translate.js:128-139，manual 条目直接跳过；saveTranslation 在 262-288 对 manual 条目只补空字段，review 保持 reviewed。
- 分类清单来源：store.js 的 categories 与 mergeZhLayers 在 111-134；routes.js 的 collectState 在 349-368。
- 技能元数据：scan.js:278-309 的 buildSkillViews 已下发 name、description、whenToUse、modelInvocable、path、source、hash、bodyPreview、status、zh、layers。
- 模型服务：@deepseek-ai/dsh-llm/src/index.ts:206/214/317/1185 stream；416 registerAdapter；733-735 listModels。现有链路已证明 provider/model 字符串可用。

#### 对 0.4.0 的实现路径

建议把「自动归类」做成独立任务，而不是偷偷改现有翻译：

1. 新增 /categorize 路由或 translate job 的一个 mode。输入：技能 name、英文 description、whenToUse、现有 zh.name/summary、分类清单；输出：category、confidence、reason（可选）。
2. 复用 translate.js 的 llm.stream 调用、超时、输出上限、并发上限与错误码，避免第二套模型链路。
3. 分类结果只作为建议写入草稿区或内存缓存，不直接覆盖 manual/reviewed 条目；UI 提供逐条接受、全部接受、忽略。接受后才写 store，并把 review 标为 draft 或 reviewed 由产品决定。
4. 增加「归类覆盖率」与「未归类/uncategorized」筛选，让用户知道哪些技能需要处理。
5. 对已翻译条目重新归类时，按 hash 缓存，避免每次全量调用；分类 taxonomy 变化时使缓存失效。

#### 风险与未决

- 技能 description 是不可信内容，可能包含提示注入。归类提示词必须把技能文本放在明确的数据区，要求模型只输出 JSON，不要把技能文本当指令。
- 分类 id 漂移：内置包、用户自定义、项目层可以合并分类；模型返回未知 id 时必须回退，不能写坏数据。
- manual 条目的产品策略：是「尊重人工，不自动改」还是「允许建议但需确认」？这决定 selectTargets 是否要放宽。
- 成本：每个技能一次模型调用；48 个技能约 24 波（并发 2），与批量翻译相同。归类任务应有独立预算与取消。
- 没有模型 adapter 或凭据时，应降级为「保留原分类」，不要阻塞管理页。

### 2.5 批量翻译：并发、输出与错误边界

**档位：宿主已支持（现有链路已具备批量任务机制）；可观测性与逐项重试需插件补。**

#### 现状与边界

- 逐技能调用，不是单个批量 prompt。每个技能一次 llm.stream，buildUserPrompt 只带一个技能。
- 并发 2：CONCURRENCY=2，runJob 启动 2 个 worker 共享 cursor。
- 单技能超时 90 秒：ITEM_TIMEOUT_MS=90_000。
- 单次输出上限 20000 字符：MAX_OUTPUT_CHARS=20_000，超过立即 abort 并抛 ERR_TOO_LONG。
- 最多 2 次尝试：MAX_ATTEMPTS=2；ERR_BAD_JSON 会重试，ABORTED 直接返回。
- 任务并发闸 2：MAX_RUNNING_JOBS=2，超出抛 ERR_BUSY，HTTP 429。
- 任务保留 30 个：MAX_JOBS=30 是已完成任务的保留数，pruneJobs 超限裁剪最旧完成任务；不是批量目标数上限。
- 失败处理：单个失败 continue 并累计 job.failed；全部目标都失败才 state=failed，部分成功仍是 done；失败明细保存在内部 failures 数组，不对外。
- 公开 job 字段：id、kind、state、total、done、failed、current、startedAt、finishedAt、error；没有逐项失败列表。
- 取消：cancel 置 cancelRequested 并 abort 当前 controller。

按 48 个技能估算：2 并发，每批 2 个，约 24 波；如果每个都卡到 90 秒，理论上限约 36 分钟。正常模型调用通常远低于此，但批量任务必须有进度、取消和超时提示。

#### 证据

- 常量：host/translate.js:29-37。
- publicJob：host/translate.js:147-158。
- pruneJobs：host/translate.js:160-169。
- callModel 与输出上限：host/translate.js:171-241，217-224。
- translateOne 的重试：host/translate.js:243-260。
- runJob 的 worker、失败累计与最终状态：host/translate.js:290-350；2 并发在 319。
- start 的并发闸与 ERR_BUSY：host/translate.js:352-357。
- /translate 路由与 429：host/routes.js:505-543，ERR_BUSY 转 429 在 535-536。
- 路由只接受 scope=untranslated|stale|selected|all 与可选 names；scope=selected 必须有 names。
- 客户端目前只在详情页对单技能调用 scope=selected：client.js:2516。
- /list 会附带 jobs 快照供 UI 轮询：host/routes.js:394 附近。

#### 对 0.4.0 的实现路径

1. 先补可观测性，不要先提并发。把 failures 数组转成公开 job.items：每个 item 记录 name、state、code、message、startedAt、finishedAt。注意不要把 provider 原始错误里的绝对路径或凭据透传给客户端。
2. 增加「重试失败项」：/translate 接受 names 与 scope=selected，前端从 job.items 里筛 failed，重新发起一个小任务。保持 2 并发与 2 次尝试，不要因为重试放大并发。
3. UI 增加批量入口：选择范围（未翻译、过期、全部）、预览目标数、开始、进度、失败列表、取消、重试失败。当前前端只有单技能翻译，批量入口是空白。
4. 如果要提高吞吐，先测 adapter 的速率限制与宿主内存。MAX_RUNNING_JOBS 与 CONCURRENCY 是仓库的宿主不变量，不应为了「更快」随意调高；确实要调，必须有压测与降级。
5. 长任务要能跨页面刷新恢复：job 状态在宿主内存，页面刷新后通过 /list 的 jobs 快照恢复。宿主重启会丢任务，UI 要说明。

#### 风险与未决

- 失败项不可见是当前最大的产品缺口；用户只看到 failed 计数，无法知道哪些技能失败、为什么失败。
- 部分成功状态是 done，容易被误读为全部成功；UI 要同时展示 done 与 failed。
- 90 秒单技能超时对慢模型/长描述可能偏紧；是否改成可配置，需要产品与压测决定。
- 20000 字符输出上限是防内存吃穿的硬边界；不要为了「一次多翻译几个」把多个技能塞进一个 prompt，JSON 失败会放大重试成本。
- 任务保留 30 个，超出会裁剪最旧完成任务；如果用户想回看历史任务，需要额外持久化，当前没有。

### 2.6 团队翻译包：项目层 .dsh/skill-cn/zh-index.json 导入/导出

**档位：可通过现有 API 实现；但「只缺 UI」的判断不成立，项目层写入与导出也需要补。**

#### 现状

- pack 模型够用：schemaVersion、version、lang、categories、entries；entry 只有 zh，不包含 bound/hash。normalizePack 会丢掉 bound/hash，origin 缺省 builtin，review 缺省 reviewed。
- 用户层导入可用：/import 接受 pack、strategy（fill/overwrite-same-origin/all）、apply、cwd；apply 时只写用户层 store，从不写项目层。
- 导出不含项目层：/export 用 collectState(null)，项目层为空；scope=all 时再补内置包；直接返回 BuiltinPack，不套 ok。
- 项目层 store 只读：loadProjectStore 读 <projectRoot>/.dsh/skill-cn/zh-index.json，兼容 entries 包裹与裸 map；没有写入、合并、导出函数。
- 客户端没有入口：client.js 全文没有 /import、/export 调用，也没有「导入/导出/团队/翻译包」文案。
- 合并优先级：项目层 > 用户层 > 内置，字段级非空覆盖；项目层在 resolveLocalization 中优先。这是产品既有契约，团队包正好利用它。

#### 证据

- pack 模型：host/store.js:256-280。
- 项目层读取：host/store.js:300-322；mergeZhLayers 在 111-134。
- 用户层写入：host/store.js:347-371 的 mutateUserStore，串行读改写，损坏先备份 .corrupt-<ts>.bak。
- /import：host/routes.js:561-591；buildImportPlan 在 242-304；writeEntryForSkill 在 306-329。
- 导入策略：fill 只补空字段；overwrite-same-origin 只覆盖同 origin；all 覆盖。manual 冲突跳过；pack 里找不到当前技能则 skipped。
- /export：host/routes.js:593-630；collectState(null) 在 599；直接返回 pack 在 623-629。
- 项目层路径：AGENTS.md 的硬约束与 host/store.js 的 loadProjectStore 一致，项目层在 <project>/.dsh/skill-cn/zh-index.json。
- 前端无入口：client.js 的 API 调用列表只有 /save、/translate、/delete、/uninstall、/source、/trash、/config、/source/batch；没有 /import 与 /export。

#### 对 0.4.0 的实现路径

1. 扩展 /import 的 target：user（默认）| project。project 时用 cwd 解析项目根，写 <project>/.dsh/skill-cn/zh-index.json。写入必须原子：临时文件 + rename，保留备份；并发写用锁或串行队列。
2. 扩展 /export 的参数：cwd 与 scope=project|user|all|translated。project 只导出项目层条目；all 导出合并后的用户可见结果，但要标注每条的 origin 与层级，避免团队包把用户私有翻译带走。
3. 导入预览要显示：将新增、覆盖、跳过、冲突（manual/不同 origin）各多少条；apply 前让用户确认。项目层导入还应显示目标文件路径。
4. pack 不要包含 bound/hash/绝对路径；团队包只携带技能 name 与 zh 字段。hash 是机器本地状态，跨机器无意义，还会造成假 stale。
5. UI 增加导入/导出面板：选择目标层（用户/项目）、选择文件或粘贴 JSON、策略、预览、应用；导出可下载 JSON 或复制。项目层导出要提示「会写入项目目录，可能被提交到 git」。
6. 兼容性：项目层文件可能由其他工具写入；读取要兼容 entries 包裹与裸 map，写入统一为带 schemaVersion/lang 的规范格式，并在文件头保留未知字段时不要静默丢弃（或明确迁移）。

#### 风险与未决

- 项目根解析：客户端传 cwd 还是宿主根据当前会话解析？多项目、无项目、worktree 都要处理。写错项目目录是高风险操作。
- 项目层写入需要用户明确同意；不能因为用户点了「导入」就默认写项目文件。建议默认用户层，项目层需要二次确认。
- 并发写与 git 冲突：团队成员同时改 zh-index.json 时，原子写只能保证本地不损坏，不能解决合并冲突；UI 要能显示解析失败并保留原文件。
- 项目层优先级高于用户层，团队包可能覆盖用户私有翻译；预览必须把这一点说清楚。
- pack 的 origin/review 语义在跨团队时可能失真；建议团队包统一 review=reviewed 或保留 draft，由导入策略决定。

### 2.7 技能体检

**档位：可通过现有 API 实现；但现有数据不够，需要插件补扫。**

#### 现在能读到什么

- 安装源：读 <agentsHome>/.skill-lock.json v3，字段 source、sourceUrl、skillPath、installedAt、updatedAt；无 sourceUrl 返回 null。README 简介抓取缓存 7 天。
- 技能路径与来源桶：scan.js 的 buildSkillViews 下发 path、source.kind、source.rank；registry 的 SkillSummary 也有 path、source、provider、invocation。
- 原文哈希：scan.js 的 readSkillCandidate 存 hash.frontmatter 与 hash.body；状态计算用当前哈希比对。
- 失效：listSkillRoots 根不存在/不可读直接跳过；filesystem provider 在根失败时 logger.warn 并 complete=false；get 时文件消失返回 undefined。
- registry 完整度：SkillCatalogSnapshot 有 complete；当前 scan.js 走 ctx.skills.list（异常时才 snapshot，且只取 skills），两条路径都丢掉了 complete。

#### 现在读不到/不可靠什么

- 没有 mtime。readSkillCandidate 不存 stat.mtime，无法判断「最近修改」或「安装后是否被改过」。
- frontmatter 哈希只覆盖 name 与 description：host/util.js:125-127 的 hashFrontmatter 是 sha256(name.trim() + 换行 + description.trim())；whenToUse、disable-model-invocation、user-invocable 等字段变更不会触发 stale。hashBody 只覆盖去掉 frontmatter 后的正文。
- 状态只看第一层：computeSkillStatus 在 host/scan.js:262-276 遍历 layers，但遇到第一个有 hash 的层就 return。项目层 fresh 会掩盖用户层 stale，用户层 fresh 也会掩盖项目层 stale。
- 没有结构化诊断：scanSkills 返回 skills、coverage、stores、generatedAt，没有 diagnostics；根目录失败只写 logger.warn，客户端看不到。现有 diagnostics 只记 lastClientDecorate（routes.js:395、store.js:325-338），不是技能体检。
- 没有 enabled/disabled 字段：filesystem provider 只有 disable-model-invocation 与 user-invocable 两个 frontmatter 开关，没有技能级启用/停用状态。
- 远程/虚拟技能没有本地文件：registry provider 可能返回 virtual 技能，path 为空；哈希与 mtime 体检要跳过并标注原因。
- 重名/遮蔽：scan.js 的 insertCandidate 按 rank 小者胜，同 rank 保留文件系统扫描；但结果里没有「被谁遮蔽」的诊断。

#### 证据

- 安装源：host/install-source.js:11 LOCK_FILE、13 CACHE_TTL 7 天、19-31 readSkillLock、34-47 sourceForSkill。
- 哈希：host/scan.js:69-96 readSkillCandidate，87-90 存 hash；host/util.js:125-131。
- 状态：host/scan.js:262-276。
- 扫描结果：host/scan.js:278-309 buildSkillViews；332-347 scanSkills 无 diagnostics。
- 根失败：@deepseek-ai/dsh-skill-filesystem/src/index.ts:185-207，根失败 logger.warn 且 complete=false；204 的 warn 文本是 skill root skipped。
- registry 完整度：@deepseek-ai/dsh-skill/src/index.ts:230-236 SkillCatalogSnapshot；470-472 list 丢 complete；481-488 snapshot 返回 complete。
- 来源桶：dsh-skill/src/index.ts:57-74 SkillSummary；dsh-skill-filesystem/src/index.ts:35-39 根 rank；251-270 roots 映射。
- 现有 diagnostics：host/routes.js:395；host/store.js:325-338。

#### 对 0.4.0 的实现路径

建议把「体检」做成独立扫描，不要塞进 /list 的同步路径：

1. 文件健康：path 是否存在、可读、是文件、大小合理；stat.mtimeMs、birthtimeMs；symlink 是否指向预期；权限错误。
2. 内容变更：新增完整哈希或规范化哈希，覆盖 frontmatter 全部字段与正文。保留现有 frontmatter/body 哈希做兼容，新增 hash.full 或 hash.frontmatterAll，避免旧数据全部变 stale。
3. 逐层状态：对项目层、用户层、内置层分别计算 fresh/stale/missing；不要遇到第一层就 return。输出每一层的 hash 比对结果。
4. 安装源：lock 里有条目但技能目录不存在；技能存在但 lock 无条目；sourceUrl 与 skillPath 不一致；安装源不可达只做提示，不做网络请求阻塞。
5. registry 完整度：改用 ctx.skills.snapshot 取 complete；complete=false 时在体检里显示「发现不完整」，并列出被跳过的根。
6. 重名/遮蔽：按 name 分组，列出 rank 更高的来源与被遮蔽的路径。
7. 翻译层健康：有 zh 但无对应技能（孤儿条目）；zh 的 bound.path 与当前路径不一致；项目层 JSON 解析失败；分类 id 不在 taxonomy。
8. 输出 diagnostics 数组：code、severity、skill、message、evidence（path/line/hash）、fixHint。通过 /diag 或 /list 的 diagnostics 字段下发，UI 提供筛选与一键重译/重扫。

#### 风险与未决

- 全量哈希对大文件有成本；SKILL.md 通常不大，但要限制大小并缓存。
- 符号链接、权限、网络盘、大小写不敏感文件系统都可能造成误报；体检结果要允许「忽略」。
- 远程/虚拟技能没有本地文件，不能按文件体检；要单独标注 provider 与 virtual。
- frontmatter 的 YAML 解析失败、重复 key、BOM 等边缘情况要有明确诊断，不要只报 stale。
- complete=false 只说明发现不完整，不说明哪个根失败；需要结合 logger 或自己扫根来补原因。

### 2.8 双语模式

**档位：可通过现有 API 实现（仅已安装技能）；从纯中文 pack 反向生成英文不可行。**

#### 机制

- zh 数据模型只存中文：store.js 的 STRING_ZH_FIELDS 与 ARRAY_ZH_FIELDS 在 32-34，entry 在 199-217，pack 在 261-280；没有 en 字段。
- /list 同时下发英文 registry 字段与中文 zh：scan.js:278-309 的 buildSkillViews 含 name、description、whenToUse、modelInvocable、path、source、hash、bodyPreview、status、zh、layers。客户端可以据此拼出「英文原文 + 中文译文」的双语视图。
- 模型上下文只用英文 registry：dsh-tool-skill/src/index.ts:53-61 的 catalogSourceEntries 只用 skill.name 与 skill.description；217-255 的目录 pre-step 过滤 modelInvocable 后注入。中文层是客户端菜单装饰，不进入模型上下文。
- 中文不能做技能名：dsh-skill/src/index.ts:21 的 SKILL_NAME 只允许小写 kebab；客户端 decorateEntry 只改 label/description/section/icon，不改 row.name（client.js:978-1040）。
- 纯 pack 不能反推英文：pack 只有 zh；normalizePack 丢 bound/hash；没有英文快照。只有已安装技能能通过 registry 拿到英文。

#### 对 0.4.0 的实现路径

1. 双语视图作为显示模式，不改数据模型：列表行显示中文名 + 英文 name；详情页并排显示英文原文（name/description/whenToUse/bodyPreview）与中文编辑区；菜单行显示中文 label 与英文 token。
2. 搜索同时匹配中文名、别名、拼音、英文 name/description；排序仍用 canonical name 稳定排序。
3. 复制/插入调用 token 时始终用英文 name，并提示「中文名只用于显示」。
4. 如果团队包需要携带英文，给 pack 增加可选的 en 快照（name/description/whenToUse/hash），但这是 schema 变更，需要版本迁移；0.4.0 可以先不做，只做本地双语视图。
5. 双语模式下不要改变模型上下文；如果未来要影响模型，必须单独设计「模型可见的中文提示」，不能用显示层偷偷注入。

#### 风险与未决

- 英文原文可能随技能升级漂移；双语视图要显示 hash/status，让用户知道中文是否过期。
- 未安装的 pack 条目没有英文；团队包如果只带中文，导入后无法生成双语。需要在产品上说明「双语仅对已安装技能生效」。
- 中文名与英文名的排序、搜索权重、空值处理要统一，避免列表跳动。
- 中文层不影响模型上下文是好事，但也意味着「中文别名直呼」必须在提交前改写成英文 canonical，否则模型看不到技能。这与 2.1 的实现路径一致。

## 3. 对 0.4.0 候选的可行性含义

| 候选 | 建议优先级 | 改动面 | 前置依赖 | 结论 |
|---|---|---|---|---|
| 团队翻译包 UI + 项目层写入/导出 | P0 | host routes/store + client 管理页 | 项目根解析、原子写、导入预览 | 用户层机制已够；项目层是新增，不是只补 UI |
| 批量翻译可观测性与失败重试 | P0 | host translate + client | job.items 公开、失败码脱敏 | 现有链路能批量，但失败不可见是硬缺口 |
| 技能体检 | P1 | host scan/util + client 面板 | 完整哈希、逐层状态、registry snapshot | 数据大多可读，需要补扫与聚合 |
| 双语视图 | P1 | client + /list 字段 | 英文 registry 字段、hash/status | 已安装技能可做；纯 pack 不可反推 |
| 使用统计驱动排序 | P1/P2 | host usage store + 事件订阅 + client 排序 | 统计口径、去重、隐私、回填成本 | 无现成统计，但 API 足够 |
| AI 重新归类 | P2 | host translate 复用 + client 建议 UI | manual 策略、分类 taxonomy、提示注入防护 | 首次翻译已含归类；重新归类需独立任务 |
| 中文别名直呼 | P2 | client 新 '/' source + claim | claim.submit 原型、附件路径、别名冲突 | 高置信可做，但必须先做原型 |
| Ctrl+T 行内翻译 | P2 | client overlay + 快捷键 + host 翻译路由 | 桌面实测、Web 备用键、会话映射 | 机制齐备；Ctrl+T 在 Web 不可行 |

建议的 0.4.0 组合：

- 先做 P0 的「团队包」与「批量翻译可观测性」，它们直接提升现有功能的可用性，风险低，不需要宿主改动。
- 再做 P1 的「技能体检」与「双语视图」，它们强化「发现/理解」的产品边界。
- P2 的「使用统计」「AI 重新归类」「中文别名」「Ctrl+T」按用户价值排序，先做原型再做产品承诺。中文别名与 Ctrl+T 都应先做技术 spike，不要直接排期。

明确不建议在 0.4.0 做：

- 修改 SKILL.md 或技能英文 name。违反仓库硬约束，也会破坏 registry。
- 把中文注册成技能名。SKILL_NAME 不允许，模型也无法识别。
- 拦截不以 '/' 开头的普通文本。输入管线只对斜杠行做裁决，强行拦截会破坏普通聊天。
- 直接解析 ~/.dsh/sessions 下的 zstd JSONL。没有公开契约，格式会变。
- 在 Web 上承诺 Ctrl+T。浏览器保留键无法拦截。

## 4. 未决问题

1. claim.submit 内调用 session.prompt 的实际行为。需要在真实宿主里做最小原型：中文别名 + 参数 + 无附件 + 有附件 + 提交中再次输入。重点看是否与当前提交事务、队列、取消冲突。
2. Ctrl+T 在桌面 Electron 的实际可达性。源码层没有 CmdOrCtrl+T accelerator，但需要实机按键验证；同时测中文输入法组合态、菜单打开/关闭、焦点在 composer/菜单/其他区域。
3. 使用统计的口径与隐私。菜单选择、用户 /调用、模型 skill 工具调用是否分别计数？保留多久？是否允许关闭？跨设备是否需要同步？这些是产品决策，不是技术缺口。
4. 历史回填的成本。sessionQuery 精确读取会重放整条日志；本机会话数量、日志大小、回填耗时需要实测。是否需要后台任务、进度条、断点续跑，取决于实测数据。
5. AI 重新归类对 manual 条目的策略。尊重人工不覆盖，还是允许建议但需确认？是否允许批量接受？review 状态如何变化？
6. 批量翻译失败明细的契约。job.items 要暴露哪些字段？错误码如何脱敏？重试是新建 job 还是复用原 job？前端如何区分「全部失败」「部分失败」「取消」？
7. 项目层写入的同意与并发。导入到项目层是否需要二次确认？如何处理 git 冲突、文件被其他工具修改、目录不存在、权限不足？原子写与备份策略要在实现前定稿。
8. 技能体检的误报边界。symlink、权限、网络盘、虚拟技能、YAML 解析失败、frontmatter 非 name/description 变更，哪些算 stale，哪些只算 warning？需要一份诊断码表。
9. 双语 pack 的 schema。0.4.0 是否只做本地双语视图，还是给 pack 增加 en 快照？后者需要 schemaVersion 迁移与导入导出兼容。
10. DSH 版本兼容。本次只验证 0.2.2-rc.5；仓库声明 >= 0.2.2-rc.1。inputTriggers、shortcuts、sessionProjections、sessionQuery 在 rc 版本间的差异需要逐版本回归，尤其是 claim/facade 与 overlay 槽。

## 5. 来源清单

### 5.1 本仓库

- /private/tmp/swb-research-host/client.js：1370-1407 overlaySource；1186-1225 decorateCandidates；1228-1283 wrapSkillSource；716-750 normalizeSkillView；4184 apply；4262 inject。
- /private/tmp/swb-research-host/host/translate.js：24-27 SYSTEM_PROMPT；29-37 常量；67-89 normalizeModelZh；109-117 buildUserPrompt；128-139 selectTargets；147-158 publicJob；160-169 pruneJobs；171-241 callModel；243-260 translateOne；262-288 saveTranslation；290-350 runJob；352-357 start。
- /private/tmp/swb-research-host/host/routes.js：242-304 buildImportPlan；306-329 writeEntryForSkill；370 list；399 save；505-543 translate；561-591 import；593-630 export；632 diag。
- /private/tmp/swb-research-host/host/store.js：16-34 常量与字段；111-134 mergeZhLayers；199-217 normalizeEntry；256-280 normalizePack；300-322 loadProjectStore；325-338 diagnostics；347-371 mutateUserStore。
- /private/tmp/swb-research-host/host/scan.js：42-67 listSkillRoots；69-96 readSkillCandidate；128-154 registrySummaries；213-232 insertCandidate；247-259 resolveLocalization；262-276 computeSkillStatus；278-309 buildSkillViews；332-347 scanSkills。
- /private/tmp/swb-research-host/host/util.js：125-131 hashFrontmatter/hashBody。
- /private/tmp/swb-research-host/host/install-source.js：11 LOCK_FILE；13 CACHE_TTL；19-31 readSkillLock；34-47 sourceForSkill。
- /private/tmp/swb-research-host/package.json：71-85 dsh.client 配置。

### 5.2 DSH 宿主包（根：/tmp/dsh-asar/dsh/node_modules/@deepseek-ai）

- dsh-client-ui-input-trigger/src/types.ts:160-215；src/client/service.ts:55-77；src/client/controller.ts:62/386-397/457-465/482-497；src/core/contract.ts:33-46；src/client/index.ts:62-86。
- dsh-client-ui-conversation/src/client/contract/input.ts:18-63/184-225/264-293/305-326；src/client/input/machine.ts:22-32/138-176；src/client/input/facade.ts:44/405-425/815-836；src/client/service.ts:40-71/203-213/234-245；src/client/apply.ts:465-474/470；src/client/skeleton/InputBar.tsx:467-469；src/client/contract/slots.ts:395-411；dsh-client-ui-renderer/src/client/scoped-slots.tsx:521-547。
- dsh-client-ui-commands/src/client/service.ts:316-317/319-366/395-405/418-433。
- dsh-client-shortcuts/src/client/index.ts:42-74/47/83/89/94-106；src/client/types.ts:5-14/46-72；src/client/dom.ts:64-94；src/binding.ts:96-111；src/client/registry.ts:50-60；README.md:30/32/82。
- dsh-client-ui-skill/src/client/index.ts:167-234。
- dsh-tool-skill/src/index.ts:53-61/130-160/181-208/217-255/429/438-450。
- dsh-skill/src/index.ts:21/57-74/146-152/230-236/288-296/470-472/481-488。
- dsh-skill-filesystem/src/index.ts:35-39/185-207/251-270。
- dsh-tools/src/events.ts:18/29/41/49/56。
- dsh-session/src/index.ts:79；src/types.ts:315/369/383。
- dsh-session-projection/src/index.ts:83-133/296/322-336/473-480；README.md:28-36/56-64。
- dsh-session-query/src/index.ts:106/186/196/292/322；src/types.ts:61-72/216-221/227-230；README.md:34-45/49-51/151-154。
- dsh-session-stats/src/index.ts:22；README.md。
- dsh-llm/src/index.ts:206/214/317/416/733-735/1185。
- dsh-api-session-controller/src/client/contract/session.ts（ISession 无历史查询）；src/client/contract/sessions.ts:49-200；src/types.ts:80-88。
- dsh-client-modules/src/client/manifest.ts:47-50/173-190/262-276。
- dsh-base/cordis.patch.yml:138-141/157-161/172-173（session-persistence、session-query-sqlite、session-projection 默认挂载）。

### 5.3 第三方插件与桌面主进程

- /Users/wyn/.dsh/profiles/desktop/node_modules/@michengai/dsh-btw/lib/client.js:15872-15888/15889-15894/15952-15957。
- /Applications/DeepSeek Harness.app/Contents/Resources/app.asar 内 dsh/package.json（0.2.2-rc.5）。
- 抽取的 /tmp/dsh-main.js:21268/21272/21366/21373（应用菜单与 accelerator）。

### 5.4 说明

本报告没有引用公开网页作为结论依据；上述本地源码与包内 README 是当前可得的一手资料。若后续 DSH 发布正式扩展点文档，应以官方文档为准，并回归本报告的 10 个未决问题。
