# dsh-skill-workbench（技能管理）

给 DSH 的技能加一层**中文显示中间层**：用 `/` 调技能时，菜单按中文分类分组，显示中文显示名与中文介绍；管理页可**改名**、编辑简介/分类、查看覆盖情况。**调用 token 永远是英文 `/name`**，模型与宿主行为零变化。

- 不改任何 `SKILL.md`，不伪造中文技能名；
- 中文数据存 `$DSH_HOME/dsh-skill-workbench/index.json`（旁路，卸载无损）；
- 自带 53 个技能的中文显示包（45 个用户技能 + 8 个 DSH 内置），装完即用；
- 管理页：技能库 / 设置；详情页可改显示名，并可一键「采用原文简介」（原文已是中文时直接复用）；
- AI 翻译是**可选项**：默认不需要，只有手动点「AI 重译（可选）」且宿主配置了模型时才调用；
- 保存只写入**实际改动的字段**（不会把内置/项目层中文整份复制进用户层）；未翻译技能至少填写中文名或简介才能保存；详情页显示中文来源，并可一键清除用户层覆盖。
- 详情页可从技能安装来源一键读取简介：读取安装时记录的 GitHub 仓库（`~/.agents/.skill-lock.json`）里的 README，优先中文，只有英文时填入英文并提示；结果缓存 7 天，可手动改写后保存。

## 安装

```powershell
dsh plugin --profile desktop add link:<本仓库的本地路径>
```

安装后重启 DSH（或点右上角刷新按钮），侧栏出现「技能管理」。卸载：

```powershell
dsh plugin --profile desktop remove dsh-skill-workbench
```

## 目录结构

```
dsh-skill-workbench/
├─ index.js                 # 宿主插件入口（cordis）
├─ client.js                # 浏览器端：/ 菜单装饰层、管理页
├─ cordis.patch.yml         # 把自己插进 profile 插件表
├─ host/                    # 宿主侧：存储、扫描、HTTP 路由、翻译、自测
├─ translations/            # 内置中文显示包（zh-CN.builtin.json）+ 校验器
├─ locale/                  # 插件自身 UI 的 zh/en 文案
├─ docs/
│  ├─ API-CONTRACT.md       # 宿主 HTTP API / 数据模型 / 客户端行为契约
│  ├─ DESIGN.md             # 设计方案（问题、三方案对比、交互、AC）
│  └─ VERIFY.md             # 交付核对清单与运行态证据
└─ test/                    # 真实 React 渲染、/ 菜单联调、边界测试
   ├─ render-page-test.mjs  # 管理页真实渲染（react-test-renderer）
   ├─ menu-live-test.mjs    # / 菜单装饰联调（连运行中 App）
   ├─ test-extra.mjs        # overlay 兼容模式 + 项目级 store
   └─ run-live.mjs          # 一键跑以上联网测试
```

## 开发与自测

```powershell
node client.selftest.mjs      # 客户端 32 组断言
node host/selftest.mjs        # 宿主 37 项检查
node translations/validate.mjs  # 中文包完整性（53 条覆盖）
```

联网测试需运行中的 DSH App，默认连 `http://127.0.0.1:51825`，端口变化时用环境变量覆盖：

```powershell
$env:DSH_PLUGIN_ORIGIN='http://127.0.0.1:51999'
node test/run-live.mjs
```

## 命名说明

DSH 插件市场的收录惯例是 npm 包名 `dsh-*`（小写连字符，如 `dsh-skill-groups`、`dsh-skills-hub`、`dsh-zh-layer`）。本插件取 `dsh-skill-workbench`：`dsh-` 前缀 + 功能描述，且该名称在 npm 上未被占用；插件 id、API 前缀、存储目录均与此名一致。
