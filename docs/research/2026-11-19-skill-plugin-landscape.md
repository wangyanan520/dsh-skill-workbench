# 同类技能管理插件与中文用户痛点调研

> 研究票：wayfinder 地图「0.4.0 功能与优化候选清单」#2「调研同类技能管理插件与中文用户痛点」。
>
> 快照：2026-11-19（Asia/Shanghai）；npm 周下载区间 2026-11-12 至 2026-11-18；插件市场索引为当日抓取的 4.9 MB 版本。
>
> 分支：research/skill-plugin-landscape。本文只记录调研结论与证据，不修改技能文件。

## 0. 结论摘要

1. **DSH 官方没有“技能显示名”这一层。** 技能名必须是 kebab-case，SkillSummary 没有 displayName 或 localized 字段，模型目录只使用 name 和 description。因此“英文调用 token 不变、中文只做显示层”不是产品偏好，而是当前宿主结构下的必然选择。
2. **“中文显示层”已经是红海。** 至少 12 个插件在做相近的事：菜单中文标题、中文/拼音搜索、中文技能页、中文名作为第二检索键、菜单拖拽排序。其中 dsh-cn-menu-kit 与本项目核心正面重叠，dsh-zh-layer 覆盖命令/技能/插件并提供 zh/both/off 三模式。再做“把菜单变中文”本身没有差异化。
3. **官方市场已把“插件描述/分类”的中文化做成基础设施。** 6,245 个插件全部有中文 description，23 个分类全部有中文标题，搜索支持所有语言；但 6,245 个 title 全是字符串（仓库坐标），没有一个本地化标题。缺口不在“翻译插件简介”，而在行级中文显示名与人工审校过的技能数据。
4. **痛点证据真实存在，但主要来自插件作者和结构性代码，不是用户 issue。** DSH 官方仓库关闭了 issues；现有证据包括 dsh-skill-cn 作者对“中文名在注册阶段被丢弃、/与神对话 永远匹配不到”的说明、dsh-skill-doctor 对输入框正则只认 ASCII 的说明、dsh-skills-cn 与 dsh-skill-pilot 的 README 原话，以及 Claude Code #66554 非 ASCII 插件技能名塌缩的 bug。不能把“issue 搜不到”当作“没有痛点”。
5. **本项目的真正护城河是数据资产和工作流，不是菜单装饰。** 竞品普遍有拼音/模糊搜索、收藏/分组、使用统计、体检、推荐、批量操作、键盘导航；但没有人同时拥有“人工审校的内置精选包 + 覆盖率/审计 + 项目层覆盖 + 不改 SKILL.md”。本机校验显示内置包 53 条、本机 48 个技能只命中 11 条，磁盘有而包里没有 45 条、包里有而磁盘没有 42 条，内置包缺口是真实且可产品化的问题。
6. **0.4.0 建议只押三个差异化方向：** P0「内置包缺口发现」；P1「团队翻译包导入/导出 + 校验」；P2「诊断包」。批量 AI 翻译、双语模式、中文别名直呼只能算补齐 parity，不应作为 headline；虚拟滚动、主题检测、formatTime、12px 排版、AI 自动归类、技能体检、使用统计榜、收藏分组、关联推荐、键盘导航、搜索增强均已被别人做好或做了没有差异。
7. **不要把“中文化”当成单一功能。** 外部先例（VS Code 语言包、Codex agents/openai.yaml、codex-plugins-zh）证明可持续的做法是：旁路元数据 + 稳定标识 + 可校验的翻译包 + 人工/社区审校，而不是改源文件或拼 DOM。本项目的 zh-index.json 与 translations/validate.mjs 已经在这条路上，0.4.0 应沿这条线加深，而不是横向加按钮。

## 1. 证据口径与限制

| 档位 | 含义 | 例子 |
|---|---|---|
| 一手·官方 | 官方文档、官方仓库代码、官方索引数据 | DSH skills.zh.md、plugin-market.zh.md、市场 index.json |
| 一手·实现 | 包源码、包元数据、实际运行输出 | dsh-cn-menu-kit 的 lib/client.js、本机 translations/validate.mjs |
| 作者自述 | 竞品 README / CHANGELOG 的功能声明 | “支持拼音”“内置 90 条中文说明” |
| 二手·讨论 | 论坛、博客、社区贴 | CSDN 的 Skills 目录命名文章、Cursor 论坛帖 |

限制：

- 竞品 README 是作者自述，未逐项复现；已知至少一处对比表与事实不符（dsh-skills-cn README 称 dsh-skill-picker“只显示英文”，但 picker 自述并实现中文/拼音搜索）。本文以“作者声称”标注，不把它当独立验证。
- npm 周下载量是代理指标，包含 CI、镜像与重复安装，不等于用户数；只用于判断相对热度。
- GitHub star 数受传播影响，不能单独代表采用率。
- 本机技能集是特定环境，内置包命中数只用于证明“缺口机制存在”，不能外推为整体覆盖率。

## 2. DSH 生态：官方能力边界

### 2.1 技能、命令与模型看到的目录

| 事实 | 证据 |
|---|---|
| 技能名必须是 kebab-case：小写字母/数字/连字符；本地提供方接受目录包 name/SKILL.md 与扁平 name.md，不支持递归 **/SKILL.md | [DSH skills.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.zh.md)，2026-11-19 |
| SkillSummary 只有 path?、name、description、whenToUse?、invocation、source、provider、resourceBase，没有显示名/本地化字段 | [skills.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.zh.md) |
| 模型会话目录只使用 name 和 description，从不使用正文或绝对路径；dsh-tool-skill 注入的目录不含路径、来源、提供方 | [skills.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.zh.md) |
| 命令名是“Lowercase command name without the leading slash” | [DSH commands.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/commands.zh.md)，2026-11-19 |
| 本地发现 rank：project-dsh 100、project-agents 200、custom 300、user-dsh 400、user-agents 500、bundled 600 | [skills.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.zh.md) |
| 官方仓库关闭 GitHub issues、开启 discussions（284,097 stars；created 2026-08-13；pushed 2026-11-18） | [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，GitHub API 2026-11-19 |

含义：

- 任何“中文显示名”都只能存在于客户端装饰层或旁路索引，不能写进技能名；改 SKILL.md 的 name 会被宿主丢弃，改宿主正则则会在升级时被覆盖。
- 模型选择技能时看不到中文层。这是产品边界：中文层改善的是人找技能，不是模型选技能；除非未来做模型侧中文目录注入，否则不要宣称“让模型更懂中文技能”。

### 2.2 官方插件市场与索引

官方索引格式（[plugin-market.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/plugin-market.zh.md)，2026-11-19）：

- LocalizedText 字段可以是字符串，或以小写语言 id 为键的对象（如 { en: Foo, zh: 甲 }），对象必须包含 en；DSH 每层忽略未知字段。
- 索引的 title、description、metadata.categories、metadata.labels、metadata.sortKeys 都支持 LocalizedText；插件条目的 title、description 也支持，没有 title 时卡片显示 name。
- 搜索匹配名称、作者、关键词，以及所有语言的标题、描述、分类和标签，并容忍拼写错误。
- DSH 不内置索引源，每个索引源属于当前 profile；索引默认不超过 128 MiB、2xx 且不重定向。

2026-11-19 对官方目录 [dsh-plugin-catalog/index.json](https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json) 的统计：

| 指标 | 数值 |
|---|---|
| 插件条目 | 6,245 |
| 分类 | 23，全部有 en/zh 标题 |
| 有中文 description | 6,245 / 6,245（0 条空、0 条与英文相同） |
| 有本地化 title | 0 / 6,245；title 全是字符串，样例是 0-0-user/dsh-plan-note 这类仓库坐标 |
| metadata.category = skill | 185 |

分类体量（前几）：ui 1190、tools 955、session 480、workflow 414、dev 366、model 326、usage 316、memory 273、notify 202、remote 197、theme 195、skill 185。

判断：

- “把插件简介翻成中文”已经不是空白：官方索引已给全部 6,245 条中文描述，且搜索跨语言。再做一层“插件描述翻译”价值很低。
- “给插件/技能一个中文显示名”仍是空白：索引的 title 是仓库坐标，官方没有给技能 SkillSummary 增加显示名。本项目的 zh-index.json 正好补这一层。
- 官方索引支持 LocalizedText，意味着本项目自己的市场索引可以继续用双语 title/description；当前 market/index.json 已经是 en/zh，不是缺口。

awesome-dsh-plugin 列表（[README.zh.md](https://cdn.jsdelivr.net/gh/awesome-dsh-plugin/awesome-dsh-plugin@main/README.zh.md)，2026-11-19 抓取，4,095,273 字节）自述“这份列表也可以当插件市场索引”：DSH 0.2.1+ 可在“插件 → 发现 → 索引源”添加索引；官方发现页与 plugin_market 智能体工具搜同一份条目；收录标准只验“能装 + 描述属实 + 分类正确 + 在维护”，不排名、不评优劣。其“技能包”区体量巨大，但绝大多数是单个技能包，不是技能管理器。

### 2.3 直接对手：中文显示层与菜单

版本、star、周下载均为 2026-11-19 快照；star 来自 GitHub API，周下载来自 npm downloads API（2026-11-12 至 11-18）。功能列只写与本项目相关的部分。

| 插件 | 做法与已覆盖 | 与本项目重叠 | 空缺 / 风险 |
|---|---|---|---|
| dsh-zh-layer 0.7.0（5★，278/周，repo created 2026-11-01） | 命令、技能、插件列表统一“中文名称 + 英文原名 + 中文功能描述”；zh / both / off 三模式；AI 翻译手动触发、增量缓存、默认 deepseek-flash | 中文显示、双语、AI 翻译、菜单覆盖 | 依赖 DOM 重写（MutationObserver 改 itemName）；无管理页、无覆盖率/审计、无项目层、无内置精选包；作者自述“大版本或特殊 UI 插件会失效” |
| dsh-cn-menu-kit 1.0.0（0★，207/周，repo created 2026-11-08） | 菜单技能标题“中文标题（英文名）”；中文即时搜索；悬浮详情；菜单内拖拽排序；顺序持久化 | 核心菜单中文显示正面重叠 | 中文标题来自 SKILL.md 的 description 前缀“中文标题——”，要求作者改技能文件；无管理页/覆盖率/审计/AI；包源码自述菜单行由官方 React 组件渲染，靠渲染后恢复，官方大版本改 DOM 可能失效 |
| dsh-skills-cn 1.4.4（0★，npm 404，repo created 2026-11-15） | 对话区顶部“技能管理”页签；中文名 + 英文 name + 中文说明 + 使用次数 + 来源；五组来源分组；可编辑中文；中英搜索；批量删除 + 回收站；键盘 ↑↓/Enter；内置 43 条离线词典 | 中文名/说明、搜索、来源分组、使用次数、删除 | 无菜单装饰、无分类编辑、无覆盖率/审计、无 AI 翻译、无项目层；分页 25，无虚拟滚动；未发布 npm、未进 catalog，采用度低 |
| dsh-skill-cn 1.0.0（0★，324/周，repo created 2026-11-13） | 注册第二个 / 源，把中文名作为 label 第二搜索键；输入 /与神对话 命中 ff-yushen-duihua，插入英文 token；排序完全相等 > 前缀 > 包含 > 描述包含，最多 15 条 | 中文名搜索、中文别名直呼 | 中文名来自描述开头 [中文名] 标签，数据源依赖作者写标签；不做管理页/覆盖率/审计；只解决“搜得到”，不解决“批量维护” |
| dsh-chinese-skill-patch 0.1.2（355/周，README 记 2026-08-22） | 用 require.resolve 定位 dsh-skill / dsh-skill-filesystem / dsh-tool-skill，把 SKILL_NAME 正则改成 Unicode，让 /私 等中文名可被发现/补全/调用 | 中文别名直呼（更彻底） | 持久改写 node_modules，DSH 升级后被覆盖；不改输入框 TEXT_REF_RE，中文仍不能变成蓝色 chip；与本项目“不碰宿主文件”的纪律冲突 |
| dsh-skill-picker 0.5.29（45★，791/周，repo created 2026-08-16） | 输入框旁面板；中文/拼音（jiyi / ji yi / jy）/英文搜索；最近使用 + 手动置顶；↑↓ + Enter；右键置顶/卸载；v0.5.15 起运行时接管官方 / 触发源做模糊 + 拼音，一个文件都不动 | 中文/拼音搜索、最近使用、键盘导航、菜单接管 | 以“选择器”为中心，不做批量维护/覆盖率/审计/项目层；接管官方触发源有兼容性风险 |
| dsh-skill-cockpit 1.7.1（10★，956/周，repo created 2026-10-14） | 应用级“技能中心”页；列六类技能根；解释技能为何不可见；启停；分组/预设；使用统计；回收站；体检；一键修 frontmatter；翻译用 MyMemory/Google 免费端点 | 管理页、分组、统计、体检、批量、搜索、键盘 | 翻译质量/审校弱；无人工审核数据资产；无项目层“团队翻译包”；功能很宽，但每一项都不是本项目要差异化的方向 |
| dsh-skill-doctor 1.0.0（1★，986/周，repo created 2026-10-31） | 技能/插件体检；SD 系列规则；体检病历与复诊对比；使用统计；安装门禁；一条龙改写工单；八条中文斜杠命令 | 体检、统计、批量修复 | 解决“技能为何不被模型选中”，不是“中文层质量”；无内置精选包/覆盖率审计；体检与翻译审计是两类问题 |
| dsh-skill-scoreboard 1.1.2（1★，277/周，repo created 2026-09-01） | 按会话去重/按加载次数两种口径统计 skill 工具调用与直接 read 文件；三选项卡、分页、JSON 导入导出、中英 UI | 使用统计排序 | 只做统计，不做管理/翻译；与本项目“最近使用”是互补，不是差异化 |
| dsh-skill-palette 0.1.5（2★，414/周，repo created 2026-10-30） | 输入框旁技能面板；8 个手写用途桶 + 关键词自动进桶；中文说明搜索；最近 24；收藏；点选插入 /技能名；内置 90 条中文说明，缺的“翻译 N 条”按默认模型翻并缓存 | 中文说明、收藏、最近、批量 AI 翻译 | 无审核/覆盖率/审计/项目层；翻译只发技能名 + 英文描述，质量不可控 |
| dsh-skill-pilot 1.1.7（1★，174/周，repo created 2026-11-09） | 输入框旁中文技能面板；中文分类栏；中英混合搜索；草稿停顿 260ms 推荐最多 3 个技能；中文说明纯本地规则生成，不联网不调模型 | 中文分类、搜索、关联推荐 | 无管理页/覆盖率/审计/项目层；推荐规则可解释但覆盖有限；无人工翻译资产 |
| dsh-skill-triage 0.2.0（0★，202/周，repo created 2026-10-28） | 触发词命中后检索本机技能，要求对每个候选登记使用/弃用理由，拦住其它工具直到选定技能全加载；25 组跨语言词表、别名权重 0.95 | 关联推荐（强制式） | 交互侵入性强，不是浏览/管理工具；无中文显示层/覆盖率 |

竞争结论：

- 第一簇：显示层（zh-layer、cn-menu-kit、skills-cn、skill-cn、picker、chinese-patch）。核心能力是“让中文用户看懂/搜到/选中”，已经高度同质化；差异主要在入口（菜单、输入框按钮、独立页签）和是否改源文件。
- 第二簇：管理器（cockpit、doctor、scoreboard、palette、pilot、triage、skills-manager、skill-explorer）。核心能力是“装/停/删/统计/体检/推荐”，功能更宽，但普遍没有“人工审校的中文数据资产”。
- 第三簇：通用大管理器（@michengai/dsh-skills-manager 34,819/周、@linxin666/dsh-client-ui-skill-explorer 29,551/周）。它们覆盖多视图、启停、导入导出、市场发现、回收站，是本项目在“管理”维度上的强势替代品；本项目不应在“通用管理器”维度硬碰。

本项目周下载是 1,387，在“中文显示层”这一簇里最高（picker 791、cockpit 956、doctor 986、palette 414、zh-layer 278、cn-menu-kit 207），但低于两个通用管理器一个数量级。这说明：细分需求真实存在，但天花板受通用管理器压制；继续加同质化显示功能，边际收益递减。

### 2.4 本机重点插件：市场、侧栏、更新、费用、日志

这五个是本机 $DSH_HOME/profiles/desktop/node_modules/ 下已安装的代表性插件，均非技能中文层竞品，但决定了 0.4.0 可借力的平台能力。

| 插件 / 版本 | 角色 | 中文相关事实 | 对 0.4.0 的含义 |
|---|---|---|---|
| dshmarket 1.73.22（261,597/周） | 可视化插件市场：浏览、搜索、一键安装社区插件 | locale/zh.json 只有 meta.title / meta.description 两条；条目的中文简介完全依赖官方 catalog 的 description.zh；lib/registry.js 的 asRegistry 只校验 category 非空，不读条目的中文显示名 | “市场条目中文化”已有官方数据；本项目不应再做插件市场翻译。市场 UI 的 title 仍是仓库坐标，说明“行级中文名”仍是空白 |
| dsh-better-sidebar 0.32.1 | 原生右侧栏 + 自绘底部工作台：文件树、编辑器、Git、任务、侧聊；暴露 ctx.betterSidebar 服务 | README 明确“i18n follows DSH”；中文 UI 跟随宿主语言，不提供技能层中文 | 平台基础设施；若 0.4.0 做诊断包/团队包，可复用其侧栏入口，但它不是竞品 |
| dsh-plugin-update 0.18.39 | 给任意 DSH 插件提供“查新版/装更新/更新日志/批量更新/失败兜底”的宿主接线与面板组件 | 中文一句话、待重启横幅、诊断一键复制、更新日志自动展示；无技能元数据 | 说明“插件自更新 + 诊断复制”已是成熟模式；诊断包可借鉴其“一键复制诊断”交互，但不要重复造更新器 |
| dsh-cost-meter 1.9.73 | 会话费用统计、预算、余额、历史、峰谷计价 | package.json 的 dshhub 块有中文 displayName / summary / categories（费用、Web UI、观测） | 证明“插件元数据中文化”有官方/市场消费路径；但这是插件级，不是技能级 |
| dsh-log 0.4.1 | 日志落盘引擎 + 读侧工具；宿主/客户端/独立 Node 三端 | 中文错误信息、事件清单、诊断行；不处理技能 | 若做“诊断包”，dsh-log 是日志来源之一；但本项目已有 diagnostics.json，优先复用，不必引入重依赖 |

### 2.5 本项目当前基线（v0.3.5）

为避免把“我们还没有”误判成“市场空白”，先列清本项目已经有什么（[README.md](../../README.md)）：

- 菜单：英文 token 不变；中文名 + 一句简介 + 中文分类；最近使用置顶；搜索认中文名、英文名、别名、全拼/首字母拼音；装饰式与兼容叠加两种（[README.md:46](../../README.md#L46)）。
- 管理页：已翻译/未审核/过期/未翻译四态；编辑中文名、别名、简介、详细说明、适用/不适用、分类、标签、关键词；来源与覆盖；项目层覆盖；覆盖率（[README.md:52-54](../../README.md#L52-L54)）。
- 从 GitHub 安装来源补简介，支持批量版，只补空字段并标“导入”草稿（[README.md:58](../../README.md#L58)）。
- 已知限制：内置包按 53 个技能生成，覆盖率一开始有缺口；翻译一次只能一个技能；中文层只改显示，模型仍收到英文原文；启停交给 skills-manager/DSH 自带设置（[README.md:85-90](../../README.md#L85-L90)）。

这意味着：“菜单中文显示”“搜索增强”“最近使用”“项目层覆盖”“来源补简介”已经在产品里；0.4.0 的候选不应重复这些，而应把已有数据资产变成工作流。

## 3. 其他 AI 编码工具的本地化先例

### 3.1 VS Code：显示层本地化的成熟样板

- 默认英文；其它语言通过 Marketplace 的 Language Pack 扩展安装；装包后 Configure Display Language 命令本身也会本地化；支持 zh-cn、zh-tw 等 15 种语言；argv.json 持久化，--locale 可启动时覆盖（[VS Code locales 文档](https://raw.githubusercontent.com/microsoft/vscode-docs/main/docs/configure/locales.md)，DateApproved 11/18/2026）。
- 官方有 Community Localization Project，可贡献/投票译文；语言包是“显示层”，扩展 ID、命令 ID、配置键保持不变。

可迁移：语言包/术语表/社区审校的治理模式；不可直接迁移：技能没有 VS Code 那样的扩展清单与显示名机制，必须自带旁路索引。

### 3.2 Claude Code：文档中文化不等于命令本地化

- 官方已有中文文档（[code.claude.com/docs/zh-CN/skills.md](https://code.claude.com/docs/zh-CN/skills.md)，2026-11-19 抓取）：自定义命令已并入 skills；文件夹名即命令名（.claude/commands/deploy.md → /deploy）；SKILL.md + frontmatter；disable-model-invocation / skillOverrides；内置 /doctor、/code-review 等。
- 但命令 token 仍由目录名决定，官方没有中文别名/中文显示名机制。UI 本地化需求公开存在：issue [#31413 “UI language localization support”](https://github.com/anthropics/claude-code/issues/31413)（2026-03-06，21 条评论，OPEN）、[#35600 “Add Traditional Chinese (zh-TW) localization support”](https://github.com/anthropics/claude-code/issues/35600)（2026-03-18，4 条评论，OPEN）。
- 非 ASCII 插件技能名有实锤 bug：issue [#66554](https://github.com/anthropics/claude-code/issues/66554)（created 2026-06-09，2 条评论，2026-07-17 被机器人以 inactive 关闭，2026-09-14 locked）。正文：插件技能目录名/name 的非 ASCII 字符逐个替换成连字符，13 个两字技能全部塌成 my-plugin:--；调用 Skill(“my-plugin:残量”) 报 Unknown skill；同一 SKILL.md 作个人技能 ~/.claude/skills/残量/SKILL.md 时 /残量 正常。说明“个人技能可中文、插件命名空间会塌缩”是真实的结构性裂缝。
- 社区先例：[LinYiXin123/claude-code-zh-toolkit](https://github.com/LinYiXin123/claude-code-zh-toolkit)（45★，created 2026-05-04）给斜杠命令技能列表加中文描述，显示层补丁，不改 SKILL.md，支持新装技能自动翻译；[Frank-6932/skill-manager-cn](https://github.com/Frank-6932/skill-manager-cn)（created 2026-09-12，0★）把 Claude Code 插件市场翻成中文，本地网页浏览/搜索/一键安装/更新，README 自述“Claude Code 的插件市场（/plugin 里的 Discover）全是英文介绍，中文用户看不懂”。

### 3.3 Cursor、Windsurf：编辑器语言包不等于 AI 产品页面

- Cursor 继承 VS Code 的 Display Language / Language Pack，但 Cursor Settings 等自有页面不随语言包本地化。官方论坛两帖：
  - [How to set the language of the software interface](https://forum.cursor.com/t/how-to-set-the-language-of-the-software-interface/164137)：用户 2026-06-26 提问；2026-07-02 官方回复 Configure Display Language + Language Pack，但明确语言包只翻编辑器 UI。
  - [Why is the setting page not supported for translation into Chinese](https://forum.cursor.com/t/why-is-the-setting-page-not-supported-for-translation-into-chinese/148308)：2026-01-08 提问；2026-01-19 回复 Cursor Settings 仍 English-only。
- Windsurf 官方无完整中文；社区 [KLFDan0534/windsurf-autoContinue](https://github.com/KLFDan0534/windsurf-autoContinue)（created 2026-05-06，pushed 2026-05-26，2★）通过注入 workbench.html 做界面汉化 300+ 词条，覆盖菜单、设置页、模型选择器。做法可借鉴、工程上不可取：注入官方产物，升级即碎。

### 3.4 Cline：UI 本地化需求公开且仍开放

- issue [#12518 “添加中文界面支持 / Add Chinese (Simplified) Language Support”](https://github.com/cline/cline/issues/12518)：created 2026-07-24，updated 2026-10-04，14 条评论，OPEN；请求 i18n 框架 + 简体语言包 + 语言切换。
- 另有 Discussion #15727 “i18n / community localization support”；社区有 HybridTalentComputing/cline-chinese 汉化 fork。
- 这些是编辑器/产品 UI 本地化，不是技能目录；但证明中文用户对英文界面的容忍度有限，且官方响应慢时社区会外挂。

### 3.5 Codex：官方给了“旁路显示元数据”的钩子

- Codex 的 agents/openai.yaml 规范里有 interface.display_name（Human-facing title shown in UI skill lists and chips）与 interface.short_description（25–64 chars）（[openai_yaml.md](https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/skill-creator/references/openai_yaml.md)，2026-11-19）。
- [onlysmt/localize-skill-metadata](https://github.com/onlysmt/localize-skill-metadata)（created 2026-05-14，0★）是一个 Codex skill，给其他 skill 生成/更新中文 agents/openai.yaml 的 display_name / short_description / default_prompt；保留原 skill 名，中文短说明 25–64 字。这是与本项目 zh-index.json 同构的“旁路显示元数据”先例。
- [kael-odin/codex-plugins-zh](https://github.com/kael-odin/codex-plugins-zh)（created 2026-10-08，pushed 2026-11-08，40★）把 OpenAI 官方目录全量中文化：189 个官方插件 + 1,505 个应用/连接器 = 1,694 条；6,720 个文件无损校验 0 分歧；每日 CI 跟进；同时产出 Codex 原生 .agents/plugins/marketplace.json 与 Claude Code 读的 .claude-plugin/marketplace.json；中文落在 interface.shortDescription / longDescription 与条目中文 category；SKILL.md 一律不动，品牌名保留英文，市场注册名 openai-curated-zh 不占官方 ID。这是“中文元数据包 + 无损校验 + 双端清单”的最强外部先例。
- Codex 的 Skills 页已有 zh-CN 本地化，但仍有 i18n 缺陷：issue [#48439](https://github.com/openai/codex/issues/48439)（created 2026-09-26，OPEN，0 评论）——“Skills page scope tabs（‘个人’/‘系统’）collide into identical ID and become unselectable in non-English locales (e.g. zh-CN)”；issue [#41256](https://github.com/openai/codex/issues/41256)（created 2026-08-28，OPEN）——“Plugins”与“Apps”在 zh-CN 下像重复入口。说明本地化不是翻译完就结束，ID/布局/术语都会引入新 bug。

### 3.6 可迁移做法与拒绝清单

| 做法 | 先例 | 迁移判断 |
|---|---|---|
| 旁路显示元数据（sidecar） | Codex agents/openai.yaml；本项目 zh-index.json | 采纳：稳定 token 不变，显示名独立存储；这是本项目已有路线 |
| 显示层本地化 + 稳定 ID | VS Code Language Pack | 采纳治理模式：术语表、审校状态、覆盖率；不照搬“语言包”机制 |
| 机器可证的无损翻译包 | codex-plugins-zh 6,720 文件 0 分歧 + 每日 CI | 采纳：团队翻译包应有 schema、校验和、dry-run diff、CI 校验 |
| 只改显示的客户端补丁 | claude-code-zh-toolkit、dsh-zh-layer | 谨慎采纳：只改显示是对的，但 DOM 补丁脆弱；优先用宿主/客户端扩展点，并做版本兼容测试 |
| 第二个 / 源 + label | dsh-skill-cn | 可选：能实现中文别名直呼，不碰宿主；但会引入重复源、排序和冲突问题，需产品决策 |
| 把中文标题写进 description 前缀 | dsh-cn-menu-kit | 拒绝：要求改 SKILL.md，违背本项目硬约束，且污染模型看到的描述 |
| 改 node_modules 正则 | dsh-chinese-skill-patch | 拒绝：升级即失效、不可审计、与“绝不改宿主文件”冲突 |
| 注入官方构建产物 | Windsurf 汉化补丁 | 拒绝：不可维护，升级即碎 |

## 4. 中文用户使用英文技能目录的痛点证据

### 4.1 结构性证据：中文名在链路上会被丢弃

| 证据 | 内容 | 来源 / 日期 |
|---|---|---|
| DSH 技能名文法 | 必须 kebab-case；SkillSummary 无显示名字段 | [skills.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.zh.md)；2026-11-19 |
| dsh-claude-compat 0.9.0 | “DSH 的技能名文法固定为 kebab-case……中文名在插件层放行也没用——下一层必然 return void 0，所以此前只能整条丢弃。”同版新增 skillAliases（如 { 三脑: san-nao }），并修复“非 kebab 名技能被静默丢弃”，每文件每进程告警一次 | [CHANGELOG.zh-CN.md](https://cdn.jsdelivr.net/npm/dsh-claude-compat@1.2.1/CHANGELOG.zh-CN.md)，2026-10-28 |
| dsh-skill-cn 作者说明 | “DSH 的技能名被强制为 [a-z0-9-]（中文名在注册阶段就被丢弃），而 / 菜单只按技能名做子序列匹配（rankByName）。所以 /与神对话 永远匹配不到。”解法是注册第二个 / 源，把中文名作为 label | [README.md](https://github.com/feifandiv/dsh-skill-cn/blob/main/README.md)，repo created 2026-11-13 |
| 输入框 chip 正则 | TEXT_REF_RE 原文使用 [w-]，JS 的 w 只有 ASCII；中文名永远匹配不上，所以“中文名 + 蓝色 chip 在当前 DSH 上互斥” | [dsh-skill-doctor README](https://github.com/shuxidemosheng/dsh-skill-doctor/blob/main/README.md)，repo pushed 2026-11-12 |
| Claude Code 非 ASCII 插件技能 | 插件技能名非 ASCII 字符逐个替换成连字符，13 个两字技能塌成 my-plugin:--，调用报 Unknown skill；个人技能目录 残量/SKILL.md 反而正常 | [issue #66554](https://github.com/anthropics/claude-code/issues/66554)，created 2026-06-09，closed stale 2026-07-17 |
| Agent Skills 规范 | name 最长 64，仅小写字母/数字/连字符，必须与父目录同名 | [agentskills.io/specification](https://agentskills.io/specification)，2026-11-19 访问 |

结论：“中文名不能用”不是 UI 偏好，而是跨宿主的命名约束。任何“中文别名”方案都必须区分三件事：搜索命中、显示替换、实际调用；三者能同时做到的方案都依赖宿主扩展点或改宿主文件，代价不同。

### 4.2 作者/社区原话：用户到底卡在哪

| 原话 | 出处 | 日期 | 性质 |
|---|---|---|---|
| “技能包装多了以后，name 和 description 全是英文，常见两个卡点：记不住……看不懂……” | [dsh-skills-cn README](https://github.com/GoForIt-2026/dsh-skills-cn/blob/main/README.md) | repo created 2026-11-15 | 作者自述（产品动机） |
| “DSH 自带 / 命令面板列出技能时，只有名字和一段英文长描述——几十个技能看下来一大坨，很难判断‘这个技能到底是干什么的、我现在该不该用’。” | [dsh-skill-pilot README](https://github.com/ITxuezhe/dsh-skill-pilot) | repo created 2026-11-09 | 作者自述（产品动机） |
| “Claude Code 的插件市场（/plugin 里的 Discover）全是英文介绍，中文用户看不懂。” | [skill-manager-cn README](https://github.com/Frank-6932/skill-manager-cn) | repo created 2026-09-12 | 作者自述（外部宿主） |
| 技能列表“全是英文”，命令工具提示也是英文；新装技能不会自动翻译，所以做显示层补丁并支持自动翻译 | [claude-code-zh-toolkit README](https://github.com/LinYiXin123/claude-code-zh-toolkit) | repo created 2026-05-04，45★ | 作者自述（外部宿主） |
| 内置 90 条中文说明，缺的提供“翻译 N 条”按钮，按默认模型翻、结果缓存 | [dsh-skill-palette README](https://github.com/AlLHHH/dsh-skill-palette) | repo created 2026-10-30 | 作者自述（需求侧证据） |
| 非 ASCII 插件技能名塌缩、调用报 Unknown skill | [Claude Code #66554](https://github.com/anthropics/claude-code/issues/66554) | 2026-06-09 | 用户 bug 报告（一手） |
| zh-CN 下 Skills 页“个人/系统”两个 tab 的 ID 冲突、无法选中 | [Codex #48439](https://github.com/openai/codex/issues/48439) | 2026-09-26 | 用户 bug 报告（一手） |
| Cline 请求简体中文界面、i18n 框架与语言切换，14 条评论仍 OPEN | [Cline #12518](https://github.com/cline/cline/issues/12518) | 2026-07-24 | 用户需求（一手） |

这些原话能支持什么：

- 支持“英文技能目录对中文用户有认知负担”这一方向；
- 支持“用户需要中文名/中文说明/中文搜索”；
- 不能支持“用户一定需要批量 AI 翻译”“一定需要团队翻译包”“一定需要虚拟滚动”。这些是产品推断，不是公开诉求。

### 4.3 相邻证据：UI 本地化需求真实，但不能直接外推

- Cursor 论坛两帖（2026-01-08、2026-06-26）说明自有设置页不随 VS Code 语言包本地化；Cline #12518（2026-07-24）说明编辑器级中文 UI 仍是开放需求；Windsurf 社区注入 workbench.html 汉化 300+ 词条（created 2026-05-06）说明官方缺位时用户会接受外挂。
- Codex #48439 / #41256 说明“已经本地化的页面仍会因 ID/术语冲突出 bug”。
- 这些证据支持“中文化是长期需求”，但不直接证明“技能目录中文层”是刚需；后者主要由 DSH 插件作者的供给和少量结构性证据支撑。

### 4.4 明确没有公开证据的项

以下项目没有找到公开的 DSH issue/discussion 或用户帖直接要求；只能从竞品实现或产品逻辑推断：

- 「团队翻译包导入/导出 UI」：没有公开需求帖；只有 codex-plugins-zh 的批量中文化流水线、dsh-plugin-translation 的术语/质检工具、以及本项目自己的 translations/validate.mjs。这是待验证假设。
- 「内置包缺口发现」：没有公开需求帖；但本机 53 条包对 48 个技能只命中 11 条，缺口客观存在。这是可由数据证明的问题，不是用户原话。
- 「虚拟滚动」：14 份竞品 README 关键词扫描 0 命中；现有实现用分页（skills-cn 25/页）或密度调整；没有用户抱怨“技能列表卡”。
- 「主题检测」：竞品普遍直接跟随 DSH 主题 token；没有“自动检测主题”的需求证据。
- 「formatTime」「12px 排版」：属于代码级微调；没有公开证据表明它们影响采用或任务完成。
- 「AI 自动归类」：没有竞品实现，也没有公开需求；现有分类都是人工/关键词/仓库规则。技术上空白，不等于值得做。
- 「中文别名直呼」：有 dsh-skill-cn、dsh-chinese-skill-patch、dsh-claude-compat 的实现，但没有找到“用户要求输入 /中文名 直接调用”的原始帖；需求是作者从“中文名被丢弃”推断出来的。

## 5. 候选池判断表

判断口径：

- 已做：至少一个可安装的竞品已经实现，且有代码/README 证据；本项目再做只能算 parity。
- 空白值得：没有竞品实现，且能利用本项目独有数据/工作流；有明确产品假设，但需求强度需验证。
- 无差异：做了也不会改变用户选择，或与现有能力重复，或没有公开需求。

| # | 候选 | 判断 | 关键证据 | 0.4.0 取向 |
|---|---|---|---|---|
| 1 | 批量 AI 翻译 | 已做 | dsh-skill-palette 缺的按默认模型翻并缓存；dsh-zh-layer 一键全量 + 增量缓存；dsh-skill-cockpit MyMemory/Google；codex-plugins-zh 全量流水线；本项目 README 仍写“一次只能一个技能” | 只做 parity。若做，必须带人工审校状态、成本上限、只翻未翻译项、失败可回滚；不要作为 headline |
| 2 | 技能体检 | 已做 | dsh-skill-doctor SD 规则 + 病历 + 复诊 + 安装门禁；dsh-skill-cockpit 四类“加载但选不中”检查；dsh-360 评分 | 不做。若要做，应叫“中文层质量审计”，与“技能为何不被模型选中”区分 |
| 3 | 使用统计排序 | 已做 | dsh-skill-scoreboard 两种计数口径 + JSON 导入导出；cockpit usage.json；doctor 跨会话统计；skills-cn 使用次数列 | 不做。现有“最近使用置顶”已覆盖排序的主场景；统计榜是另一个产品 |
| 4 | AI 自动归类 | 无差异（暂缓） | 14 份 README 关键词扫描 0 命中；现有分类是人工/关键词/仓库规则；没有公开需求 | 不做。技术上空白，但会削弱精选分类的可控性，且无法证明提升选择效率 |
| 5 | 收藏分组 | 已做 | palette 收藏 + 收藏页按使用置顶；@cccuuuhhh/dsh-skill-groups 具名分组 + 勾选切换 + 拖拽；dsh-plugin-namecards 文件夹；skills-cn 来源分组 | 不做。分组是通用管理器的标配，不是差异化 |
| 6 | 关联推荐 | 已做 | dsh-skill-pilot 草稿停顿 260ms 推荐最多 3 个；dsh-skill-triage 强制逐候选登记使用/弃用；palette 关键词桶 | 不做。推荐质量依赖场景数据，本项目没有明显优势 |
| 7 | 内置包缺口发现 | 空白值得 | 没有竞品有“人工审校的内置精选包”，因此没人能做“已装技能 vs 内置包”的缺口报告；本项目 README 承认 53 条包有覆盖缺口；本机实测 53 条 / 48 技能 / 命中 11，磁盘有包里没有 45、包里有磁盘没有 42 | P0：做“缺口/失效/漂移/未审核”四类报告 + 一键加入待译清单 + 导出缺口清单；把已知限制变成入口 |
| 8 | 团队翻译包 UI | 空白值得 | 没有竞品提供“翻译包导入/导出 + 校验 + 冲突解决”UI；codex-plugins-zh 证明中文元数据可分发包且需无损校验；dsh-plugin-translation 只有术语/质检工具；本项目已有 translations/validate.mjs 与审计规则 | P1：先做轻量 JSON 包（schema/version/checksum/reviewStatus），导入时 dry-run diff + 冲突策略（项目层 > 用户层，新于旧），不做服务器/实时协作 |
| 9 | 双语模式 | 已做 | dsh-zh-layer zh/both/off；dsh-skills-cn 中文名 + 英文 name + 中文说明；namecards 原名 + 中文显示名；本项目“兼容叠加”是两组而非双语行 | 只做 parity。若做，优先“同一行中英并排”，但不要把它当差异点 |
| 10 | 中文别名直呼 | 已做 | dsh-skill-cn 第二 / 源 + label；dsh-chinese-skill-patch 改 Unicode 正则；dsh-claude-compat skillAliases；外部 claude-code-zh-toolkit 显示层补丁 | 只做 parity。本项目的精选别名数据可提升命中率，但机制已被验证，不是空白；直接调用还受 TEXT_REF_RE 限制 |
| 11 | 菜单内行内翻译 | 已做 | dsh-zh-layer MutationObserver 重写菜单项；dsh-cn-menu-kit 菜单中文标题 + 悬浮详情；本项目菜单装饰已做；claude-code-zh-toolkit 在外部宿主做同类事 | 不做。这已经是本项目核心能力，不是 0.4.0 新方向 |
| 12 | 虚拟滚动 | 无差异 | 14 份 README 关键词 0 命中；skills-cn 用分页 25；没有用户抱怨列表卡 | 不做。技能规模通常几十到几百，分页/密度足够；收益低、测试成本高 |
| 13 | 批量操作 | 已做 | skills-cn 批量删除 + 回收站；cockpit 分组/批量启停；skills-manager 批量添加 + 分类级启停；doctor 批量改写工单 | 不做。若做，只做“批量加入待译/批量审核”，服务于 0.4.0 的翻译工作流，不单独成功能 |
| 14 | 搜索增强 | 已做 | picker 中文/拼音/英文 + 模糊 + 接管官方触发源；catalog 拼音 + 模糊；pilot 中英混合；palette 中文说明；官方市场跨语言搜索 | 不做。拼音/模糊已是标配；本项目已有中文名/别名/全拼/首字母 |
| 15 | 键盘导航 | 已做 | picker ↑↓ + Enter；catalog 键盘行操作；skills-cn ↑↓/Enter；cockpit 键盘行操作 | 不做。属于基础可用性，不是差异化 |
| 16 | 主题检测 | 无差异 | 竞品普遍跟随 DSH 主题 token；cn-menu-kit 自适配深浅色；没有“自动检测主题”需求 | 不做。跟随主题即可；额外检测只增加状态复杂度 |
| 17 | formatTime | 无差异 | 14 份 README 0 命中；属于微文案/局部格式 | 不做。没有用户价值证据 |
| 18 | 12px 排版 | 无差异 | zh-layer 的 both 模式英文 span 硬编码 12px；纯视觉微调，且可能损害可读性/对比度 | 不做。若为信息密度，应先做可读性测试，而不是固定 12px |
| 19 | 诊断包 | 空白值得（低优先） | 没有竞品导出“技能/插件/覆盖/审计/扫描错误/主题/版本”一体化诊断包；doctor 有病历/复诊但不导出；dsh-plugin-update 有“诊断一键复制”；本项目已有 diagnostics.json | P2：导出脱敏 JSON/Markdown，含版本、技能根、覆盖率、审计 P1/P2、扫描错误、菜单模式、主题；用于 issue/支持，不做遥测上传 |

计数：已做 11 项（1、2、3、5、6、9、10、11、13、14、15）；空白值得 3 项（7、8、19）；无差异 5 项（4、12、16、17、18）。

## 6. 对 0.4.0 的建议

### 6.1 优先级

| 优先级 | 方向 | 用户得到的 | 为什么是我们 | 成本/风险 | 验收标准 |
|---|---|---|---|---|---|
| P0 | 内置包缺口发现 | 打开管理页就能看到“本机已装但内置包没有”的技能、内置包有但本机没有的条目、原文简介变过的“过期”条目、有中文但未审核的条目；可一键加入待译清单/导出 | 只有我们维护 53 条人工精选包；竞品没有这个数据资产，无法复制同样入口 | 中低；缺口可能很大，需要分页/筛选/按使用频率排序 | 本机样本能从 11/48 命中算出 45 个缺口；报告可导出；缺口项可一键进入翻译/审核流程；不修改 SKILL.md |
| P1 | 团队翻译包导入/导出 + 校验 | 把一个项目的 zh-index.json 导出为带版本/校验和的包，交给同事导入；导入前看到 diff、冲突和无效项 | 没有竞品做“技能中文翻译包”的 UI；codex-plugins-zh 证明分发需求，本项目已有 validate.mjs/审计规则 | 中高；冲突策略、版本兼容、隐私（技能名/描述可能含内部信息） | 导出包含 schema/version/checksum/reviewStatus；导入 dry-run 列出新增/冲突/无效；项目层覆盖用户层；校验失败不改数据 |
| P2 | 诊断包 | 一键复制/下载脱敏诊断，附到 issue；包含版本、技能根、扫描错误、覆盖率、审计结果、主题/菜单模式 | 没有竞品做技能层诊断包；本项目已有 diagnostics.json、审计与覆盖率数据 | 低；主要是脱敏与格式 | 不包含绝对路径/用户名/密钥；P1/P2 审计计数准确；可复现同一份报告 |

### 6.2 只做 parity、不做 headline 的项

- 批量 AI 翻译：竞品已做透，且我们的“人工审校”价值不在“翻得快”，而在“翻得可审核”。如果 0.4.0 要做，必须和“缺口发现/审核状态”绑在一起：只翻缺口项、只翻未审核项、结果进草稿、可回滚。
- 双语模式：zh-layer 已经做了 zh/both/off；本项目“兼容叠加”是两组，不是同一行双语。若用户反馈强烈，再做“同一行中英并排”；否则不做。
- 中文别名直呼：dsh-skill-cn 已经验证“第二 / 源 + label”可行；本项目已有别名搜索，直接调用还受输入框 ASCII 正则限制。除非用户明确要求“输入 /中文名 直接调用”，否则不做。
- 批量操作：只做“批量加入待译/批量审核”，服务于翻译工作流；不做批量启停/删除，避免和通用管理器正面竞争。

### 6.3 明确不建议做

- 技能体检 / 使用统计榜 / 收藏分组 / 关联推荐 / 键盘导航 / 搜索增强：已有成熟竞品，做了只是补齐，无法改变用户选择。
- 虚拟滚动 / 主题检测 / formatTime / 12px 排版：没有公开需求，收益低，测试成本高；12px 还可能损害可读性。
- AI 自动归类：技术上空白，但会削弱“人工精选分类”的可控性，且没有需求证据；最多做“建议分类”，不做自动写入。
- 改 SKILL.md / 改宿主正则 / 注入官方构建产物：违背项目硬约束，升级即碎，不可审计。

### 6.4 与“通用管理器”的竞争策略

本项目的周下载 1,387，低于 @michengai/dsh-skills-manager 34,819 与 @linxin666/dsh-client-ui-skill-explorer 29,551 一个数量级。不要在“装/停/删/多视图/市场发现”上硬碰；应该把本项目定位成：

> 中文技能数据层：为任何技能管理器/菜单提供可审校、可覆盖、可导出的中文名/简介/分类数据；管理页是数据的编辑器，不是另一个全能管理器。

这一定位能解释为什么 0.4.0 应做“缺口/翻译包/诊断”，而不是“再加一个技能列表页”。

## 7. 未决问题

1. 团队翻译包是不是真需求？目前只有 codex-plugins-zh 的分发先例和本项目 validate.mjs，没有公开用户帖。需要 5–10 个团队访谈，或先做“导出”不做“导入”，看是否有人主动分享包。
2. 内置包缺口功能会不会把“缺口”变成压力？本机 45 个缺口是环境样本，不代表普遍；如果缺口太大，用户可能直接放弃。需要按“已安装/常用/来源”排序，并允许隐藏不关心的技能。
3. DSH 上游会不会内建技能显示名？当前 SkillSummary 没有 displayName，但官方市场已支持 LocalizedText。如果未来 SkillSummary 增加本地化字段，本项目的显示层价值会下降；需要跟踪 skills.zh.md 与 client-modules 文档的变更。
4. 菜单装饰的兼容性风险有多大？dsh-cn-menu-kit 明确说菜单行由官方 React 组件渲染，靠渲染后恢复，官方大版本改 DOM 可能失效；本项目“装饰式”也需要版本矩阵测试。0.4.0 前应补一组 DSH 版本兼容测试，而不是假设稳定。
5. 人工审校的价值能否被证明？目前没有公开 benchmark 证明“人工审校的中文名/简介”比“AI 直译”带来更高的任务完成率或更短选择时间。需要定义指标（选择时间、误选率、翻译采纳率），否则“精选包”只是信仰。
6. 翻译包的隐私边界。技能名/描述可能包含内部项目名、客户名、未公开工具名；导出/导入/发送给模型都需要脱敏策略。团队包尤其需要“哪些字段可导出”的开关。
7. 中文别名直呼要不要做？机制可行（第二 / 源），但与官方 TEXT_REF_RE、菜单排序、重复源冲突；如果做，必须限定“只影响搜索/插入，不改调用 token”，并接受与 dsh-skill-cn 同类插件的冲突。
8. 市场索引的 title 本地化何时能被官方 catalog 消费？官方文档支持 LocalizedText，但当前 6,245 条 title 全是字符串。若未来 catalog 支持本地化标题，本项目可把自己的市场条目做得更好；这不是 0.4.0 的核心，但值得跟踪。

## 8. 附录：数据与复现口径

### 8.1 关键数据快照

| 数据 | 值 | 口径 |
|---|---|---|
| 官方 catalog 插件数 | 6,245 | dsh-plugin-catalog/index.json，2026-11-19 |
| 有中文 description | 6,245 / 6,245 | 同上；空值与 en==zh 均为 0 |
| 有本地化 title | 0 / 6,245 | 同上；title 全为字符串 |
| 分类数 | 23 | 同上；全部有 en/zh |
| 本项目内置包 | 53 条 | translations/zh-CN.builtin.json |
| 本机技能 | 48 个 SKILL.md / 48 个 frontmatter name | node translations/validate.mjs，2026-11-19 |
| 本机命中 | 11 / 48 | 同上 |
| 磁盘有、包里没有 | 45 | 同上 |
| 包里有、磁盘没有 | 42 | 同上 |

本机样本受已安装技能影响，只用于证明“缺口机制存在”，不代表所有用户。全量缺口应以用户实际扫描结果为准。

### 8.2 竞品数据来源

- 版本/仓库/star：GitHub API 与 npm registry，2026-11-19；部分仓库因 API 限流未取到创建时间，正文用 npm 版本与 README 日期替代。
- 周下载：npm downloads API 的 last-week 区间，2026-11-12 至 2026-11-18。
- 功能：竞品 README/CHANGELOG 作者自述；dsh-cn-menu-kit 的标题来源、dsh-zh-layer 的 DOM 重写、dsh-skill-cn 的第二 / 源经过包源码抽查。
- 官方市场：cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json；官方格式见 plugin-market.zh.md。

### 8.3 未采用的证据

- CSDN/博客类“Skills 放中文文件夹导致扫描不到”的文章：与官方 kebab-case 约束一致，但属二手，未作为主证据；主证据用 DSH 官方文档与 dsh-claude-compat CHANGELOG。
- 竞品 README 的对比表：存在自述偏差（如 dsh-skills-cn 对 picker 的描述与事实不符），未直接采信。
- 社区汉化 fork 的 star 数：只作需求旁证，不作采用率结论。

---

一句话结论：中文显示层已被做透，0.4.0 的机会不在“再做一个中文菜单”，而在把本项目独有的精选包 + 审校 + 覆盖率/审计 + 项目层覆盖变成三个可操作的工作流：缺口发现、团队翻译包、诊断包。
