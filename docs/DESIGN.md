# DSH 技能中文中间层插件 · 设计方案（头脑风暴稿 v1）

> 目标插件：`dsh-skill-workbench`（中文名：**技能中文化**）
> 基于 DSH 0.2.2-rc.1 desktop profile 的源码级调研；4 份研究报告见 `_dsh_design/research/`：
> [skill-pipeline.md](research/skill-pipeline.md)（技能展示链路）、[plugin-api.md](research/plugin-api.md)（插件开发面）、
> [prior-art.md](research/prior-art.md)（先例与可复用资产）、[product-design.md](research/product-design.md)（产品与交互草案）。
> 调研方式：拆包桌面端 `app.asar` 提取 `@deepseek-ai/*` 编译源码 + 全量 Host API 目录（`dsh-tool-cordis/lib/types/api-catalog.js`，10258 行）+ 已装插件源码，结论均带 文件:行号 证据。

---

## 0. 一句话方案

> **不碰技能文件，也不伪造中文调用名**：在「技能目录 → `/` 菜单 / 管理页」之间加一层**旁路中文语义索引**（中文名、中文介绍、中文分类、拼音别名、适用/不适用），
> `/` 菜单按中文分类分组显示中文名+中文介绍，管理页按同一口径浏览/编辑/详情，而**调用 token 永远是英文 `/english-name`**——模型、宿主、技能中心、技能卡片行为零变化。

---

## 1. 痛点与目标（把"想法"拆成可验收能力）

用户原话（m00001）：技能用 `/` 时都是英文、介绍看着不方便、列表乱七八糟；想要插件能管理，并加一个"中间层"，让 `/` 调取时显示**有分类的中文技能名和中文介绍**；管理界面和技能详情也按中间层的中文分类/中文名称/中文介绍展示。

拆成 4 个能力域：

| # | 能力 | 验收口径（简版） |
|---|------|------------------|
| G1 | `/` 菜单中文化 | 按中文分类分组，行=中文名+中文介绍+/english-name；中/英/拼音可搜；选中插入英文 token |
| G2 | 中间层（数据层） | 独立 JSON/T S 存储，字段级三层合并；技能原文变更自动标过期；绝不写回 SKILL.md；卸载无损 |
| G3 | 管理界面 | 侧栏新页：技能列表（分类/来源/翻译状态筛选、覆盖率）、详情编辑、批量翻译、导入导出、设置 |
| G4 | 技能详情中文化 | 中文名/别名/简介/详细说明/适用/不适用/分类/标签/关键词/调用示例 + 原文对照、差异高亮 |

**明确不做（MVP）**：翻译整个 SKILL.md 正文、改技能启停/删除/新建（交给已装的 skill-explorer）、中文调用 token、改模型侧英文技能目录（默认）、重写技能扫描器。

---

## 2. 调研结论：DSH 里的真实链路（决定方案的关键约束）

### 2.1 数据流（源码实证）

```
SKILL.md frontmatter
  → dsh-skill-filesystem provider（rank：项目 .dsh/skills 100 < 项目 .agents/skills 200 < custom 300
                                    < $DSH_HOME/skills 400 < ~/.agents/skills 500 < bundled 600）
  → ctx.skills（SkillRegistry，global layer + preset scope，近层同名覆盖）
  ├─→ RPC sessionSkillCatalog.list → 浏览器 ctx.remote.skills
  │     → 内置 skill source（trigger "/", name "skill", order 2）candidates 映射
  │     → `/` 菜单渲染 → 选中插入字面文本 `/english-name `
  │     → 宿主 dsh-tool-skill 识别 `/name` 手势 → 取正文注入 <skill_content>
  └─→ dsh-tool-skill（agent/pre-step）生成 <available_skills>（name + 截断 description ≤500 字符）→ 模型目录
```

关键证据（均在 `<WORKSPACE>\_dsh_recon\src\dsh\node_modules\@deepseek-ai\` 下）：

- 内置 `/` source 的候选映射（`dsh-client-ui-skill/lib/client.js:491-503`）：
  `rankByName(skills, query).map(skill => ({ name: skill.name, description: skill.modelInvocable ? skill.description : `${t("menu.userOnly")} · ${skill.description}` }))` —— **只给 name+description，没有 label**。
- 选中回填（同文件 `:540-542`）：`return { text: \`/${candidate.name} \` }` —— **token 由 candidate.name 决定，天然是英文**。
- `/` 菜单行渲染契约（`dsh-client-ui-input-trigger/lib/client.js:1806-1825`）：`item.label ?? item.name` 作标题；label 与 name 非仅大小写差异时，标题后追加英文 name 别名；右侧渲染 `description`；item 支持 `icon`、`drill`；**item.section 变化处渲染小节标题（:1788-1791）**。→ 中文标题、分类分组"完全在既有契约内"，不是私有 hack（`dsh-client-ui-commands` 自用 label/section：`:1246,1271,1293,1297,1500`）。
- `/` 菜单组标题（`:1764-1768`）= `t(source.name)`；`showGroupTitle:false` 或组内存在 section 时不渲染组标题 → 自建 source 可用中文组标题。
- 第三方 source 注册（`:1556-1571`）：同 `(trigger,name)` 重复抛错，只增/只能撤销自己，**无删除他人 source 的 API**；多 source 同 trigger 按 `order` 并列成组（`:1594`、`seedGroups :831-842`）。
- 宿主 `skills/list` = `sessionSkillCatalog.list` = `ctx.skills.list(...)` 过滤 user-invocable 后映射（`dsh-api-session-controller/lib/index.js:3112-3119`），响应只含 `name/description/modelInvocable/path?/whenToUse?`（SkillEntry）。
- 插件 UI 官方座位：`sidebar.panellist`（list slot，侧栏行）+ `main`（keyed slot，中央页），`ctx.layout.selectPanel(key)` 切页；root 页面 props 自带 `useSessions/usePanelInfo/t/actions`（`dsh-client-ui-sidebar/README.md:42`、`dsh-client-ui-layout/README.md:36,63`）。
- 插件服务端能力：`ctx.webServer.register({kind,path,handler})` 路由（loopback 围栏须自做）、`$DSH_HOME/<plugin>/index.json` 原子写、`ctx.llm.stream(...)`、可选 `ctx.translator`（bing 匿名/付费 provider）。
- 版本耦合：DSH 仍 0.2.2-rc.1；`live.sources`、候选渲染契约属于**未文档化的内部约定**（渲染契约稳定，但需回归测试）。

### 2.2 十条硬约束（设计必须遵守）

| # | 约束 | 对设计的影响 |
|---|------|--------------|
| C1 | 技能 `name` 被硬校验为 kebab-case（`dsh-skill/lib/index.js:17`；`dsh-skill-filesystem/lib/index.js:699 isSkillName`） | 中文名**只能做展示 label**，不能作调用 token；不伪造中文 name |
| C2 | `skills/list` 响应无 label/i18n 字段 | 中文显示名只能由客户端/装饰层附加 |
| C3 | 菜单行支持 label/section/description/icon/drill | 中文化在主路径可行，且 UI 是官方能力 |
| C4 | 内置 source 候选只有 name+description，onPick 用 candidate.name | 要在菜单显示中文名，必须"装饰候选行"或"另注册 source" |
| C5 | 无法运行期删除内置英文组；只能增/撤自己的 source | 单组纯中文的代价 = 装饰内置 source（C 方案）或 patch 停用内置（B 方案） |
| C6 | bundle patch 可按 id 覆盖/禁用内置插件行（`dsh-web-app/cordis.patch.yml:382-383,484-525`） | B 方案技术上存在，但停用 ui-skill 会失去 4 件事：`/` source、调用卡片、"查看"预览、用户 `/name` 引用 chip，都要重实现 |
| C7 | 调用卡片标题取 tool args 英文名；`/name` chip 正则为 ASCII（`ui-skill client.js:275-309`） | 卡片/chip 无法显示中文（设计上接受，文档说明） |
| C8 | 模型目录与 UI 同读 `ctx.skills`（`dsh-tool-skill/lib/index.js:972-980`） | 若用 provider 影子把 description 改中文，会污染模型上下文 → 默认不做，P2 开关 |
| C9 | 插件可用 HTTP 路由 + JSON 存储 + LLM/translator | 翻译与管理页可行，无需外部服务 |
| C10 | 无技能目录实时刷新事件（磁盘/插件改动需重组合或重开会话） | 过期检测必须靠原文 hash/mtime + 手动"刷新"按钮 |

### 2.3 社区先例（说明可行性与差异化）

- **dsh-plugin-labels**（npm 0.10.4，MIT）：已证明"给技能补中文描述 + 改 `/` 菜单显示"可行（包装 skills 服务、`$DSH_HOME/plugin-labels-skills.json` 缓存、启动 4s + 每 5 分钟自动补），但**无中文短名、无分类、无管理 UI**。
- **dsh-skill-groups**（1.0.0）：在输入框左侧加 🧩 面板（`conversation.input.left`），7 类分组；中文三级兜底（SKILL.md 中文 description → 内置中文表 → 正文摘要）。
- **dsh-skill-catalog / dsh-skill-manager / dsh-capability-inventory / dsh-skill-mcp-panel**：发现、开关、总览类；无人做"**中文名 + 可编辑分类 + 详情管理 + `/` 菜单一致**"。
- **dsh-chinese-skill-patch**：直接正则改磁盘 lib，DSH 升级即失效 —— 反面教材，不做。
- 差异化定位：**唯一同时满足"中文名（非仅描述）+ 分类分组 + 管理/详情 + 零侵入 + 可共享翻译包"的插件**。

---

## 3. 设计空间：`/` 菜单三种接入策略（头脑风暴核心）

| 方案 | 做法 | 优点 | 缺点 / 风险 | 结论 |
|------|------|------|--------------|------|
| **A 叠加式** | 自己注册第二个 `/` source（中文名 label、中文 description、section 分类、onPick 仍插 `/english-name`） | 零侵入、只增不改、实现最简单（~150 行）、失败不影响内置菜单 | 菜单出现两组（"技能(英文)" + "技能中文"），英文杂乱仍在眼前 | **兼容/兜底模式** |
| **B 接管式** | 插件 bundle patch `- id: ui-skill disabled: true`，自己重实现 source + 调用卡片 + `/name` chip + 预览 | 菜单 100% 中文单组、可定制最强 | 要复刻 4 个 UI 面；DSH 升级易崩；漏一个面即功能缺失；实测成本高 | 远期可选，**不推荐 MVP** |
| **C 扩展式（推荐）** | 纯客户端运行期"装饰"内置 source：从 `ctx.inputTriggers.live.sources` 找到 `('/','skill')`，包装其 `candidates`——原函数 query 传空取全量行，再按中文索引映射 label/section/description + 排序/过滤；`onPick/lexicon/openReference` 原样保留 | **单组纯中文**、调用 token 英文、宿主零改动、无需 patch；与官方渲染契约完全兼容 | 依赖未文档化 `live.sources`；source 每次重注册会失效 → 需惰性重包装；原 source 中文 query 会过滤成空 → 包装层自行处理 | **MVP 主模式** |

### 3.1 C 方案实现要点（可行性已验证到行号）

1. `inject: ["inputTriggers","remote","remote.skills","sessions","locale","slots","layout"]`；服务名 `ctx.inputTriggers`（`dsh-client-ui-input-trigger/lib/client.js:1534-1548`）。
2. `live = { sources: [...] }` 是公开类字段（`:1536-1539`），内置 skill source 注册后常在；若加载顺序在后，用 `ctx.on("connection/reset")` / 定时重试做 **惰性 ensureWrapped**。
3. 包装：
   ```js
   const orig = source.candidates.bind(source);
   source.candidates = async (sess, opts = {}) => {
     const rows = await orig(sess, { ...opts, query: "" }); // 全量英文行（保留 modelInvocable 前缀等语义）
     return decorate(rows, zhIndex, opts.query, recent);   // 映射 label/section/description + 中/英/拼音过滤 + 排序
   };
   ```
   注意：菜单组标题由 `t(source.name)` 决定（"技能"），单组内用 `section` 分组即可，无需新建 source。
4. 失败/异常时 `try/catch` 回退 `orig` 英文逻辑；设置里提供"模式"切换（扩展式 / 兼容叠加式 / 关闭）。
5. 实测清单（见 §14）：`live.sources` 可写、候选无二次过滤、中文 query 不抛错、source 重注册重包装、`-id ui-skill disabled` 行为（仅 B 方案需要）。

### 3.2 为什么不做"provider 影子"（把 description 改中文）

`ctx.skills.registerProvider(rank:90)` 能让 `/` 菜单描述 + 模型目录同时变中文，看似"一处翻译三处生效"；但 **SkillSummary 无 label，标题仍是英文**，且机翻会直接进模型上下文（影响模型判断，且非纯 UI）。因此：默认关闭；作为 P2「模型侧也中文化」开关，必须 hash/mtime 校验 + 一键停用。

### 3.3 详情中文化会怎么呈现

- 管理页详情 = 中文详情主阵地（G4 主要验收点）；
- `/` 菜单点击仍打开原始 SKILL.md（`openReference` 行为不动，保持"所见即原文"）；
- P1 可选：生成"中文详情预览 markdown"缓存文件，用 `ctx.sidebarRight.openResource` 在右侧栏打开（`dsh-resource://file/session/<sid>/<path>` 地址格式，`ui-skill client.js:12-66,521-539` 可照抄；路径约束待实测）。

---

## 4. 总体架构

```
┌────────────────────────────── 浏览器（web client bundle，手写 ModuleLoader / 或 tsdown）─────────────────────────────┐
│  / 菜单装饰器（C 方案）       管理页（sidebar.panellist + main slot）        插件 UI locale（自有 NS）              │
│  - ensureWrapped 内置 source   - 技能库列表 / 详情编辑 / 批量翻译向导         - 中文/英文界面文案                     │
│  - 中文 label/section/desc     - 导入导出 / 设置                              - 分类图标色板（可选）                │
│  - 中文/英文/拼音搜索排序      - 覆盖率统计 / 过期提示                                                               │
│  - 最近使用置顶                                                                                                       │
└───────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────┘
                                            │ 相对路径 fetch `api/dsh-skill-workbench/*`（loopback）
┌───────────────────────────────────────────┴────────────────── 宿主（cordis 插件，lib/index.js）──────────────────────┐
│  数据采集（只读）：ctx.skills.snapshot({cwd}) + 读 SKILL.md frontmatter/hash/mtime                                    │
│  中间层 Store：$DSH_HOME/dsh-skill-workbench/index.json（用户级，原子写） + <project>/.dsh/skill-cn/zh-index.json（P1）     │
│  翻译任务：ctx.llm.stream({provider:'deepseek-account', model:'deepseek-flash', reasoningEffort:'off'})              │
│            + 串行/并发 2 + 60s 超时 + 重试退避 + job 进度；可选 ctx.translator(bing) 离线快翻                          │
│  HTTP：GET list/status/health、POST translate/retranslate/config/import、GET export                                   │
│  可选 P2：rank:90 译文 provider（默认 disabled，开启后模型 catalog 也中文）                                           │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**技术栈决策（与 plugin-api 研究一致）**

- 免构建优先：`package.json`（`type:module`，`main: lib/index.js`，`exports` 含 `.`、`./client`、`./locale/*.json`、`dsh` 字段）+ `cordis.patch.yml`（`- insert: [{id: skill-i18n, name: dsh-skill-workbench}]`）+ `lib/index.js` + `lib/client.js`（手写 `window.__ModuleLoader__.load`，只 require `react`/@jsx-runtime）；页面上 TS/JSX 后改 tsdown 产物。
- 客户端 `apply` 全部注册包 `try/catch`（官方注释：插件 apply 抛错会导致整个 web shell boot 白屏）。
- 数据/契约一律走 `ctx` 服务，第三方插件运行时禁止 `import @deepseek-ai/*`。

**目录树（建议）**

```
dsh-skill-workbench/
├─ package.json            # name/version/exports/dsh 字段/peerDeps
├─ cordis.patch.yml        # - insert: [{id: skill-i18n, name: dsh-skill-workbench}]
├─ locale/{zh,en}.json     # 仅插件 meta.title/description
├─ lib/
│  ├─ index.js             # 宿主：Store/采集/HTTP/翻译 job/（P2 provider）
│  ├─ client.js            # 浏览器：菜单装饰器 + 管理页注册（ModuleLoader）
│  ├─ store.js             # 合并/原子写/hash 过期/迁移
│  ├─ translate.js         # LLM 提示词、并发、重试、进度
│  ├─ menu-decorator.js    # C 方案 source 包装 + 搜索排序
│  └─ ui/                  # 页面组件（若上 tsdown 则为 src/）
├─ translations/zh-CN.builtin.json   # 可选内置初始包
└─ README.zh.md
```

**HTTPS API 草案**

| 方法/路径 | 作用 |
|-----------|------|
| `GET api/dsh-skill-workbench/list?cwd=` | 全量技能 + 中文条目 + 状态（fresh/stale/missing/untranslated）+ 覆盖率 |
| `GET api/dsh-skill-workbench/status` | 翻译任务进度、store 版本、数据路径 |
| `POST api/dsh-skill-workbench/translate` | `{scope:"untranslated"|"stale"|"selected", names?, cwd?}` 启动批量翻译 job |
| `POST api/dsh-skill-workbench/retranslate` | 单条重译 `{name, cwd?}` |
| `POST api/dsh-skill-workbench/save` | 保存单条中文编辑（含 review 状态） |
| `POST api/dsh-skill-workbench/import` / `GET .../export` | 翻译包导入预览/应用、导出 JSON |
| `POST api/dsh-skill-workbench/config` | `{mode:"decorate"|"overlay"|"off", enabled, targetLang, pinyinSearch, ...}` |
| `GET api/dsh-skill-workbench/health` | 自检 |

> 所有 handler：先 loopback 围栏（`remoteAddress`/Host、`sec-fetch-site`、Origin；X-Forwarded-For 永不作为证据），再比 method，再校验 cwd realpath 包含关系（Host 进程 node:fs 不受沙箱限制，边界自负）。

---

## 5. 中间层数据模型（定稿版）

单文件 `index.json`（schemaVersion: 1）：

```jsonc
{
  "schemaVersion": 1,
  "lang": "zh-CN",
  "updatedAt": "2026-11-12T16:00:00+08:00",
  "settings": { "mode": "decorate", "enabled": true, "pinyinSearch": true },
  "categories": [ { "id": "project", "zh": "项目与需求", "order": 10, "icon": "📋" } ],
  "entries": {
    "agent-reach": {
      "dirName": "agent-reach",
      "bound": { "sourceKind": "user-agents", "sourceRank": 500, "path": "C:/Users/.../.agents/skills/agent-reach/SKILL.md" },
      "hash": { "frontmatter": "sha256:...", "body": "sha256:...", "at": "2026-11-12T15:00:00+08:00" },
      "zh": {
        "name": "全网调研",            // ≤10 字名词短语
        "alias": ["联网调研", "深度搜索"],
        "summary": "跨平台搜索与调研，汇总公开信息",  // ≤40 字
        "description": "……",           // 详细说明（多行）
        "whenToUse": "需要查资料/追热点/找真实评价时",
        "notFor": "本地文件分析、纯代码修改",
        "category": "research",         // 主分类唯一
        "tags": ["调研", "搜索"],
        "keywords": ["小红书", "推特", "B站"],
        "origin": "llm",                 // manual|llm|import|builtin|community|existing-zh
        "review": "draft"                // draft|reviewed|published
      },
      "bodyZh": null,                    // P1：正文摘要（分段）
      "updatedAt": "2026-11-12T15:00:00+08:00"
    }
  }
}
```

**规则**

- **三层合并**：`<project>/.dsh/skill-cn/zh-index.json`（最高，可随仓库提交） > `$DSH_HOME/dsh-skill-workbench/index.json`（中） > 包内 `translations/zh-CN.builtin.json`（只读，最低）。按**字段级**合并（高层非空覆盖），删除高层条目自动回落低层；管理页用徽章显示"来源：项目/用户/内置"。
- **主键** = SKILL.md frontmatter 的 `name`（= 调用 token）。`dirName` 仅作定位（实测 45 个技能里有 4 个目录名≠name，如 `image-to-code-skill→image-to-code`；不能拿目录名当主键）。
- **过期检测**：`hash.frontmatter` 覆盖 `name+description` 规范化文本，`hash.body` 覆盖正文；三态 `fresh / stale / missing`。stale 不自动覆盖，详情页给 diff + 三选一（重译 / 保留 / 忽略本次）。
- **冲突**：同名多来源技能按官方 source rank 取"胜者"，中文跟随胜者并提示来源变更；原文差异过大（hash 无交集）标 `conflict` 不自动覆盖；孤儿条目（技能已不存在）菜单隐藏、管理页可清理；两个中文名重复时菜单自动补英文小字。
- **回退**：无中文名 → 英文 name 作标题；无 summary → 英文 description 截断 80 字；无分类 → "未翻译"组末位；store 损坏/版本不兼容 → 纯英文模式（零阻塞，非侵入提示 + 自动备份 `index.v<n>.bak.json`）。

---

## 6. 中文内容从哪来（质量与更新策略）

| 渠道 | 流程 | 成本 | 适用 |
|------|------|------|------|
| 手工编辑 | 详情页逐条填 | 45 技能 × 3–5 分钟 ≈ 2–4 小时 | 精品/高频技能 |
| **批量 LLM（MVP 推荐）** | 选中范围 → 预检（条数/预估 token/耗时）→ `ctx.llm.stream` 生成 JSON → 逐条写入标 `review:"draft"` | 45 条约 1–3 分钟、一次批量调用；失败可重试 | 首次冷启动 |
| 导入翻译包 | JSON 导入 → 五类预览（新增/更新/跳过/冲突/过期）→ 应用策略 | 零 LLM 成本 | 团队共享、社区包 |
| 内置/社区包 | 随插件发布 `translations/zh-CN.builtin.json` | 零 | 开箱即用 |
| 兼容种子 | 读取 dsh-plugin-labels 缓存（`$DSH_HOME/plugin-labels-skills.json`）作冷启动种子 | 零 | 已装该插件的用户 |

**LLM 提示词约束（固化在插件里，版本化）**

- 只输出一个技能对象的 JSON（`nameDir` 原样回填、`zhName/zhSummary/zhDescription/whenToUse/notFor/category/tags/keywords`）；
- 中文名 ≤10 字名词短语、不带"技能"二字；summary ≤40 字，说清"做什么 + 何时用"；
- 分类**优先从现有类目里选**，确实没有才允许新建（新建项在管理页提示确认）；
- 专有名词保留英文（TDD、SKILL.md、Figma、React）；禁止编造技能没有的能力；
- 批量接口：每批 8–10 条，schema 校验失败自动重试一次，仍失败逐条降级；
- 过期条目单独重译，输入里带上旧中文与原文 diff，保持术语一致。

**审核策略**：LLM 结果**立即生效**，但打"未审核(LLM)"灰标；管理页可一键批量"确认"，`review=reviewed`；`origin=manual` 的条目在批量导入/重译时默认**不覆盖**。

---

## 7. 分类体系（针对这台机器的 45 个技能）

**7 个一级 / 16 个二级，主分类唯一（决定 `/` 菜单分组）；tags 只用于筛选。**

| 一级 | 二级（示例技能） |
|------|------------------|
| 📋 项目与需求（6） | 立项与需求澄清（feature-requirements-clarification、project-requirements-clarification）、路线图（project-roadmap-planning）、需求变更（feature-evolution）、项目理解（project-understanding） |
| 🛠 技术设计与开发（11） | 架构与技术方案（feature-tech-design、archpilot）、选型与工程结构（project-tech-stack、project-structure）、任务与实现（feature-task-planning、feature-implementation、project-initialization）、规范与初始化（project-dev-standards）、开发环境（diagnose-windows-sandbox-acl） |
| ✅ 质量与发布（5） | 代码审查（code-review、web-design-guidelines）、缺陷处理（bugfix-workflow、bug-hunt）、提交与发布（git-commit、release-notes） |
| 🎨 前端与视觉设计（9） | 界面设计（frontend-design、frontend-polish、high-end-visual-design、redesign-existing-projects、image-to-code）、设计规范与主题（theme-factory、brand-guidelines、humanizer?）、设计工具与组件（figma、shadcn） |
| 🖼 图像与创意生成（4） | 界面图生成（imagegen-frontend-web、imagegen-frontend-mobile）、设计稿转代码（image-to-code）、算法艺术（algorithmic-art） |
| 🔎 信息、数据与可视化（5） | 检索调研（agent-reach）、数据处理（data-analysis）、图表与图解（chart-visualization、visualization）、汇总报告（summary-report） |
| ✍️ 内容创作与写作（5） | 去 AI 味与润色（humanizer-zh、shuorenhua）、小说与角色（novel-to-video-breakdown）、视频素材（novel-to-video-breakdown）、文档处理（office*） |

> 具体 45 个技能的逐条归类在实现阶段生成（`product-design.md` 已给出草案表）；新增/未知技能默认落"未分类"虚拟组（末位折叠），**不设"其他"一级类**（避免变成垃圾桶）。
> 分类可在管理页新增/改名/排序（P1 拖拽）；分类名与图标（emoji 或色点）都存中间层，不发版即可调。

---

## 8. `/` 菜单交互设计

**默认顺序**：🔥 最近使用（≤6，置顶，跨会话）→ 7 个分类（按 order）→ 未翻译（末位、默认折叠）。菜单顶部搜索框直接输入即过滤。

**单行结构**（复用现有渲染能力）：

```
┌──────────────────────────────────────────────────────────┐
│ 🔎 搜索技能（支持中文 / 英文 / 拼音）                      │
├──────────────────────────────────────────────────────────┤
│ 最近使用                                                  │
│  🧭 全网调研            /agent-reach       跨平台搜索与调研…│
│  🛠 缺陷修复            /bug-hunt          复现问题并给最小…│
├──────────────────────────────────────────────────────────┤
│ 项目与需求                                                │
│  📋 需求澄清            /feature-requirements-clarification  从模糊想法挖…│
│  📋 项目理解            /project-understanding   接手代码库…│
├──────────────────────────────────────────────────────────┤
│ 技术设计与开发  …（同上）                                  │
├──────────────────────────────────────────────────────────┤
│ 未翻译（3）  ▸                                            │
│  📦 some-english-skill  /some-english-skill   English desc…│
└──────────────────────────────────────────────────────────┘
```

- **标题** = 中文名（label）；英文 `/name` 以等宽小字跟在后面（label 与 name 非仅大小写差异时，现有渲染器自动追加 name 别名，正好实现"中文名 + /英文名"）。
- **介绍** = 中文 summary；未翻译回退英文 description 并加灰标"未翻译"（仍可调用）。
- **中/英/拼音搜索**：一个输入框匹配 中文名 / alias / 中文简介 / keywords / 英文 name / 英文 description / 拼音全拼与首字母（`quanwangdiaoyan`、`qwd`）；排序：中文名精确 > 中文名前缀 > 中文名包含 > 别名 > 拼音 > 英文 name > 简介。
- **选中**：恒插入 `/english-name ` + 空格，行为与现状完全一致（透明、可撤销）。
- **空状态**：无中文条目时 `/` 菜单仍完整可用（英文模式 + 顶部提示"去『技能中文』页开启中文化"）。
- **中文名直呼**（P2 彩蛋）：输入 `/万能调研` 时若匹配到某技能别名，客户端在提交前改写为 `/agent-reach `（默认关闭，需用户显式开启；风险：破坏输入透明性）。

---

## 9. 管理界面（信息架构）

侧栏新增一行 **「技能中文」**（`sidebar.panellist`，order 60，图标 🀄/文），点击打开中央页（`main` slot，key 与侧栏 id 相同）。

**页面顶栏**：覆盖率条（已翻译 / 未审核 / 已过期 / 未翻译）+ 搜索框 + "刷新技能目录" + "批量翻译"主按钮。

**Tab 1 · 技能库**
- 列表：中文名 | /name | 分类 | 来源（项目/用户/内置/未翻译） | 状态徽章（最新/过期/未审核） | 更新时间 | 操作（编辑/重译/停用中文）
- 筛选：分类 / 来源 / 翻译状态 / 内容来源（manual/llm/import/builtin）；排序：分类、更新时间、名称
- 多选 → 批量重译、批量确认、批量归类、停用中文

**Tab 2 · 批量翻译向导（4 步）**
1. 选择范围（未翻译 / 已过期 / 全部 / 勾选）
2. 预检：条数、预估 token/耗时、将跳过的人工条目
3. 执行：进度条 + 当前条 + 成功/失败/可取消；失败逐条重试
4. 结果：成功率、失败清单、一键确认全部

**Tab 3 · 导入 / 导出**
- 导出：范围 + JSON（P1 支持 YAML）；含 schemaVersion/生成时间
- 导入：五类预览（新增/更新/跳过/冲突/过期）→ 应用策略（仅补缺失 / 覆盖同来源 / 全量但不覆盖人工）

**Tab 4 · 设置**
- 中文层开关；`/` 菜单模式（装饰式默认 / 兼容叠加式 / 关闭）；生效语言；默认视图；拼音搜索开关；最近使用清除；数据目录与备份；孤儿清理；（P2）模型侧描述中文化开关。

**详情页**（列表点入）：左栏原文（name、英文 description、SKILL.md 正文预览、hash、更新时间、"在技能中心打开"）；右栏中文编辑（中文名/别名/简介/详细说明/适用/不适用/分类/标签/关键词；保存 / 放弃 / 重新生成 / 停用中文）；原文变更时顶部黄条 + 并排 diff（原文 old/new ↔ 当前中文），提供"重译 / 保留 / 忽略"。

**线框（列表页示意）**：

```
技能中文                        已翻译 32/45  未审核 18  过期 3  未翻译 13   [刷新] [批量翻译]
┌──────────────────────────────────────────────────────────────────────────────┐
│ 🔎 搜索       分类: 全部 ▾  来源: 全部 ▾  状态: 全部 ▾            ☐ 全选   │
├────┬──────────────┬────────────────────┬─────────┬──────────┬───────────────┤
│ ☐  │ 全网调研     │ /agent-reach       │ 🔎 信息 │ 用户 · 最新│ 11-12 15:00  │
│ ☐  │ 需求澄清     │ /feature-requir…   │ 📋 项目 │ 用户 · 未审核│ 11-12 15:02 │
│ ☐  │ New skill…   │ /some-skill        │ 未分类  │ 未翻译    │ —            │
└────┴──────────────┴────────────────────┴─────────┴──────────┴───────────────┘
```

---

## 10. 技能详情（中文化呈现）

- **中文详情字段**：中文名 + 别名、一句话简介、详细说明、适用场景、不适用边界、分类与标签、中文关键词、调用示例（`/name`）、来源与状态（项目/用户/内置、审核状态、原文 hash 与时间）。
- **三段视图**：中文 / 对照（左中右或上下分栏）/ 原文；对照模式差异高亮；正文默认折叠，点开才加载（性能）。
- **入口**：管理页详情（主）；`/` 菜单点技能仍打开原文（不改现有语义）；P1 可选"中文预览"用右侧栏打开生成的中文 markdown（地址约束待实测）。

---

## 11. 与现有插件分工 / 共存

| 插件 | 管什么 | 与本插件关系 |
|------|--------|--------------|
| `@linxin666/dsh-client-ui-skill-explorer` | 技能启停、新建、编辑、删除、导入（管"技能文件"） | **分工**：本插件只读技能文件 + 管中文语义；详情页提供"在技能中心打开"跳转；来源 rank 与其对齐 |
| `dsh-plugin-labels`（若安装） | 中文描述（无短名/分类/UI） | 可读取其缓存做种子；两者同时开时菜单可能补前缀，设置里提示二选一或降级 |
| `dsh-skill-groups`（若安装） | 输入框左侧 🧩 面板 | 可选共存；若也注册 `/` source 会多一组，设置里可关其中一个 |
| `dsh-experimental-translator` / cot-translation | 翻译服务与思维链翻译 | 可选：作为免费离线翻译通道（bing）；默认用宿主 LLM |
| `dshmarket` / 插件市场 | 安装分发 | 发布渠道之一 |

**卸载无损**：中间层 JSON 独立于技能文件；卸载后技能与技能中心功能完全不受影响（AC-20）。

---

## 12. MVP 范围与里程碑

**v0.1（目标 1–2 周）**

| 里程碑 | 内容 | 估时 |
|--------|------|------|
| M0 技术验证（spike） | 包装内置 source 让 `/` 菜单出现中文 label/section；验证 live.sources、query 空串、source 重注册 | 0.5–1 天 |
| M1 骨架 + Store + API | 插件包/ patch / 宿主 Store 合并 / list·health 路由 / 安装链路跑通 | 2–3 天 |
| M2 `/` 菜单装饰器 | C 方案包装 + 中文/英/拼音搜索 + 排序/最近使用/未翻译回退 + 兼容模式 A | 2–3 天 |
| M3 管理页 | 侧栏行 + 主页面 + 列表 + 详情编辑 + 覆盖率 | 3–4 天 |
| M4 批量翻译 + 过期 | ctx.llm 批量 job、过期 hash 检测、diff 提示、单条重译 | 2–3 天 |
| M5 打磨/测试/发布 | AC 验证、异常回退、README、npm/发布 | 1–2 天 |

**MVP 不做**：正文全文翻译、项目级覆盖、导入包、分类拖拽管理 UI、社区市场、写回 SKILL.md、改模型侧目录、英文界面全量英译。
**P1**：导入导出包、项目级 store、分类管理 UI、批量审核、正文摘要（`bodyZh`）、菜单内"一键翻译该技能"、按项目最近使用、右侧栏中文预览。
**P2**：社区翻译包市场/评分、团队共享（随仓库）、AI 自动归类、全文正文翻译、自然语言搜索、反向英译（中文→英文用户）、模型侧描述中文化开关。

---

## 13. 验收标准（Given-When-Then 摘录）

- **AC-01** 当技能已有中文条目，`/` 菜单行显示中文名+中文简介，并按分类分组；选中后输入框插入 `/english-name ` 且技能正常加载。
- **AC-02** 当技能无中文条目，行仍显示（英文名/描述+灰"未翻译"），选中可用；全部未翻译时菜单功能不缺。
- **AC-03** 输入中文名/别名/拼音全拼/首字母/英文 name/中文简介关键词，均能命中同一技能。
- **AC-04** 管理页列表 = 宿主技能全集（含 user-only 技能），同一技能不因目录名≠name 出现两次。
- **AC-05** 批量翻译逐条落盘并带"未审核(LLM)"标；部分失败不阻塞其余、可重试、不产生半条脏数据。
- **AC-06** 技能 SKILL.md 变更后，管理页显示"已过期"徽章 + diff，不自动覆盖中文；可重译/保留/忽略。
- **AC-07** 中间层 JSON 损坏或版本不兼容时，插件降级英文模式，`/` 菜单与技能调用不受影响，并给出非阻塞提示与备份。
- **AC-08** 项目级覆盖条目删除后回落到用户级同技能中文；三层按字段合并。
- **AC-09** 设置"关闭中文层"后，`/` 菜单与技能卡片行为恢复 DSH 原生（含调用卡片），管理页仍可编辑但注明"未生效"。
- **AC-10** 导入翻译包先预览五类结果再应用；"不覆盖人工条目"策略生效。
- **AC-11** 卸载插件后，技能、技能中心、`/` 调用行为与安装前一致（无损）。
- **AC-12** 客户端 `apply` 任意注册失败不导致 GUI 白屏（每步 try/catch，错误进日志）。

---

## 14. 风险与待实测清单

| 风险 | 级别 | 对策 |
|------|------|------|
| C 方案依赖 `live.sources` 未文档化字段 | 中 | 惰性 ensureWrapped + 全链路 try/catch 回退英文；兼容模式 A 兜底；spike 先行 |
| DSH 升级破坏菜单渲染契约/服务名 | 中 | 契约回归测试（npm 版本锁定 peer `>=0.2.2-rc.1 <0.3`）；发布说明标注 |
| 客户端 apply 抛错 → GUI 白屏 | 高 | 所有注册 try/catch；不假设 slot 存在；CI 冒烟 |
| LLM 无重试/限流，付费凭据缺失 | 中 | 自建 60s 超时+退避+并发 2+失败重试；凭据缺失降级"仅手工/导入"并提示 |
| 机翻质量影响判断 | 中 | 显示"未审核(LLM)"；人工确认；详情形审阅；不默认进模型目录 |
| 旧会话不刷新技能目录 | 低 | 管理页"刷新"按钮 + 重开会话提示；hash 检测兜底 |
| Host 无沙箱，写越界/被网页跨站调用 | 中 | 路由 loopback 围栏 + cwd realpath 包含校验 + 只读写技能目录与插件数据目录 |
| 与 skill-explorer 同时对技能文件操作 | 低 | 本插件只读技能文件；写操作只碰自己的 store |

**待实测（spike 清单，半天内可完成）**
1. 第三方 client 插件 `inject ["remote","remote.skills"]` 后能否直接 `ctx.remote.skills.list`；
2. `ctx.inputTriggers.live.sources` 可读写、包装 `candidates` 后菜单立即生效（含中文 label/section）；
3. 原 `candidates` 传 `query:""` 返回全量；中文 query 不会抛错；
4. source 重注册/连接重置后包装是否失效（验证 ensureWrapped）；
5. `- id: ui-skill disabled: true` 的实际行为（只有 B 方案需要，用于决策是否保留远期选项）；
6. `sidebarRight.openResource` 能否打开插件生成的中文预览文件（P1 详情用）。

---

## 15. 命名 / 打包 / 安装 / 发布

- **包名**：`dsh-skill-workbench`（无 scope，避免 npm 组织限制）；中文名：**技能中文化**。
- **安装（本地开发）**：
  ```powershell
  $dsh = "<DSH_INSTALL>\resources\runtime\cli\bin\dsh.cmd"
  & $dsh plugin --profile desktop add link:<path-to-this-repo>
  # 手动在 <USER_HOME>\.dsh\profiles\desktop\package.json 的 dsh.profile.bundles 末尾追加 "dsh-skill-workbench"
  # 重启桌面 App；改 lib/*.js 触发一次重组合热替换，改 package.json 的 dsh 字段需重启
  ```
- **发布**：npm（`dsh.skill-i18n` 无 scope 直接 `npm publish`）→ dsh-profiles 市场/`dshmarket` 收录 → `awesome-dsh-plugin` PR / `dsh-plugins.tech/submit` 目录站 → README 中文（附 GIF：`/` 菜单从英文变中文）。

---

## 16. 决策记录（ADR 摘要）

| ID | 决策 | 理由 |
|----|------|------|
| ADR-1 | 中间层旁路存储，**绝不写 SKILL.md** | 零侵入、覆盖内置技能、升级不冲突、卸载无损 |
| ADR-2 | 中文名仅作展示 label，**调用 token 恒英文** | name 被 kebab-case 硬校验；中文名会破坏模型识别、卡片、chip、技能中心 |
| ADR-3 | `/` 菜单默认**扩展式（C）**，兼容叠加式（A）兜底，不接管（B） | 单组纯中文 + 零宿主改动；B 需重实现 4 个 UI 面、升级易崩 |
| ADR-4 | 模型侧目录**默认不动**；P2 提供开关 | provider 影子会让机翻进模型上下文，非纯 UI |
| ADR-5 | 数据三层合并（项目 > 用户 > 内置），字段级覆盖 | 团队共享 + 个人覆盖 + 开箱即用 |
| ADR-6 | 与 skill-explorer **分工**：文件操作归它，中文语义归本插件 | 避免功能重叠与互相打架 |
| ADR-7 | LLM 结果直接生效但标未审核 | 首版体验（一键可用）与可控性平衡；可批量确认 |

---

## 17. 头脑风暴：后续可加的"亮点"（P2+，按性价比排序）

1. **中文别名直呼**：`/万能调研` → 自动改写 `/agent-reach`（可选开启；对新手最友好）。
2. **团队翻译包**：`<project>/.dsh/skill-cn/zh-index.json` 随仓库提交，新人开箱即中文。
3. **使用统计驱动排序**：哪类技能常用 → 置顶/推荐分类（本地统计，不上传）。
4. **AI 自动归类**：新技能安装后自动建议分类与标签，一键采纳。
5. **分类图标/主题色**：每类 emoji/色点，菜单一眼分辨（已含在数据模型 categories.icon）。
6. **技能体检**：重复技能、失效条目、未翻译、原文变更的汇总报告（复用 summary-report 技能生成 HTML）。
7. **双语模式**：外文用户把中文条目反译回英文（同一中间层的反向利用）。
8. **菜单内行内翻译**：未翻译技能在菜单里按快捷键 `Ctrl+T` 就地翻译（不离开输入框）。

---

## 18. 待确认的 3 个决策（下一步）

1. **`/` 菜单接入策略**：推荐"扩展式为主 + 兼容叠加式兜底"，代价是依赖一个未文档化字段（失败自动回退英文）。是否接受？（备选：只做叠加式，零侵入但会多一组英文；或做接管式，全中文但风险最高）
2. **首版中文内容从哪来**：推荐"批量 LLM 一键生成 + 人工校对（标未审核）"；也可选纯手工（质量最高但约 2–4 小时）或先内置一份社区/预生成中文包（零等待）。
3. **推进节奏**：先按本方案定稿（1 天出 HTML/详细技术方案），还是直接进入 M0 spike 验证菜单改造（半天可看到 `/` 菜单中文效果）？

> 调研产出：`_dsh_design/research/skill-pipeline.md`、`plugin-api.md`、`prior-art.md`、`product-design.md`；本方案为综合稿。
