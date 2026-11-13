# dsh-skill-workbench（技能管理）

DSH 的技能目录是英文的。用 `/` 调技能时，菜单里是一排英文名，每次都得先认一遍。这个插件给它加一层中文：技能按中文分类排好，显示中文名和一句中文简介，实际发出去的调用 token 还是英文 `/name`，模型、宿主和技能文件都不受影响。

配套的管理页用来改这些中文：重命名、改简介、换分类，看哪些技能还没翻译。装自 GitHub 的技能可以从仓库 README 抓一段简介填进来；个人技能卸载时先进回收站，不会直接删掉。

## 安装

### 社区插件市场

收录合并后，在 DSH 的插件市场搜 `dsh-skill-workbench`，装上重启 DSH 即可。

### 自定义插件索引（现在就能用）

1. DSH → Plugins → Experimental plugins，打开 **Custom plugin indexes**
2. 切到 **Discover**，添加
   `https://raw.githubusercontent.com/wangyanan520/dsh-skill-workbench/main/market/index.json`
3. 找到「技能管理」，安装后重启 DSH

### npm

```bash
dsh plugin --profile desktop add dsh-skill-workbench
```

### 本地仓库

```bash
dsh plugin --profile desktop add link:<本仓库路径>
```

装完重启 DSH，或者点右上角的刷新按钮，侧栏会出现「技能管理」。卸载插件：

```bash
dsh plugin --profile desktop remove dsh-skill-workbench
```

需要 DSH `>=0.2.2-rc.1`、Node 24 和 React 18。

## 会做什么

### `/` 菜单

技能保留原来的英文调用 token，菜单里换成中文名、一句简介和中文分类。最近用过的技能排在最前面，然后是各个分类，还没翻译的放最后。搜索框认中文名、英文名、别名和拼音，全拼 `quanwangdiaoyan` 和首字母 `qwdy` 都能搜到。

菜单有两种显示方式。默认的「装饰式」直接改写官方技能分组里的行，不新增分组；「兼容叠加」保留原来那组英文，另加一组「技能」，装饰式不生效时用。也可以关掉菜单中文，只留管理页。

### 管理页

技能库列出所有技能和翻译状态：已翻译、未审核、过期（原文简介改过）、未翻译。详情页能改中文名、别名、简介（40 字以内）、详细说明、适用与不适用场景、分类、标签和关键词，也能看到这条中文来自内置包还是你自己，并清除自己的覆盖回退到内置版本。原文本身就是中文的技能，可以点「采用原文简介」直接复用。

列表顶部有覆盖率统计，能看出还有多少技能没配中文。设置页放着菜单模式、拼音搜索、最近使用和回收站。

### 从安装来源补简介

从 GitHub 安装的技能，仓库里一般有中文 README。详情页会读 `~/.agents/.skill-lock.json` 里记录的仓库，从 README 取一段简介；中文优先，只有英文时会填英文并标注。结果缓存 7 天，保存前可以改。技能库工具栏里还有批量版：只补空字段，标成「导入」草稿，不会覆盖你已经写好的内容。

### 卸载与回收站

在详情页卸载 `~/.agents/skills` 下的个人技能时，文件夹先移进插件的回收站，不会立刻删除。设置页可以恢复，或者二次确认后永久删除；卸载同时会清掉 `.skill-lock.json` 里对应的安装记录。项目技能和 DSH 内置技能只读，这里动不了。

### AI 重译（可选）

详情页有「AI 重译」按钮，只在按下去的时候调用宿主配置的模型；没配模型就不调用。不想用翻译的话完全可以手动写，或者干脆不用这个按钮。

## 数据放在哪

- `$DSH_HOME/dsh-skill-workbench/index.json`：中文条目和设置
- `<项目>/.dsh/skill-cn/zh-index.json`：可选的按项目覆盖，叠加在用户层之上
- `$DSH_HOME/dsh-skill-workbench/trash/`：从 `~/.agents/skills` 移出来的技能
- `$DSH_HOME/dsh-skill-workbench/diagnostics.json`：最近一次扫描的诊断信息

`$DSH_HOME` 默认是 `~/.dsh`。卸载插件或删掉数据目录，`SKILL.md` 一个字节都不会变，技能照常能用；丢的只是中文标签。

## 权限

插件读取当前项目和用户目录下的技能目录，只写 `$DSH_HOME/dsh-skill-workbench/`。只有在卸载个人技能时才会写到 `~/.agents/skills` 和 `~/.agents/.skill-lock.json`，而且只动那一个技能。它不编辑 `SKILL.md`，也不碰不属于自己的技能。

宿主 HTTP API 只监听 loopback，并校验请求来源。唯一的外网请求是补简介时从 GitHub 读取 README，其余功能离线可用。

## 已知限制

- 内置中文包按 53 个技能生成。机器上装的技能不同，覆盖率一开始会有缺口，手动补或从安装来源补都行。
- 翻译一次只能处理一个技能，还没做批量翻译按钮。
- 兼容叠加模式会出现两组技能，这是故意的。只想要一组就切回装饰式。
- 中文层改的是显示，不是模型收到的东西。发给模型的技能描述仍然是英文原文。
- 启停技能请用 skills-manager 或 DSH 自带的技能设置，这个插件只管显示和卸载。

## 开发

```bash
node client.selftest.mjs        # 客户端断言，真实 React 渲染
node host/selftest.mjs          # 宿主检查；CI 里设 SKIP_REAL_AGENTS_SCAN=1
node translations/validate.mjs  # 内置中文包完整性
```

联网测试需要运行中的 DSH App，默认连 `http://127.0.0.1:51825`，端口不同时用环境变量覆盖：

```bash
DSH_PLUGIN_ORIGIN='http://127.0.0.1:51999' node test/run-live.mjs
```

发布和社区收录流程见 [docs/PUBLISH.md](docs/PUBLISH.md)。宿主 API 契约见 [docs/API-CONTRACT.md](docs/API-CONTRACT.md)，设计说明见 [docs/DESIGN.md](docs/DESIGN.md)。

## License

MIT
