# dsh-skill-workbench（技能管理）

给 DSH 的技能加一层**中文显示中间层**：用 `/` 调技能时，菜单按中文分类分组，显示中文显示名与中文介绍；管理页可**改名**、编辑简介/分类、查看覆盖情况。**调用 token 永远是英文 `/name`**，模型与宿主行为零变化。

- 不改任何 `SKILL.md`，不伪造中文技能名；
- 中文数据存 `$DSH_HOME/dsh-skill-workbench/index.json`（旁路，卸载无损）；
- 自带 53 个技能的中文显示包（45 个用户技能 + 8 个 DSH 内置），装完即用；
- 管理页：技能库 / 设置；详情页可改显示名，并可一键「采用原文简介」（原文已是中文时直接复用）；
- AI 翻译是**可选项**：默认不需要，只有手动点「AI 重译（可选）」且宿主配置了模型时才调用；
- 保存只写入**实际改动的字段**（不会把内置/项目层中文整份复制进用户层）；未翻译技能至少填写中文名或简介才能保存；详情页显示中文来源，并可一键清除用户层覆盖。
- 详情页可从技能安装来源一键读取简介：读取安装时记录的 GitHub 仓库（`~/.agents/.skill-lock.json`）里的 README，优先中文，只有英文时填入英文并提示；结果缓存 7 天，可手动改写后保存。
- 详情页可卸载 `~/.agents/skills` 里的个人技能：先移到回收站，可在设置页恢复或永久删除（永久删除需二次确认）；项目技能与 DSH 内置技能保持只读，同时清理该技能的安装记录。

## 安装

### 方式一：插件市场索引（推荐给普通用户）

1. DSH → **Plugins**
2. 在 **Experimental plugins** 下打开 **Custom plugin indexes**
3. 切到 **Discover**，添加索引地址：
   `https://raw.githubusercontent.com/wangyanan520/dsh-skill-workbench/main/market/index.json`
4. 找到「技能管理」→ 安装 → 重启 DSH

### 方式二：npm

```bash
dsh plugin --profile desktop add dsh-skill-workbench
```

### 方式三：本地开发

```bash
dsh plugin --profile desktop add link:<本仓库的本地路径>
```

安装后重启 DSH（或点右上角刷新按钮），侧栏出现「技能管理」。卸载：

```bash
dsh plugin --profile desktop remove dsh-skill-workbench
```

## 与 skills-manager 的区别

- **skills-manager**：负责技能的加载/启停与来源管理；
- **本插件**：负责中文显示层（`/` 菜单里的中文名、分类、简介），以及个人技能的卸载/回收站。
  两者可以同时安装，入口分别在设置页与侧边栏；如果只想要中文菜单，装本插件即可。

## 权限与数据

- 只读技能目录（`~/.agents/skills`、项目内技能目录等），**从不写入** `SKILL.md`；
- 写 `$DSH_HOME/dsh-skill-workbench/`：中文索引、回收站、安装来源缓存；
- 卸载个人技能时写 `~/.agents/skills` 与 `~/.agents/.skill-lock.json`（只影响被卸载技能）；
- 宿主 HTTP API 只监听 loopback，且带本机来源校验；
- 「从安装来源读取简介」会访问 GitHub raw 内容，其余功能不联网。

## 已知限制

- 内置显示包按固定的 53 个技能生成，不同机器的技能集不同，覆盖率数字会有偏差；缺的技能可在详情页手动编辑或从安装来源读取。
- 批量翻译 UI 暂未提供（宿主 API 支持），当前只有详情页的单条「AI 重译」。
- 菜单兼容模式（overlay）会出现「官方英文分组 + 技能中文分组」两组，这是有意保留的兜底行为。

## 目录结构

```
dsh-skill-workbench/
├─ index.js                 # 宿主插件入口（cordis）
├─ client.js                # 浏览器端：/ 菜单装饰层、管理页
├─ cordis.patch.yml         # 把自己插进 profile 插件表
├─ host/                    # 宿主侧：存储、扫描、HTTP 路由、翻译、卸载、安装来源
├─ translations/            # 内置中文显示包（zh-CN.builtin.json）+ 校验器
├─ locale/                  # 插件自身 UI 的 zh/en 文案
├─ assets/icon.svg          # 插件图标
├─ market/                  # 插件市场索引（format 1）
├─ scripts/                 # 市场索引生成脚本
├─ docs/
│  ├─ API-CONTRACT.md       # 宿主 HTTP API / 数据模型 / 客户端行为契约
│  ├─ DESIGN.md             # 设计方案（问题、三方案对比、交互、AC）
│  ├─ PUBLISH.md            # npm 发布与市场索引清单
│  └─ VERIFY.md             # 交付核对清单与运行态证据
└─ test/                    # 真实 React 渲染、/ 菜单联调、边界测试
```

## 开发与自测

```bash
node client.selftest.mjs        # 客户端 32 组断言
node host/selftest.mjs          # 宿主：本机技能集完整时全绿；CI 用 SKIP_REAL_AGENTS_SCAN=1
node translations/validate.mjs  # 中文包完整性（对照内置 53 条）
```

联网测试需运行中的 DSH App，默认连 `http://127.0.0.1:51825`，端口变化时用环境变量覆盖：

```bash
DSH_PLUGIN_ORIGIN='http://127.0.0.1:51999' node test/run-live.mjs
```

发布流程见 [docs/PUBLISH.md](docs/PUBLISH.md)。

## 命名说明

社区 DSH 插件沿用小写连字符的 npm 包名（如 `dsh-skill-groups`、`dsh-skills-hub`、`dsh-zh-layer`）。本插件取 `dsh-skill-workbench`：`dsh-` 前缀 + 功能描述；插件 id、API 前缀、存储目录均与此名一致。
