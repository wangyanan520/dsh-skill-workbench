# 插件市场索引

`index.json` 是 DSH 插件市场索引（format 1），列出本插件的可安装版本。用户在 DSH 的
**Plugins → Experimental plugins → Custom plugin indexes → Discover** 里添加它的 https 地址后，
即可看到「技能管理」并一键安装。

## 生成

发布 npm 包之后执行：

```bash
node scripts/build-market-index.mjs
```

脚本会从 npm registry 读取 `dsh-skill-workbench` 的 `dist-tags.latest` 与发布时间，
生成 `market/index.json`。**不要手写 `publishTimestamp`**——它必须等于 npm 上的真实发布时间；
每次发版都要重新生成，否则市场安装会指到错误版本或时间。

## 托管

两种都可以：

1. **raw.githubusercontent.com（最省事）**
   `https://raw.githubusercontent.com/wangyanan520/dsh-skill-workbench/main/market/index.json`
2. **GitHub Pages（更稳定，推荐长期使用）**
   仓库 Settings → Pages → 选择 `main` 分支根目录；地址形如
   `https://wangyanan520.github.io/dsh-skill-workbench/market/index.json`

## 用户安装步骤

1. 打开 DSH 的 **Plugins** 页面
2. 在 **Experimental plugins** 下打开 **Custom plugin indexes**
3. 切到 **Discover**，添加上面的索引地址
4. 找到「技能管理」→ 安装 → 重启 DSH

## 校验

生成后可以用 Node 快速检查字段形状（正式安装仍以 DSH 为准）：

```bash
node -e "const i=JSON.parse(require('fs').readFileSync('market/index.json','utf8'));if(i.format!==1)throw 1;const v=i.plugins[0].versions[0];if(!(v.publishTimestamp>0))throw 2;console.log(i.plugins[0].name,v.version,new Date(v.publishTimestamp*1000).toISOString())"
```

索引格式 1 的关键约束：

- `format` 必须是 `1`
- `plugins[].name` 是 npm 包名
- `versions[]` 非空，按 SemVer 降序
- `versions[].version` 是精确版本号（与 npm 一致）
- `versions[].publishTimestamp` 是 Unix 秒
- `versions[].source` 为 `{ "type": "npm" }`（或 `git` + commit）
- `title` / `description` 是 `LocalizedText`（字符串，或带英文 fallback 的语言映射）
