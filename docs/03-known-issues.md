# 已知问题与残余风险

最后核对：2026-11-18（补充桌面端更新失败的根因）

本文件只记录**当前仍然存在**的问题、环境性失败和明确的设计取舍。已修复的审查项见 `docs/UI-REVIEW-2026-11.md` 与 `docs/UI-REVIEW-2026-11-ROUND2.md`（第二轮的 P1/P2 与主要 P3 已于 2026-11-15 修复，见 CHANGELOG 0.3.4）。

## 桌面端更新（2026-11-18 排查）

1. **现象**：DSH 桌面端运行中，在 dshmarket 里把 `dsh-skill-workbench` 从 0.3.3 更新到 0.3.4，报「这个插件正在使用中，桌面端不允许现在移除」（`bundle-in-use`）。同一批更新里 `billion-context`、`dsh-better-sidebar`、`dsh-cost-meter` 也连续报同一个错，而 7 个 `@michengai/*` 插件成功。
2. **根因**：不是本插件代码问题，是宿主进程内的包解析状态失效。`removeBundle` 先 `selectBundle(name,false)` 把 bundle 行从 `dsh.profile.bundles` 摘掉，再走 HMR `reload()`；`recompose` 在 `publish` 阶段发现某个 profile 包的 `realDir` 与新 resolution 的包目录不一致（pnpm 覆盖安装/换目录），`ResolutionRouter.replace` 抛 `ResolutionRestartRequired("package-moved")`，`recompose` 提前 return（`entry.update` 未执行，旧 entry 仍挂载），紧随其后的 `bundle-in-use` 守卫命中。市场 #935 会把已摘掉的 bundle 行恢复，所以磁盘与清单不会留下半安装状态。
3. **影响面**：不止本插件。对照实验里对一个无关插件 `dsh-cost-meter` 执行 `plugin_manager set_bundle(enabled=false)`，同样返回 `application:"restart-required"`、`restartReason:"package-moved"` 且 route 仍 200，证明当前进程里任何 bundle 的移除/禁用都做不了。失败的 4 个都是 manifest 列表末尾的 unserialized 包，成功的 7 个是 `@michengai/*` scoped 包——相关性指向批次/目录解析状态，而不是某个插件的 patch 写法。
4. **规避**：完全退出 DSH（⌘Q，确认 `pgrep -f "DeepSeek Harness"` 为空）再重新打开，然后在市场里点更新。这是宿主 `nextStep` 自身要求的状态，不是绕过；重启后进程会按磁盘重建解析，`package-moved` 不再成立。失败后直接重试即可，不需要手工改 `package.json` 或清理 `node_modules`。
5. **本插件侧的相关修复（0.3.5）**：`host/routes.js` 的全局布尔挂载守卫改为「后挂载者接管 + token 归属」，避免 HMR 重载后新实例跳过注册、旧 disposer 又删掉路由，表现为更新后 `/api/dsh-skill-workbench/*` 全 404、侧栏入口消失。这条缺陷与上面的 `bundle-in-use` 是两条独立路径，修它不能让宿主在运行中卸载包，但能避免「热重载后插件变哑」。

## 环境性失败（不是插件逻辑回归）

1. 默认 `node host/selftest.mjs` 会扫描本机 `~/.agents/skills`。当前机器缺少映射技能 `image-to-code`，结果为 44/45；设置 `SKIP_REAL_AGENTS_SCAN=1` 后全部通过。
2. `translations/validate.mjs` 与当前磁盘技能目录漂移，本机报告约 45 missing / 42 extra。内置包按仓库内 `translations/zh-CN.builtin.json` 为准，不随个人技能目录实时同步。
3. 仓库没有 `node_modules`，`test/render-page-test.mjs` 无法直接运行；需要自行安装 `react`、`react-test-renderer`，并启动 `127.0.0.1:51825` 的测试宿主。
4. DSH Web GUI 的 59664 端口需要 `dsh web` 打印的令牌；未拿到令牌时无法对真实宿主截图。当前视觉验收使用 `/tmp/skill-ui-review` 夹具：外壳近似 DSH，页面 DOM 与内联样式来自真实 `client.js`。

## 主题与视觉

1. `detectThemeMode()` 是启发式检测：依次看 `html/body` 的 class、`data-theme`/`data-color-mode`、`color-scheme`、计算文字亮度、`matchMedia`。如果真实 DSH 主题既不加类名又给出低对比度的计算文字色，可能判错；需要在真实宿主中复核一次亮/暗切换。
2. 主题变量是页面级 `--skw-*`，不覆盖宿主全局组件；侧栏、菜单行、弹层仍由 DSH 渲染，插件无法保证它们的配色。
3. 仍保留一批 12px 的辅助元数据（覆盖率 hint、路径/哈希、诊断等）。详情页操作说明已提升到 13px；其余是低频辅助信息，未全部提升，属于排版取舍。
4. `formatTime` 仍是手写 `YYYY-MM-DD HH:mm`，没有改用 `Intl.DateTimeFormat`；避免改变现有跨 locale 输出，暂列改进项。

## 交互与数据

脏表单的最终兜底是**草稿救援**（0.3.4）：脏状态持续镜像到 `sessionStorage['skw:draft:<name>']`，重开详情时询问恢复/丢弃。拦截不了的离开路径（宿主切面板改 hash、技能被外部卸载导致索引刷新）都靠它保住内容，但它是“可恢复”而不是“可撤销”。注意：用户明确点过“放弃修改”的草稿也会暂存一版，重开时会出现恢复提示（多一次点击，属取舍）。

1. 覆盖卡的百分比度量“有中文”，不度量“已审核”。2026-11-15 修补后本机索引 48 条、51 个技能全部有中文名，且 48 条全部标为 `reviewed`（0 草稿），因此覆盖卡会同时显示 100% 与“未审核 0”。**但“已审核”在本机是由助手按审计规则统一判定的，不是人工逐条确认**：清单里只有 `reviewed` / `draft` 两个状态，没有记录审核人，所以这个标记无法区分“人看过”和“助手过了审计器”。若要把“可放心用”做成主指标，需要宿主提供独立的 reviewed 覆盖率与审核人字段。
2. 分类只有用户在 `index.json` 里声明 `categories` 才生效（`client.js` 的 `resolveSection` 在 `catById` 为空时把所有条目落到“未分类”）。本机已于 2026-11-15 声明 8 个分类（lark/project/research/tooling/quality/frontend/image/writing）。
3. 设置页总开关 `enabled` 只影响 `/` 菜单；管理页始终保留中文编辑。这是 2026-11 审查后的明确语义，`enabledHint` 已同步文案。
4. 无数据时错误态只保留页头、错误横幅、提示与重试，不渲染 tabs/设置/回收站；原因是拿不到索引时这些视图也没有数据。错误恢复依赖重试。
5. 清除中文覆盖、卸载技能、永久删除都是**限时二次确认**（5 秒后复位，可取消），不是可撤销事务。清除覆盖没有回收站；这是产品现状，不是本次遗漏。
6. 保存成功会同时显示页顶横幅与操作栏内状态；审核状态是否立即消失取决于宿主 `/list` 返回的新索引。夹具是静态数据，不会变化。
7. 批量翻译仍未实现，README 已写明是已知限制；不要把“确认审核”当成一次能替代内容质量判断的批量工作流——标记为 `reviewed` 不等于内容正确，真正的把关仍靠第 9 条的对照审计。
8. 拼音搜索只读 `zh.pinyin` / `zh.pinyinInitials` 存储字段（`client.js:965-967`），不做运行时转换，所以拼音必须在写库时生成。2026-11-15 已为本机 48 条按“名称 + 别名”生成，随后**把 tags / keywords 的全拼并入 `zh.pinyin`**（174 个含汉字的标签词，多音词做了覆盖如 地→di、重设计→chongsheji）：因此 `feishu` 现在命中全部 27 条 lark 技能（此前只命中名称含“飞书”的 5 条）。`zh.pinyinInitials` 仍只覆盖名称+别名，不并入 tag 首字母——否则 `fs`、`wd` 这类两位组合会大面积误命中。
9. **51 个技能里 33 条的 `SKILL.md` description 本来就是中文**（`lark-*` 全线、`create-prd`、`systematic-debugging`、`test-driven-development` 等），只有 18 条是英文。所以这些条目的中文层不是“翻译”，是**改写压缩**；审核口径应是“压缩后有没有失真或丢路由细节”，而不是“译得准不准”。抽查 6 条（`lark-base`/`lark-vc`/`create-prd`/`systematic-debugging`/`agent-reach`/`hallmark`）的结论：4 条通过，2 条打回并已修（`lark-base` 漏写“认证/授权转 `lark-shared`”；内置包 `agent-reach` 原写“跨 13 个平台”，而原文自称 15 个、逐项只有 14 个，已改为“跨十余个平台”）。内置包同样存在与原文不一致的内容，不能默认它比用户层可信。另：`hallmark` 原本标 `reviewed`，但摘要被旧批处理硬切，修复后内容已变，曾降回 `draft`，随后在 2026-11-15 收尾中随第 10 条一并重新置为 `reviewed`。
10. 2026-11-15 收尾：用户把审核权整体交给助手，48 条已全部置 `reviewed`（其中 20 条存量草稿先逐条对照原文复核，修掉 `team-research` 摘要里“适合需要快速产出报告的深度调研”这句原文没有的措辞）。同时做了一次只动标点与空格的排版统一（39 个字段：`whenToUse`/`notFor`/`description` 补句号，中英数字之间补空格，如“与2周发布计划”→“与 2 周发布计划”），这类修饰不改语义，因此未回退 review 状态；`summary` 按菜单行惯例不带句号。回滚点见 `index.backup-review-*` / `index.backup-finalreview-*` / `index.backup-type-*`。

## 性能与规模

1. 管理页一次渲染全部技能行（当前 51 条），没有分页或虚拟滚动。超过约 200 条时需要重新评估首屏与筛选性能。
2. 30 秒静默刷新会重新拉取 `/list`；详情有脏检查保护，不会覆盖正在编辑的表单，但列表滚动位置在极端情况下可能被浏览器恢复策略影响。**2026-11-16 起后台刷新失败不再顶整页错误态**：降级为 8 秒自动消失的 warn 提示，列表保留上一次数据，下一次成功刷新会清掉提示。
3. 批量翻译的资源上限：同时运行的任务上限 2（超出 `ERR_BUSY` → 429），单技能模型输出累积上限 20000 字符（超出判失败且不写盘）。任务内部仍有 `CONCURRENCY=2` 的并发。这些是防 adapter 失控的护栏，不是吞吐目标。

## 测试缺口

1. `client.selftest.mjs` 使用 fake React，只覆盖 factory、菜单装饰和 apply，不渲染管理页。
2. 管理页回归已于 2026-11-15 入库、**2026-11-16 改造成离线可复现并进门禁**：`test/page-regression-test.mjs`（`npm run test:page`）在离线环境用真 React + `react-test-renderer` 渲染，`/list` 载荷由 `test/fixture.mjs` 在 `os.tmpdir()` 里造（真写 `SKILL.md` 与 `index.json`，扫描仍走 `host/scan.js`），因此不再依赖本机技能目录。已覆盖渲染、中文名与英文 token、覆盖率卡、拼音搜索、清空恢复、详情页打开、用户层 `layers` 透传（「清除中文覆盖」可见）、草稿救援全流程（镜像/恢复/丢弃）、非法 `filter` 退回 `all`。它现在跑在 `pre-commit` 与 CI 里。**仍缺**保存写入链路、脏检查确认框（返回/切分区/关窗）、审核状态提交与 URL hash 前进后退——这些需要可写的 mock 宿主（当前未做）。`test/render-page-test.mjs` 仍是对真实宿主的联调脚本，两者不要混用。
3. axe 在夹具的列表、详情、设置（亮/暗）均为 0 violations，但 axe 不覆盖真实 DSH 的外壳、宿主弹层和键盘全流程。
4. 中文层质量审计器已于 2026-11-15 入库：`scripts/audit-zh.mjs`，用法 `npm run audit:zh`（有 P1 时 exit 1）/ `npm run audit:zh:strict`（P2 也算失败）。它按 `listSkillRoots` 的 rank 取磁盘原文、按内置包+用户层+项目层的合并结果取值，因此能同时审计“只有内置包兜底”的技能。注意其判定规则必须区分“普通英文词应翻译”与“专有名词/标识符应保留”，否则会把正常翻译报成术语丢失；新增规则时要先拿现有 51 条跑一遍，确认没有把干净条目报成 P1。
