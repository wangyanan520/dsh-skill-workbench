# 2026-11 UI/UX 对抗式审查与修复

日期：2026-11-15

## 范围与方法

- 对象：`/Users/wyn/Dev/dsh-skill-workbench` 的管理页与 `/` 菜单装饰。
- 方法：读过 `client.js`、`host/`、`README.md`、`docs/DESIGN.md`；用真实 `client.js` 在 5199 夹具中渲染列表、详情、设置、加载/错误/空态；按 `web-interface-guidelines` 逐条对照；用 axe 跑 WCAG A/AA 与 best-practice；亮/暗、1440/390 双尺寸截图。
- 限制：真实 DSH 59664 需要令牌（401），夹具外壳是近似实现；`/` 菜单只做代码审查，未在真实宿主渲染；夹具注入 1 条 stale、1 条 untranslated，真实索引是 59/59 有中文、57 条草稿。结论只对插件页面区域负责。

## 结论

审查时的页面“能用，但不能放心交付”。三类信任缺口：

1. **会丢工作**：返回、切 tab、30 秒刷新都可能重置未保存表单，且没有脏标记。
2. **危险操作不可逆**：清除覆盖、卸载、永久删除只有无超时的二次点击，没有取消/撤销反馈。
3. **亮色读不到错误**：错误横幅、危险文字、主按钮的对比度低于 WCAG AA。

## 已修复项

| # | 问题 | 修复 |
|---|------|------|
| 1 | 亮色错误文字 ≈1.59:1，主按钮 3.20:1 | 新增 `THEME_VARS`/`THEME_CSS`/`useThemeMode`；语义色改为主题变量；浅色主色 #2563eb（5.17:1），danger #b42318（6.57:1），暗色 danger #ffb4ab（9.75:1） |
| 2 | 未保存编辑静默丢失 | `DetailView` 增加 dirty/dirtyRef；依赖刷新跳过脏表单；返回/切 tab/关闭窗口确认；保存成功 `setInitial(form)` |
| 3 | 保存失败提示在页顶且 6 秒消失 | 保存按钮旁 `role=alert` 内联错误；成功显示“已保存”/“已确认审核”；错误横幅保留 12 秒 |
| 4 | 危险确认无超时、无取消 | 清除覆盖/卸载/永久删除统一 5 秒自动复位 + 取消按钮 |
| 5 | 行是 `div role=button` 内嵌 button，59 行 118 个 tab stop | 行改为 `<a data-skw-row href="#skill/...">`；移除行内编辑按钮；行标签带技能名；分组头改 h2 |
| 6 | 详情/390 信息架构倒置 | 覆盖卡与诊断只在库列表显示；详情标题 h2 并自动聚焦；860px 以下中文表单排到英文原文之前；底部操作栏 sticky；名称/简介计数与 maxLength |
| 7 | 覆盖率 100% 与 57 条未审核冲突 | 卡片明示“覆盖率只统计是否已有中文”，并增加“已审核”计数；诊断收进 details；分类计数随搜索/状态筛选变化；stale 口径在 hint 中说明 |
| 8 | 错误/加载/空态完成度低 | 错误态保留页头 + 提示 + 重试；加载态页头 + 6 行骨架 + `role=status`；空态提供“清除搜索与筛选” |
| 9 | 设置页保存按钮在 AI 卡内、清除最近使用无确认 | 独立 `.skw-settings-actions` 保存栏；清除最近使用二次确认 + 5 秒超时 + 取消；Provider 字段标签去重 |
| 10 | tabs/筛选/进度条/表单缺少语义 | tabs 用 `tablist/tab/tabpanel` + `aria-selected` + 方向键；筛选 `aria-pressed`；进度条 `progressbar/aria-valuenow`；`infoRow` 改 `dl/dt/dd`；详情 `pre` 可聚焦 |
| 11 | 搜索/筛选/详情状态不持久 | hash 与 `sessionStorage['skw:route']` 同步；支持 `#library?q=&filter=&cat=`、`#skill/<name>`、`#settings`；pushState/popstate 支持浏览器前进后退；返回回焦原行 |

## 证据

- 旧对比度：白字/#4c8dff 3.20:1；#ff9d9d 在 12% 红底 ≈1.59:1；#ff9d9d 白底 1.99:1。
- 新对比度：白字/#2563eb 5.17:1；#b42318/白 6.57:1；警告 5.36:1；成功 5.10:1；草稿 7.39:1；暗色 danger 9.75:1；输入边框亮 3.25:1、暗 4.38:1。
- axe（wcag2a/aa/21a/21aa/best-practice）：列表、详情、设置 × 亮/暗，均为 0 violations。
- 交互实测：空搜索清除、脏检查留在详情/确认后返回并回焦、保存成功回列表、确认审核显示“已确认审核”、保存失败显示内联 alert；浏览器后退从详情回列表，脏表单后退会被确认拦住。
- 截图基线（本机临时）：`/tmp/skill-ui-review/shots-v2*`、`shots-v3-detail`、`shots-v3-phone-detail`、`shots-v3-phone`。

## 关键实现位置

- 主题：`THEME_VARS`、`detectThemeMode`、`useThemeMode`、`THEME_CSS`、`ensureThemeStyle`（`client.js` STYLES 之后）。
- 列表与行：`LibraryTab` 的受控 query/filter/category、`rowTitle`、`a[data-skw-row]`、空态清除。
- 详情：`DetailView` 的 `submit(reviewOnly)`、`save()`、`reviewCurrent()`、`.skw-detail-actions`、`.skw-detail-zh`。
- 页面：`Page` 的 `readInitialRoute`、`leaveDetail(force)`、`refresh(force, silent)`、tabs 键盘处理、coverage/details。
- 设置/回收站：`SettingsTab` 的独立保存栏与清除确认；`TrashCard` 的 purge 定时与取消。

## 验证命令与结果

- `node --check client.js`：通过。
- `node client.selftest.mjs`：32 组断言全过。
- `SKIP_REAL_AGENTS_SCAN=1 node host/selftest.mjs`：退出 0。
- 默认 `node host/selftest.mjs`：44/45，失败项是本机缺少 `image-to-code`。
- `npm run selftest`：受上述环境项与翻译包漂移影响，未全绿。
- `node test/render-page-test.mjs`：缺少 `node_modules/react`，未运行。

## 残余

见 `docs/03-known-issues.md`：真实宿主主题复核、错误态导航、覆盖/审核语义、危险操作不可撤销、12px 说明文字、无虚拟滚动、无仓库内管理页回归测试。
