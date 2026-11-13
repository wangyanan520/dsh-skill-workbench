# 自建插件索引

`index.json` 是 DSH 的自定义插件索引（format 1），只在用户把它的 https 地址加进 **Discover** 之后才可见。它不是社区插件市场：社区市场的列表由 awesome-dsh-plugin 仓库维护，收录要走 PR，具体见 [docs/PUBLISH.md](../docs/PUBLISH.md)。

## 生成

npm 包发布之后执行：

```bash
node scripts/build-market-index.mjs
```

脚本从 npm registry 读 `dsh-skill-workbench` 的 `dist-tags.latest` 和发布时间，写出 `market/index.json`。`publishTimestamp` 必须等于 npm 上的真实发布时间，不要手写；每次发版都要重新生成，否则市场安装会指到错误的版本。

## 托管

两种都行：

1. raw.githubusercontent.com，最省事
   `https://raw.githubusercontent.com/wangyanan520/dsh-skill-workbench/main/market/index.json`
2. GitHub Pages，更稳定
   仓库 Settings → Pages，选择 `main` 分支根目录，地址形如
   `https://wangyanan520.github.io/dsh-skill-workbench/market/index.json`

## 安装步骤

1. 打开 DSH 的 **Plugins** 页面
2. 在 **Experimental plugins** 下打开 **Custom plugin indexes**
3. 切到 **Discover**，添加索引地址
4. 找到「技能管理」，安装，重启 DSH

## 校验

生成后可以先用 Node 检查字段形状，正式安装仍以 DSH 为准：

```bash
node -e "const i=JSON.parse(require('fs').readFileSync('market/index.json','utf8'));if(i.format!==1)throw 1;const v=i.plugins[0].versions[0];if(!(v.publishTimestamp>0))throw 2;console.log(i.plugins[0].name,v.version,new Date(v.publishTimestamp*1000).toISOString())"
```

format 1 的约束：

- `format` 必须是 `1`
- `plugins[].name` 是 npm 包名
- `versions[]` 非空，按 SemVer 降序
- `versions[].version` 与 npm 上的版本号完全一致
- `versions[].publishTimestamp` 是 Unix 秒
- `versions[].source` 为 `{ "type": "npm" }`，或者 `git` 加 commit
- `title` / `description` 是 `LocalizedText`：字符串，或带英文 fallback 的语言映射
