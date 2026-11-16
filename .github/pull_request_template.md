<!-- 模板对应 docs/GIT-CONVENTIONS.md 第 5 节；标题必须等于最终 squash 提交标题 -->

## 改了什么

-

## 为什么

- 触发场景 / 用户影响 / 根因：

## 怎么验证

- [ ] `node --check client.js`
- [ ] `node client.selftest.mjs`
- [ ] `SKIP_REAL_AGENTS_SCAN=1 node host/selftest.mjs`
- [ ] `npm run audit:zh`
- [ ] `npm run check:contrast`
- [ ] `npm run test:page`
- [ ] 手工步骤（写清点击路径）：

## 风险与回滚

- 影响面：
- 降级行为：
- 回滚方式（`git revert` 是否足够？是否需要数据修复？）：

## 红线自查（命中则需第二人复核）

- [ ] 未修改任何 `SKILL.md` 或技能英文 `name`
- [ ] 用户数据只写 `$DSH_HOME/dsh-skill-workbench/`（卸载/恢复例外已说明）
- [ ] 新增宿主字段已进 `normalizeSkillView` 白名单，并有渲染断言
- [ ] 新增主题变量已进亮/暗两套 `THEME_VARS` 与 `check-contrast` CASES
- [ ] 路径拼接有形态校验 + `realpath` 父目录比对
- [ ] 外链/外部数据做了 `https?` 白名单，无 `innerHTML` 类调用
- [ ] 5xx 响应不含堆栈、绝对路径、内部字段
- [ ] 涉及 `host/uninstall.js`、`host/store.js` 写盘、依赖变更（如是，指定复核人）
