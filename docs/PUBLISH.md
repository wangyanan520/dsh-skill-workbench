# 发布清单（npm + 插件市场索引）

目标：先让社区用户能通过自定义索引安装本插件。官方收录目前没有自助入口（DSH 没有官方索引），
这里只覆盖「npm 发布 + 自建索引」这条路径。

## 0. 前置

- npm 账号，且 `dsh-skill-workbench` 未被占用（已确认：`npm view dsh-skill-workbench` 返回 404）
- 仓库 push 权限
- Node 24（`engines.node` 要求）

## 1. 发布前检查

```bash
node --check client.js
node client.selftest.mjs
node host/selftest.mjs          # 本机没有完整技能集时用 SKIP_REAL_AGENTS_SCAN=1
git diff --check
git status                      # 应干净；确认版本号与 CHANGELOG 已更新
npm pack --dry-run              # 检查文件清单
```

`npm pack --dry-run` 应满足：

- 包含 `index.js`、`client.js`、`host/`（**不含** `host/selftest.mjs`）、`cordis.patch.yml`、`locale/`、`translations/`、`docs/`、`assets/icon.svg`、README
- 不包含 `scripts/`、`test/`、`client.selftest.mjs`
- `engines` 同时有 `node` 与 `dsh`
- `dsh.manifestVersion` 为 `1`，`dsh.bundle.patch` 指向 `./cordis.patch.yml`

## 2. 发布 npm

```bash
npm login
npm publish --access public
npm view dsh-skill-workbench@0.3.0 version
```

注意：

- 发布后不能改版本内容；发现问题的标准做法是升 `0.3.1` 再发，不要覆盖已有版本。
- `peerDependencies` 已标 `optional`，避免 pnpm 严格模式因宿主不提供 `@deepseek-ai/dsh` / `react` 而阻断安装。

## 3. 生成并托管市场索引

```bash
node scripts/build-market-index.mjs
git add market/index.json
git commit -m "chore: publish market index for 0.3.0"
git push
```

索引地址（任选其一，写进 README 的安装说明）：

- raw：`https://raw.githubusercontent.com/wangyanan520/dsh-skill-workbench/main/market/index.json`
- GitHub Pages：仓库 Settings → Pages，地址形如
  `https://wangyanan520.github.io/dsh-skill-workbench/market/index.json`

发布后确认地址可访问：

```bash
curl -fsSL <索引地址> | head -5
```

## 4. 干净环境实测

在一台没有装过本插件的机器（或新 profile）上：

1. DSH → Plugins → Experimental plugins → 打开 Custom plugin indexes
2. Discover → 添加索引地址
3. 安装「技能管理」→ 重启 DSH
4. 验证：侧栏出现「技能管理」；`/` 菜单显示中文名；保存一条中文简介；卸载一个个人技能并在设置页回收站恢复；卸载插件后 profile 干净（无残留 bundle）

## 5. 打标签与 release

```bash
git tag v0.3.0
git push origin v0.3.0
```

在 GitHub 创建 Release，正文直接引用 `CHANGELOG.md` 对应版本。

## 6. 回滚

- 市场索引写错：修正 `market/index.json` 并 push，用户刷新索引即可。
- npm 包发布后有问题：优先发 `0.3.1` 补丁；24 小时内确需下架再 `npm unpublish dsh-skill-workbench@0.3.0`（会留下空白版本，谨慎使用）。

## 7. 后续每次发版

1. 改 `package.json` 版本与 `CHANGELOG.md`
2. 跑测试
3. `npm publish`
4. `node scripts/build-market-index.mjs` 重新生成索引（新版本追加到 `versions`，旧版本保留）
5. push 索引、打 tag、写 release

> 说明：脚本目前只生成「当前 latest 一个版本」的索引条目。如果希望让用户回退旧版本，
> 可以在 `market/index.json` 里手动追加旧版本条目（`versions` 按 SemVer 降序）。
