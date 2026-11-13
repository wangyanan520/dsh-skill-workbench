# 分享素材

## 一句话介绍

中文：

> 技能管理：给 DSH 的 `/` 菜单加一层中文显示，技能按中文分类排好并显示中文名和简介，调用 token 仍是英文 `/name`，不改任何 `SKILL.md`。另外支持从安装来源补简介，个人技能卸载进回收站。

English:

> Skill Workbench adds a Chinese display layer to DSH skills: the `/` menu groups skills under Chinese categories with Chinese names and summaries, while the invocation token stays the English `/name` and no `SKILL.md` is modified. It also fills missing summaries from install sources and moves uninstalled personal skills to a recycle bin.

## 安装方式

社区插件市场收录合并后，搜索 `dsh-skill-workbench` 即可安装。

收录之前可以用自定义索引：

```
https://raw.githubusercontent.com/wangyanan520/dsh-skill-workbench/main/market/index.json
```

DSH → Plugins → Experimental plugins → Custom plugin indexes → Discover，添加地址，安装「技能管理」，重启 DSH。

或者走 npm：

```bash
dsh plugin --profile desktop add dsh-skill-workbench
```

## 社区分享短文

中文：

> 写了个 DSH 插件「技能管理」。起因是 `/` 菜单里的技能全是英文名，每次用都得先翻译一遍。
>
> 它给技能加中文名、中文简介和中文分类，调用还是原来的英文 `/name`，`SKILL.md` 一个字节都不改，中文数据单独存一份，卸载插件也不会丢技能。
>
> 另外两个顺手的功能：从技能安装时记录的 GitHub 仓库读 README 补简介；个人技能卸载先进回收站，可以恢复。
>
> 插件市场搜 `dsh-skill-workbench`（收录通过后），或者用自定义索引先装：
> https://raw.githubusercontent.com/wangyanan520/dsh-skill-workbench/main/market/index.json
>
> 仓库和 issue：https://github.com/wangyanan520/dsh-skill-workbench

English:

> I built a small DSH plugin called Skill Workbench. The `/` menu lists skills by their English names, and I got tired of translating them in my head every time.
>
> It adds Chinese names, summaries and categories to the menu. The token you send is still the English `/name`, SKILL.md files are untouched, and the Chinese data lives in its own store, so uninstalling the plugin loses nothing but the labels.
>
> Two extras: it can read the GitHub repo a skill was installed from and fill in a summary, and uninstalling a personal skill moves it to a recycle bin first.
>
> Search for `dsh-skill-workbench` in the plugin market once the listing is live, or add this custom index:
> https://raw.githubusercontent.com/wangyanan520/dsh-skill-workbench/main/market/index.json
>
> Repo and issues: https://github.com/wangyanan520/dsh-skill-workbench

## 截图

README 和插件市场都还缺界面图。需要三张，用系统截图工具截就行：

1. `/` 菜单里的中文分组
2. 技能库列表和覆盖率
3. 详情页编辑中文

截好放到 `assets/screenshots/`，在 README 里引用，再补一个 `screenshots.json` 给插件市场用。

## 链接

- 仓库：https://github.com/wangyanan520/dsh-skill-workbench
- Release：https://github.com/wangyanan520/dsh-skill-workbench/releases/tag/v0.3.2
- 市场索引：`market/index.json`（format 1，latest 0.3.2）
