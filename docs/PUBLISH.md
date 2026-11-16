# 发布与上架

对外有三条路，用途不一样：

- **npm**：包发在 `dsh-skill-workbench`，给直接用命令行装的人。npm 上最新是 `0.3.3`；`0.3.4` 已在本仓库定稿（`package.json` 与 CHANGELOG 就绪），只差一次 `npm publish`，步骤见第二节。**发布完成后把这一行改成实际最新版本**，否则文档会替仓库撒谎。
- **社区插件市场**：dshmarket 的列表来自 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 仓库，收录靠 PR。只有进了这份清单，用户才能在插件市场里搜到并安装。
- **自建索引**：本仓库的 `market/index.json`，给不想等审核、知道索引地址的人用。它不会出现在社区市场里。

## 一、提交社区收录

收录仓库一个插件一个 YAML 文件，PR 只加这一个文件，README 由脚本生成，不要手改。

```bash
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone=false
```

新建 `data/plugins/wangyanan520__dsh-skill-workbench.yml`：

```yaml
url: https://github.com/wangyanan520/dsh-skill-workbench
name: wangyanan520/dsh-skill-workbench
category: skill
description:
  en: 'Chinese display layer for DSH skills: the / menu groups skills under Chinese categories with Chinese names and summaries, while the invocation token stays the English /name and no SKILL.md is edited. Also fills missing summaries from install sources and moves uninstalled personal skills to a recycle bin.'
  zh: 给 DSH 技能加中文显示层：`/` 菜单按中文分类显示中文名与简介，调用仍是英文 `/name`，不改任何 SKILL.md。还能从安装来源补简介，卸载个人技能时移入回收站。
icon: https://raw.githubusercontent.com/wangyanan520/dsh-skill-workbench/main/assets/icon-180.png
```

几点硬性要求：

- `url` 必须和仓库地址完全一致，`name` 用 `owner/repo`。
- `description.en` 必填，英文一句话，陈述功能，不写营销词；出现 `: `（英文冒号加空格）时要给整行加引号。
- `category` 取 `skill`。可用的分类见 contributing.md。
- `icon` 只收 GitHub 上托管的 png/jpg/jpeg/webp，SVG 和第三方图床会被拒；不写就回退到作者头像。本仓库的位图是 `assets/icon-180.png`。
- 一个 PR 最多 3 条；仓库要有 `dsh-plugin` topic；`package.json` 里要有 `dsh.bundle`，只声明 `dsh.client` 会被拒。

PR 提上去后 CI 依次跑：条目数量 → 清单校验 → 仓库创建满 1 天 → awesome-lint 和站点构建。仓库龄这一条会随时间自动重跑，没满一天被拦不需要关 PR，也不用推空提交。

合并后站点自动重建，插件市场通常一天内能看到。评审会对照代码看描述是否属实，也会看是否和已有条目重复；`skill` 分类里技能管理类插件很多，描述里写清差异（`/` 菜单显示层、不改 SKILL.md、卸载进回收站），别只写“更好的技能管理器”。

如果 PR 被标成 `held: author`，按评论改完推到同一个分支，再回一条评论说明改了什么就行。

## 二、发版流程

0. 先确认还登着：`npm whoami`。报 `need auth` 说明 `~/.npmrc` 里的 token 已失效，先 `npm login`——**过期不会被 `npm publish` 提示成认证问题，容易误判成网络故障**。
1. 改 `package.json` 版本和 `CHANGELOG.md`；`package-lock.json` 里的版本字段也要跟着（`npm install --package-lock-only` 自动同步）。
2. 跑测试与门禁（见下）。有依赖时 `pre-commit` 已经覆盖语法/双 selftest/对比度/页面回归，剩下的手工补。
3. `npm publish --access public`
4. `node scripts/build-market-index.mjs` 重新生成索引，提交并 push
5. 打 tag、在 GitHub 建 Release，正文引用 CHANGELOG

发布前检查：

```bash
npm whoami                      # 必须回显账号
node --check client.js
node client.selftest.mjs
SKIP_REAL_AGENTS_SCAN=1 node host/selftest.mjs   # 本机技能集完整时可去掉 SKIP
npm run test:page
npm run check:contrast
npm run audit:zh:ci             # 与 CI 同口径：内置包 + 空数据守卫
git diff --check
git status                      # 应干净
npm pack --dry-run              # 看文件清单
```

注意顺序：**先 publish 再生成索引**。`build-market-index.mjs` 从 registry 读 `dist-tags.latest`，本地早于发布跑会写进旧版本号。

`npm pack --dry-run` 的结果要满足：

- 包含 `index.js`、`client.js`、`host/`（不含 `host/selftest.mjs`）、`cordis.patch.yml`、`locale/`、`translations/`、`docs/`、`assets/icon.svg`、两个 README
- 不包含 `scripts/`、`test/`、`client.selftest.mjs`
- `engines` 同时有 `node` 和 `dsh`
- `dsh.manifestVersion` 是 `1`，`dsh.bundle.patch` 指向 `./cordis.patch.yml`

npm 版本发出去就不能改内容。发现问题就升补丁版本再发，别覆盖已有版本。`peerDependencies` 保持 `optional`，否则 pnpm 严格模式会因为宿主没提供 `@deepseek-ai/dsh` 或 `react` 而卡住安装。

## 三、索引生成与托管

```bash
node scripts/build-market-index.mjs
git add market/index.json
git commit -m "chore: refresh market index for <version>"
git push
```

脚本从 npm registry 读 `dist-tags.latest` 和发布时间，生成 `market/index.json`。`publishTimestamp` 必须等于 npm 上的真实发布时间，每次发版都要重新生成，不要手写。

两种托管地址都行：

- raw：`https://raw.githubusercontent.com/wangyanan520/dsh-skill-workbench/main/market/index.json`
- GitHub Pages：`https://wangyanan520.github.io/dsh-skill-workbench/market/index.json`

发布后确认能访问：

```bash
curl -fsSL https://raw.githubusercontent.com/wangyanan520/dsh-skill-workbench/main/market/index.json | head -5
```

## 四、干净环境验证

找一台没装过本插件的机器，或者新建一个 profile：

1. 打开 DSH 的插件市场，搜 `dsh-skill-workbench`，确认能装（收录合并后）
2. 或者 Plugins → Experimental plugins → Custom plugin indexes → Discover，手动加索引地址
3. 安装后重启，确认侧栏出现「技能管理」
4. `/` 菜单显示中文名；改一条简介并保存；卸载一个个人技能，在设置页回收站恢复
5. 卸载插件后 profile 干净，没有残留 bundle

## 五、回滚

- 索引写错：修 `market/index.json` 再 push，用户刷新索引即可。
- npm 包有问题：优先发补丁版本；发布后 72 小时内确实要撤回再 `npm unpublish dsh-skill-workbench@<version>`，撤回会留下空版本号，慎用。
- 社区清单里的条目出错：改同一个 YAML 文件再提 PR。

## 六、每次发版

1. 版本号和 CHANGELOG
2. 测试
3. `npm publish`
4. 重新生成并提交索引
5. push、打 tag、写 release

发布这一步只有你有凭据，所以下面是可以直接照抄的一条龙（`<ver>` 换成版本号，例如 `0.3.4`）：

```bash
npm login                      # token 过期时必做；npm whoami 报 need auth 就是它
npm whoami                     # 必须回显账号
npm publish --access public    # 成功后才能继续下面几步

node scripts/build-market-index.mjs
git add market/index.json
git commit -m "chore(release): refresh market index for <ver>"
git push

git tag -a v<ver> -m "v<ver>"
git push origin v<ver>
gh release create v<ver> --title "v<ver>" --notes-file <(sed -n "/^## <ver>/,/^## /p" CHANGELOG.md | sed '$d')
```

**顺序不能反**：`build-market-index.mjs` 从 registry 读 `dist-tags.latest`，在 publish 之前跑会把旧版本号写进索引；tag 与 Release 也应在 publish 之后，否则仓库说 `<ver>`、npm 说旧版本，命令行安装的用户拿到的东西和文档对不上。

脚本目前只生成 latest 一个版本。想让用户回退旧版本，可以在 `market/index.json` 里手动追加历史条目，`versions` 按 SemVer 降序。
