# 分享与曝光素材（0.3.2）

## 索引地址（用户安装用）

```
https://raw.githubusercontent.com/wangyanan520/dsh-skill-workbench/main/market/index.json
```

DSH → Plugins → Experimental plugins → Custom plugin indexes → Discover → 添加上面的地址 → 安装「技能管理」→ 重启 DSH。

## 一句话介绍

> 技能管理：给 DSH 的技能加一层中文显示中间层——`/` 菜单按中文分类显示中文名和简介，调用仍然是英文 `/name`，不改任何 SKILL.md；支持从安装来源批量补简介、个人技能卸载与回收站。

English:

> Skill Workbench: a Chinese display layer for DSH skills. The `/` menu groups skills by Chinese category and shows Chinese names and summaries, while the invocation token stays the English `/name`. SKILL.md files are never modified. Also includes batch summary filling from install sources, plus uninstall / recycle bin for personal skills.

## 社区分享短文（可直接粘贴）

中文：

> 做了个小 DSH 插件「技能管理」：把 `/` 菜单里的技能按中文分类显示成中文名 + 中文简介，调用还是原来的英文 `/name`，不动任何 SKILL.md。中文数据存在旁路，卸载无损。还支持从技能安装时记录的 GitHub 仓库批量补简介，以及把 `~/.agents/skills` 里的个人技能移到回收站。
>
> 安装（自定义索引）：Plugins → Experimental plugins → Custom plugin indexes → Discover，添加
> https://raw.githubusercontent.com/wangyanan520/dsh-skill-workbench/main/market/index.json
> 或 npm：`dsh plugin --profile desktop add dsh-skill-workbench`
>
> 反馈/建议欢迎在仓库提 issue：https://github.com/wangyanan520/dsh-skill-workbench

English:

> I built a small DSH plugin called "Skill Workbench": it shows `/` menu skills with Chinese names and summaries grouped by Chinese category, while the invocation token remains the English `/name`. It never touches SKILL.md — Chinese data lives in a sidecar store, so uninstalling is lossless. It can also batch-fill summaries from each skill's install-source GitHub repo, and move personal skills from `~/.agents/skills` into a recycle bin.
>
> Install via a custom plugin index: Plugins → Experimental plugins → Custom plugin indexes → Discover, add
> https://raw.githubusercontent.com/wangyanan520/dsh-skill-workbench/main/market/index.json
> or npm: `dsh plugin --profile desktop add dsh-skill-workbench`
>
> Issues and suggestions: https://github.com/wangyanan520/dsh-skill-workbench/issues

## 已完成的门面项（2026-11-13）

- 仓库 topics：`dsh`、`dsh-plugin`、`deepseek-harness`、`deepseek`、`agent-skills`、`skills`、`skill-manager`、`chinese`、`chinese-translation`、`i18n`、`skill-catalog`、`cordis`
- 仓库 description：DSH 技能中文显示中间层（中英双语）
- Release：https://github.com/wangyanan520/dsh-skill-workbench/releases/tag/v0.3.2
- 市场索引：format 1，latest = 0.3.2，npmmirror 已同步

## 待补

- README 顶部界面截图（需要人工截图：技能库列表、中文菜单、详情页各一张）。
- 如 DSH 官方有插件/技能相关的 issue 区或讨论区，可用上面的分享短文投放一次；官方目前没有统一的插件索引，刷屏式推广没有必要。
