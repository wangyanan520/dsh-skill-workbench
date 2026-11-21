/*!
 * dsh-skill-workbench — 浏览器端 bundle（零构建，手写 __ModuleLoader__.load）
 *
 * 职责：
 *  A) / 菜单装饰器：包装官方 dsh-client-ui-skill 注册的 slash source，把候选行装饰成
 *     中文 label / 中文简介 / 中文分类 section / 分类 emoji 图标；支持中文、别名、拼音、
 *     英文 query 过滤与打分排序；任何异常回退原 source。
 *  B) overlay 兼容模式：自注册一个 '/' source（分组名「技能」），在装饰式失效时仍可中文显示。
 *  C) 管理页：sidebar.panellist 入口 + main keyed 页面（技能库 / 设置）。
 *
 * 约束：只 require('react')；不 import @deepseek-ai/*；不新增任何运行时依赖或构建步骤。
 * 数据：宿主 HTTP API `api/dsh-skill-workbench/*`（文档相对路径，无前导 '/'）。
 */
(function () {
  'use strict';

  var loader = typeof window !== 'undefined' ? window.__ModuleLoader__ : undefined;
  if (!loader || typeof loader.load !== 'function') {
    try {
      console.error('[dsh-skill-workbench] window.__ModuleLoader__ 不可用，客户端插件未加载');
    } catch (e) {}
    return;
  }

  loader.load({
    id: 'dsh-skill-workbench',
    factory: function (require) {
      try {
        return buildClient(require);
      } catch (err) {
        try {
          console.error('[dsh-skill-workbench] 客户端 bundle 初始化失败', err);
        } catch (e) {}
        return {
          name: 'dsh-skill-workbench',
          inject: ['slots', 'locale', 'inputTriggers'],
          apply: function () {},
        };
      }
    },
  });

  function buildClient(require) {
    var React = require('react');
    var h = React.createElement;

    var NS = 'dsh-skill-workbench';
    var PANEL_ID = 'dsh-skill-workbench';
    var PANEL_ORDER = 60;
    var API_BASE = 'api/dsh-skill-workbench';
    var RECENT_KEY = 'dsh-skill-workbench:recent';
    var MAX_RECENT = 6;
    var INDEX_TTL_MS = 30000;
    var INDEX_FAIL_RETRY_MS = 10000;
    var OVERLAY_SOURCE_NAME = '技能';
    var WRAP_MARK = '__dsh_skill_i18n_mark__';

    // ------------------------------------------------------------------
    // 文案（zh 主、en 兜底；locale 服务不可用时按 document.lang 自选）
    // ------------------------------------------------------------------
    var COPY_ZH = {
      'panel.label': '技能管理',
      'page.title': '技能管理',
      'page.subtitle': '管理中文名、简介与分类；/ 菜单显示中文，调用仍用英文 /name，不改 SKILL.md。',
      'page.refresh': '刷新',
      'page.loading': '加载中…',
      'page.retry': '重试',
      'page.none': '—',
      'page.unknown': '未知',
      'page.skillMissing': '该技能已不在当前索引中（可能已被卸载或移除）。若有未保存的草稿，已暂存到本会话；技能重新出现后打开详情即可恢复。',
      'page.errorHint': '若持续失败，可检查数据目录或重新加载插件；已加载的页面状态不会丢失。',
      'page.discardConfirm': '有未保存的修改。确定要{action}吗？',
      'page.discardAction': '离开',
      'tabs.label': '管理页分区',
      'coverage.hint': '覆盖率只统计是否已有中文；是否审核通过请看状态筛选。',
      'page.close': '关闭',
      'tabs.library': '技能库',
      'tabs.settings': '设置',
      'coverage.title': '中文覆盖',
      'coverage.line': '已有中文 {translated} / {total}（{percent}%）',
      'list.count': '共 {count} 条',
      'list.batchSource': '从安装源补简介',
      'list.batchBusy': '补简介中…',
      'list.batchProgress': '已补 {filled} / 尝试 {done}',
      'list.batchDone': '补简介完成：尝试 {done} 个，成功 {filled} 个',
      'list.batchNone': '没有可补的未翻译技能（需要有安装来源）',
      'list.batchFail': '批量补简介失败',
      'list.batchScopeAria': '批量翻译范围',
      'list.batchScopeUntranslated': '未翻译（{count}）',
      'list.batchScopeStale': '过期（{count}）',
      'list.batchTranslate': '批量翻译（{count}）',
      'list.batchConfirm': '将用 AI 批量翻译 {count} 个技能，结果标为草稿；不会覆盖已有的手动中文。任务失败后可重试或取消。',
      'list.batchConfirmRun': '确认翻译',
      'list.batchCancel': '取消',
      'list.batchErrBusy': '已有翻译任务在运行，请稍后再试',
      'list.batchErrUpgrade': '当前宿主不支持批量翻译，请升级 DSH 或插件',
      'list.batchErrStart': '批量翻译启动失败',
      'list.batchStarted': '批量翻译已开始（共 {count} 个技能）',
      'list.batchFinished': '批量翻译任务已结束，列表已刷新',
      'coverage.translated': '已翻译',
      'coverage.untranslated': '未翻译',
      'coverage.stale': '过期',
      'coverage.draft': '未审核',
      'coverage.reviewed': '已审核',
      'coverage.source': '覆盖来源',
      'coverage.gapBuiltin': '内置包 {count}',
      'coverage.gapLocal': '仅自己补 {count}',
      'coverage.gapNone': '没中文 {count}',
      'coverage.gapUnknown': '来源未知 {count}',
      'coverage.gapStale': '过期 {count}',
      'coverage.gapAllBuiltin': '全部由内置包覆盖',
      'coverage.gapEmpty': '还没有扫描到技能',
      'coverage.gapLegacyHint': '当前宿主不提供分层来源；升级 DSH 或插件后可看到内置包归因。',
      'coverage.gapViewNone': '查看没中文',
      'coverage.gapViewStale': '查看过期',
      'coverage.gapBuiltinAria': '内置包覆盖 {count} 个技能',
      'coverage.gapLocalAria': '仅自己补 {count} 个技能',
      'coverage.gapNoneAria': '没中文 {count} 个技能',
      'coverage.gapUnknownAria': '来源未知 {count} 个技能',
      'coverage.gapStaleAria': '过期 {count} 个技能',
      'diag.title': '菜单诊断',
      'diag.none': '尚未收到 / 菜单装饰上报。打开一次 / 菜单后会自动上报。',
      'diag.decorated': '装饰成功：{rows} 行',
      'diag.skipped': '未装饰，菜单回退英文',
      'diag.mode': '模式',
      'diag.at': '时间',
      'diag.error': '错误',
      'diag.hint': '若长期没有上报，请确认宿主侧 dsh-skill-workbench 已加载（插件列表可见）。',
      'filter.all': '全部',
      'filter.untranslated': '未翻译',
      'filter.stale': '过期',
      'filter.draft': '未审核',
      'filter.placeholder': '搜索中文名 / 英文名 / 拼音 / 别名…',
      'filter.categoryAll': '全部分类',
      'table.name': '中文名',
      'table.skill': '技能名',
      'table.category': '分类',
      'table.status': '状态',
      'table.origin': '来源',
      'table.updated': '更新时间',
      'table.action': '操作',
      'table.edit': '改名 / 编辑',
      'table.empty': '没有匹配的技能。',
      'table.clearFilters': '清除搜索与筛选',
      'list.open': '打开技能',
      'list.editAffordance': '编辑',
      'filter.label': '按审核状态筛选',
      'status.fresh': '正常',
      'status.stale': '过期',
      'status.untranslated': '未翻译',
      'status.draft': '未审核',
      'origin.builtin': '内置',
      'origin.user': '用户',
      'origin.project': '项目',
      'origin.none': '—',
      'origin.draft': '未审核',
      'detail.title': '技能详情',
      'detail.back': '返回列表',
      'detail.zh': '中文内容',
      'detail.layers': '中文来源',
      'detail.source': '英文原文',
      'detail.name': '显示名称（中文名）',
      'detail.alias': '别名（逗号分隔）',
      'detail.summary': '中文简介（≤40 字）',
      'detail.description': '详细说明',
      'detail.useSource': '采用原文说明',
      'detail.useSourceHint': '把技能原文的 description 填入上方的详细说明；中文简介为空时会截取前 40 字作为简介。',
      'detail.whenToUse': '适用场景',
      'detail.notFor': '不适用场景',
      'detail.category': '分类',
      'detail.tags': '标签（逗号分隔）',
      'detail.keywords': '关键词（逗号分隔）',
      'detail.save': '保存中文',
      'detail.saving': '保存中…',
      'detail.regenerate': 'AI 重译（可选）',
      'detail.regenerating': '已提交…',
      'detail.stale': '技能文件已更新，当前中文内容可能已过期：可直接手动修改后保存，或点「AI 重译（可选）」重新生成。',
      'detail.updatedAt': '英文原文更新时间',
      'detail.hash': '内容哈希',
      'detail.path': '技能路径',
      'detail.body': '正文预览',
      'detail.empty': '尚未填写中文，可直接编辑后保存。',
      'detail.noCategory': '未分类',
      'detail.noChanges': '内容已经是最新，无需重复保存。',
      'detail.emptyZh': '中文内容为空：请至少填写中文名或中文简介。',
      'detail.removeOverride': '清除中文覆盖',
      'detail.removeConfirm': '再点一次确认清除',
      'detail.removeHint': '删除用户层条目，回退到内置/项目内容',
      'detail.removeOk': '已清除本条中文覆盖。',
      'detail.removeFail': '清除失败',
      'detail.removing': '正在清除…',
      'detail.installSource': '安装来源',
      'detail.sourceFetch': '从安装源读取简介',
      'detail.sourceLoading': '读取中…',
      'detail.sourceFilled': '已从安装源填入中文简介，请确认后保存。',
      'detail.sourceEnFilled': '安装源只有英文简介，已填入详细说明；可改写中文或点「AI 重译」。',
      'detail.sourceNone': '安装源里没找到该技能的简介，请手动填写。',
      'detail.sourceKept': '简介已有内容，未覆盖你填写的内容。',
      'detail.sourceFail': '读取安装源失败',
      'detail.saveOk': '中文内容已保存。',
      'detail.saveFail': '保存失败',
      'detail.regenerateFail': '启动翻译失败',
      'detail.uninstall': '卸载技能',
      'detail.uninstallConfirm': '再次点击确认卸载',
      'detail.uninstallHint': '技能目录会移到回收站，可在「设置」页恢复或永久删除',
      'detail.uninstalling': '正在卸载…',
      'detail.uninstallOk': '已卸载，技能已移到回收站。',
      'detail.uninstallFail': '卸载失败',
      'detail.sourceDescription': '原文 description（英文）',
      'detail.review': '确认审核',
      'detail.reviewing': '审核中…',
      'detail.reviewOk': '已确认审核。',
      'detail.reviewHint': '保存当前中文内容并标记为已审核',
      'detail.dirty': '有未保存的修改',
      'detail.saved': '没有未保存的修改',
      'detail.discard': '放弃修改',
      'detail.discardConfirm': '再点一次放弃修改',
      'detail.removeCancel': '取消清除',
      'detail.uninstallCancel': '取消卸载',
      'detail.draftFound': '发现上次未保存的草稿',
      'detail.draftRestore': '恢复草稿',
      'detail.draftDiscard': '丢弃草稿',
      'settings.title': '设置',
      'settings.enabled': '启用中文层',
      'settings.enabledHint': '关闭后 / 菜单恢复英文；管理页始终保留中文编辑，不修改任何技能文件。',
      'settings.mode': '菜单显示模式',
      'settings.mode.decorate': '装饰式（推荐）',
      'settings.mode.decorateHint': '直接在官方技能分组内显示中文名与中文简介，按中文分类分组，不新增菜单分组。',
      'settings.mode.overlay': '兼容叠加',
      'settings.mode.overlayHint': '保留官方英文分组，额外增加一个「技能」中文分组；装饰式失效时可用。',
      'settings.mode.off': '关闭菜单中文',
      'settings.mode.offHint': '效果与关闭上方开关相同；保留此选项仅为兼容旧设置。',
      'settings.mode.unknown': '未知模式',
      'settings.pinyin': '启用拼音搜索',
      'settings.pinyinHint': '支持全拼（quanwangdiaoyan）与首字母（qwdy）搜索中文技能。',
      'settings.recent': '显示最近使用',
      'settings.recentHint': '把最近用过的技能置顶到 / 菜单顶部（最多 6 个，保存在浏览器本地）。',
      'settings.provider': 'AI 重译（可选）',
      'settings.providerLabel': 'Provider',
      'settings.model': '模型',
      'settings.modelHint': '不用翻译时可以完全不填；留空使用宿主默认（deepseek-account / deepseek-flash），只影响详情页的「AI 重译（可选）」按钮。',
      'settings.save': '保存设置',
      'settings.saving': '保存中…',
      'settings.saveOk': '设置已保存，重新打开 / 菜单后生效。',
      'settings.saveFail': '设置保存失败',
      'settings.clearRecent': '清除最近使用记录',
      'settings.clearConfirm': '再点一次清除',
      'settings.clearCancel': '取消',
      'settings.purgeCancel': '取消永久删除',
      'settings.dirty': '有未保存的设置',
      'settings.synced': '设置已同步',
      'settings.storeTitle': '存储',
      'settings.recentCleared': '已清除最近使用记录。',
      'settings.trash': '回收站',
      'settings.trashHint': '卸载的个人技能会先放到这里；可以恢复，也可以永久删除。',
      'settings.trashEmpty': '回收站是空的。',
      'settings.trashLoading': '读取回收站…',
      'settings.trashBusy': '处理中…',
      'settings.trashRestore': '恢复',
      'settings.trashPurge': '永久删除',
      'settings.trashPurgeConfirm': '再点一次永久删除',
      'settings.trashRestoreOk': '已恢复到 ~/.agents/skills。',
      'settings.trashPurgeOk': '已永久删除。',
      'settings.trashFail': '操作失败',
      'settings.store': '数据目录',
      'settings.builtinVersion': '内置显示包版本',
      'settings.saved': '已保存',
      'menu.recent': '最近使用',
      'menu.untranslated': '未翻译',
      'menu.uncategorized': '未分类',
      'error.network': '无法连接宿主服务，请确认 dsh-skill-workbench 插件已正确加载。',
      'error.http': '请求失败（HTTP {status}）',
      'error.badPayload': '宿主返回的数据格式不正确。',
      'error.loadList': '加载技能列表失败',
      'error.refreshFailed': '后台刷新失败，当前显示上一次的数据',
      'error.loadStatus': '加载状态失败',
      'error.render': '管理页渲染出错',
      'notice.close': '关闭',
    };

    var COPY_EN = {
      'panel.label': 'Skill Manager',
      'page.title': 'Skill Manager',
      'page.subtitle': 'Edit Chinese names, summaries and categories; the / menu stays Chinese, invocations stay English. Never edits SKILL.md.',
      'page.refresh': 'Refresh',
      'page.loading': 'Loading…',
      'page.retry': 'Retry',
      'page.none': '—',
      'page.unknown': 'Unknown',
      'page.skillMissing': 'This skill is no longer in the index (possibly uninstalled). Unsaved draft is kept in this session and can be restored when the skill reappears.',
      'page.errorHint': 'If this keeps failing, check the data directory or reload the plugin; the current page state is kept.',
      'page.discardConfirm': 'You have unsaved changes. {action} anyway?',
      'page.discardAction': 'Leave',
      'tabs.label': 'Sections',
      'coverage.hint': 'Coverage only counts whether Chinese exists; use the status filter to see whether it was reviewed.',
      'page.close': 'Close',
      'tabs.library': 'Library',
      'tabs.settings': 'Settings',
      'coverage.title': 'Chinese coverage',
      'coverage.line': 'Chinese ready {translated} / {total}（{percent}%）',
      'list.count': '{count} skills',
      'list.batchSource': 'Fill from install source',
      'list.batchBusy': 'Filling…',
      'list.batchProgress': 'Filled {filled} / tried {done}',
      'list.batchDone': 'Done: tried {done}, filled {filled}',
      'list.batchNone': 'No untranslated skill with an install source',
      'list.batchFail': 'Failed to fill summaries',
      'list.batchScopeAria': 'Batch translate scope',
      'list.batchScopeUntranslated': 'Untranslated ({count})',
      'list.batchScopeStale': 'Stale ({count})',
      'list.batchTranslate': 'Batch translate ({count})',
      'list.batchConfirm': 'Use AI to translate {count} skills in batch. Results are marked as drafts and will not overwrite existing manual Chinese. If the job fails, you can retry or cancel it.',
      'list.batchConfirmRun': 'Confirm translate',
      'list.batchCancel': 'Cancel',
      'list.batchErrBusy': 'Another translation job is running. Try again later.',
      'list.batchErrUpgrade': 'This host does not support batch translation. Upgrade DSH or the plugin.',
      'list.batchErrStart': 'Failed to start batch translation',
      'list.batchStarted': 'Batch translation started ({count} skills)',
      'list.batchFinished': 'Batch translation finished; the list has been refreshed',
      'coverage.translated': 'Translated',
      'coverage.untranslated': 'Untranslated',
      'coverage.stale': 'Stale',
      'coverage.draft': 'Draft',
      'coverage.reviewed': 'Reviewed',
      'coverage.source': 'Coverage source',
      'coverage.gapBuiltin': 'Built-in {count}',
      'coverage.gapLocal': 'Self-added {count}',
      'coverage.gapNone': 'No Chinese {count}',
      'coverage.gapUnknown': 'Unknown source {count}',
      'coverage.gapStale': 'Stale {count}',
      'coverage.gapAllBuiltin': 'Fully covered by the built-in pack',
      'coverage.gapEmpty': 'No skills scanned yet',
      'coverage.gapLegacyHint': 'This host does not expose layer sources; upgrade DSH or the plugin to see built-in coverage.',
      'coverage.gapViewNone': 'View untranslated',
      'coverage.gapViewStale': 'View stale',
      'coverage.gapBuiltinAria': 'Built-in pack covers {count} skills',
      'coverage.gapLocalAria': 'Self-added Chinese covers {count} skills',
      'coverage.gapNoneAria': 'No Chinese for {count} skills',
      'coverage.gapUnknownAria': 'Unknown Chinese source for {count} skills',
      'coverage.gapStaleAria': 'Stale for {count} skills',
      'diag.title': 'Menu diagnostics',
      'diag.none': 'No / menu decoration report yet. Open the / menu once and it will report automatically.',
      'diag.decorated': 'Decorated: {rows} rows',
      'diag.skipped': 'Not decorated, menu falls back to English',
      'diag.mode': 'Mode',
      'diag.at': 'Time',
      'diag.error': 'Error',
      'diag.hint': 'If no report arrives, check that the host-side dsh-skill-workbench is loaded.',
      'filter.all': 'All',
      'filter.untranslated': 'Untranslated',
      'filter.stale': 'Stale',
      'filter.draft': 'Draft',
      'filter.placeholder': 'Search name / English name / pinyin / alias…',
      'filter.categoryAll': 'All categories',
      'table.name': 'Chinese name',
      'table.skill': 'Skill',
      'table.category': 'Category',
      'table.status': 'Status',
      'table.origin': 'Origin',
      'table.updated': 'Updated',
      'table.action': 'Actions',
      'table.edit': 'Rename / Edit',
      'table.empty': 'No matching skills.',
      'table.clearFilters': 'Clear search and filters',
      'list.open': 'Open skill',
      'list.editAffordance': 'Edit',
      'filter.label': 'Filter by review status',
      'status.fresh': 'Fresh',
      'status.stale': 'Stale',
      'status.untranslated': 'Untranslated',
      'status.draft': 'Draft',
      'origin.builtin': 'Built-in',
      'origin.user': 'User',
      'origin.project': 'Project',
      'origin.none': '—',
      'origin.draft': 'Not reviewed',
      'detail.title': 'Skill details',
      'detail.back': 'Back to list',
      'detail.zh': 'Chinese',
      'detail.layers': 'Chinese source',
      'detail.source': 'English source',
      'detail.name': 'Display name',
      'detail.alias': 'Aliases (comma separated)',
      'detail.summary': 'Chinese summary (≤40 chars)',
      'detail.description': 'Description',
      'detail.useSource': 'Use source description',
      'detail.useSourceHint': 'Fill the description above with the skill\u2019s original description; when the summary is empty, its first 40 characters are used.',
      'detail.whenToUse': 'When to use',
      'detail.notFor': 'When not to use',
      'detail.category': 'Category',
      'detail.tags': 'Tags (comma separated)',
      'detail.keywords': 'Keywords (comma separated)',
      'detail.save': 'Save Chinese',
      'detail.saving': 'Saving…',
      'detail.regenerate': 'Regenerate',
      'detail.regenerating': 'Submitted…',
      'detail.stale': 'The skill file changed; the current translation may be stale. Consider regenerating it.',
      'detail.updatedAt': 'English source updated',
      'detail.hash': 'Content hash',
      'detail.path': 'Skill path',
      'detail.body': 'Body preview',
      'detail.empty': 'No Chinese content yet. Edit and save directly.',
      'detail.noCategory': 'Uncategorized',
      'detail.noChanges': 'Content is already up to date.',
      'detail.emptyZh': 'Chinese content is empty: fill in a Chinese name or summary first.',
      'detail.removeOverride': 'Remove Chinese override',
      'detail.removeConfirm': 'Click again to confirm removal',
      'detail.removeHint': 'Delete the user-layer entry and fall back to built-in or project content',
      'detail.removeOk': 'Chinese override removed.',
      'detail.removeFail': 'Failed to remove',
      'detail.removing': 'Removing…',
      'detail.installSource': 'Install source',
      'detail.sourceFetch': 'Read summary from install source',
      'detail.sourceLoading': 'Reading…',
      'detail.sourceFilled': 'Chinese summary filled from the install source. Review and save.',
      'detail.sourceEnFilled': 'The install source only has an English summary; it was filled into the description field. Rewrite it in Chinese or use "AI retranslate".',
      'detail.sourceNone': 'No summary for this skill in the install source. Fill it in manually.',
      'detail.sourceKept': 'The summary already has content; your text was kept.',
      'detail.sourceFail': 'Failed to read the install source',
      'detail.saveOk': 'Chinese content saved.',
      'detail.saveFail': 'Save failed',
      'detail.regenerateFail': 'Failed to start translation',
      'detail.uninstall': 'Uninstall skill',
      'detail.uninstallConfirm': 'Click again to confirm uninstall',
      'detail.uninstallHint': 'The skill folder moves to the recycle bin; restore or purge it on the Settings page.',
      'detail.sourceDescription': 'Source description (English)',
      'detail.review': 'Confirm review',
      'detail.reviewing': 'Reviewing…',
      'detail.reviewOk': 'Review confirmed.',
      'detail.reviewHint': 'Save the current Chinese content and mark it reviewed',
      'detail.dirty': 'Unsaved changes',
      'detail.saved': 'No unsaved changes',
      'detail.discard': 'Discard changes',
      'detail.discardConfirm': 'Click again to discard',
      'detail.removeCancel': 'Cancel removal',
      'detail.uninstallCancel': 'Cancel uninstall',
      'detail.draftFound': 'Unsaved draft from last session found',
      'detail.draftRestore': 'Restore draft',
      'detail.draftDiscard': 'Discard draft',
      'detail.uninstalling': 'Uninstalling…',
      'detail.uninstallOk': 'Uninstalled. The skill was moved to the recycle bin.',
      'detail.uninstallFail': 'Failed to uninstall',
      'settings.title': 'Settings',
      'settings.enabled': 'Enable the Chinese layer',
      'settings.enabledHint': 'When disabled, the / menu falls back to English; this management page keeps its Chinese editor. No skill file is modified.',
      'settings.mode': 'Menu display mode',
      'settings.mode.decorate': 'Decorate (recommended)',
      'settings.mode.decorateHint': 'Show Chinese names and descriptions inside the official skill group, grouped by Chinese category. No extra menu group.',
      'settings.mode.overlay': 'Overlay (compatibility)',
      'settings.mode.overlayHint': 'Keep the official English group and add a separate Chinese "技能" group. Use if decorating does not work.',
      'settings.mode.off': 'Disable menu i18n',
      'settings.mode.offHint': 'Same effect as turning off the switch above; kept for older settings.',
      'settings.mode.unknown': 'Unknown mode',
      'settings.pinyin': 'Enable pinyin search',
      'settings.pinyinHint': 'Search Chinese skills by full pinyin (quanwangdiaoyan) or initials (qwdy).',
      'settings.recent': 'Show recently used',
      'settings.recentHint': 'Pin recently used skills to the top of the / menu (up to 6, stored in this browser).',
      'settings.provider': 'AI retranslate (optional)',
      'settings.providerLabel': 'Provider',
      'settings.model': 'Model',
      'settings.modelHint': 'Leave empty to use the host default (deepseek-account / deepseek-flash).',
      'settings.save': 'Save settings',
      'settings.saving': 'Saving…',
      'settings.saveOk': 'Settings saved. Reopen the / menu to apply.',
      'settings.saveFail': 'Failed to save settings',
      'settings.clearRecent': 'Clear recent skills',
      'settings.clearConfirm': 'Click again to clear',
      'settings.clearCancel': 'Cancel',
      'settings.purgeCancel': 'Cancel permanent delete',
      'settings.dirty': 'Unsaved settings',
      'settings.synced': 'Settings synced',
      'settings.storeTitle': 'Storage',
      'settings.recentCleared': 'Recent skills cleared.',
      'settings.trash': 'Recycle bin',
      'settings.trashHint': 'Uninstalled personal skills are moved here first; restore them or delete permanently.',
      'settings.trashEmpty': 'The recycle bin is empty.',
      'settings.trashLoading': 'Reading the recycle bin…',
      'settings.trashBusy': 'Working…',
      'settings.trashRestore': 'Restore',
      'settings.trashPurge': 'Delete permanently',
      'settings.trashPurgeConfirm': 'Click again to delete permanently',
      'settings.trashRestoreOk': 'Restored to ~/.agents/skills.',
      'settings.trashPurgeOk': 'Deleted permanently.',
      'settings.trashFail': 'Operation failed',
      'settings.store': 'Data directory',
      'settings.builtinVersion': 'Built-in translation pack',
      'settings.saved': 'Saved',
      'menu.recent': 'Recent',
      'menu.untranslated': 'Untranslated',
      'menu.uncategorized': 'Uncategorized',
      'error.network': 'Cannot reach the host service. Make sure the dsh-skill-workbench plugin is loaded.',
      'error.http': 'Request failed (HTTP {status})',
      'error.badPayload': 'The host returned an unexpected payload.',
      'error.loadList': 'Failed to load skills',
      'error.refreshFailed': 'Background refresh failed; showing the last loaded data',
      'error.loadStatus': 'Failed to load status',
      'error.render': 'The management page failed to render',
      'notice.close': 'Dismiss',
    };

    // ------------------------------------------------------------------
    // 基础工具
    // ------------------------------------------------------------------
    function detectLanguage() {
      try {
        var lang = document && document.documentElement ? document.documentElement.lang : '';
        if (lang) return /^zh/i.test(lang) ? 'zh' : 'en';
      } catch (e) {}
      try {
        var nav = typeof navigator !== 'undefined' ? navigator : null;
        var list = nav && nav.languages && nav.languages.length ? nav.languages : [nav && nav.language];
        for (var i = 0; i < list.length; i++) {
          if (typeof list[i] === 'string' && list[i]) return /^zh/i.test(list[i]) ? 'zh' : 'en';
        }
      } catch (e) {}
      return 'zh';
    }

    var LOCAL_COPY = detectLanguage() === 'en' ? COPY_EN : COPY_ZH;
    var translate = null;

    function formatTemplate(template, params) {
      if (!params || typeof template !== 'string') return template;
      return template.replace(/\{(\w+)\}/g, function (match, key) {
        var value = params[key];
        return value === undefined || value === null ? match : String(value);
      });
    }

    function t(key, params) {
      if (translate) {
        try {
          var value = translate(key, params);
          if (typeof value === 'string' && value !== key && value !== '') return value;
        } catch (e) {}
      }
      var fallback = LOCAL_COPY[key];
      if (typeof fallback !== 'string') return key;
      return params ? formatTemplate(fallback, params) : fallback;
    }

    function pageTranslate(seatTranslate) {
      return function (key, params) {
        if (typeof seatTranslate === 'function') {
          try {
            var value = seatTranslate(key, params);
            if (typeof value === 'string' && value !== key && value !== '') return value;
          } catch (e) {}
        }
        return t(key, params);
      };
    }

    function warn(label, err) {
      try {
        console.warn('[dsh-skill-workbench] ' + label + ' 失败：' + errorText(err));
      } catch (e) {}
    }

    function errorText(err) {
      try {
        if (err && typeof err.message === 'string' && err.message) return err.message;
        if (typeof err === 'string' && err) return err;
      } catch (e) {}
      return t('page.unknown');
    }

    function isObject(value) {
      return !!value && typeof value === 'object' && !Array.isArray(value);
    }

    function toArray(value) {
      return Array.isArray(value) ? value : [];
    }

    function asString(value) {
      return typeof value === 'string' ? value : '';
    }

    /** 单行摘要：压缩空白；超长截断并补省略号。 */
    function clipText(value, max) {
      var text = asString(value).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '');
      if (!text) return '';
      var limit = typeof max === 'number' && max > 0 ? max : 80;
      return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
    }

    function getService(ctx, name) {
      if (!ctx) return undefined;
      try {
        if (typeof ctx.get === 'function') {
          var fromGet = ctx.get(name);
          if (fromGet !== undefined && fromGet !== null) return fromGet;
        }
      } catch (e) {}
      try {
        var direct = ctx[name];
        if (direct !== undefined && direct !== null) return direct;
      } catch (e) {}
      return undefined;
    }

    // ctx.effect 存在时交给它管理生命周期；否则退化为直接执行（并把 disposer 丢弃）。
    function invokeEffect(ctx, label, callback) {
      if (ctx && typeof ctx.effect === 'function') {
        try {
          return ctx.effect(callback, label);
        } catch (err) {
          warn('ctx.effect(' + label + ')', err);
          return undefined;
        }
      }
      try {
        return callback();
      } catch (err) {
        warn(label, err);
        return undefined;
      }
    }

    function requireFetch() {
      if (typeof fetch !== 'function') throw new Error(t('error.network'));
      return fetch;
    }

    function formatTime(value) {
      if (value === undefined || value === null || value === '') return t('page.none');
      try {
        var date = new Date(value);
        if (isNaN(date.getTime())) return String(value);
        function pad(num) {
          return num < 10 ? '0' + num : String(num);
        }
        return (
          date.getFullYear() +
          '-' +
          pad(date.getMonth() + 1) +
          '-' +
          pad(date.getDate()) +
          ' ' +
          pad(date.getHours()) +
          ':' +
          pad(date.getMinutes())
        );
      } catch (e) {
        return String(value);
      }
    }

    function shortHash(hash) {
      if (!isObject(hash)) return '';
      var head = asString(hash.frontmatter).slice(0, 8);
      var body = asString(hash.body).slice(0, 8);
      if (!head && !body) return '';
      return (head || '?') + '/' + (body || '?');
    }

    // ------------------------------------------------------------------
    // 宿主 HTTP API（文档相对路径，无前导 '/'）
    // ------------------------------------------------------------------
    var indexCache = null; // { data: Index, at: number }
    var indexInflight = null;
    var indexError = null;
    var lastIndexFailureAt = 0;

    async function apiRequest(path, options) {
      var doFetch = requireFetch();
      var res;
      try {
        res = await doFetch(path, options);
      } catch (err) {
        var networkError = new Error(t('error.network'));
        networkError.code = 'ERR_NETWORK';
        networkError.cause = err;
        throw networkError;
      }
      var text = '';
      try {
        if (res && typeof res.text === 'function') text = await res.text();
        else if (res && typeof res.json === 'function') text = JSON.stringify(await res.json());
      } catch (e) {
        text = '';
      }
      var body = null;
      if (text) {
        try {
          body = JSON.parse(text);
        } catch (e) {
          body = null;
        }
      }
      var okStatus = !!res && (res.ok === true || (typeof res.status === 'number' && res.status >= 200 && res.status < 300));
      if (!okStatus) {
        var statusMessage = isObject(body) && asString(body.message) ? body.message : t('error.http', { status: res && res.status ? res.status : '?' });
        var httpError = new Error(statusMessage);
        httpError.code = (isObject(body) && asString(body.code)) || 'ERR_HTTP';
        httpError.status = res && typeof res.status === 'number' ? res.status : 0;
        throw httpError;
      }
      if (!isObject(body) || body.ok === false) {
        var payloadMessage = isObject(body) && asString(body.message) ? body.message : t('error.badPayload');
        var payloadError = new Error(payloadMessage);
        payloadError.code = (isObject(body) && asString(body.code)) || 'ERR_BAD_PAYLOAD';
        throw payloadError;
      }
      return body;
    }

    function apiPost(path, payload) {
      return apiRequest(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload || {}),
      });
    }

    function apiGet(path) {
      return apiRequest(path, { headers: { accept: 'application/json' } });
    }

    function normalizeSettings(raw) {
      var source = isObject(raw) ? raw : {};
      var mode = source.mode;
      if (mode !== 'decorate' && mode !== 'overlay' && mode !== 'off') mode = 'decorate';
      return {
        enabled: source.enabled !== false,
        mode: mode,
        pinyinSearch: source.pinyinSearch !== false,
        showRecent: source.showRecent !== false,
        translatorProvider: asString(source.translatorProvider),
        translatorModel: asString(source.translatorModel),
      };
    }

    function normalizeCategories(raw) {
      var list = [];
      var byId = new Map();
      var input = toArray(raw);
      for (var i = 0; i < input.length; i++) {
        var item = input[i];
        if (!isObject(item)) continue;
        var id = asString(item.id).trim();
        if (!id) continue;
        var zh = asString(item.zh).trim();
        var hasOrder = typeof item.order === 'number' && Number.isFinite(item.order);
        var order = hasOrder ? item.order : 0;
        var icon = asString(item.icon).trim();
        var parent = asString(item.parent).trim() || null;
        var existing = byId.get(id);
        // 防御宿主异常数据：同一 id 只保留首次出现的条目，后续只做字段级覆盖（近似 mergeCategories）。
        // 注意 list 保持插入序，宿主 mergeCategories 会按 order 重排；正常链路 categories 已由宿主去重并排序。
        if (existing) {
          if (zh) existing.zh = zh;
          if (hasOrder) existing.order = order;
          if (icon) existing.icon = icon;
          if (parent) existing.parent = parent;
          continue;
        }
        var category = {
          id: id,
          zh: zh || id,
          order: order,
          icon: icon,
          parent: parent,
        };
        list.push(category);
        byId.set(id, category);
      }
      return { list: list, byId: byId };
    }

    function normalizeSkillView(raw) {
      var source = isObject(raw) ? raw : {};
      var zh = isObject(source.zh) ? source.zh : null;
      var status = source.status === 'stale' || source.status === 'untranslated' ? source.status : 'fresh';
      if (!zh && status === 'fresh') status = 'untranslated';
      return {
        name: asString(source.name),
        description: asString(source.description),
        whenToUse: asString(source.whenToUse),
        modelInvocable: source.modelInvocable !== false,
        path: asString(source.path),
        source: isObject(source.source) ? source.source : null,
        hash: isObject(source.hash) ? source.hash : null,
        bodyPreview: asString(source.bodyPreview),
        status: status,
        zh: zh,
        origin: asString(source.origin) || null,
        updatedAt: source.updatedAt || null,
        dirName: asString(source.dirName),
        // layers / install 必须透传：宿主 /list 明确下发这两个字段，
        // 详情页的「清除中文覆盖」「安装来源」与 confirmReview 判定都依赖它们。
        layers: toArray(source.layers).map(function (layer) {
          var item = isObject(layer) ? layer : {};
          return {
            source: asString(item.source) || null,
            origin: asString(item.origin) || null,
            review: item.review === 'draft' || item.review === 'reviewed' ? item.review : null,
            updatedAt: item.updatedAt || null,
          };
        }),
        install: isObject(source.install) ? source.install : null,
      };
    }

    function normalizeIndex(body) {
      var categories = normalizeCategories(body.categories);
      var skills = [];
      var byName = new Map();
      var input = toArray(body.skills);
      for (var i = 0; i < input.length; i++) {
        var skill = normalizeSkillView(input[i]);
        if (!skill.name) continue;
        skills.push(skill);
        byName.set(skill.name, skill);
      }
      return {
        generatedAt: body.generatedAt || null,
        store: isObject(body.store) ? body.store : {},
        settings: normalizeSettings(body.settings),
        categories: categories.list,
        catById: categories.byId,
        skills: skills,
        byName: byName,
        coverage: isObject(body.coverage) ? body.coverage : {},
      };
    }

    async function loadIndex(force) {
      var now = Date.now();
      if (!force) {
        if (indexCache && now - indexCache.at < INDEX_TTL_MS) return indexCache.data;
        if (lastIndexFailureAt && now - lastIndexFailureAt < INDEX_FAIL_RETRY_MS) return null;
      }
      // 强制刷新不能复用保存前发出的旧请求，否则会拿到保存前的列表数据。
      if (indexInflight && !force) return indexInflight;
      var startedAt = Date.now();
      var request = (async function () {
        try {
          var body = await apiRequest(API_BASE + '/list', {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          });
          if (!Array.isArray(body.skills) || !Array.isArray(body.categories)) {
            throw new Error(t('error.badPayload'));
          }
          var data = normalizeIndex(body);
          // 旧响应晚到时不能覆盖更新的缓存：保存成功触发的强制刷新可能先返回，
          // 此时 30s 静默刷新的旧响应还在路上，直接写缓存会让 UI 回退到保存前。
          if (indexCache && indexCache.at > startedAt) return indexCache.data;
          indexCache = { data: data, at: Date.now() };
          indexError = null;
          lastIndexFailureAt = 0;
          return data;
        } catch (err) {
          if (indexCache && indexCache.at > startedAt) return indexCache.data;
          indexError = err;
          lastIndexFailureAt = Date.now();
          return null;
        } finally {
          if (indexInflight === request) indexInflight = null;
        }
      })();
      indexInflight = request;
      return request;
    }

    function invalidateIndex() {
      indexCache = null;
      lastIndexFailureAt = 0;
    }

    // ------------------------------------------------------------------
    // / 菜单装饰：最近使用、分类、中文行、搜索打分
    // ------------------------------------------------------------------
    function safeLocalStorage() {
      try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
      } catch (e) {
        return null;
      }
    }

    // ------------------------------------------------------------------
    // 草稿救援：编辑中的表单持续镜像到 sessionStorage。
    // 有些离开路径插件拦不住（宿主切面板改 hash、技能被外部卸载后索引刷新），
    // 与其事后追责，不如让未保存内容可恢复：再次打开详情时询问是否还原草稿。
    // ------------------------------------------------------------------
    var DRAFT_PREFIX = 'skw:draft:';

    function draftKey(name) {
      return DRAFT_PREFIX + asString(name);
    }

    function readDraft(name) {
      try {
        var raw = sessionStorage.getItem(draftKey(name));
        if (!raw) return null;
        var parsed = JSON.parse(raw);
        if (!isObject(parsed)) return null;
        var form = emptyFormShape();
        for (var key in form) {
          if (typeof parsed[key] === 'string') form[key] = parsed[key];
        }
        return form;
      } catch (e) {
        return null;
      }
    }

    function writeDraft(name, form) {
      try {
        sessionStorage.setItem(draftKey(name), JSON.stringify(form));
      } catch (e) {}
    }

    function clearDraft(name) {
      try {
        sessionStorage.removeItem(draftKey(name));
      } catch (e) {}
    }

    function hasDraft(name) {
      try {
        return !!sessionStorage.getItem(draftKey(name));
      } catch (e) {
        return false;
      }
    }

    function emptyFormShape() {
      return {
        name: '',
        alias: '',
        summary: '',
        description: '',
        whenToUse: '',
        notFor: '',
        category: '',
        tags: '',
        keywords: '',
      };
    }

    function readRecent() {
      var storage = safeLocalStorage();
      if (!storage) return [];
      try {
        var raw = storage.getItem(RECENT_KEY);
        if (!raw) return [];
        var parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        var names = [];
        for (var i = 0; i < parsed.length && names.length < MAX_RECENT; i++) {
          if (typeof parsed[i] === 'string' && parsed[i] && names.indexOf(parsed[i]) === -1) names.push(parsed[i]);
        }
        return names;
      } catch (e) {
        return [];
      }
    }

    function writeRecent(names) {
      var storage = safeLocalStorage();
      if (!storage) return;
      try {
        storage.setItem(RECENT_KEY, JSON.stringify(names.slice(0, MAX_RECENT)));
      } catch (e) {}
    }

    function recordRecent(name, settings) {
      if (typeof name !== 'string' || !name) return;
      try {
        if (settings && settings.showRecent === false) return;
        var list = readRecent().filter(function (item) {
          return item !== name;
        });
        list.unshift(name);
        writeRecent(list);
      } catch (e) {}
    }

    function clearRecent() {
      var storage = safeLocalStorage();
      if (!storage) return;
      try {
        storage.removeItem(RECENT_KEY);
      } catch (e) {}
    }

    var iconComponentCache = new Map();

    function categoryIcon(emoji) {
      if (!emoji) return null;
      var cached = iconComponentCache.get(emoji);
      if (cached) return cached;
      var Component = function SkillCategoryIcon() {
        return h(
          'span',
          { style: { fontSize: '13px', lineHeight: '1', display: 'inline-block' }, 'aria-hidden': 'true' },
          emoji
        );
      };
      iconComponentCache.set(emoji, Component);
      return Component;
    }

    function topCategory(index, category) {
      var current = category;
      var guard = 0;
      while (current && current.parent && index.catById.has(current.parent) && guard < 8) {
        current = index.catById.get(current.parent);
        guard += 1;
      }
      return current || null;
    }

    function resolveSection(index, categoryId) {
      var id = asString(categoryId);
      if (id && index.catById.has(id)) {
        var top = topCategory(index, index.catById.get(id));
        if (top) return top;
      }
      return { id: 'uncategorized', zh: t('menu.uncategorized'), order: 900, icon: '📦' };
    }

    function makeItem(row, baseIndex, index) {
      var name = asString(row.name);
      var skill = index.byName.get(name) || null;
      var zh = skill && isObject(skill.zh) ? skill.zh : null;
      return { row: row, skill: skill, zh: zh, name: name, baseIndex: baseIndex };
    }

    function decorateEntry(item, index) {
      var out = {};
      var row = item.row;
      for (var key in row) {
        if (Object.prototype.hasOwnProperty.call(row, key)) out[key] = row[key];
      }
      var zh = item.zh;
      if (!zh) {
        out.section = t('menu.untranslated');
        return { row: out, sectionOrder: 9999, baseIndex: item.baseIndex, untranslated: true };
      }
      var zhName = asString(zh.name);
      if (zhName) out.label = zhName;
      var zhSummary = asString(zh.summary);
      if (zhSummary) out.description = zhSummary;
      var section = resolveSection(index, zh.category);
      out.section = section.zh;
      var icon = section.icon ? categoryIcon(section.icon) : null;
      if (icon) out.icon = icon;
      var order = Number(section.order);
      return {
        row: out,
        sectionOrder: Number.isFinite(order) ? order : 900,
        baseIndex: item.baseIndex,
        untranslated: false,
      };
    }

    function buildRecentRank(settings) {
      var rank = new Map();
      if (settings && settings.showRecent === false) return rank;
      var names = readRecent();
      for (var i = 0; i < names.length; i++) rank.set(names[i], i);
      return rank;
    }

    function appendEntries(target, entries, extra) {
      for (var i = 0; i < entries.length; i++) {
        if (extra) extra(entries[i]);
        target.push(entries[i].row);
      }
    }

    function scoreText(value, token, exactScore, prefixScore, includesScore) {
      if (typeof value !== 'string' || !value) return 0;
      var haystack = value.toLowerCase();
      if (haystack === token) return exactScore;
      if (haystack.indexOf(token) === 0) return prefixScore;
      if (haystack.indexOf(token) !== -1) return includesScore;
      return 0;
    }

    function scoreList(values, token, exactScore, prefixScore, includesScore) {
      var list = toArray(values);
      var best = 0;
      for (var i = 0; i < list.length; i++) {
        var score = scoreText(list[i], token, exactScore, prefixScore, includesScore);
        if (score > best) best = score;
      }
      return best;
    }

    function scoreItem(item, tokens, settings) {
      var zh = item.zh;
      var row = item.row;
      var total = 0;
      for (var i = 0; i < tokens.length; i++) {
        var token = tokens[i];
        if (!token) continue;
        var best = 0;
        if (zh) {
          best = Math.max(best, scoreText(zh.name, token, 100, 90, 80));
          best = Math.max(best, scoreList(zh.alias, token, 70, 68, 66));
          best = Math.max(best, scoreList(zh.keywords, token, 62, 60, 58));
          best = Math.max(best, scoreList(zh.tags, token, 58, 56, 54));
          if (settings.pinyinSearch !== false) {
            best = Math.max(best, scoreText(zh.pinyin, token, 58, 56, 54));
            best = Math.max(best, scoreText(zh.pinyinInitials, token, 52, 50, 48));
          }
          best = Math.max(best, scoreText(zh.summary, token, 0, 0, 30));
          best = Math.max(best, scoreText(zh.description, token, 0, 0, 26));
          best = Math.max(best, scoreText(zh.whenToUse, token, 0, 0, 24));
        }
        best = Math.max(best, scoreText(row.name, token, 46, 44, 42));
        best = Math.max(best, scoreText(row.description, token, 0, 0, 20));
        if (!best) return 0;
        total += best;
      }
      return total;
    }

    function searchItems(items, query, index, settings) {
      var tokens = query.toLowerCase().split(/\s+/);
      var matches = [];
      for (var i = 0; i < items.length; i++) {
        var score = scoreItem(items[i], tokens, settings);
        if (score > 0) matches.push({ item: items[i], score: score });
      }
      matches.sort(function (a, b) {
        return b.score - a.score || a.item.baseIndex - b.item.baseIndex;
      });
      var out = [];
      for (var j = 0; j < matches.length; j++) {
        out.push(decorateEntry(matches[j].item, index).row);
      }
      return out;
    }

    function decorateMenu(rows, index, query, settings) {
      var items = [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        if (!isObject(row) || !asString(row.name)) continue;
        items.push(makeItem(row, i, index));
      }
      var effectiveSettings = settings || index.settings || normalizeSettings(null);
      var cleaned = typeof query === 'string' ? query.trim() : '';
      if (cleaned) return searchItems(items, cleaned, index, effectiveSettings);

      var recentRank = buildRecentRank(effectiveSettings);
      var recent = [];
      var grouped = [];
      var untranslated = [];
      for (var j = 0; j < items.length; j++) {
        var item = items[j];
        var entry = decorateEntry(item, index);
        if (recentRank.has(item.name)) {
          entry.row.section = t('menu.recent');
          entry.sectionOrder = -1;
          entry.recentRank = recentRank.get(item.name);
          recent.push(entry);
        } else if (entry.untranslated) {
          untranslated.push(entry);
        } else {
          grouped.push(entry);
        }
      }
      recent.sort(function (a, b) {
        return a.recentRank - b.recentRank;
      });
      grouped.sort(function (a, b) {
        return a.sectionOrder - b.sectionOrder || a.baseIndex - b.baseIndex;
      });
      var out = [];
      appendEntries(out, recent);
      appendEntries(out, grouped);
      appendEntries(out, untranslated);
      return out;
    }

    // ------------------------------------------------------------------
    // 诊断上报（首次装饰成功/失败各一次，失败静默）
    // ------------------------------------------------------------------
    var diagSent = false;
    var lastDecorateReport = null;

    function reportDiag(payload) {
      if (diagSent) return;
      diagSent = true;
      var record = {
        mode: payload && payload.mode ? payload.mode : 'decorate',
        decorated: !!(payload && payload.decorated),
        rows: payload && Number.isFinite(Number(payload.rows)) ? Number(payload.rows) : 0,
        at: new Date().toISOString(),
      };
      if (payload && payload.error) record.error = String(payload.error);
      lastDecorateReport = record;
      try {
        if (typeof fetch !== 'function') return;
        var result = fetch(API_BASE + '/diag', {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(record),
          keepalive: true,
        });
        if (result && typeof result.catch === 'function') result.catch(function () {});
      } catch (e) {}
    }

    // ------------------------------------------------------------------
    // 内置 skill source 包装
    // ------------------------------------------------------------------
    var wrappedSource = null;
    var watchTimer = null;
    var watchAttempts = 0;
    var watchCtx = null;

    function findSkillSource(ctx) {
      var service = getService(ctx, 'inputTriggers');
      if (!service) return { service: null, source: null };
      var sources = null;
      try {
        sources = service.live && Array.isArray(service.live.sources) ? service.live.sources : null;
      } catch (e) {}
      if (!sources) return { service: service, source: null };
      for (var i = 0; i < sources.length; i++) {
        var candidate = sources[i];
        if (candidate && candidate.trigger === '/' && candidate.name === 'skill') {
          return { service: service, source: candidate };
        }
      }
      return { service: service, source: null };
    }

    function callOriginalCandidates(mark, source, session, options) {
      return mark.originalCandidates.apply(source, [session, options]);
    }

    async function decorateCandidates(source, mark, session, options) {
      var opts = isObject(options) ? options : {};
      var index = await loadIndex(false);
      // 官方 source 只按英文名过滤，先传 query:'' 取全量，再自行做中文/拼音过滤。
      var fullOptions = {};
      for (var key in opts) {
        if (Object.prototype.hasOwnProperty.call(opts, key)) fullOptions[key] = opts[key];
      }
      fullOptions.query = '';
      var rows = await callOriginalCandidates(mark, source, session, fullOptions);
      if (!Array.isArray(rows)) return rows;
      if (opts.signal && opts.signal.aborted) return [];
      if (!index) {
        reportDiag({
          mode: 'decorate',
          decorated: false,
          rows: rows.length,
          error: indexError ? errorText(indexError) : '中文索引不可用',
        });
        return rows;
      }
      var settings = index.settings;
      if (!settings.enabled || settings.mode !== 'decorate') {
        reportDiag({ mode: settings.mode, decorated: false, rows: rows.length });
        return rows;
      }
      var coverage = index.coverage || {};
      if (!(Number(coverage.translated) > 0) || index.byName.size === 0) {
        reportDiag({ mode: settings.mode, decorated: false, rows: rows.length });
        return rows;
      }
      var decorated;
      try {
        decorated = decorateMenu(rows, index, opts.query, settings);
      } catch (err) {
        reportDiag({ mode: settings.mode, decorated: false, rows: rows.length, error: errorText(err) });
        return rows;
      }
      reportDiag({ mode: settings.mode, decorated: true, rows: decorated.length });
      return decorated;
    }

    function wrapSkillSource(source) {
      if (!source) return false;
      if (source[WRAP_MARK]) {
        wrappedSource = source;
        return true;
      }
      if (typeof source.candidates !== 'function') return false;
      var mark = {
        originalCandidates: source.candidates,
        originalPick: typeof source.onPick === 'function' ? source.onPick : null,
      };
      try {
        Object.defineProperty(source, WRAP_MARK, {
          value: mark,
          configurable: true,
          enumerable: false,
          writable: true,
        });
      } catch (e) {
        try {
          source[WRAP_MARK] = mark;
        } catch (e2) {
          return false;
        }
      }
      try {
        source.candidates = async function (session, options) {
          try {
            return await decorateCandidates(source, mark, session, options);
          } catch (err) {
            // 异常回退 orig；orig 也失败才抛出，交给 input-trigger 记录 source-failed。
            return mark.originalCandidates.apply(source, [session, options]);
          }
        };
        if (mark.originalPick) {
          source.onPick = function () {
            var args = Array.prototype.slice.call(arguments);
            try {
              var last = args.length ? args[args.length - 1] : undefined;
              var candidate = last;
              if (isObject(last) && last.candidate) candidate = last.candidate;
              var name = isObject(candidate) ? asString(candidate.name) : typeof candidate === 'string' ? candidate : '';
              if (name) {
                var settings = indexCache && indexCache.data ? indexCache.data.settings : null;
                recordRecent(name, settings);
              }
            } catch (e) {}
            return mark.originalPick.apply(source, args);
          };
        }
      } catch (err) {
        warn('包装内置 skill source', err);
        return false;
      }
      wrappedSource = source;
      return true;
    }

    function tryWrapSkillSource(ctx) {
      var found = findSkillSource(ctx);
      if (!found.source) return false;
      return wrapSkillSource(found.source);
    }

    function stopWatch() {
      if (!watchTimer) return;
      try {
        clearInterval(watchTimer);
      } catch (e) {}
      watchTimer = null;
    }

    function watchForSkillSource(ctx) {
      watchCtx = ctx;
      if (tryWrapSkillSource(ctx)) {
        stopWatch();
        return;
      }
      if (watchTimer) return;
      watchAttempts = 0;
      try {
        watchTimer = setInterval(function () {
          watchAttempts += 1;
          if (tryWrapSkillSource(watchCtx) || watchAttempts >= 120) stopWatch();
        }, 500);
      } catch (e) {
        warn('setInterval', e);
      }
    }

    function isSourceLive(ctx, source) {
      return findSkillSource(ctx).source === source;
    }

    function restoreSource() {
      var source = wrappedSource;
      wrappedSource = null;
      if (!source) return;
      var mark = source[WRAP_MARK];
      if (!mark) return;
      try {
        source.candidates = mark.originalCandidates;
      } catch (e) {}
      try {
        if (mark.originalPick) source.onPick = mark.originalPick;
      } catch (e) {}
      try {
        delete source[WRAP_MARK];
      } catch (e) {
        try {
          source[WRAP_MARK] = undefined;
        } catch (e2) {}
      }
    }

    function setupMenu(ctx) {
      watchForSkillSource(ctx);
      var offReset = null;
      if (typeof ctx.on === 'function') {
        try {
          offReset = ctx.on('connection/reset', function () {
            if (!wrappedSource || !isSourceLive(ctx, wrappedSource)) {
              wrappedSource = null;
              watchForSkillSource(ctx);
            }
          });
        } catch (err) {
          warn('ctx.on(connection/reset)', err);
        }
      }
      return function cleanup() {
        stopWatch();
        try {
          if (typeof offReset === 'function') offReset();
        } catch (e) {}
        restoreSource();
      };
    }

    // ------------------------------------------------------------------
    // overlay 兼容模式：自注册 '/' source
    // ------------------------------------------------------------------
    var overlaySource = {
      trigger: '/',
      name: OVERLAY_SOURCE_NAME,
      order: 3,
      showGroupTitle: false,
      warm: function () {},
      candidates: async function (session, options) {
        var opts = isObject(options) ? options : {};
        try {
          var index = await loadIndex(false);
          if (!index) return [];
          var settings = index.settings;
          if (!settings.enabled || settings.mode !== 'overlay') return [];
          if (opts.signal && opts.signal.aborted) return [];
          var coverage = index.coverage || {};
          if (!(Number(coverage.translated) > 0) || index.byName.size === 0) return [];
          var rows = [];
          for (var i = 0; i < index.skills.length; i++) {
            rows.push({ name: index.skills[i].name, description: index.skills[i].description });
          }
          return decorateMenu(rows, index, opts.query, settings);
        } catch (err) {
          return [];
        }
      },
      onPick: function (pick) {
        try {
          var candidate = isObject(pick) && pick.candidate ? pick.candidate : pick;
          var name = isObject(candidate) ? asString(candidate.name) : '';
          if (!name) return undefined;
          var settings = indexCache && indexCache.data ? indexCache.data.settings : null;
          recordRecent(name, settings);
          return { text: '/' + name + ' ' };
        } catch (err) {
          return undefined;
        }
      },
    };

    function registerOverlay(ctx) {
      var service = getService(ctx, 'inputTriggers');
      if (!service || typeof service.registerSource !== 'function') return null;
      try {
        var dispose = service.registerSource(overlaySource);
        return typeof dispose === 'function' ? dispose : null;
      } catch (err) {
        warn('registerSource(overlay)', err);
        return null;
      }
    }

    // ------------------------------------------------------------------
    // 管理页 UI（inline style，全部中文文案；简单但完整可用）
    // ------------------------------------------------------------------
    function sx() {
      var out = {};
      for (var i = 0; i < arguments.length; i++) {
        var source = arguments[i];
        if (!isObject(source)) continue;
        for (var key in source) {
          if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key];
        }
      }
      return out;
    }

    var STYLES = {
      page: {
        height: '100%',
        minHeight: 0,
        overflowY: 'auto',
        overflowX: 'hidden',
        overscrollBehavior: 'contain',
        padding: '20px 24px 32px',
        maxWidth: '1120px',
        margin: '0 auto',
        fontSize: '14px',
        lineHeight: 1.6,
        color: 'inherit',
        fontFamily: 'inherit',
        boxSizing: 'border-box',
      },
      header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' },
      title: { fontSize: '18px', fontWeight: 600, margin: 0, lineHeight: 1.3 },
      h2: { fontSize: '14px', fontWeight: 600, margin: 0, lineHeight: 1.4 },
      detailTitle: { fontSize: '18px', fontWeight: 600, margin: 0, lineHeight: 1.35, minWidth: 0, overflowWrap: 'anywhere' },
      subtitle: { color: 'inherit', opacity: 0.8, fontSize: '13px', margin: '6px 0 0', maxWidth: '760px' },
      row: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      card: {
        border: '1px solid var(--dsh-border, rgba(127,127,127,0.28))',
        borderRadius: '8px',
        padding: '12px 14px',
        background: 'var(--dsh-surface, rgba(127,127,127,0.06))',
      },
      muted: { color: 'inherit', opacity: 0.75 },
      small: { fontSize: '12px' },
      button: {
        cursor: 'pointer',
        border: '1px solid var(--dsh-border, rgba(127,127,127,0.35))',
        background: 'transparent',
        color: 'inherit',
        borderRadius: '6px',
        padding: '5px 12px',
        minHeight: '32px',
        fontSize: '13px',
        lineHeight: 1.5,
      },
      buttonPrimary: {
        cursor: 'pointer',
        border: '1px solid transparent',
        background: 'var(--skw-primary, #2563eb)',
        color: 'var(--skw-on-primary, #fff)',
        borderRadius: '6px',
        padding: '6px 14px',
        minHeight: '32px',
        fontSize: '13px',
        lineHeight: 1.5,
      },
      buttonDanger: {
        cursor: 'pointer',
        border: '1px solid var(--skw-danger-border, rgba(217,83,79,0.6))',
        background: 'var(--skw-danger-bg, rgba(217,83,79,0.08))',
        color: 'var(--skw-danger, #b42318)',
        borderRadius: '6px',
        padding: '5px 12px',
        minHeight: '32px',
        fontSize: '12px',
        lineHeight: 1.5,
      },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        border: '1px solid var(--skw-field-border, var(--dsh-border, rgba(127,127,127,0.35)))',
        background: 'transparent',
        color: 'inherit',
        borderRadius: '6px',
        padding: '6px 9px',
        minHeight: '32px',
        fontSize: '14px',
        fontFamily: 'inherit',
      },
      textarea: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: '70px',
        resize: 'vertical',
        border: '1px solid var(--skw-field-border, var(--dsh-border, rgba(127,127,127,0.35)))',
        background: 'transparent',
        color: 'inherit',
        borderRadius: '6px',
        padding: '6px 9px',
        fontSize: '14px',
        fontFamily: 'inherit',
      },
      tabRow: {
        display: 'flex',
        gap: '4px',
        borderBottom: '1px solid var(--dsh-border, rgba(127,127,127,0.28))',
        marginTop: '16px',
      },
      tab: {
        cursor: 'pointer',
        border: 'none',
        borderBottom: '2px solid transparent',
        background: 'transparent',
        color: 'inherit',
        opacity: 0.8,
        padding: '9px 12px',
        minHeight: '36px',
        fontSize: '13px',
      },
      tabActive: { borderBottomColor: 'var(--skw-primary, #2563eb)', color: 'inherit', fontWeight: 600 },
      table: { width: '100%', borderCollapse: 'collapse', marginTop: '8px' },
      th: {
        textAlign: 'left',
        padding: '6px 8px',
        borderBottom: '1px solid var(--dsh-border, rgba(127,127,127,0.28))',
        fontWeight: 500,
        fontSize: '12.5px',
        color: 'inherit',
        opacity: 0.85,
        whiteSpace: 'nowrap',
      },
      td: {
        padding: '8px 8px',
        fontSize: '13px',
        borderBottom: '1px solid var(--dsh-border, rgba(127,127,127,0.16))',
        verticalAlign: 'top',
      },
      banner: { padding: '8px 10px', borderRadius: '6px', marginTop: '12px', border: '1px solid var(--dsh-border, rgba(127,127,127,0.3))' },
      bannerError: { borderColor: 'var(--skw-danger-border, rgba(217,83,79,0.7))', color: 'var(--skw-danger, #b42318)', background: 'var(--skw-danger-bg, rgba(217,83,79,0.12))' },
      bannerOk: { borderColor: 'var(--skw-success-border, rgba(60,154,95,0.7))', color: 'var(--skw-success, #067647)', background: 'var(--skw-success-bg, rgba(60,154,95,0.12))' },
      bannerWarn: { borderColor: 'var(--skw-warning-border, rgba(201,162,39,0.7))', color: 'var(--skw-warning, #8a5a00)', background: 'var(--skw-warning-bg, rgba(201,162,39,0.12))' },
      bannerInfo: { borderColor: 'var(--skw-field-border, #8a8f98)', color: 'inherit', background: 'var(--skw-hover, rgba(15, 23, 42, 0.05))' },
      badge: {
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '10px',
        fontSize: '12px',
        lineHeight: 1.6,
        color: 'inherit',
        border: '1px solid rgba(127,127,127,0.5)',
        whiteSpace: 'nowrap',
      },
      progress: { height: '6px', borderRadius: '3px', background: 'rgba(127,127,127,0.22)', overflow: 'hidden', marginTop: '6px' },
      progressBar: { height: '100%', background: 'var(--skw-primary, #2563eb)', transition: 'width 0.2s ease' },
      label: { display: 'block', fontSize: '13px', fontWeight: 500, color: 'inherit', opacity: 0.85, marginBottom: '3px' },
      field: { display: 'block', marginTop: '10px' },
      grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px', marginTop: '12px' },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '12.5px' },
      diag: { fontSize: '12.5px', color: 'inherit', opacity: 0.82, marginTop: '6px', wordBreak: 'break-word' },
      pre: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'inherit' },
    };

    // ------------------------------------------------------------------
    // 主题：不假设宿主一定用 .dark / data-theme，运行时读计算色后再兜底
    // ------------------------------------------------------------------
    var THEME_VARS = {
      light: {
        '--skw-primary': '#2563eb',
        '--skw-primary-hover': '#1d4ed8',
        '--skw-on-primary': '#ffffff',
        '--skw-danger': '#b42318',
        '--skw-danger-strong': '#912018',
        '--skw-danger-bg': 'rgba(180, 35, 24, 0.08)',
        '--skw-danger-border': 'rgba(180, 35, 24, 0.5)',
        '--skw-success': '#067647',
        '--skw-success-bg': 'rgba(6, 118, 71, 0.08)',
        '--skw-success-border': 'rgba(6, 118, 71, 0.5)',
        '--skw-warning': '#8a5a00',
        '--skw-warning-bg': 'rgba(138, 90, 0, 0.1)',
        '--skw-warning-border': 'rgba(138, 90, 0, 0.5)',
        '--skw-field-border': '#8a8f98',
        '--skw-field-border-hover': '#59616c',
        '--skw-surface': '#ffffff',
        '--skw-border': '#8a8f98',
        '--skw-focus': '#1d4ed8',
        '--skw-hover': 'rgba(15, 23, 42, 0.05)',
        '--skw-status-fresh': '#067647',
        '--skw-status-fresh-bg': '#e7f6ee',
        '--skw-status-stale': '#8a5a00',
        '--skw-status-stale-bg': '#fdf3d7',
        '--skw-status-untranslated': '#5d646e',
        '--skw-status-untranslated-bg': '#eef0f3',
        '--skw-status-draft': '#6b21a8',
        '--skw-status-draft-bg': '#f3e8ff',
        '--skw-skeleton': 'rgba(15, 23, 42, 0.08)',
        '--skw-skeleton-strong': 'rgba(15, 23, 42, 0.14)',
      },
      dark: {
        '--skw-primary': '#2563eb',
        '--skw-primary-hover': '#1d4ed8',
        '--skw-on-primary': '#ffffff',
        '--skw-danger': '#ffb4ab',
        '--skw-danger-strong': '#ffd7d2',
        '--skw-danger-bg': 'rgba(255, 180, 171, 0.12)',
        '--skw-danger-border': 'rgba(255, 180, 171, 0.5)',
        '--skw-success': '#7ee2b8',
        '--skw-success-bg': 'rgba(126, 226, 184, 0.12)',
        '--skw-success-border': 'rgba(126, 226, 184, 0.5)',
        '--skw-warning': '#f5c451',
        '--skw-warning-bg': 'rgba(245, 196, 81, 0.12)',
        '--skw-warning-border': 'rgba(245, 196, 81, 0.5)',
        '--skw-field-border': '#7b8492',
        '--skw-field-border-hover': '#aab3c0',
        '--skw-surface': '#1b1f24',
        '--skw-border': '#7b8492',
        '--skw-focus': '#93c5fd',
        '--skw-hover': 'rgba(255, 255, 255, 0.06)',
        '--skw-status-fresh': '#7ee2b8',
        '--skw-status-fresh-bg': 'rgba(126, 226, 184, 0.14)',
        '--skw-status-stale': '#f5c451',
        '--skw-status-stale-bg': 'rgba(245, 196, 81, 0.14)',
        '--skw-status-untranslated': '#c3cad6',
        '--skw-status-untranslated-bg': 'rgba(195, 202, 214, 0.14)',
        '--skw-status-draft': '#d8b4fe',
        '--skw-status-draft-bg': 'rgba(216, 180, 254, 0.14)',
        '--skw-skeleton': 'rgba(255, 255, 255, 0.08)',
        '--skw-skeleton-strong': 'rgba(255, 255, 255, 0.14)',
      },
    };

    var THEME_STYLE_ID = 'dsh-skill-workbench-theme';

    function parseCssColor(value) {
      var text = asString(value);
      var match = text.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
      if (!match) return null;
      return [Number(match[1]), Number(match[2]), Number(match[3])];
    }

    function colorLuminance(rgb) {
      var values = [];
      for (var i = 0; i < 3; i++) {
        var channel = Math.max(0, Math.min(255, Number(rgb[i]) || 0)) / 255;
        values.push(channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4));
      }
      return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
    }

    function detectThemeMode() {
      if (typeof document === 'undefined') return 'light';
      try {
        var root = document.documentElement;
        var signals = [root.getAttribute('data-theme'), root.getAttribute('data-color-mode'), root.className];
        if (document.body) signals.push(document.body.className, document.body.getAttribute('data-theme'));
        for (var i = 0; i < signals.length; i++) {
          var signal = asString(signals[i]);
          if (/(^|[\s_-])dark([\s_-]|$)/i.test(signal)) return 'dark';
          if (/(^|[\s_-])light([\s_-]|$)/i.test(signal)) return 'light';
        }
        var computed = window.getComputedStyle ? window.getComputedStyle(root) : null;
        var scheme = computed ? asString(computed.colorScheme) : '';
        if (/dark/i.test(scheme) && !/light/i.test(scheme)) return 'dark';
        if (/light/i.test(scheme) && !/dark/i.test(scheme)) return 'light';
        var sample = computed ? parseCssColor(computed.color) : null;
        if (!sample && document.body) sample = parseCssColor(window.getComputedStyle(document.body).color);
        if (sample) return colorLuminance(sample) > 0.55 ? 'dark' : 'light';
      } catch (e) {}
      try {
        if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
      } catch (e) {}
      return 'light';
    }

    function useThemeMode() {
      var pair = React.useState(detectThemeMode);
      var mode = pair[0];
      var setMode = pair[1];
      React.useEffect(function () {
        function update() {
          setMode(detectThemeMode());
        }
        var media = null;
        var observer = null;
        try {
          if (typeof window.matchMedia === 'function') {
            media = window.matchMedia('(prefers-color-scheme: dark)');
            if (media.addEventListener) media.addEventListener('change', update);
            else if (media.addListener) media.addListener(update);
          }
        } catch (e) {}
        try {
          if (typeof MutationObserver === 'function' && document.documentElement) {
            observer = new MutationObserver(update);
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'data-color-mode', 'style'] });
            if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] });
          }
        } catch (e) {}
        update();
        return function () {
          try {
            if (media && media.removeEventListener) media.removeEventListener('change', update);
            else if (media && media.removeListener) media.removeListener(update);
          } catch (e) {}
          try {
            if (observer) observer.disconnect();
          } catch (e) {}
        };
      }, []);
      return mode;
    }

    var THEME_CSS = [
      '.skw-page { touch-action: manipulation; }',
      '.skw-page button, .skw-page input, .skw-page select, .skw-page textarea { font-family: inherit; }',
      '.skw-page button:not(:disabled), .skw-page a[data-skw-row] { transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, filter 150ms ease; }',
      '.skw-page button:not(:disabled):hover { filter: brightness(1.06); }',
      '.skw-page a[data-skw-row]:hover { background: var(--skw-hover); }',
      '.skw-page :focus-visible { outline: 2px solid var(--skw-focus); outline-offset: 2px; }',
      '.skw-page input:hover, .skw-page textarea:hover, .skw-page select:hover { border-color: var(--skw-field-border-hover); }',
      '.skw-page .skw-skeleton { background: var(--skw-skeleton); border-radius: 4px; animation: skw-shimmer 1.2s ease-in-out infinite; }',
      '@keyframes skw-shimmer { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }',
      '.skw-page .skw-progress-bar { transition: width 200ms ease; }',
      '@media (pointer: coarse) {',
      '  .skw-page button, .skw-page .skw-tab, .skw-page a[data-skw-row] { min-height: 44px; }',
      '}',
      '@media (max-width: 860px) {',
      '  .skw-detail-grid { grid-template-columns: 1fr !important; }',
      '  .skw-detail-zh { order: -1; }',
      '  .skw-page { padding: 16px 16px 24px !important; }',
      '}',
      '@media (max-width: 640px) {',
      '  .skw-search { flex: 1 1 100% !important; width: auto !important; max-width: none !important; }',
      '  .skw-category { flex: 1 1 140px !important; width: auto !important; min-width: 0 !important; }',
      '  .skw-filters { flex: 1 1 100% !important; overflow-x: auto; padding-bottom: 2px; }',
      '  .skw-page { padding: 14px 12px 22px !important; }',
      '}',
      '@media (prefers-reduced-motion: reduce) {',
      '  .skw-page *, .skw-page *::before, .skw-page *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; scroll-behavior: auto !important; }',
      '}',
    ].join('\n');

    function ensureThemeStyle() {
      if (typeof document === 'undefined' || !document.head) return;
      try {
        if (document.getElementById(THEME_STYLE_ID)) return;
        var style = document.createElement('style');
        style.id = THEME_STYLE_ID;
        style.textContent = THEME_CSS;
        document.head.appendChild(style);
      } catch (e) {}
    }

    var MODES = ['decorate', 'overlay', 'off'];
    // 合法筛选值：路由解析与工具栏共用一份，避免 #library?filter=bogus 把列表整空（R18）。
    var SKILL_FILTERS = ['all', 'untranslated', 'stale', 'draft'];
    // 状态徽章只认这四个 key；颜色一律走 --skw-status-* 主题变量，
    // 不再维护一份会和 THEME_VARS 漂移的硬编码色表（R20）。
    var STATUS_KEYS = { fresh: true, stale: true, untranslated: true, draft: true };

    function parseList(value) {
      var text = asString(value);
      if (!text) return [];
      var parts = text.split(/[,，]/);
      var out = [];
      for (var i = 0; i < parts.length; i++) {
        var part = parts[i].replace(/^\s+|\s+$/g, '');
        if (part) out.push(part);
      }
      return out;
    }

    function joinList(value) {
      return toArray(value).join(', ');
    }

    function percentOf(part, total) {
      var whole = Number(total) || 0;
      if (whole <= 0) return 0;
      return Math.max(0, Math.min(100, Math.round((Number(part) || 0) / whole * 100)));
    }

    function modeLabel(tr, mode) {
      if (MODES.indexOf(mode) === -1) return tr('settings.mode.unknown');
      return tr('settings.mode.' + mode);
    }

    function skillStatusKey(skill) {
      if (!skill || !isObject(skill.zh)) return 'untranslated';
      if (skill.status === 'stale') return 'stale';
      if (skill.zh.review === 'draft') return 'draft';
      return 'fresh';
    }

    // 覆盖率卡的来源四桶：只读 /list 已下发的 zh 与 layers，不改宿主契约。
    // builtin/local/none/unknown 必须覆盖全部技能；stale/draft 是独立状态，不参与四桶。
    function computeGapBuckets(skills) {
      var list = toArray(skills);
      var buckets = { builtin: 0, local: 0, none: 0, unknown: 0, stale: 0, draft: 0, total: list.length };
      for (var i = 0; i < list.length; i++) {
        var skill = isObject(list[i]) ? list[i] : {};
        var zh = isObject(skill.zh) && Object.keys(skill.zh).length > 0 ? skill.zh : null;
        if (!zh) {
          buckets.none += 1;
        } else {
          var layers = toArray(skill.layers);
          var hasBuiltin = false;
          var hasLocal = false;
          for (var j = 0; j < layers.length; j++) {
            var source = isObject(layers[j]) ? layers[j].source : null;
            if (source === 'builtin') hasBuiltin = true;
            else if (source === 'user' || source === 'project') hasLocal = true;
          }
          if (hasBuiltin) buckets.builtin += 1;
          else if (hasLocal) buckets.local += 1;
          // 有中文却没有可识别的来源层：旧宿主（无 layers）或未知 source 都归这里，不猜。
          else buckets.unknown += 1;
        }
        if (skill.status === 'stale') buckets.stale += 1;
        if (zh && zh.review === 'draft') buckets.draft += 1;
      }
      return buckets;
    }

    function categoryText(index, categoryId) {
      var id = asString(categoryId);
      if (!id) return '';
      var category = index && index.catById ? index.catById.get(id) : null;
      if (!category) return '';
      if (category.parent && index.catById.has(category.parent)) {
        return index.catById.get(category.parent).zh + ' / ' + category.zh;
      }
      return category.zh;
    }

    // 线性「打开的书」图标（Lucide/Feather 的 book-open 风格）：只描边不填充，
    // 24 网格、圆头圆角、颜色跟随 currentColor，随明暗主题自动变化。
    var PANEL_ICON_PATHS = [
      'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z',
      'M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
    ];

    function PanelIcon(props) {
      var size = props && Number(props.size) > 0 ? Number(props.size) : 18;
      return h(
        'svg',
        {
          'data-dsh-panel-entry': PANEL_ID,
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { display: 'block' },
        },
        PANEL_ICON_PATHS.map(function (d, i) {
          return h('path', { key: 'p' + i, d: d });
        })
      );
    }

    function Banner(props) {
      var tr = props.tr || pageTranslate(null);
      var tone =
        props.kind === 'error'
          ? STYLES.bannerError
          : props.kind === 'warn'
          ? STYLES.bannerWarn
          : props.kind === 'info'
          ? STYLES.bannerInfo
          : STYLES.bannerOk;
      return h(
        'div',
        { style: sx(STYLES.banner, tone), role: props.kind === 'error' ? 'alert' : 'status' },
        h('span', null, asString(props.text)),
        props.onClose
          ? h(
              'button',
              {
                type: 'button',
                style: sx(STYLES.button, { marginLeft: '10px', padding: '0 6px' }),
                onClick: props.onClose,
                'aria-label': tr('notice.close'),
              },
              '×'
            )
          : null
      );
    }

    function StatusBadge(props) {
      var tr = props.tr;
      // 未知状态归到 untranslated，避免拼出 --skw-status-undefined 这种无效变量。
      var key = STATUS_KEYS[props.status] === true ? props.status : 'untranslated';
      return h(
        'span',
        {
          style: sx(STYLES.badge, {
            borderColor: 'var(--skw-status-' + key + ', currentColor)',
            color: 'var(--skw-status-' + key + ', currentColor)',
            background: 'var(--skw-status-' + key + '-bg, transparent)',
            fontWeight: 500,
          }),
        },
        tr('status.' + key)
      );
    }

    function field(tr, label, child) {
      return h('label', { style: STYLES.field }, h('span', { style: STYLES.label }, label), child);
    }

    function infoRow(tr, label, value) {
      var text = value === undefined || value === null || value === '' ? tr('page.none') : String(value);
      return h(
        'dl',
        { style: { margin: '8px 0 0' } },
        h('dt', { style: STYLES.label }, label),
        h('dd', { style: sx(STYLES.pre, { margin: 0 }) }, text)
      );
    }

    function checkbox(tr, label, checked, onChange) {
      return h(
        'label',
        { style: sx(STYLES.row, { marginTop: '10px', cursor: 'pointer' }) },
        h('input', { type: 'checkbox', checked: !!checked, onChange: function (event) { onChange(!!event.target.checked); } }),
        h('span', null, label)
      );
    }

    class PageBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }
      static getDerivedStateFromError(error) {
        return { error: error };
      }
      componentDidCatch(error) {
        warn('管理页渲染', error);
      }
      render() {
        if (this.state && this.state.error) {
          return h(
            'div',
            { style: STYLES.page },
            h(Banner, {
              tr: pageTranslate(null),
              kind: 'error',
              text: t('error.render') + '：' + errorText(this.state.error),
            })
          );
        }
        return this.props && this.props.children ? this.props.children : null;
      }
    }

    function PageWithBoundary(props) {
      return h(PageBoundary, null, h(Page, props));
    }

    // ---------------------------- Tab 1：技能库 ----------------------------
    function LibraryTab(props) {
      var tr = props.tr;
      var index = props.index;
      var query = asString(props.query);
      var filter = props.filter || 'all';
      var categoryFilter = props.categoryFilter || '';
      var setQuery = props.onQueryChange;
      var setFilter = props.onFilterChange;
      var setCategoryFilter = props.onCategoryChange;
      var batchScope = props.batchScope === 'stale' ? 'stale' : 'untranslated';
      var batchCounts = isObject(props.batchCounts) ? props.batchCounts : {};
      var batchCount = Number(batchCounts[batchScope]) || 0;
      var batchRunning = !!props.batchRunning;
      var batchArmed = !!props.batchArmed;

      var lowered = asString(query).replace(/^\s+|\s+$/g, '').toLowerCase();
      var filters = SKILL_FILTERS;
      var rows = [];
      var skills = index.skills || [];
      for (var i = 0; i < skills.length; i++) {
        var skill = skills[i];
        if (!skill || !skill.name) continue;
        if (filter !== 'all' && skillStatusKey(skill) !== filter) continue;
        if (lowered && !matchSkillText(skill, lowered)) continue;
        if (categoryFilter) {
          var topIdOf = skill.zh ? resolveSection(index, skill.zh.category).id : 'untranslated';
          if (topIdOf !== categoryFilter) continue;
        }
        rows.push(skill);
      }
      rows.sort(function (a, b) {
        var sectionA = a.zh ? resolveSection(index, a.zh.category).order : 900;
        var sectionB = b.zh ? resolveSection(index, b.zh.category).order : 900;
        if (sectionA !== sectionB) return sectionA - sectionB;
        var nameA = a.zh && a.zh.name ? a.zh.name : a.name;
        var nameB = b.zh && b.zh.name ? b.zh.name : b.name;
        return String(nameA).localeCompare(String(nameB));
      });

      // 分类分组头：与 / 菜单的小节保持一致，长列表也能按分类扫读
      var sectionCounts = {};
      for (var sc = 0; sc < rows.length; sc++) {
        var sectionIdOf = rows[sc].zh ? resolveSection(index, rows[sc].zh.category).id : 'untranslated';
        sectionCounts[sectionIdOf] = (sectionCounts[sectionIdOf] || 0) + 1;
      }
      var lastSectionId = null;

      // 分类下拉：按主分类筛选（与 / 菜单分组一致），括号内为当前搜索/状态筛选下可命中的数量。
      // 不含分类本身，避免选中某类后其他类的数字全部变成 0。
      var categoryCounts = {};
      for (var cc = 0; cc < skills.length; cc++) {
        var countSkill = skills[cc];
        if (!countSkill || !countSkill.name) continue;
        if (filter !== 'all' && skillStatusKey(countSkill) !== filter) continue;
        if (lowered && !matchSkillText(countSkill, lowered)) continue;
        var ccId = countSkill.zh ? resolveSection(index, countSkill.zh.category).id : 'untranslated';
        categoryCounts[ccId] = (categoryCounts[ccId] || 0) + 1;
      }
      var categoryOptions = [];
      var topCategories = index.categories || [];
      for (var tci = 0; tci < topCategories.length; tci++) {
        var topCat = topCategories[tci];
        if (!topCat || !topCat.id || topCat.parent) continue;
        categoryOptions.push(
          h('option', { key: topCat.id, value: topCat.id }, (topCat.icon ? topCat.icon + ' ' : '') + (topCat.zh || topCat.id) + '（' + (categoryCounts[topCat.id] || 0) + '）')
        );
      }

      var filterButtons = [];
      for (var f = 0; f < filters.length; f++) {
        var key = filters[f];
        filterButtons.push(
          h(
            'button',
            {
              key: key,
              type: 'button',
              'aria-pressed': filter === key,
              style: sx(STYLES.button, filter === key ? { fontWeight: 600, borderColor: 'var(--skw-primary, #2563eb)', background: 'var(--skw-hover, transparent)' } : null),
              onClick: (function (next) {
                return function () {
                  setFilter(next);
                };
              })(key),
            },
            tr('filter.' + key)
          )
        );
      }

      var listRows = [];
      if (!rows.length) {
        listRows.push(
          h(
            'div',
            { key: 'empty', style: { padding: '28px 8px', textAlign: 'center' } },
            h('div', { style: STYLES.muted }, tr('table.empty')),
            h(
              'button',
              {
                type: 'button',
                style: sx(STYLES.button, { marginTop: '10px' }),
                onClick: function () {
                  if (typeof props.onResetFilters === 'function') props.onResetFilters();
                },
              },
              tr('table.clearFilters')
            )
          )
        );
      }
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var rowZh = isObject(row.zh) ? row.zh : null;
        var rowTitle = rowZh && rowZh.name ? rowZh.name : '/' + row.name;
        var summaryText = asString(rowZh && rowZh.summary) || clipText(row.description, 160);
        var rowSection = row.zh ? resolveSection(index, row.zh.category) : null;
        var rowSectionId = rowSection ? rowSection.id : 'untranslated';
        if (rowSectionId !== lastSectionId) {
          lastSectionId = rowSectionId;
          listRows.push(
            h(
              'h2',
              {
                key: 'section-' + rowSectionId,
                style: sx(STYLES.h2, {
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  margin: r === 0 ? '8px 6px 0' : '20px 6px 0',
                  fontSize: '13px',
                  fontWeight: 600,
                  letterSpacing: '0.02em',
                  color: 'inherit',
                  opacity: 0.95,
                }),
              },
              h('span', null, (rowSection && rowSection.icon ? rowSection.icon + ' ' : '') + (rowSection ? rowSection.zh : tr('status.untranslated'))),
              h('span', { style: { fontWeight: 400, opacity: 0.8 } }, String(sectionCounts[rowSectionId] || 0))
            )
          );
        }
        listRows.push(
          h(
            'a',
            {
              key: row.name,
              id: 'skw-row-' + encodeURIComponent(row.name),
              href: '#skill/' + encodeURIComponent(row.name),
              'data-skw-row': row.name,
              'aria-label': tr('list.open') + ' ' + rowTitle,
              style: {
                display: 'flex',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: '10px',
                padding: '10px 6px',
                borderBottom: '1px solid var(--dsh-border, rgba(127,127,127,0.16))',
                borderRadius: '6px',
                color: 'inherit',
                textDecoration: 'none',
                cursor: 'pointer',
              },
              onClick: (function (name) {
                return function (event) {
                  try {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                  } catch (e) {}
                  props.onOpen(name);
                };
              })(row.name),
            },
            h(
              'div',
              { style: { flex: '1 1 320px', minWidth: '0' } },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' } },
                h(
                  'span',
                  { style: { fontSize: '16px', fontWeight: 600, lineHeight: 1.35, color: 'inherit' } },
                  rowTitle
                ),
                rowZh && rowZh.name
                  ? h('span', { translate: 'no', style: sx(STYLES.mono, { color: 'inherit', opacity: 0.78 }) }, '/' + row.name)
                  : null
              ),
              summaryText
                ? h(
                    'div',
                    {
                      style: {
                        fontSize: '13px',
                        lineHeight: '1.6',
                        color: 'inherit',
                        opacity: 0.88,
                        marginTop: '3px',
                        overflow: 'hidden',
                        display: '-webkit-box',
                        WebkitLineClamp: '2',
                        WebkitBoxOrient: 'vertical',
                      },
                    },
                    summaryText
                  )
                : null
            ),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '6px', flex: '0 0 auto' } },
              categoryText(index, rowZh && rowZh.category)
                ? h('span', { style: sx(STYLES.badge, { color: 'inherit', borderColor: 'rgba(127,127,127,0.45)' }) }, categoryText(index, rowZh && rowZh.category))
                : null,
              h(StatusBadge, { tr: tr, status: skillStatusKey(row) }),
              h(
                'span',
                {
                  'aria-hidden': 'true',
                  style: sx(STYLES.small, { opacity: 0.75, whiteSpace: 'nowrap', padding: '2px 4px' }),
                },
                tr('list.editAffordance') + ' ›'
              )
            )
          )
        );
      }

      var batchPanel = null;
      if (batchArmed || props.batchError || props.batchNotice) {
        var batchPanelRows = [];
        if (batchArmed) {
          batchPanelRows.push(
            h(
              'div',
              {
                key: 'confirm',
                'data-skw-batch-confirm': '1',
                style: sx(STYLES.banner, STYLES.bannerWarn, { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }),
              },
              h('span', { style: sx(STYLES.small, { flex: '1 1 240px' }) }, tr('list.batchConfirm', { count: batchCount })),
              h(
                'button',
                { key: 'run', type: 'button', style: STYLES.buttonPrimary, onClick: props.onBatchConfirm },
                tr('list.batchConfirmRun')
              ),
              h(
                'button',
                { key: 'cancel', type: 'button', style: STYLES.button, onClick: props.onBatchCancel },
                tr('list.batchCancel')
              )
            )
          );
        }
        if (props.batchError) {
          batchPanelRows.push(
            h('div', { key: 'error', role: 'alert', style: sx(STYLES.banner, STYLES.bannerError, { marginTop: '8px' }) }, props.batchError)
          );
        }
        if (!batchArmed && props.batchNotice) {
          batchPanelRows.push(
            h('div', { key: 'notice', role: 'status', style: sx(STYLES.small, STYLES.muted, { marginTop: '6px' }) }, props.batchNotice)
          );
        }
        batchPanel = h('div', { 'data-skw-batch-panel': '1', style: { marginTop: '8px' } }, batchPanelRows);
      }

      return h(
        'div',
        null,
        h(
          'div',
          { style: sx(STYLES.row, { marginTop: '12px', justifyContent: 'space-between' }) },
          h(
            'div',
            { style: sx(STYLES.row, { flex: '1 1 auto', minWidth: 0 }) },
            h('input', {
              value: query,
              type: 'search',
              className: 'skw-search',
              onChange: function (event) {
                setQuery(event.target.value);
              },
              placeholder: tr('filter.placeholder'),
              style: sx(STYLES.input, { width: '280px', flex: '1 1 220px', maxWidth: '280px' }),
              'aria-label': tr('filter.placeholder'),
            }),
            h(
              'select',
              {
                value: categoryFilter,
                className: 'skw-category',
                onChange: function (event) {
                  setCategoryFilter(event.target.value);
                },
                style: sx(STYLES.input, { width: '170px', flex: '0 1 170px', minWidth: '130px', cursor: 'pointer' }),
                'aria-label': tr('filter.categoryAll'),
              },
              h('option', { value: '' }, tr('filter.categoryAll')),
              categoryOptions
            ),
            h(
              'div',
              { className: 'skw-filters', role: 'group', 'aria-label': tr('filter.label'), style: sx(STYLES.row, { gap: '6px' }) },
              filterButtons
            )
          ),
          h(
            'div',
            { style: STYLES.row },
            h(
              'select',
              {
                value: batchScope,
                className: 'skw-batch-scope',
                onChange: function (event) {
                  if (typeof props.onBatchScopeChange === 'function') props.onBatchScopeChange(event.target.value);
                },
                style: sx(STYLES.input, { width: '132px', flex: '0 1 132px', minWidth: '112px', cursor: 'pointer' }),
                'aria-label': tr('list.batchScopeAria'),
              },
              h('option', { value: 'untranslated' }, tr('list.batchScopeUntranslated', { count: Number(batchCounts.untranslated) || 0 })),
              h('option', { value: 'stale' }, tr('list.batchScopeStale', { count: Number(batchCounts.stale) || 0 }))
            ),
            h(
              'button',
              {
                type: 'button',
                'data-skw-batch-start': '1',
                style: sx(STYLES.button, { fontSize: '12px' }),
                onClick: function () {
                  if (typeof props.onBatchArm === 'function') props.onBatchArm();
                },
                disabled: batchCount <= 0 || batchRunning || !!props.batchBusy,
              },
              tr('list.batchTranslate', { count: batchCount })
            ),
            props.onBatchSource
              ? h(
                  'button',
                  {
                    type: 'button',
                    style: sx(STYLES.button, { fontSize: '12px' }),
                    onClick: props.onBatchSource,
                    disabled: !!props.batchBusy,
                  },
                  props.batchBusy ? tr('list.batchBusy') : tr('list.batchSource')
                )
              : null,
            h(
              'span',
              { style: sx(STYLES.muted, STYLES.small) },
              props.batchText || tr('list.count', { count: rows.length })
            )
          )
        ),
        batchPanel,
        h('div', { style: { marginTop: '4px' } }, listRows)
      );
    }

    function matchSkillText(skill, lowered) {
      var zh = isObject(skill.zh) ? skill.zh : null;
      var fields = [skill.name, skill.description];
      if (zh) {
        fields.push(zh.name, zh.summary, zh.description, zh.pinyin, zh.pinyinInitials);
        fields = fields.concat(toArray(zh.alias), toArray(zh.keywords), toArray(zh.tags));
      }
      for (var i = 0; i < fields.length; i++) {
        var value = fields[i];
        if (typeof value === 'string' && value && value.toLowerCase().indexOf(lowered) !== -1) return true;
      }
      return false;
    }

    // ---------------------------- 详情页 ----------------------------
    function emptyForm(skill) {
      var zh = skill && isObject(skill.zh) ? skill.zh : {};
      return {
        name: asString(zh.name),
        alias: joinList(zh.alias),
        summary: asString(zh.summary),
        description: asString(zh.description),
        whenToUse: asString(zh.whenToUse),
        notFor: asString(zh.notFor),
        category: asString(zh.category),
        tags: joinList(zh.tags),
        keywords: joinList(zh.keywords),
      };
    }

    function DetailView(props) {
      var tr = props.tr;
      var index = props.index;
      var skill = props.skill;
      var useState = React.useState;
      var useEffect = React.useEffect;
      var [form, setForm] = useState(emptyForm(skill));
      var [initial, setInitial] = useState(emptyForm(skill));
      var [saving, setSaving] = useState(false);
      var [busy, setBusy] = useState(false);
      var [removeArmed, setRemoveArmed] = useState(false);
      var [removing, setRemoving] = useState(false);
      var [uninstallArmed, setUninstallArmed] = useState(false);
      var [uninstalling, setUninstalling] = useState(false);
      var [sourceBusy, setSourceBusy] = useState(false);
      var [reviewing, setReviewing] = useState(false);
      var [saveError, setSaveError] = useState('');
      var [saveOk, setSaveOk] = useState('');
      var [draftRescue, setDraftRescue] = useState(function () {
        return readDraft(skill.name);
      });
      var dirty = JSON.stringify(form) !== JSON.stringify(initial);
      var dirtyRef = React.useRef(false);
      dirtyRef.current = dirty;

      // 草稿救援：表单一脏就镜像到 sessionStorage，干净即清除。
      // 宿主切面板、技能被外部移除等拦不住的卸载路径都靠它兜底。
      useEffect(
        function () {
          if (dirty) writeDraft(skill.name, form);
          else clearDraft(skill.name);
        },
        [dirty, form]
      );

      useEffect(
        function () {
          // 后台 30s 刷新会换掉 skill 对象；用户正在编辑时不能拿服务端数据覆盖表单。
          if (dirtyRef.current) return;
          setForm(emptyForm(skill));
          setInitial(emptyForm(skill));
          setSaveError('');
        },
        // 依赖整个 zh 内容签名而不只是 zh.name：AI 重译只改 summary/description，
        // 旧依赖会让干净表单停在翻译前的基线上，用户在陈旧数据上盲改。
        [skill && skill.name, skill && skill.updatedAt, skill && skill.zh ? JSON.stringify(skill.zh) : '']
      );

      useEffect(
        function () {
          if (typeof props.onDirtyChange === 'function') props.onDirtyChange(dirty);
          return function () {
            if (typeof props.onDirtyChange === 'function') props.onDirtyChange(false);
          };
        },
        [dirty]
      );

      useEffect(
        function () {
          if (!removeArmed) return undefined;
          var timer = setTimeout(function () {
            setRemoveArmed(false);
          }, 5000);
          return function () {
            clearTimeout(timer);
          };
        },
        [removeArmed]
      );

      useEffect(
        function () {
          if (!uninstallArmed) return undefined;
          var timer = setTimeout(function () {
            setUninstallArmed(false);
          }, 5000);
          return function () {
            clearTimeout(timer);
          };
        },
        [uninstallArmed]
      );

      function setField(key, value) {
        setSaveOk('');
        setSaveError('');
        setForm(function (prev) {
          var next = {};
          for (var k in prev) {
            if (Object.prototype.hasOwnProperty.call(prev, k)) next[k] = prev[k];
          }
          next[key] = value;
          return next;
        });
      }

      /** 「采用原文简介」：把 SKILL.md 原文 description 填入详细说明；简介为空时截取前 40 字。 */
      function applySourceDescription() {
        setForm(function (prev) {
          var next = {};
          for (var k in prev) {
            if (Object.prototype.hasOwnProperty.call(prev, k)) next[k] = prev[k];
          }
          next.description = asString(skill.description).replace(/^\s+|\s+$/g, '');
          if (!asString(prev.summary)) next.summary = clipText(skill.description, 40);
          return next;
        });
      }

      function trimText(value) {
        return asString(value).replace(/^\s+|\s+$/g, '');
      }

      function submit(reviewOnly) {
        // 写操作互斥：保存/审核在途时禁入，清除/卸载在途时也禁入，
        // 否则 /save 与 /delete、/uninstall 会在宿主端乱序互踩。
        if (saving || reviewing || removing || uninstalling) return;
        setSaveError('');
        var next = {
          name: trimText(form.name),
          alias: parseList(form.alias),
          summary: trimText(form.summary),
          description: asString(form.description),
          whenToUse: asString(form.whenToUse),
          notFor: asString(form.notFor),
          category: asString(form.category),
          tags: parseList(form.tags),
          keywords: parseList(form.keywords),
        };
        var prev = {
          name: trimText(initial.name),
          alias: parseList(initial.alias),
          summary: trimText(initial.summary),
          description: asString(initial.description),
          whenToUse: asString(initial.whenToUse),
          notFor: asString(initial.notFor),
          category: asString(initial.category),
          tags: parseList(initial.tags),
          keywords: parseList(initial.keywords),
        };
        var contentFields = ['name', 'summary', 'description', 'whenToUse', 'notFor', 'alias', 'tags', 'keywords'];
        var patch = {};
        var changedContent = false;
        for (var key in next) {
          if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
          if (JSON.stringify(next[key]) !== JSON.stringify(prev[key])) {
            patch[key] = next[key];
            if (contentFields.indexOf(key) !== -1) changedContent = true;
          }
        }
        if (reviewOnly) {
          // 审核内置草稿时用户层可能还没有内容；提交当前表单的完整中文，
          // 让后端有一条可审核的用户层记录，而不是只写 review 字段。
          patch = {
            name: next.name,
            alias: next.alias,
            summary: next.summary,
            description: next.description,
            whenToUse: next.whenToUse,
            notFor: next.notFor,
            category: next.category,
            tags: next.tags,
            keywords: next.keywords,
            origin: 'manual',
          };
          changedContent = true;
        }
        var hasPatch = Object.keys(patch).length > 0;
        // AI 翻译/重译会把结果直接写进用户层并标成 draft；此时表单与已保存内容一致，
        // 点保存应当把审核状态标成 reviewed（相当于确认这次 AI 结果），而不是什么都不做。
        var confirmReview =
          !hasPatch &&
          isObject(skill.zh) &&
          skill.zh.review === 'draft' &&
          toArray(skill.layers).some(function (layer) {
            return layer.source === 'user';
          });
        if (!hasPatch && !confirmReview) {
          if (props.setNotice) props.setNotice({ kind: 'info', text: tr('detail.noChanges') });
          if (typeof props.onBack === 'function') props.onBack(true);
          return;
        }
        // 空表单保存会让「未翻译」技能变成 fresh 并污染覆盖率：至少要有中文名或中文简介。
        var hasContent = contentFields.some(function (field) {
          var value = next[field];
          if (Array.isArray(value)) return value.length > 0;
          return typeof value === 'string' && value.trim() !== '';
        });
        if (!hasContent) {
          setSaveError(tr('detail.emptyZh'));
          return;
        }
        // 只提交实际改动的字段：内置/项目层内容不会被整份复制进用户层。
        if (changedContent && !reviewOnly) patch.origin = 'manual';
        if (reviewOnly) setReviewing(true);
        else setSaving(true);
        apiPost(API_BASE + '/save', {
          name: skill.name,
          review: reviewOnly || changedContent || confirmReview ? 'reviewed' : undefined,
          zh: patch,
        })
          .then(function () {
            setSaving(false);
            setReviewing(false);
            setInitial(form);
            setSaveError('');
            setSaveOk(tr(reviewOnly ? 'detail.reviewOk' : 'detail.saveOk'));
            if (props.setNotice) props.setNotice({ kind: 'ok', text: reviewOnly ? tr('detail.reviewOk') : tr('detail.saveOk') });
            var changed = typeof props.onChanged === 'function' ? props.onChanged() : null;
            if (reviewOnly) return;
            var back = function () {
              // 保存成功后回到列表，成功提示由页面顶部的横幅展示。
              if (typeof props.onBack === 'function') props.onBack(true);
            };
            // 等列表刷新完成再返回，避免返回后仍显示保存前的旧列表。
            if (changed && typeof changed.then === 'function') changed.then(back, back);
            else back();
          })
          .catch(function (err) {
            setSaving(false);
            setReviewing(false);
            setSaveError(tr('detail.saveFail') + '：' + errorText(err));
          });
      }

      function save() {
        submit(false);
      }

      function reviewCurrent() {
        submit(true);
      }

      function regenerate() {
        if (busy || saving || reviewing || removing || uninstalling) return;
        setBusy(true);
        apiPost(API_BASE + '/translate', { scope: 'selected', names: [skill.name] })
          .then(function (out) {
            setBusy(false);
            // 单条重译的 jobId 交回 Page，用于只轮询这一条任务，不要猜测“第一个 running job”。
            if (out && out.jobId && typeof props.onTranslateStarted === 'function') {
              props.onTranslateStarted(String(out.jobId));
            }
            if (props.setNotice) props.setNotice({ kind: 'ok', text: tr('detail.regenerating') });
            if (typeof props.onChanged === 'function') props.onChanged();
          })
          .catch(function (err) {
            setBusy(false);
            if (props.setNotice) props.setNotice({ kind: 'error', text: tr('detail.regenerateFail') + '：' + errorText(err) });
          });
      }

      function removeOverride() {
        if (removing || saving || reviewing) return;
        if (!removeArmed) {
          setRemoveArmed(true);
          return;
        }
        setRemoving(true);
        apiPost(API_BASE + '/delete', { name: skill.name })
          .then(function () {
            setRemoving(false);
            setRemoveArmed(false);
            if (props.setNotice) props.setNotice({ kind: 'ok', text: tr('detail.removeOk') });
            if (typeof props.onChanged === 'function') props.onChanged();
          })
          .catch(function (err) {
            setRemoving(false);
            setRemoveArmed(false);
            if (props.setNotice) props.setNotice({ kind: 'error', text: tr('detail.removeFail') + '：' + errorText(err) });
          });
      }

      // 卸载个人技能：只对 ~/.agents/skills 下的技能开放；两次点击确认，成功后回到列表。
      function uninstallSkill() {
        if (uninstalling || saving || reviewing) return;
        if (!uninstallArmed) {
          setUninstallArmed(true);
          return;
        }
        setUninstalling(true);
        apiPost(API_BASE + '/uninstall', { name: skill.name })
          .then(function () {
            setUninstalling(false);
            setUninstallArmed(false);
            if (props.setNotice) props.setNotice({ kind: 'ok', text: tr('detail.uninstallOk') });
            if (typeof props.onChanged === 'function') props.onChanged();
            if (typeof props.onBack === 'function') props.onBack(true);
          })
          .catch(function (err) {
            setUninstalling(false);
            setUninstallArmed(false);
            if (props.setNotice) props.setNotice({ kind: 'error', text: tr('detail.uninstallFail') + '：' + errorText(err) });
          });
      }

      // 从安装来源（技能安装时记录的 GitHub 仓库）读取该技能的一句话简介；中文优先。
      function loadSource() {
        if (sourceBusy) return;
        setSourceBusy(true);
        apiGet(API_BASE + '/source?name=' + encodeURIComponent(skill.name))
          .then(function (result) {
            setSourceBusy(false);
            var info = result && isObject(result.zh) ? result.zh : null;
            var summary = info ? asString(info.summary).trim() : '';
            if (!summary) {
              if (props.setNotice) props.setNotice({ kind: 'error', text: tr('detail.sourceNone') });
              return;
            }
            var summaryTaken = !trimText(form.summary);
            var descriptionTaken = !trimText(form.description);
            setForm(function (prev) {
              var next = {};
              for (var k in prev) {
                if (Object.prototype.hasOwnProperty.call(prev, k)) next[k] = prev[k];
              }
              if (!trimText(prev.summary)) next.summary = summary.slice(0, 60);
              if (!trimText(prev.description)) next.description = summary;
              return next;
            });
            if (props.setNotice) {
              var kept = !summaryTaken && !descriptionTaken;
              var text = kept ? tr('detail.sourceKept')
                : info.lang === 'zh' ? tr('detail.sourceFilled') : tr('detail.sourceEnFilled');
              props.setNotice({ kind: kept ? 'info' : 'ok', text: text });
            }
          })
          .catch(function (err) {
            setSourceBusy(false);
            if (props.setNotice) props.setNotice({ kind: 'error', text: tr('detail.sourceFail') + '：' + errorText(err) });
          });
      }

      var zh = isObject(skill.zh) ? skill.zh : null;
      var stale = skill.status === 'stale';
      var layers = Array.isArray(skill.layers) ? skill.layers : [];
      var hasUserLayer = layers.some(function (layer) { return layer.source === 'user'; });
      var uninstallable = !!(skill.source && skill.source.kind === 'user-agents' && skill.path);
      var layerText = layers.length === 0
        ? tr('origin.none')
        : layers.map(function (layer) {
            var label = tr('origin.' + (layer.source || 'none'));
            if (layer.origin) label += ' · ' + layer.origin;
            if (layer.review === 'draft') label += ' · ' + tr('origin.draft');
            return label;
          }).join(' > ');

      var categoryOptions = [
        h('option', { key: '__none__', value: '' }, tr('detail.noCategory')),
      ];
      for (var i = 0; i < index.categories.length; i++) {
        var category = index.categories[i];
        var label = category.parent && index.catById.has(category.parent)
          ? index.catById.get(category.parent).zh + ' / ' + category.zh
          : category.zh;
        categoryOptions.push(h('option', { key: category.id, value: category.id }, label));
      }

      return h(
        'div',
        null,
        h(
          'div',
          { className: 'skw-detail-head', style: sx(STYLES.row, { marginTop: '12px', alignItems: 'center' }) },
          h(
            'button',
            { type: 'button', style: STYLES.button, onClick: function () { if (typeof props.onBack === 'function') props.onBack(); } },
            '← ' + tr('detail.back')
          ),
          h('h2', { style: STYLES.detailTitle, tabIndex: -1, 'data-skw-detail-title': '1' }, zh && zh.name ? zh.name : skill.name),
          h('code', { style: STYLES.mono }, '/' + skill.name),
          h(StatusBadge, { tr: tr, status: skillStatusKey(skill) })
        ),
        stale
          ? h(
              'div',
              { style: sx(STYLES.banner, STYLES.bannerWarn) },
              h('span', null, tr('detail.stale')),
              h(
                'button',
                { type: 'button', style: sx(STYLES.button, { marginLeft: '10px' }), onClick: regenerate, disabled: busy || saving || reviewing || removing || uninstalling },
                busy ? tr('detail.regenerating') : tr('detail.regenerate')
              )
            )
          : null,
        draftRescue
          ? h(
              'div',
              { style: sx(STYLES.banner, STYLES.bannerWarn, { alignItems: 'center', flexWrap: 'wrap' }) },
              h('span', null, tr('detail.draftFound')),
              h(
                'button',
                {
                  type: 'button',
                  style: sx(STYLES.button, { marginLeft: '10px', padding: '2px 10px' }),
                  onClick: function () {
                    setForm(draftRescue);
                    setDraftRescue(null);
                  },
                },
                tr('detail.draftRestore')
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: sx(STYLES.button, { marginLeft: '6px', padding: '2px 10px' }),
                  onClick: function () {
                    clearDraft(skill.name);
                    setDraftRescue(null);
                  },
                },
                tr('detail.draftDiscard')
              )
            )
          : null,
        h(
          'div',
          { className: 'skw-detail-grid', style: STYLES.grid2 },
          h(
            'div',
            { className: 'skw-detail-en', lang: 'en', style: STYLES.card },
            h('h2', { style: STYLES.h2 }, tr('detail.source')),
            infoRow(tr, tr('table.skill'), '/' + skill.name),
            infoRow(tr, tr('detail.sourceDescription'), skill.description),
            infoRow(tr, tr('detail.whenToUse'), skill.whenToUse),
            infoRow(tr, tr('detail.updatedAt'), formatTime(skill.updatedAt)),
            infoRow(tr, tr('detail.hash'), shortHash(skill.hash)),
            infoRow(tr, tr('detail.path'), skill.path),
            skill.bodyPreview
              ? h(
                  'div',
                  { style: { marginTop: '10px' } },
                  h('div', { style: STYLES.label }, tr('detail.body')),
                  h(
                    'pre',
                    {
                      tabIndex: 0,
                      'aria-label': tr('detail.body'),
                      style: sx(STYLES.pre, {
                        maxHeight: '240px',
                        overflow: 'auto',
                        border: '1px solid rgba(127,127,127,0.2)',
                        borderRadius: '6px',
                        padding: '8px',
                      }),
                    },
                    skill.bodyPreview
                  )
                )
              : null
          ),
          h(
            'div',
            { className: 'skw-detail-zh', lang: 'zh-CN', style: STYLES.card },
            h('h2', { style: STYLES.h2 }, tr('detail.zh')),
            h('div', { style: sx(STYLES.muted, STYLES.small, { margin: '4px 0 8px' }) }, tr('detail.layers') + '：' + layerText),
            skill.install
              ? h(
                  'div',
                  { style: sx(STYLES.row, { alignItems: 'center', marginBottom: '6px' }) },
                  // sourceUrl 只允许 http(s)：这是全文唯一把数据字段放进 HTML 属性的位置，
                  // React 对 javascript: URL 只警告不拦截，必须显式白名单。
                  (function () {
                    var url = asString(skill.install.sourceUrl);
                    if (/^https?:/i.test(url)) {
                      return h(
                        'a',
                        {
                          href: url,
                          target: '_blank',
                          rel: 'noopener noreferrer',
                          style: sx(STYLES.small, { color: 'inherit', marginRight: '8px' }),
                        },
                        tr('detail.installSource') + '：' + (skill.install.source || url)
                      );
                    }
                    return h(
                      'span',
                      { style: sx(STYLES.small, { marginRight: '8px' }) },
                      tr('detail.installSource') + '：' + (skill.install.source || url || tr('page.none'))
                    );
                  })(),
                  h(
                    'button',
                    { type: 'button', style: sx(STYLES.button, { fontSize: '12px' }), onClick: loadSource, disabled: sourceBusy },
                    sourceBusy ? tr('detail.sourceLoading') : tr('detail.sourceFetch')
                  )
                )
              : null,
            field(
              tr,
              tr('detail.name'),
              h('input', {
                value: form.name,
                style: STYLES.input,
                onChange: function (event) {
                  setField('name', event.target.value);
                },
              })
            ),
            field(
              tr,
              tr('detail.alias'),
              h('input', {
                value: form.alias,
                style: STYLES.input,
                onChange: function (event) {
                  setField('alias', event.target.value);
                },
              })
            ),
            field(
              tr,
              tr('detail.summary'),
              h('input', {
                value: form.summary,
                maxLength: 40,
                style: STYLES.input,
                onChange: function (event) {
                  setField('summary', event.target.value);
                },
              })
            ),
            h('div', { style: sx(STYLES.small, { opacity: 0.72, margin: '-4px 0 4px' }) }, String(form.summary.length) + ' / 40'),
            field(
              tr,
              tr('detail.description'),
              h('textarea', {
                value: form.description,
                style: STYLES.textarea,
                onChange: function (event) {
                  setField('description', event.target.value);
                },
              })
            ),
            h(
              'div',
              { style: sx(STYLES.row, { marginTop: '6px', alignItems: 'center' }) },
              h(
                'button',
                { type: 'button', style: sx(STYLES.button, { fontSize: '12px' }), onClick: applySourceDescription },
                tr('detail.useSource')
              ),
              h('span', { style: sx(STYLES.muted, { fontSize: '13px' }) }, tr('detail.useSourceHint'))
            ),
            field(
              tr,
              tr('detail.whenToUse'),
              h('textarea', {
                value: form.whenToUse,
                style: STYLES.textarea,
                onChange: function (event) {
                  setField('whenToUse', event.target.value);
                },
              })
            ),
            field(
              tr,
              tr('detail.notFor'),
              h('textarea', {
                value: form.notFor,
                style: STYLES.textarea,
                onChange: function (event) {
                  setField('notFor', event.target.value);
                },
              })
            ),
            field(
              tr,
              tr('detail.category'),
              h(
                'select',
                {
                  value: form.category,
                  style: STYLES.input,
                  onChange: function (event) {
                    setField('category', event.target.value);
                  },
                },
                categoryOptions
              )
            ),
            field(
              tr,
              tr('detail.tags'),
              h('input', {
                value: form.tags,
                style: STYLES.input,
                onChange: function (event) {
                  setField('tags', event.target.value);
                },
              })
            ),
            field(
              tr,
              tr('detail.keywords'),
              h('input', {
                value: form.keywords,
                style: STYLES.input,
                onChange: function (event) {
                  setField('keywords', event.target.value);
                },
              })
            ),
            !zh ? h('div', { style: sx(STYLES.muted, STYLES.small, { marginTop: '8px' }) }, tr('detail.empty')) : null
          )
        ),
        h(
          'div',
          {
            className: 'skw-detail-actions',
            style: {
              position: 'sticky',
              bottom: 0,
              zIndex: 3,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '8px',
              marginTop: '12px',
              padding: '10px 0 calc(10px + env(safe-area-inset-bottom, 0px))',
              background: 'var(--skw-surface, var(--dsh-surface, #1b1f24))',
              borderTop: '1px solid var(--skw-border, var(--dsh-border, rgba(127,127,127,0.2)))',
            },
          },
          h(
            'button',
            { type: 'button', style: STYLES.buttonPrimary, onClick: save, disabled: saving || reviewing },
            saving ? tr('detail.saving') : tr('detail.save')
          ),
          isObject(skill.zh) && skill.zh.review === 'draft'
            ? h(
                'button',
                {
                  type: 'button',
                  style: sx(STYLES.button, { minHeight: '32px' }),
                  onClick: reviewCurrent,
                  disabled: saving || reviewing,
                  title: tr('detail.reviewHint'),
                },
                reviewing ? tr('detail.reviewing') : tr('detail.review')
              )
            : null,
          h(
            'button',
            { type: 'button', style: STYLES.button, onClick: regenerate, disabled: busy || saving || reviewing },
            busy ? tr('detail.regenerating') : tr('detail.regenerate')
          ),
          h(
            'span',
            { role: 'status', style: sx(STYLES.small, { opacity: 0.78, minWidth: '72px' }) },
            dirty ? tr('detail.dirty') : saveOk || tr('detail.saved')
          ),
          saveError
            ? h('div', { role: 'alert', style: sx(STYLES.small, { color: 'var(--skw-danger, #b42318)', flex: '1 1 100%' }) }, saveError)
            : null,
          hasUserLayer
            ? h(
                'div',
                { style: sx(STYLES.row, { gap: '6px', marginLeft: 'auto', alignItems: 'center' }) },
                h(
                  'button',
                  { type: 'button', style: sx(STYLES.button, { fontSize: '12px' }), onClick: removeOverride, disabled: removing || saving || reviewing },
                  removing ? tr('detail.removing') : removeArmed ? tr('detail.removeConfirm') : tr('detail.removeOverride')
                ),
                removeArmed
                  ? h('button', { type: 'button', style: sx(STYLES.button, { fontSize: '12px' }), onClick: function () { setRemoveArmed(false); } }, tr('detail.removeCancel'))
                  : null,
              )
            : null,
          uninstallable
            ? h(
                'div',
                { style: sx(STYLES.row, { gap: '6px', alignItems: 'center' }) },
                h(
                  'button',
                  { type: 'button', style: sx(STYLES.button, { fontSize: '12px', color: 'var(--skw-danger, #b42318)', borderColor: 'var(--skw-danger-border, rgba(180,35,24,0.5))' }), onClick: uninstallSkill, disabled: uninstalling || saving || reviewing },
                  uninstalling
                    ? tr('detail.uninstalling')
                    : uninstallArmed
                      ? tr('detail.uninstallConfirm')
                      : tr('detail.uninstall')
                ),
                uninstallArmed
                  ? h('button', { type: 'button', style: sx(STYLES.button, { fontSize: '12px' }), onClick: function () { setUninstallArmed(false); } }, tr('detail.uninstallCancel'))
                  : null,
              )
            : null
        )
      );
    }

    // ---------------------------- Tab 2：设置 ----------------------------
    function formFromSettings(settings) {
      return {
        enabled: settings.enabled !== false,
        mode: MODES.indexOf(settings.mode) === -1 ? 'decorate' : settings.mode,
        pinyinSearch: settings.pinyinSearch !== false,
        showRecent: settings.showRecent !== false,
        provider: asString(settings.translatorProvider),
        model: asString(settings.translatorModel),
      };
    }

    // ---------------------------- 回收站卡片 ----------------------------
    // 卸载的个人技能先移到插件数据目录的 trash/；这里可以恢复或永久删除（永久删除两次确认）。
    function TrashCard(props) {
      var tr = props.tr;
      var useState = React.useState;
      var useEffect = React.useEffect;
      var [entries, setEntries] = useState(null);
      var [error, setError] = useState('');
      var [busyId, setBusyId] = useState('');
      var [armedId, setArmedId] = useState('');

      function load() {
        apiGet(API_BASE + '/trash')
          .then(function (result) {
            setEntries(Array.isArray(result.entries) ? result.entries : []);
            setError('');
          })
          .catch(function (err) {
            setEntries([]);
            setError(errorText(err));
          });
      }

      useEffect(function () {
        load();
      }, []);

      useEffect(
        function () {
          if (!armedId) return undefined;
          var timer = setTimeout(function () {
            setArmedId('');
          }, 5000);
          return function () {
            clearTimeout(timer);
          };
        },
        [armedId]
      );

      function act(id, path, okKey) {
        // 按钮在 busyId 非空时已禁用，这里只兜竞态。
        if (busyId) return false;
        setBusyId(id);
        apiPost(API_BASE + path, { id: id })
          .then(function () {
            setBusyId('');
            // 只解除本次操作那一行；不要把另一行正在倒计时的 armed 一起清掉（R19）。
            setArmedId(function (current) {
              return current === id ? '' : current;
            });
            load();
            if (typeof props.onChanged === 'function') props.onChanged();
            if (props.setNotice) props.setNotice({ kind: 'ok', text: tr(okKey) });
          })
          .catch(function (err) {
            setBusyId('');
            setArmedId(function (current) {
              return current === id ? '' : current;
            });
            if (props.setNotice) props.setNotice({ kind: 'error', text: tr('settings.trashFail') + '：' + errorText(err) });
          });
        return true;
      }

      function purge(entry) {
        // 别的行在途时不要把它「预置成已武装」再被静默吞掉（R19）。
        if (busyId) return;
        if (armedId !== entry.id) {
          setArmedId(entry.id);
          return;
        }
        act(entry.id, '/purge', 'settings.trashPurgeOk');
      }

      var body;
      if (entries === null) {
        body = h('div', { style: sx(STYLES.muted, STYLES.small, { marginTop: '6px' }) }, tr('settings.trashLoading'));
      } else if (error) {
        body = h('div', { role: 'alert', style: sx(STYLES.small, { color: 'var(--skw-danger, #b42318)', marginTop: '6px' }) }, error);
      } else if (!entries.length) {
        body = h('div', { style: sx(STYLES.muted, STYLES.small, { marginTop: '6px' }) }, tr('settings.trashEmpty'));
      } else {
        body = h(
          'div',
          null,
          entries.map(function (entry) {
            return h(
              'div',
              {
                key: entry.id,
                style: sx(STYLES.row, {
                  justifyContent: 'space-between',
                  marginTop: '8px',
                  paddingTop: '8px',
                  borderTop: '1px solid var(--dsh-border, rgba(127,127,127,0.16))',
                }),
              },
              h(
                'div',
                { style: { minWidth: '0' } },
                h(
                  'div',
                  null,
                  entry.name + ' ',
                  h('span', { style: sx(STYLES.muted, STYLES.small) }, formatTime(entry.trashedAt))
                ),
                h('div', { style: sx(STYLES.muted, STYLES.small) }, entry.originalPath || '')
              ),
              h(
                'div',
                { style: STYLES.row },
                h(
                  'button',
                  {
                    type: 'button',
                    style: sx(STYLES.button, { fontSize: '12px' }),
                    onClick: function () {
                      act(entry.id, '/restore', 'settings.trashRestoreOk');
                    },
                    disabled: !!busyId,
                  },
                  busyId === entry.id ? tr('settings.trashBusy') : tr('settings.trashRestore')
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    style: sx(STYLES.button, { fontSize: '12px', color: 'var(--skw-danger, #b42318)' }),
                    onClick: function () {
                      purge(entry);
                    },
                    disabled: !!busyId,
                  },
                  armedId === entry.id ? tr('settings.trashPurgeConfirm') : tr('settings.trashPurge')
                ),
                armedId === entry.id
                  ? h(
                      'button',
                      { type: 'button', style: sx(STYLES.button, { fontSize: '12px' }), onClick: function () { setArmedId(''); } },
                      tr('settings.purgeCancel')
                    )
                  : null
              )
            );
          })
        );
      }

      return h(
        'div',
        { style: sx(STYLES.card, { marginTop: '12px' }) },
        h('h2', { style: STYLES.h2 }, tr('settings.trash')),
        h('div', { style: sx(STYLES.muted, STYLES.small, { marginTop: '4px' }) }, tr('settings.trashHint')),
        body
      );
    }

    function SettingsTab(props) {
      var tr = props.tr;
      var index = props.index;
      var settings = index.settings;
      var useState = React.useState;
      var useEffect = React.useEffect;
      var [form, setForm] = useState(formFromSettings(settings));
      var [saving, setSaving] = useState(false);
      var [saveError, setSaveError] = useState('');
      var [clearArmed, setClearArmed] = useState(false);
      var dirty = JSON.stringify(form) !== JSON.stringify(formFromSettings(settings));
      var dirtyRef = React.useRef(false);
      dirtyRef.current = dirty;

      useEffect(
        function () {
          if (dirtyRef.current) return;
          setForm(formFromSettings(settings));
          setSaveError('');
        },
        [
          settings.enabled,
          settings.mode,
          settings.pinyinSearch,
          settings.showRecent,
          settings.translatorProvider,
          settings.translatorModel,
        ]
      );

      useEffect(
        function () {
          if (typeof props.onDirtyChange === 'function') props.onDirtyChange(dirty);
          return function () {
            if (typeof props.onDirtyChange === 'function') props.onDirtyChange(false);
          };
        },
        [dirty]
      );

      useEffect(
        function () {
          if (!clearArmed) return undefined;
          var timer = setTimeout(function () {
            setClearArmed(false);
          }, 5000);
          return function () {
            clearTimeout(timer);
          };
        },
        [clearArmed]
      );

      function setField(key, value) {
        setForm(function (prev) {
          var next = {};
          for (var k in prev) {
            if (Object.prototype.hasOwnProperty.call(prev, k)) next[k] = prev[k];
          }
          next[key] = value;
          return next;
        });
      }

      function save() {
        if (saving) return;
        setSaving(true);
        setSaveError('');
        if (props.setNotice) props.setNotice(null);
        apiPost(API_BASE + '/config', {
          settings: {
            enabled: !!form.enabled,
            mode: form.mode,
            pinyinSearch: !!form.pinyinSearch,
            showRecent: !!form.showRecent,
            translatorProvider: asString(form.provider).replace(/^\s+|\s+$/g, ''),
            translatorModel: asString(form.model).replace(/^\s+|\s+$/g, ''),
          },
        })
          .then(function () {
            setSaving(false);
            setSaveError('');
            if (props.setNotice) props.setNotice({ kind: 'ok', text: tr('settings.saveOk') });
            if (typeof props.onSaved === 'function') props.onSaved();
          })
          .catch(function (err) {
            setSaving(false);
            setSaveError(tr('settings.saveFail') + '：' + errorText(err));
          });
      }

      var modeOptions = [];
      for (var i = 0; i < MODES.length; i++) {
        var mode = MODES[i];
        modeOptions.push(
          h(
            'label',
            {
              key: mode,
              style: sx(STYLES.field, { display: 'block', cursor: 'pointer' }),
            },
            h('span', { style: STYLES.row },
              h('input', {
                type: 'radio',
                name: 'dsh-skill-workbench-mode',
                checked: form.mode === mode,
                onChange: (function (next) {
                  return function () {
                    setField('mode', next);
                  };
                })(mode),
              }),
              h('strong', null, tr('settings.mode.' + mode))
            ),
            h('span', { style: sx(STYLES.muted, STYLES.small, { display: 'block', marginLeft: '20px' }) }, tr('settings.mode.' + mode + 'Hint'))
          )
        );
      }

      var store = index.store || {};
      function toggleClearRecent() {
        if (!clearArmed) {
          setClearArmed(true);
          return;
        }
        clearRecent();
        setClearArmed(false);
        if (props.setNotice) props.setNotice({ kind: 'ok', text: tr('settings.recentCleared') });
      }
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'skw-card', style: sx(STYLES.card, { marginTop: '12px' }) },
          h('h2', { style: STYLES.h2 }, tr('settings.title')),
          checkbox(tr, tr('settings.enabled'), form.enabled, function (next) {
            setField('enabled', next);
          }),
          h('div', { style: sx(STYLES.muted, STYLES.small) }, tr('settings.enabledHint')),
          h('h3', { style: sx(STYLES.h2, { marginTop: '16px', fontSize: '14px' }) }, tr('settings.mode')),
          h('div', { role: 'radiogroup', 'aria-label': tr('settings.mode') }, modeOptions),
          checkbox(tr, tr('settings.pinyin'), form.pinyinSearch, function (next) {
            setField('pinyinSearch', next);
          }),
          h('div', { style: sx(STYLES.muted, STYLES.small) }, tr('settings.pinyinHint')),
          checkbox(tr, tr('settings.recent'), form.showRecent, function (next) {
            setField('showRecent', next);
          }),
          h('div', { style: sx(STYLES.muted, STYLES.small) }, tr('settings.recentHint'))
        ),
        h(
          'div',
          { className: 'skw-card', style: sx(STYLES.card, { marginTop: '12px' }) },
          h('h2', { style: STYLES.h2 }, tr('settings.provider')),
          h(
            'div',
            { style: STYLES.grid2 },
            field(
              tr,
              tr('settings.providerLabel'),
              h('input', {
                value: form.provider,
                placeholder: 'deepseek-account',
                style: STYLES.input,
                onChange: function (event) {
                  setField('provider', event.target.value);
                },
              })
            ),
            field(
              tr,
              tr('settings.model'),
              h('input', {
                value: form.model,
                placeholder: 'deepseek-flash',
                style: STYLES.input,
                onChange: function (event) {
                  setField('model', event.target.value);
                },
              })
            )
          ),
          h('div', { style: sx(STYLES.muted, STYLES.small, { marginTop: '6px' }) }, tr('settings.modelHint'))
        ),
        h(
          'div',
          {
            className: 'skw-settings-actions',
            style: {
              position: 'sticky',
              bottom: 0,
              zIndex: 3,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '8px',
              marginTop: '12px',
              padding: '10px 0 calc(10px + env(safe-area-inset-bottom, 0px))',
              background: 'var(--skw-surface, var(--dsh-surface, rgba(127,127,127,0.08)))',
              borderTop: '1px solid var(--skw-border, var(--dsh-border, rgba(127,127,127,0.2)))',
            },
          },
          h(
            'button',
            { type: 'button', style: STYLES.buttonPrimary, onClick: save, disabled: saving },
            saving ? tr('settings.saving') : tr('settings.save')
          ),
          h(
            'span',
            { role: 'status', style: sx(STYLES.small, { opacity: 0.78 }) },
            dirty ? tr('settings.dirty') : tr('settings.synced')
          ),
          saveError ? h('span', { role: 'alert', style: sx(STYLES.small, { color: 'var(--skw-danger, #b42318)' }) }, saveError) : null,
          h(
            'div',
            { style: sx(STYLES.row, { gap: '6px', marginLeft: 'auto' }) },
            h(
              'button',
              { type: 'button', style: STYLES.button, onClick: toggleClearRecent, disabled: saving },
              clearArmed ? tr('settings.clearConfirm') : tr('settings.clearRecent')
            ),
            clearArmed
              ? h('button', { type: 'button', style: STYLES.button, onClick: function () { setClearArmed(false); } }, tr('settings.clearCancel'))
              : null
          )
        ),
        h(
          'div',
          { className: 'skw-card', style: sx(STYLES.card, { marginTop: '12px' }) },
          h('h2', { style: STYLES.h2 }, tr('settings.storeTitle')),
          infoRow(tr, tr('settings.store'), store.userPath),
          infoRow(tr, tr('settings.builtinVersion'), store.builtinVersion)
        ),
        h(TrashCard, { tr: tr, setNotice: props.setNotice, onChanged: props.onSaved })
      );
    }

    // ---------------------------- 管理页外壳 ----------------------------
    function DiagLine(props) {
      var tr = props.tr;
      var diag = props.diag;
      if (!diag) return h('div', { style: STYLES.diag }, tr('diag.none'));
      var text = (diag.decorated ? tr('diag.decorated', { rows: Number(diag.rows) || 0 }) : tr('diag.skipped')) +
        ' · ' + tr('diag.mode') + '：' + modeLabel(tr, diag.mode) +
        ' · ' + tr('diag.at') + '：' + formatTime(diag.at);
      if (diag.error) text += ' · ' + tr('diag.error') + '：' + diag.error;
      return h('div', { style: STYLES.diag }, text);
    }

    function Page(props) {
      var tr = pageTranslate(props && typeof props.t === 'function' ? props.t : null);
      var useState = React.useState;
      var useEffect = React.useEffect;
      var useCallback = React.useCallback;

      function parseRouteHash(raw) {
        var text = asString(raw).replace(/^#/, '');
        if (!text) return null;
        if (text === 'settings') return { tab: 'settings', selected: '', query: '', filter: 'all', category: '' };
        if (text.indexOf('skill/') === 0) {
          var selectedName = '';
          try {
            selectedName = decodeURIComponent(text.slice(6));
          } catch (e) {
            selectedName = text.slice(6);
          }
          return { tab: 'library', selected: selectedName, query: '', filter: 'all', category: '' };
        }
        if (text === 'library' || text.indexOf('library?') === 0) {
          var route = { tab: 'library', selected: '', query: '', filter: 'all', category: '' };
          var qIndex = text.indexOf('?');
          if (qIndex >= 0) {
            try {
              var params = new URLSearchParams(text.slice(qIndex + 1));
              route.query = params.get('q') || '';
              // 非法筛选值退回 all：否则列表会被整空且没有任何按钮呈按下态（R18）。
              var rawFilter = params.get('filter') || 'all';
              route.filter = SKILL_FILTERS.indexOf(rawFilter) >= 0 ? rawFilter : 'all';
              route.category = params.get('cat') || '';
            } catch (e) {}
          }
          return route;
        }
        return null;
      }
      function readInitialRoute() {
        var route = { tab: 'library', selected: '', query: '', filter: 'all', category: '' };
        try {
          var fromHash = parseRouteHash(location.hash);
          if (fromHash) return fromHash;
        } catch (e) {}
        try {
          var stored = JSON.parse(sessionStorage.getItem('skw:route') || 'null');
          if (stored && typeof stored === 'object') {
            route.tab = stored.tab === 'settings' ? 'settings' : 'library';
            route.selected = asString(stored.selected);
            route.query = asString(stored.query);
            route.filter = asString(stored.filter) || 'all';
            route.category = asString(stored.category);
          }
        } catch (e) {}
        return route;
      }
      var initialRoute = readInitialRoute();

      var [tab, setTab] = useState(initialRoute.tab);
      var [data, setData] = useState(null);
      var [loading, setLoading] = useState(true);
      var [error, setError] = useState('');
      var [notice, setNotice] = useState(null);
      var [selected, setSelected] = useState(initialRoute.selected);
      var [query, setQuery] = useState(initialRoute.query);
      var [filter, setFilter] = useState(initialRoute.filter);
      var [categoryFilter, setCategoryFilter] = useState(initialRoute.category);
      var [detailDirty, setDetailDirty] = useState(false);
      var [settingsDirty, setSettingsDirty] = useState(false);
      var [batchBusy, setBatchBusy] = useState(false);
      var [batchText, setBatchText] = useState('');
      // 批量 AI 翻译：与「从安装源补简介」及单条重译的 runningJobId 分开记账。
      var [batchScope, setBatchScope] = useState('untranslated');
      var [batchArmedUntil, setBatchArmedUntil] = useState(0);
      var [batchJobId, setBatchJobId] = useState('');
      var [batchError, setBatchError] = useState('');
      var [batchNotice, setBatchNotice] = useState('');
      var [singleJobId, setSingleJobId] = useState('');
      // 后台刷新失败不该把整页顶成错误态：单独一个会自动消失的提示（R12）。
      var [refreshError, setRefreshError] = useState('');
      var refreshErrorTimer = React.useRef(null);
      var batchArmedTimer = React.useRef(null);
      var batchStartRef = React.useRef(false);
      var dataRef = React.useRef(null);
      dataRef.current = data;
      var batchBusyRef = React.useRef(false);
      var navRef = React.useRef({ first: true, key: '', query: '', suppress: false });
      var hashRef = React.useRef('');
      var dirtyRef = React.useRef(false);
      dirtyRef.current = detailDirty || settingsDirty;
      var selectedRef = React.useRef('');
      selectedRef.current = selected;
      var themeMode = useThemeMode();
      var themeVars = THEME_VARS[themeMode] || THEME_VARS.light;
      var pageStyle = sx(STYLES.page, themeVars);
      React.useEffect(function () {
        ensureThemeStyle();
      }, []);

      React.useEffect(
        function () {
          var hash = '#library';
          if (tab === 'settings') hash = '#settings';
          else if (selected) hash = '#skill/' + encodeURIComponent(selected);
          else {
            try {
              var params = new URLSearchParams();
              if (query) params.set('q', query);
              if (filter && filter !== 'all') params.set('filter', filter);
              if (categoryFilter) params.set('cat', categoryFilter);
              var suffix = params.toString();
              if (suffix) hash += '?' + suffix;
            } catch (e) {}
          }
          var key = tab + '|' + selected + '|' + filter + '|' + categoryFilter;
          var previous = navRef.current;
          var shouldPush = !previous.first && !previous.suppress && key !== previous.key;
          try {
            var next = location.pathname + location.search + hash;
            if (location.hash !== hash) {
              if (shouldPush) history.pushState(null, '', next);
              else history.replaceState(null, '', next);
            }
            hashRef.current = next;
          } catch (e) {}
          try {
            sessionStorage.setItem('skw:route', JSON.stringify({ tab: tab, selected: selected, query: query, filter: filter, category: categoryFilter }));
          } catch (e) {}
          navRef.current = { first: false, key: key, query: query, suppress: false };
        },
        [tab, selected, query, filter, categoryFilter]
      );

      React.useEffect(function () {
        function onPopState() {
          var route = null;
          try {
            route = parseRouteHash(location.hash);
          } catch (e) {}
          if (!route) {
            // hash 被宿主或其他面板切走：插件拦不住宿主卸载本页（未保存内容
            // 有草稿救援兜底），但至少给用户一次反悔机会；confirm 抛错时按“留在原地”处理。
            if (dirtyRef.current && !confirmDiscard(tr('page.discardAction'))) {
              try {
                history.pushState(null, '', hashRef.current || location.href);
              } catch (e) {}
            }
            return;
          }
          if (dirtyRef.current) {
            var ok = false;
            try {
              ok = window.confirm(tr('page.discardConfirm', { action: tr('page.discardAction') }));
            } catch (e) {
              ok = false;
            }
            if (!ok) {
              try {
                history.pushState(null, '', hashRef.current || location.href);
              } catch (e) {}
              return;
            }
          }
          var leavingDetail = !!selectedRef.current && !route.selected;
          var focusName = selectedRef.current;
          navRef.current = { first: false, key: route.tab + '|' + route.selected + '|' + route.filter + '|' + route.category, query: route.query, suppress: true };
          try {
            hashRef.current = location.pathname + location.search + location.hash;
          } catch (e) {}
          setTab(route.tab);
          setSelected(route.selected);
          setQuery(route.query);
          setFilter(route.filter);
          setCategoryFilter(route.category);
          // 浏览器后退回列表时回焦原行，与插件内返回按钮行为一致。
          if (leavingDetail && route.tab === 'library') {
            try {
              setTimeout(function () {
                var node = document.getElementById('skw-row-' + encodeURIComponent(focusName));
                if (node) node.focus();
              }, 0);
            } catch (e) {}
          }
        }
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined;
        window.addEventListener('popstate', onPopState);
        return function () {
          window.removeEventListener('popstate', onPopState);
        };
      }, []);

      function hasUnsaved() {
        return dirtyRef.current;
      }
      function confirmDiscard(actionLabel) {
        if (!hasUnsaved()) return true;
        try {
          return window.confirm(tr('page.discardConfirm', { action: actionLabel || tr('page.discardAction') }));
        } catch (e) {
          // 无法询问时宁可拦住也不静默丢稿（fail-closed）；用户仍可通过保存离开。
          return false;
        }
      }
      function leaveDetail(force) {
        if (force !== true && !confirmDiscard(tr('detail.back'))) return;
        var previous = selected;
        setSelected('');
        setDetailDirty(false);
        try {
          setTimeout(function () {
            var node = document.getElementById('skw-row-' + encodeURIComponent(previous));
            if (node) node.focus();
          }, 0);
        } catch (e) {}
      }
      React.useEffect(
        function () {
          if (!selected) return undefined;
          var timer = null;
          try {
            timer = setTimeout(function () {
              var node = document.querySelector('[data-skw-detail-title]');
              if (node) node.focus();
            }, 0);
          } catch (e) {}
          return function () {
            if (timer) clearTimeout(timer);
          };
        },
        // data 从 null 变为可用时要再聚焦一次：深链/刷新恢复路径 mount 时
        // 只有骨架屏，setTimeout 里找不到标题节点，仅依赖 [selected] 不会再触发。
        [selected, data ? 1 : 0]
      );
      React.useEffect(
        function () {
          if (!hasUnsaved()) return undefined;
          function onBeforeUnload(event) {
            event.preventDefault();
            event.returnValue = '';
          }
          if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined;
          window.addEventListener('beforeunload', onBeforeUnload);
          return function () {
            window.removeEventListener('beforeunload', onBeforeUnload);
          };
        },
        [detailDirty, settingsDirty]
      );

      function showRefreshError(text) {
        setRefreshError(text);
        try {
          if (refreshErrorTimer.current) clearTimeout(refreshErrorTimer.current);
        } catch (e) {}
        try {
          refreshErrorTimer.current = setTimeout(function () {
            setRefreshError('');
            refreshErrorTimer.current = null;
          }, 8000);
        } catch (e) {}
      }

      React.useEffect(function () {
        return function () {
          try {
            if (refreshErrorTimer.current) clearTimeout(refreshErrorTimer.current);
          } catch (e) {}
          refreshErrorTimer.current = null;
          try {
            if (batchArmedTimer.current) clearTimeout(batchArmedTimer.current);
          } catch (e) {}
          batchArmedTimer.current = null;
        };
      }, []);

      // 离开技能库（打开详情/切到设置）时，批量确认必须复位，不能跨页面残留。
      React.useEffect(
        function () {
          if (tab === 'library' && !selected) return undefined;
          try {
            if (batchArmedTimer.current) clearTimeout(batchArmedTimer.current);
          } catch (e) {}
          batchArmedTimer.current = null;
          setBatchArmedUntil(0);
          return undefined;
        },
        [tab, selected]
      );

      var refresh = useCallback(function (force, silent) {
        if (force) invalidateIndex();
        if (!silent) setLoading(true);
        var indexPromise = loadIndex(!!force);
        var statusPromise = apiRequest(API_BASE + '/status', {
          headers: { accept: 'application/json' },
          cache: 'no-store',
        }).catch(function () {
          return null;
        });
        return Promise.all([indexPromise, statusPromise])
          .then(function (out) {
            var index = out[0];
            var status = out[1];
            setLoading(false);
            if (!index) {
              var message = indexError ? errorText(indexError) : tr('error.loadList');
              // 已有数据时的后台刷新失败：只提示、不清空列表，也不占住整页错误态。
              if (silent && dataRef.current) {
                showRefreshError(tr('error.refreshFailed') + '：' + message);
                return;
              }
              setError(message);
              return;
            }
            setError('');
            setRefreshError('');
            setData({ index: index, status: status });
          })
          .catch(function (err) {
            setLoading(false);
            var message = errorText(err);
            if (silent && dataRef.current) {
              showRefreshError(tr('error.refreshFailed') + '：' + message);
              return;
            }
            setError(message);
          });
      }, []);

      var batchSource = useCallback(function () {
        if (batchBusyRef.current) return Promise.resolve();
        batchBusyRef.current = true;
        setBatchBusy(true);
        setBatchText('');
        var done = 0;
        var filled = 0;
        function step(round) {
          if (round > 20) return Promise.resolve();
          return apiPost(API_BASE + '/source/batch', { limit: 6 }).then(function (out) {
            var attempted = Number(out && out.attempted) || 0;
            filled += Number(out && out.filled) || 0;
            done += attempted;
            if (attempted === 0) return undefined;
            setBatchText(tr('list.batchProgress', { done: done, filled: filled }));
            if (Number(out.remaining) <= 0) return undefined;
            return step(round + 1);
          });
        }
        return step(0)
          .then(function () {
            if (done === 0) {
              setNotice({ kind: 'info', text: tr('list.batchNone') });
            } else {
              setNotice({ kind: 'ok', text: tr('list.batchDone', { done: done, filled: filled }) });
            }
            return refresh(true);
          })
          .catch(function (err) {
            setNotice({ kind: 'error', text: tr('list.batchFail') + '：' + errorText(err) });
          })
          .then(function () {
            batchBusyRef.current = false;
            setBatchBusy(false);
            setBatchText('');
          });
      }, []);

      useEffect(function () {
        refresh(false);
        var timer = null;
        try {
          timer = setInterval(function () {
            refresh(false, true);
          }, 30000);
        } catch (e) {}
        return function () {
          if (timer) {
            try {
              clearInterval(timer);
            } catch (e) {}
          }
        };
      }, []);

      var jobs = data && data.status && Array.isArray(data.status.jobs) ? data.status.jobs : [];
      var hostJobRunning = false;
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i] && jobs[i].state === 'running') {
          hostJobRunning = true;
          break;
        }
      }
      // 单条重译只认 DetailView 回报的 jobId；批量 job 走 batchJobId，绝不混用。
      var runningJobId = singleJobId ? String(singleJobId) : '';
      var hasRunningJob = hostJobRunning || !!singleJobId || !!batchJobId;

      useEffect(function () {
        if (!runningJobId) return undefined;
        var timer = setInterval(function () {
          apiRequest(API_BASE + '/status', { headers: { accept: 'application/json' }, cache: 'no-store' })
            .then(function (status) {
              var list = Array.isArray(status.jobs) ? status.jobs : [];
              var stillRunning = false;
              for (var j = 0; j < list.length; j++) {
                if (list[j] && String(list[j].id) === runningJobId && list[j].state === 'running') stillRunning = true;
              }
              setData(function (prev) {
                return prev ? { index: prev.index, status: status } : prev;
              });
              if (!stillRunning) {
                clearInterval(timer);
                setSingleJobId('');
                invalidateIndex();
                loadIndex(true).then(function (index) {
                  if (!index) return;
                  setData(function (prev) {
                    return prev ? { index: index, status: status } : prev;
                  });
                });
              }
            })
            .catch(function () {});
        }, 1500);
        return function () {
          clearInterval(timer);
        };
      }, [runningJobId]);

      // 批量翻译只按 batchJobId 精确轮询；不用“第一个 running job”代表批量任务。
      useEffect(function () {
        if (!batchJobId) return undefined;
        var stopped = false;
        var timer = setInterval(function () {
          apiRequest(API_BASE + '/status', { headers: { accept: 'application/json' }, cache: 'no-store' })
            .then(function (status) {
              if (stopped) return;
              var list = status && Array.isArray(status.jobs) ? status.jobs : [];
              var job = null;
              for (var j = 0; j < list.length; j++) {
                if (list[j] && String(list[j].id) === batchJobId) {
                  job = list[j];
                  break;
                }
              }
              setData(function (prev) {
                return prev ? { index: prev.index, status: status } : prev;
              });
              if (job && job.state === 'running') return;
              clearInterval(timer);
              invalidateIndex();
              loadIndex(true)
                .then(function (index) {
                  if (stopped) return;
                  if (index) {
                    setData(function (prev) {
                      return prev ? { index: index, status: status } : prev;
                    });
                  }
                  setBatchJobId('');
                  setBatchNotice(tr('list.batchFinished'));
                })
                .catch(function () {
                  if (stopped) return;
                  setBatchJobId('');
                  setBatchNotice(tr('list.batchFinished'));
                });
            })
            .catch(function () {});
        }, 1500);
        return function () {
          stopped = true;
          clearInterval(timer);
        };
      }, [batchJobId]);

      useEffect(function () {
        if (!notice) return undefined;
        var timer = setTimeout(function () {
          setNotice(null);
        }, notice.kind === 'error' ? 12000 : 6000);
        return function () {
          clearTimeout(timer);
        };
      }, [notice]);

      if (!data) {
        var loadingHeader = h(
          'div',
          { className: 'skw-header', style: STYLES.header },
          h(
            'div',
            null,
            h('h1', { style: STYLES.title }, tr('page.title')),
            h('p', { style: STYLES.subtitle }, tr('page.subtitle'))
          ),
          h(
            'div',
            { style: STYLES.row },
            h(
              'button',
              {
                type: 'button',
                style: STYLES.button,
                onClick: function () {
                  refresh(true);
                },
                disabled: loading,
              },
              loading ? tr('page.loading') : tr('page.retry')
            )
          )
        );
        if (error) {
          return h(
            'div',
            { className: 'skw-page', style: pageStyle },
            loadingHeader,
            h(Banner, { tr: tr, kind: 'error', text: error }),
            h('div', { style: sx(STYLES.muted, STYLES.small, { marginTop: '8px' }) }, tr('page.errorHint')),
            h(
              'div',
              { style: sx(STYLES.row, { marginTop: '12px' }) },
              h(
                'button',
                {
                  type: 'button',
                  style: STYLES.buttonPrimary,
                  onClick: function () {
                    refresh(true);
                  },
                },
                tr('page.retry')
              )
            )
          );
        }
        var skeletonRows = [];
        for (var sk = 0; sk < 6; sk++) {
          skeletonRows.push(h('div', { key: 'sk-' + sk, className: 'skw-skeleton', style: sx({ height: '44px', borderRadius: '8px', marginTop: '10px', background: 'var(--skw-skeleton, rgba(127,127,127,0.14))' }) }));
        }
        return h(
          'div',
          { className: 'skw-page', style: pageStyle, 'aria-busy': 'true' },
          loadingHeader,
          h(
            'div',
            { role: 'status', style: sx(STYLES.card, { marginTop: '12px' }) },
            h('div', { style: sx(STYLES.muted, STYLES.small) }, tr('page.loading')),
            skeletonRows
          )
        );
      }

      var index = data.index;
      var status = data.status;
      var coverage = index.coverage || {};
      var total = Number(coverage.total) || 0;
      var translated = Number(coverage.translated) || 0;
      var reviewed = toArray(index.skills).filter(function (item) { return isObject(item.zh) && item.zh.review === 'reviewed'; }).length;
      var percent = percentOf(translated, total);
      var gap = computeGapBuckets(index.skills);
      var hostHasLayers = toArray(index.skills).some(function (item) {
        return toArray(item.layers).length > 0;
      });
      // 有中文却没有任何层来源，才判定为旧宿主；全是「没中文」时不该弹升级说明。
      var legacyGap = gap.total > 0 && gap.builtin + gap.local + gap.unknown > 0 && !hostHasLayers;
      var diagnostics = status && status.diagnostics ? status.diagnostics : null;
      var diag = diagnostics && diagnostics.lastClientDecorate ? diagnostics.lastClientDecorate : lastDecorateReport;

      var batchCounts = {
        untranslated: Number(coverage.untranslated) || 0,
        stale: Number(coverage.stale) || 0,
      };
      var batchCount = batchCounts[batchScope] || 0;

      function clearBatchArmedTimer() {
        try {
          if (batchArmedTimer.current) clearTimeout(batchArmedTimer.current);
        } catch (e) {}
        batchArmedTimer.current = null;
      }
      function resetBatchArmed() {
        clearBatchArmedTimer();
        setBatchArmedUntil(0);
      }
      function changeBatchScope(next) {
        var scope = next === 'stale' ? 'stale' : 'untranslated';
        // 切换范围时旧确认必须作废，避免拿旧数量去启动新范围。
        resetBatchArmed();
        setBatchError('');
        setBatchNotice('');
        if (scope !== batchScope) setBatchScope(scope);
      }
      function cancelBatchArmed() {
        resetBatchArmed();
      }
      function armBatch() {
        if (batchCount <= 0 || hasRunningJob || batchStartRef.current || batchArmedUntil) return;
        clearBatchArmedTimer();
        setBatchError('');
        setBatchNotice('');
        setBatchArmedUntil(Date.now() + 5000);
        try {
          batchArmedTimer.current = setTimeout(function () {
            batchArmedTimer.current = null;
            setBatchArmedUntil(0);
          }, 5000);
        } catch (e) {}
      }
      function confirmBatch() {
        if (batchStartRef.current || batchCount <= 0 || hasRunningJob) return;
        resetBatchArmed();
        batchStartRef.current = true;
        setBatchError('');
        setBatchNotice('');
        var scope = batchScope;
        var count = batchCount;
        apiPost(API_BASE + '/translate', { scope: scope })
          .then(function (out) {
            batchStartRef.current = false;
            var jobId = out && out.jobId ? String(out.jobId) : '';
            if (!jobId) {
              setBatchError(tr('list.batchErrStart'));
              return;
            }
            setBatchJobId(jobId);
            setBatchNotice(tr('list.batchStarted', { count: count }));
          })
          .catch(function (err) {
            batchStartRef.current = false;
            var status = err && err.status;
            if (err && (err.code === 'ERR_BUSY' || status === 429)) {
              setBatchError(tr('list.batchErrBusy'));
            } else if (status === 404 || status === 405) {
              setBatchError(tr('list.batchErrUpgrade'));
            } else {
              setBatchError(tr('list.batchErrStart') + '：' + errorText(err));
            }
          });
      }

      function gapMetric(key, count, labelKey, ariaKey) {
        return h(
          'span',
          {
            key: key,
            'data-skw-gap': key,
            'aria-label': tr(ariaKey, { count: count }),
            style: sx(STYLES.muted, STYLES.small),
          },
          tr(labelKey, { count: count })
        );
      }
      function gapDot(key) {
        return h('span', { key: key, 'aria-hidden': 'true', style: sx(STYLES.muted, STYLES.small) }, '·');
      }
      function gapAction(key, labelKey, nextFilter) {
        return h(
          'button',
          {
            key: key,
            type: 'button',
            style: sx(STYLES.button, STYLES.small),
            onClick: function () {
              setFilter(nextFilter);
            },
          },
          tr(labelKey)
        );
      }

      var gapSource = [];
      if (gap.total === 0) {
        gapSource.push(h('span', { key: 'empty', style: sx(STYLES.muted, STYLES.small) }, tr('coverage.gapEmpty')));
      } else if (legacyGap) {
        gapSource.push(gapMetric('unknown', gap.unknown, 'coverage.gapUnknown', 'coverage.gapUnknownAria'), gapDot('d1'));
        gapSource.push(gapMetric('none', gap.none, 'coverage.gapNone', 'coverage.gapNoneAria'), gapDot('d2'));
        gapSource.push(gapMetric('stale', gap.stale, 'coverage.gapStale', 'coverage.gapStaleAria'));
      } else if (gap.builtin === gap.total) {
        gapSource.push(
          h(
            'span',
            { key: 'allBuiltin', 'data-skw-gap': 'all-builtin', style: sx(STYLES.muted, STYLES.small) },
            tr('coverage.gapAllBuiltin')
          )
        );
      } else {
        gapSource.push(gapMetric('builtin', gap.builtin, 'coverage.gapBuiltin', 'coverage.gapBuiltinAria'), gapDot('d1'));
        gapSource.push(gapMetric('local', gap.local, 'coverage.gapLocal', 'coverage.gapLocalAria'), gapDot('d2'));
        gapSource.push(gapMetric('none', gap.none, 'coverage.gapNone', 'coverage.gapNoneAria'));
        if (gap.unknown > 0) {
          gapSource.push(gapDot('d3'), gapMetric('unknown', gap.unknown, 'coverage.gapUnknown', 'coverage.gapUnknownAria'));
        }
      }
      var gapActions = [];
      if (gap.total > 0 && gap.none > 0) gapActions.push(gapAction('view-none', 'coverage.gapViewNone', 'untranslated'));
      if (gap.total > 0 && gap.stale > 0) gapActions.push(gapAction('view-stale', 'coverage.gapViewStale', 'stale'));

      var tabs = [
        { id: 'library', label: tr('tabs.library') },
        { id: 'settings', label: tr('tabs.settings') },
      ];
      function switchTab(next) {
        if (next === tab) return;
        if (!confirmDiscard(tr('page.discardAction'))) return;
        setTab(next);
        if (next !== 'library') setSelected('');
        setDetailDirty(false);
        setSettingsDirty(false);
        setNotice(null);
      }
      function onTabKey(event, index) {
        var key = event && event.key;
        var nextIndex = -1;
        if (key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
        else if (key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
        else if (key === 'Home') nextIndex = 0;
        else if (key === 'End') nextIndex = tabs.length - 1;
        if (nextIndex < 0) return;
        try {
          event.preventDefault();
          var id = tabs[nextIndex].id;
          var node = document.getElementById('skw-tab-' + id);
          if (node) node.focus();
        } catch (e) {}
        switchTab(tabs[nextIndex].id);
      }
      var tabButtons = [];
      for (var tIdx = 0; tIdx < tabs.length; tIdx++) {
        tabButtons.push(
          h(
            'button',
            {
              key: tabs[tIdx].id,
              id: 'skw-tab-' + tabs[tIdx].id,
              type: 'button',
              className: 'skw-tab',
              role: 'tab',
              'aria-selected': tab === tabs[tIdx].id,
              'aria-controls': 'skw-panel-' + tabs[tIdx].id,
              tabIndex: tab === tabs[tIdx].id ? 0 : -1,
              style: sx(STYLES.tab, tab === tabs[tIdx].id ? STYLES.tabActive : null),
              onClick: (function (next) {
                return function () {
                  switchTab(next);
                };
              })(tabs[tIdx].id),
              onKeyDown: (function (index) {
                return function (event) {
                  onTabKey(event, index);
                };
              })(tIdx),
            },
            tabs[tIdx].label
          )
        );
      }

      var content = null;
      if (tab === 'library') {
        if (selected) {
          var selectedSkill = index.byName.get(selected) || null;
          content = selectedSkill
            ? h(DetailView, {
                tr: tr,
                index: index,
                skill: selectedSkill,
                onBack: leaveDetail,
                onDirtyChange: setDetailDirty,
                onChanged: function () {
                  return refresh(true);
                },
                onTranslateStarted: function (jobId) {
                  setSingleJobId(jobId ? String(jobId) : '');
                },
                setNotice: setNotice,
              })
            : h(
                'div',
                { style: sx(STYLES.card, { marginTop: '12px' }) },
                h(
                  'button',
                  { type: 'button', style: STYLES.button, onClick: function () { leaveDetail(); } },
                  '← ' + tr('detail.back')
                ),
                h('span', { style: sx(STYLES.muted, { marginLeft: '10px' }) }, tr('page.unknown')),
                // 技能被外部卸载/移除后索引刷新会让表单静默消失；提示草稿已暂存，
                // 技能重新出现后打开详情即可取回（草稿救援机制兜底）。
                hasDraft(selected)
                  ? h('div', { style: sx(STYLES.small, { margin: '8px 0 0' }) }, tr('page.skillMissing'))
                  : null
              );
        } else {
          content = h(LibraryTab, {
            tr: tr,
            index: index,
            query: query,
            filter: filter,
            categoryFilter: categoryFilter,
            onQueryChange: setQuery,
            onFilterChange: setFilter,
            onCategoryChange: setCategoryFilter,
            onResetFilters: function () {
              setQuery('');
              setFilter('all');
              setCategoryFilter('');
            },
            onBatchSource: batchSource,
            batchBusy: batchBusy,
            batchText: batchText,
            batchScope: batchScope,
            batchCounts: batchCounts,
            batchArmed: !!batchArmedUntil,
            batchRunning: hasRunningJob,
            batchError: batchError,
            batchNotice: batchNotice,
            onBatchScopeChange: changeBatchScope,
            onBatchArm: armBatch,
            onBatchCancel: cancelBatchArmed,
            onBatchConfirm: confirmBatch,
            onOpen: function (name) {
              setSelected(name);
              setNotice(null);
            },
          });
        }
      } else {
        content = h(SettingsTab, {
          tr: tr,
          index: index,
          status: status,
          setNotice: setNotice,
          onDirtyChange: setSettingsDirty,
          onSaved: function () {
            return refresh(true);
          },
        });
      }

      return h(
        'div',
        { className: 'skw-page', style: pageStyle },
        h(
          'div',
          { className: 'skw-header', style: STYLES.header },
          h(
            'div',
            null,
            h('h1', { style: STYLES.title }, tr('page.title')),
            h('p', { style: STYLES.subtitle }, tr('page.subtitle'))
          ),
          h(
            'div',
            { style: STYLES.row },
            h(
              'button',
              { type: 'button', style: STYLES.button, onClick: function () { refresh(true); }, disabled: loading },
              loading ? tr('page.loading') : tr('page.refresh')
            )
          )
        ),
        notice ? h(Banner, { tr: tr, kind: notice.kind, text: notice.text, onClose: function () { setNotice(null); } }) : null,
        error && data ? h(Banner, { tr: tr, kind: 'error', text: error }) : null,
        refreshError
          ? h(Banner, {
              tr: tr,
              kind: 'warn',
              text: refreshError,
              onClose: function () {
                setRefreshError('');
              },
            })
          : null,
        tab === 'library' && !selected
          ? h(
              'div',
              { className: 'skw-card', style: sx(STYLES.card, { marginTop: '12px' }) },
              h(
                'div',
                { style: sx(STYLES.row, { justifyContent: 'space-between' }) },
                h('h2', { style: STYLES.h2 }, tr('coverage.title')),
                h('span', { style: sx(STYLES.muted, STYLES.small) }, tr('coverage.line', { translated: translated, total: total, percent: percent }))
              ),
              h(
                'div',
                {
                  role: 'progressbar',
                  'aria-label': tr('coverage.title'),
                  'aria-valuemin': 0,
                  'aria-valuemax': 100,
                  'aria-valuenow': percent,
                  style: STYLES.progress,
                },
                h('div', { className: 'skw-progress-bar', style: sx(STYLES.progressBar, { width: percent + '%' }) })
              ),
              h(
                'div',
                { style: sx(STYLES.row, { marginTop: '8px' }) },
                h('span', { style: sx(STYLES.muted, STYLES.small) }, tr('coverage.translated') + ' ' + translated),
                h('span', { style: sx(STYLES.muted, STYLES.small) }, tr('coverage.untranslated') + ' ' + (Number(coverage.untranslated) || 0)),
                h('span', { style: sx(STYLES.muted, STYLES.small) }, tr('coverage.stale') + ' ' + (Number(coverage.stale) || 0)),
                h('span', { style: sx(STYLES.muted, STYLES.small) }, tr('coverage.draft') + ' ' + (Number(coverage.draft) || 0)),
                h('span', { style: sx(STYLES.muted, STYLES.small) }, tr('coverage.reviewed') + ' ' + reviewed)
              ),
              h(
                'div',
                { style: sx(STYLES.row, { marginTop: '8px' }) },
                h('span', { style: sx(STYLES.muted, STYLES.small) }, tr('coverage.source')),
                gapSource
              ),
              legacyGap
                ? h('div', { style: sx(STYLES.muted, STYLES.small, { marginTop: '4px' }) }, tr('coverage.gapLegacyHint'))
                : null,
              gapActions.length > 0
                ? h('div', { style: sx(STYLES.row, { marginTop: '6px' }) }, gapActions)
                : null,
              h('div', { style: sx(STYLES.muted, STYLES.small, { marginTop: '4px' }) }, tr('coverage.hint')),
              h(
                'details',
                { className: 'skw-diag' },
                h('summary', { style: sx(STYLES.small, { cursor: 'pointer', marginTop: '6px' }) }, tr('diag.title')),
                h(DiagLine, { tr: tr, diag: diag })
              )
            )
          : null,
        h(
          'div',
          { className: 'skw-tabrow', style: STYLES.tabRow, role: 'tablist', 'aria-label': tr('tabs.label') },
          tabButtons
        ),
        h(
          'div',
          { id: 'skw-panel-' + tab, role: 'tabpanel', 'aria-labelledby': 'skw-tab-' + tab, tabIndex: -1 },
          content
        )
      );
    }

    // ------------------------------------------------------------------
    // 注册管理页（sidebar.panellist 入口 + main keyed 页面）
    // ------------------------------------------------------------------
    function openPanel(ctx) {
      try {
        var layout = getService(ctx, 'layout');
        if (layout && typeof layout.selectPanel === 'function') {
          layout.selectPanel(PANEL_ID);
          return true;
        }
      } catch (err) {
        warn('layout.selectPanel', err);
      }
      return false;
    }

    function installPage(ctx) {
      var slots = getService(ctx, 'slots');
      if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
        warn('slots 服务不可用，管理页未注册', null);
        return function () {};
      }
      // 页面座位由 shell 声明；layout 尚未就绪也不阻塞注册，仅记录一次。
      if (!getService(ctx, 'layout')) {
        try {
          console.warn('[dsh-skill-workbench] layout 服务尚未就绪，管理页将在座位声明后可用');
        } catch (e) {}
      }
      var disposers = [];
      try {
        disposers.push(
          slots.inject('sidebar.panellist', function () {
            try {
              return slots.register(
                {
                  name: 'sidebar.panellist',
                  id: PANEL_ID,
                  order: PANEL_ORDER,
                  label: function () {
                    return t('panel.label');
                  },
                  locale: NS,
                },
                PanelIcon
              );
            } catch (err) {
              warn('注册侧栏入口', err);
              return undefined;
            }
          })
        );
      } catch (err) {
        warn('slots.inject(sidebar.panellist)', err);
      }
      try {
        disposers.push(
          slots.inject('main', function () {
            try {
              return slots.register(
                {
                  name: 'main',
                  key: PANEL_ID,
                  locale: NS,
                  inject: function () {
                    return {
                      openPanel: function () {
                        return openPanel(ctx);
                      },
                    };
                  },
                },
                PageWithBoundary
              );
            } catch (err) {
              warn('注册管理页', err);
              return undefined;
            }
          })
        );
      } catch (err) {
        warn('slots.inject(main)', err);
      }
      return function cleanup() {
        for (var i = disposers.length - 1; i >= 0; i--) {
          try {
            if (typeof disposers[i] === 'function') disposers[i]();
          } catch (err) {
            warn('dispose page', err);
          }
        }
        disposers.length = 0;
      };
    }

    // ------------------------------------------------------------------
    // apply：整体 + 每个注册单独 try/catch，保证任何失败都不会白屏
    // ------------------------------------------------------------------
    function apply(ctx) {
      var disposers = [];
      var disposed = false;

      function cleanupAll() {
        if (disposed) return;
        disposed = true;
        for (var i = disposers.length - 1; i >= 0; i--) {
          try {
            if (typeof disposers[i] === 'function') disposers[i]();
          } catch (err) {
            warn('dispose', err);
          }
        }
        disposers.length = 0;
        stopWatch();
      }

      try {
        // 1) 文案
        try {
          if (ctx && ctx.locale && typeof ctx.locale.register === 'function') {
            var localeDisposer = ctx.locale.register(NS, { zh: COPY_ZH, en: COPY_EN });
            if (typeof localeDisposer === 'function') disposers.push(localeDisposer);
          }
        } catch (err) {
          warn('注册文案', err);
        }
        try {
          if (ctx && ctx.locale && typeof ctx.locale.bind === 'function') {
            var bound = ctx.locale.bind(NS);
            if (typeof bound === 'function') translate = bound;
          }
        } catch (err) {
          warn('绑定文案', err);
        }

        // 2) / 菜单：始终包装内置 source（包装层按最新 settings.mode 决定装饰 / 原样），
        //    并注册 overlay source（仅 mode==='overlay' 时返回候选）。
        try {
          var menuCleanup = setupMenu(ctx);
          if (typeof menuCleanup === 'function') disposers.push(menuCleanup);
        } catch (err) {
          warn('setupMenu', err);
        }
        try {
          var overlayDisposer = registerOverlay(ctx);
          if (typeof overlayDisposer === 'function') disposers.push(overlayDisposer);
        } catch (err) {
          warn('registerOverlay', err);
        }

        // 3) 管理页
        try {
          var pageCleanup = installPage(ctx);
          if (typeof pageCleanup === 'function') disposers.push(pageCleanup);
        } catch (err) {
          warn('installPage', err);
        }

        if (ctx && typeof ctx.effect === 'function') {
          try {
            ctx.effect(function () {
              return cleanupAll;
            }, 'dsh-skill-workbench: lifecycle');
          } catch (err) {
            warn('ctx.effect(lifecycle)', err);
          }
        }
      } catch (err) {
        warn('apply', err);
      }

      return cleanupAll;
    }

    return {
      name: 'dsh-skill-workbench',
      inject: ['slots', 'locale', 'inputTriggers'],
      apply: apply,
    };
  }
})();
