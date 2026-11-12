# dsh-skill-workbench · 实现契约（v1，Lead 定义，实现以本文件为准）

> 这是 Host / Client / 翻译包 / 验证 四条工作流之间的唯一契约。任何偏离先发消息给 lead。
> 约束：DSH 0.2.2-rc.1；**零构建**（宿主纯 ESM + node: 内建；客户端单文件 `client.js`，`window.__ModuleLoader__.load`，只 require `react`）；第三方插件运行时不得 import `@deepseek-ai/*`，一切走 ctx 服务。

## 0. 文件所有权（禁止越界写）

| 工作流 | 拥有的文件 |
|---|---|
| host-dev | `dsh-skill-workbench/index.js`、`dsh-skill-workbench/host/**` |
| client-dev | `dsh-skill-workbench/client.js`、`dsh-skill-workbench/client.selftest.mjs` |
| catalog | `dsh-skill-workbench/translations/**`、`_dsh_design/research/zh-pack-report.md` |
| verify | `dsh-skill-workbench/scripts/**`、`_dsh_design/verify/**` |
| Lead | `package.json`、`cordis.patch.yml`、`locale/**`、`README*.md`、`docs/**`、profile 安装与最终 diff |

共享只读：`<WORKSPACE>\_dsh_recon\src\dsh\node_modules\@deepseek-ai\**`（DSH 源码证据）、`<WORKSPACE>\_dsh_design\**`。

## 1. 中间层数据模型

技能主键 = SKILL.md frontmatter 的 `name`（= 调用 token，kebab-case）。

```jsonc
// zh 条目（所有字段都有默认值，保存时只写传入字段的 merge 结果）
{
  "name": "全网调研",              // 中文名，≤10 字，名词短语，不带"技能"
  "alias": ["联网调研"],           // 其他中文叫法，可为空数组
  "summary": "跨平台搜索与调研，汇总公开信息", // ≤40 字，菜单右侧显示
  "description": "长说明，可含 markdown",      // 详情页
  "whenToUse": "何时用",
  "notFor": "何时不要用",
  "category": "research",          // 必须是 categories[].id；缺省 "uncategorized"
  "tags": ["调研"],
  "keywords": ["小红书", "B站"],    // 命中搜索的额外词
  "pinyin": "quanwangdiaoyan",     // 中文名全拼小写，无空格
  "pinyinInitials": "qwd",         // 中文名首字母小写
  "origin": "builtin",             // manual | llm | import | builtin | community | existing-zh
  "review": "reviewed"             // draft | reviewed
}
```

分类：`{ "id": "research", "zh": "信息数据与可视化", "order": 30, "icon": "🔎" }`

### 1.1 存储三层（字段级合并，高层非空覆盖）

1. `<project>/.dsh/skill-cn/zh-index.json`（P1，Host 只在传入 cwd 时读，现在允许缺省）
2. `$DSH_HOME/dsh-skill-workbench/index.json`（用户级，读写主存储；`$DSH_HOME` 缺省 `~/.dsh`）
3. 包内 `translations/zh-CN.builtin.json`（只读，最低）

用户级 store 完整形状：

```jsonc
{
  "schemaVersion": 1,
  "lang": "zh-CN",
  "updatedAt": "2026-11-12T16:00:00+08:00",
  "settings": {
    "enabled": true,
    "mode": "decorate",              // decorate | overlay | off
    "pinyinSearch": true,
    "showRecent": true,
    "translatorProvider": "deepseek-account",
    "translatorModel": "deepseek-flash"
  },
  "categories": [ /* 可覆盖内置分类字段；未覆盖的沿用内置 */ ],
  "entries": {
    "agent-reach": {
      "dirName": "agent-reach",
      "bound": { "kind": "user-agents", "rank": 500, "path": "C:/Users/.../SKILL.md" },
      "hash": { "frontmatter": "<sha256hex>", "body": "<sha256hex>", "at": "ISO" },
      "zh": { /* 见上 */ },
      "updatedAt": "ISO"
    }
  }
}
```

内置包形状（只含 zh 数据，可无 bound/hash）：

```jsonc
{
  "schemaVersion": 1,
  "version": "1.0.0",
  "lang": "zh-CN",
  "categories": [ /* 7 个一级 = 菜单分组；二级分类作为 id 也行，但菜单按一级分组 */ ],
  "entries": { "<skill name>": { "zh": { /* 同上，origin:"builtin", review:"reviewed" */ } } }
}
```

### 1.2 Hash 与过期（Host 计算，规范写死）

```
hashFrontmatter(name, description) = sha256hex(`${String(name).trim()}\n${String(description).trim()}`)
hashBody(content) = sha256hex(trim(stripFrontmatter(String(content))))
stripFrontmatter(s): 若 s 以 "---\n"（或 "---\r\n"）开头，找到其后第一个独占一行的 "---"，返回其后的内容；否则返回 s。
```

- 状态：`untranslated`（无 zh）| `stale`（有 zh 且有 hash 且与当前文件 hash 不一致）| `fresh`（其余）。
- 内置包条目无 hash → 视为 `fresh`，`hash: null`（MVP 接受）。
- 保存/翻译写条目时必须同时写 `bound` 与 `hash`（用扫描时当前文件的值）。

## 2. Host HTTP API（契约）

- 基路径：`/api/dsh-skill-workbench/`（每个路由先做 loopback 围栏：只接受 loopback socket + Host 头 loopback + `sec-fetch-site !== 'cross-site'`，再比 method；参考 `skill-explorer/lib/index.js:9-128`）。
- 请求/响应 `application/json; charset=utf-8`；响应统一 `{ "ok": true, ... }` 或 `{ "ok": false, "code": "ERR_XXX", "message": "中文说明" }`。
- 所有写操作必须原子写（tmp + rename）。

| Method | Path | 请求 | 响应（成功时） |
|---|---|---|---|
| GET | `list?cwd=<可选绝对路径>` | — | `{ok, generatedAt, store:{userPath, builtinVersion}, settings, categories:[{id,zh,order,icon}], skills:[SkillView], coverage:{total,translated,draft,stale,untranslated}}` |
| GET | `status` | — | `{ok, version, settings, store, jobs:[Job], diagnostics:{lastClientDecorate:null\|{at,mode,decorated,rows,error}}} ` |
| POST | `save` | `{name, zh:{部分字段}, cwd?, review?}` | `{ok, entry}` |
| POST | `delete` | `{name, cwd?}` | `{ok, deleted:true}`（只删用户级） |
| POST | `translate` | `{scope:"untranslated"\|"stale"\|"selected"\|"all", names?:string[], cwd?}` | `{ok, jobId, total}`（异步启动） |
| POST | `cancel` | `{jobId}` | `{ok, cancelled:true}` |
| POST | `import` | `{pack: BuiltinPack, strategy:"fill"\|"overwrite-same-origin"\|"all", apply:boolean, cwd?}` | `{ok, preview:{added,updated,skipped,conflict,stale}, applied}` |
| GET | `export?scope=all\|translated` | — | `BuiltinPack`（Content-Disposition attachment 可省略，MVP 返回 JSON 即可） |
| POST | `diag` | `{mode, decorated:boolean, rows:number, error?:string, at}` | `{ok:true}`（写 diagnostics.json，只保留最后一次） |
| GET | `health` | — | `{ok:true, version}` |

`SkillView` 形状：

```jsonc
{
  "name": "agent-reach",
  "description": "英文原文描述",
  "whenToUse": "英文原文/可空",
  "modelInvocable": true,
  "path": "C:/.../SKILL.md",
  "source": { "kind": "user-agents", "rank": 500 },
  "hash": { "frontmatter": "...", "body": "..." },
  "bodyPreview": "SKILL.md 正文前 3000 字（无 frontmatter，可截断）",
  "status": "fresh|stale|untranslated",
  "zh": { /* 合并后的 zh，或 null */ },
  "origin": "builtin|user|project|null",   // zh 数据来自哪层
  "updatedAt": "ISO|null",
  "dirName": "agent-reach"
}
```

`Job` 形状：`{id, kind:"translate", state:"running|done|failed|cancelled", total, done, failed, current, startedAt, finishedAt, error}`。

`diag` 由浏览器端在首次成功/失败装饰菜单后上报；Host 写入 `$DSH_HOME/dsh-skill-workbench/diagnostics.json`。

## 3. 扫描（Host）

- 注入 `['webServer','skills']`；`apply(ctx, config)` 内 `const list = await ctx.skills.list({ cwd })` 或 `ctx.skills.list()`（cwd 缺省时用 `ctx.workingDirectory?.get?.()`，拿不到就直接不传）。
- 每个 summary 有 `name/description/whenToUse?/invocation?/source?/path`；读 `path` 得正文，计算 hash，生成 SkillView。
- 无 `path` 的 runtime/plugin skill：仍列出（status `untranslated` 或若用户有 zh 则 fresh，hash 用 description 计算、`hash.body=null`）。
- 扫描结果 **按需调用**（每次 list 请求重扫；45 个技能足够快），不常驻缓存；`translate` job 开始时扫一次。

## 4. 翻译任务（Host，LLM）

- 源：`ctx.llm.stream({ provider, model, system, messages, signal, maxTokens: 800, reasoningEffort: 'off' })`；只收 `chunk.type === 'text-delta'` 的 `chunk.text`；`finish.reason.kind === 'stop'` 才算成功；单条 90s 超时；并发 2；失败重试 1 次。
- 默认 `provider=deepseek-account`，`model=deepseek-flash`（可在 store.settings 覆盖）。凭据不可用/llm 服务缺失 → job failed，`error.code="ERR_NO_LLM"`，不影响手工编辑。
- System 提示词（固定在 `host/translate.js`，可迭代但必须版本化常量）：

```
你是 DSH（DeepSeek Harness）技能目录的中文翻译与编目助手。
输入一个技能的英文元数据，输出严格 JSON（不要 markdown 代码块、不要解释）：
{"name":"中文名（≤10字，名词短语，不带“技能”二字）","alias":["可选别名"],"summary":"中文简介（≤40字，说清做什么+何时用）","description":"详细中文说明（1-3 句，保留专有名词英文）","whenToUse":"适用场景","notFor":"不适用边界","category":"从给定分类 id 中选最合适的一个","tags":["2-4个中文标签"],"keywords":["可用于搜索的专有名词/平台名"]}
category 只能取给定 id；无法判断时用 "uncategorized"。专有名词（TDD、SKILL.md、Figma、React 等）保留英文。不得编造技能没有的能力。
```

- 用户消息只含该技能的 `name/description/whenToUse/分类清单`；输出 JSON 解析失败重试一次，再失败计入 failed。
- 写盘：`zh` 合并（保留已有 manual 字段？规则：`origin==='manual'` 的条目在 scope=untranslated/stale 时不覆盖；scope=all 且 force 才覆盖，MVP 不加 force）、`origin='llm'`、`review='draft'`、写 bound+hash。

## 5. 客户端契约（`client.js`）

```js
window.__ModuleLoader__.load({
  id: 'dsh-skill-workbench',
  factory(require) {
    const React = require('react');
    // ...实现...
    return { name: 'dsh-skill-workbench', inject: ['slots', 'locale', 'inputTriggers'], apply };
  },
});
```

### 5.1 apply 必须
1. 整体 `try/catch`；每个注册单独 `try/catch`，绝不让异常冒出（否则 web shell boot 白屏）。
2. `ctx.locale.register(NS, {zh, en})`（自备 NS，如 `dsh-skill-workbench`）+ `ctx.locale.bind(NS)`；文案 zh 为主，en 兜底。
3. 管理页注册（官方座位，照抄 `dsh-client-ui-skill-explorer`）：
   - `ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name:'sidebar.panellist', id:'dsh-skill-workbench', order:60, label: () => t('panel'), locale: NS }, Icon))`
   - `ctx.slots.inject('main', () => ctx.slots.register({ name:'main', key:'dsh-skill-workbench', locale: NS }, Page))`
   - 注册前先用 `ctx.get('slots')`/`ctx.get('layout')` 判空；`ctx.layout?.selectPanel?.('dsh-skill-workbench')` 切页。
4. 菜单装饰（mode=decorate，默认）：
   - `const svc = ctx.get('inputTriggers')`；每 500ms（最多 120 次）用 `svc.live?.sources?.find(s => s.trigger === '/' && s.name === 'skill')` 找内置 source；找到后包装一次（WeakSet/symbol 标记防重复），并 `ctx.on('connection/reset', ...)` 后重试。
   - 包装 `candidates(session, opts)`：`const rows = await orig(session, {...opts, query: ''})`；`await ensureIndex()`（`fetch('api/dsh-skill-workbench/list')`，30s TTL，single-flight，失败返回 null）。
     - index 不可用 / `settings.enabled===false` / `mode==='off'` → 原样返回 `orig(session, opts)`。
     - index 可用但 `coverage.translated === 0` → 原样返回 orig（英文模式，菜单完整）。
     - 否则 decorate：行 `{name, description}` → `{...row, label: zh.name, description: zh.summary || row.description, section: 分类 zh 名, icon: 分类 icon}`；未翻译行 `section:'未翻译'`。
     - 排序：最近使用（localStorage `dsh-skill-workbench:recent`，≤6，section `'最近使用'`）→ 按分类 order → 未翻译（末位）。
     - query 非空：先按 `name/alias/summary/keywords/tags/pinyin/pinyinInitials/英文 name/英文 description` 做包含匹配（大小写不敏感；拼音只匹配小写），再打分排序（中文名精确>前缀>包含>别名>拼音>英文 name>简介）。`settings.pinyinSearch===false` 时忽略拼音字段。
   - 包装 `onPick`（若原函数存在）：`function (...args) { try { recordRecent(args[args.length-1]?.name); } catch {} return origPick.apply(this, args); }`（签名不假设，取最后一个参数）。
   - 首次装饰成功/失败后 `POST api/dsh-skill-workbench/diag`（失败静默）。
   - 整个候选路径 try/catch，异常回退 `orig(session, opts)`。
5. mode=overlay：不包装内置 source，改为自注册一个 `/` source：`{ trigger:'/', name:'技能', order: 3, showGroupTitle: false, candidates(...) {...返回中文行...}, onPick(candidate){ return { text: `/${candidate.name} ` }; } }`（name 用中文可让组标题原样显示；candidates 数据来自同一 list API + 同一 decorate/搜索函数）。
6. mode=off：不注册任何 menu 改动。

### 5.2 管理页（MVP 必须）
单个主页面，三个 tab（用 React state，风格简洁、inline style、深色/浅色都别崩）：
- **技能库**：覆盖率条 + 搜索 + 状态筛选（全部/未翻译/过期/未审核）；表格行：中文名（无则英文名）/ `/name` / 分类 / 状态徽章 / 来源；点行开详情（侧栏或下方面板）：中文名/别名/简介/详细说明/适用/不适用/分类下拉/标签，保存按钮 `POST save`；显示英文原文摘要 + 更新时间 + "原文变更"黄条（stale 时）；"重新生成"按钮 `POST translate {scope:'selected', names:[name]}`。
- **批量翻译**：统计（未翻译/过期数）→ 按钮 `POST translate {scope:'untranslated'|'stale'}` → 轮询 `GET status` 每 1.5s 显示进度条（done/total/failed）→ 结束刷新列表。
- **设置**：开关（启用中文层 / 拼音搜索 / 最近使用）、模式单选（装饰内置菜单/兼容叠加/关闭）、翻译模型 provider/model 输入、保存 `POST save`?（设置用 `POST config`——见下）。
- 额外：`POST config` 路由（补契约）：`{settings:{部分字段}}` → `{ok, settings}`；Host 合并写入 store.settings。
- 每 30s 或手动"刷新"按钮重新 `GET list`；顶部显示 `GET status` 的 lastClientDecorate 诊断（"菜单装饰已生效：N 行"或错误）。
- 页面必须处理 API 404/网络错误：显示中文提示，不白屏。

## 6. 初始翻译包（catalog）

- 输出 `translations/zh-CN.builtin.json`，覆盖 `<USER_HOME>\.agents\skills` 下全部技能（约 45 个；键 = frontmatter `name`，不是目录名；已知 4 个目录名≠name）。
- 分类：一级 7 个（id/zh/order/icon 见设计文档 §7：project/tooling/quality/frontend/image/research/writing），二级 category id 可建（如 project-requirements），但目录 `categories` 必须同时包含一级与二级，二级 `parent` 指向一级；菜单按一级分组（Client 端 category id 找不到时回退第一个一级或"未分类"）。**简化：MVP 只建一级 + 可选二级，menu 按一级分组；实现上 zh.category 用二级 id 时 Client 端需 map 到一级。**
- 每条 `zh` 必须含 `name/summary/description/whenToUse/notFor/category/tags/keywords/pinyin/pinyinInitials/origin:"builtin"/review:"reviewed"`；`alias` 可选。
- 质量要求：中文名 ≤10 字、summary ≤40 字、专有名词保留英文。

## 7. 验收 / 自测（各工作流自查，verify 复核）

- host-dev：`node --check index.js host/*.js`；`node -e "import('./index.js').then(m=>console.log(m.name, m.inject))"`；`host/selftest.mjs` 用真实技能目录跑通 `scan` + `merge` + `coverage`，输出 JSON 断言（`node host/selftest.mjs` 全绿）。
- client-dev：`node --check client.js`；`client.selftest.mjs` 用 Node `vm` 沙箱造 `window.__ModuleLoader__`、假 `react`、假 ctx（含 `inputTriggers.live.sources` 假 source、`slots`、`locale`）加载 `client.js`，断言：包装后行 `label/section/description` 正确、中文/拼音 query 命中、异常回退、apply 不抛错（`node client.selftest.mjs` 全绿）。
- catalog：JSON 合法；45 个技能全覆盖无缺；每个 zh 字段非空；分类 id 存在；pinyin 为小写字母。脚本可自写并放 `translations/validate.mjs`（catalog 自己拥有）。
- verify：独立写 `scripts/live-smoke.mjs`（不 import 实现内部，只用 `client.js` 的 loader 沙箱 + 自造 ctx）；`scripts/contract-check.mjs` 静态检查各行号/API 路径/导出；安装后 `GET /api/dsh-skill-workbench/health` 探活（App 重启后）。输出 `_dsh_design/verify/VERIFY.md`。

## 8. 禁止事项

- 不修改 profile 的 `package.json` / `cordis.patch.yml`（Lead 安装时统一改）。
- 不修改 `<USER_HOME>\.agents\skills` 下任何文件。
- 不写回 SKILL.md；不伪造中文 skill name；不改 DSH 官方 lib。
- 不引入 npm 依赖、不建构建流程（client.js 单文件手写；React 用 `React.createElement`）。
- 不把 `@deepseek-ai/*` 写进运行时 import。
