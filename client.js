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
      'page.subtitle': '管理技能的中文显示名、简介与分类：/ 菜单按分类显示中文，调用仍然使用英文 /name，绝不修改 SKILL.md。',
      'page.refresh': '刷新',
      'page.loading': '加载中…',
      'page.retry': '重试',
      'page.none': '—',
      'page.unknown': '未知',
      'page.close': '关闭',
      'tabs.library': '技能库',
      'tabs.settings': '设置',
      'coverage.title': '中文覆盖',
      'coverage.line': '已有中文 {translated} / {total}（{percent}%）',
      'list.count': '共 {count} 条',
      'coverage.translated': '已翻译',
      'coverage.untranslated': '未翻译',
      'coverage.stale': '过期',
      'coverage.draft': '未审核',
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
      'detail.useSource': '采用原文简介',
      'detail.useSourceHint': '把技能原文的 description 直接填入下方详细说明（原文若已是中文可直接用）。',
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
      'settings.title': '设置',
      'settings.enabled': '启用中文层',
      'settings.enabledHint': '关闭后 / 菜单与页面都回退英文，不修改任何技能文件。',
      'settings.mode': '菜单显示模式',
      'settings.mode.decorate': '装饰式（推荐）',
      'settings.mode.decorateHint': '直接在官方技能分组内显示中文名与中文简介，按中文分类分组，不新增菜单分组。',
      'settings.mode.overlay': '兼容叠加',
      'settings.mode.overlayHint': '保留官方英文分组，额外增加一个「技能」中文分组；装饰式失效时可用。',
      'settings.mode.off': '关闭菜单中文',
      'settings.mode.offHint': '不改动 / 菜单，只保留管理页。',
      'settings.mode.unknown': '未知模式',
      'settings.pinyin': '启用拼音搜索',
      'settings.pinyinHint': '支持全拼（quanwangdiaoyan）与首字母（qwdy）搜索中文技能。',
      'settings.recent': '显示最近使用',
      'settings.recentHint': '把最近用过的技能置顶到 / 菜单顶部（最多 6 个，保存在浏览器本地）。',
      'settings.provider': 'AI 重译 Provider（可选）',
      'settings.model': 'AI 重译模型（可选）',
      'settings.modelHint': '不用翻译时可以完全不填；留空使用宿主默认（deepseek-account / deepseek-flash），只影响详情页的「AI 重译（可选）」按钮。',
      'settings.save': '保存设置',
      'settings.saving': '保存中…',
      'settings.saveOk': '设置已保存，重新打开 / 菜单后生效。',
      'settings.saveFail': '设置保存失败',
      'settings.clearRecent': '清除最近使用记录',
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
      'error.loadStatus': '加载状态失败',
      'error.render': '管理页渲染出错',
      'notice.close': '关闭',
    };

    var COPY_EN = {
      'panel.label': 'Skill Manager',
      'page.title': 'Skill Manager',
      'page.subtitle': 'Manage Chinese display names, summaries and categories for skills: the / menu shows Chinese by category while invocations stay in English. Never edits SKILL.md.',
      'page.refresh': 'Refresh',
      'page.loading': 'Loading…',
      'page.retry': 'Retry',
      'page.none': '—',
      'page.unknown': 'Unknown',
      'page.close': 'Close',
      'tabs.library': 'Library',
      'tabs.settings': 'Settings',
      'coverage.title': 'Chinese coverage',
      'coverage.line': 'Chinese ready {translated} / {total}（{percent}%）',
      'list.count': '{count} skills',
      'coverage.translated': 'Translated',
      'coverage.untranslated': 'Untranslated',
      'coverage.stale': 'Stale',
      'coverage.draft': 'Draft',
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
      'detail.useSourceHint': 'Fill the description below with the skill\u2019s original description (reuse it directly when it is already Chinese).',
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
      'detail.uninstalling': 'Uninstalling…',
      'detail.uninstallOk': 'Uninstalled. The skill was moved to the recycle bin.',
      'detail.uninstallFail': 'Failed to uninstall',
      'settings.title': 'Settings',
      'settings.enabled': 'Enable the Chinese layer',
      'settings.enabledHint': 'When disabled, both the / menu and this page fall back to English. No skill file is modified.',
      'settings.mode': 'Menu display mode',
      'settings.mode.decorate': 'Decorate (recommended)',
      'settings.mode.decorateHint': 'Show Chinese names and descriptions inside the official skill group, grouped by Chinese category. No extra menu group.',
      'settings.mode.overlay': 'Overlay (compatibility)',
      'settings.mode.overlayHint': 'Keep the official English group and add a separate Chinese "技能" group. Use if decorating does not work.',
      'settings.mode.off': 'Disable menu i18n',
      'settings.mode.offHint': 'Leave the / menu untouched; keep this management page only.',
      'settings.mode.unknown': 'Unknown mode',
      'settings.pinyin': 'Enable pinyin search',
      'settings.pinyinHint': 'Search Chinese skills by full pinyin (quanwangdiaoyan) or initials (qwdy).',
      'settings.recent': 'Show recently used',
      'settings.recentHint': 'Pin recently used skills to the top of the / menu (up to 6, stored in this browser).',
      'settings.provider': 'Translator provider',
      'settings.model': 'Translator model',
      'settings.modelHint': 'Leave empty to use the host default (deepseek-account / deepseek-flash).',
      'settings.save': 'Save settings',
      'settings.saving': 'Saving…',
      'settings.saveOk': 'Settings saved. Reopen the / menu to apply.',
      'settings.saveFail': 'Failed to save settings',
      'settings.clearRecent': 'Clear recent skills',
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
      if (indexInflight) return indexInflight;
      indexInflight = (async function () {
        try {
          var body = await apiRequest(API_BASE + '/list', {
            headers: { accept: 'application/json' },
            cache: 'no-store',
          });
          if (!Array.isArray(body.skills) || !Array.isArray(body.categories)) {
            throw new Error(t('error.badPayload'));
          }
          var data = normalizeIndex(body);
          indexCache = { data: data, at: Date.now() };
          indexError = null;
          lastIndexFailureAt = 0;
          return data;
        } catch (err) {
          indexError = err;
          lastIndexFailureAt = Date.now();
          return null;
        } finally {
          indexInflight = null;
        }
      })();
      return indexInflight;
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
        fontSize: '13px',
        lineHeight: 1.5,
      },
      buttonPrimary: {
        cursor: 'pointer',
        border: '1px solid transparent',
        background: 'var(--dsh-accent, #4c8dff)',
        color: '#fff',
        borderRadius: '6px',
        padding: '6px 14px',
        fontSize: '13px',
        lineHeight: 1.5,
      },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        border: '1px solid var(--dsh-border, rgba(127,127,127,0.35))',
        background: 'transparent',
        color: 'inherit',
        borderRadius: '6px',
        padding: '6px 9px',
        fontSize: '14px',
        fontFamily: 'inherit',
      },
      textarea: {
        width: '100%',
        boxSizing: 'border-box',
        minHeight: '70px',
        resize: 'vertical',
        border: '1px solid var(--dsh-border, rgba(127,127,127,0.35))',
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
        opacity: 0.75,
        padding: '7px 12px',
        fontSize: '13px',
      },
      tabActive: { borderBottomColor: 'var(--dsh-accent, #4c8dff)', color: 'inherit', fontWeight: 600 },
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
      banner: { padding: '8px 10px', borderRadius: '6px', marginTop: '12px', border: '1px solid rgba(127,127,127,0.3)' },
      bannerError: { borderColor: 'rgba(217,83,79,0.7)', color: '#ff9d9d', background: 'rgba(217,83,79,0.12)' },
      bannerOk: { borderColor: 'rgba(60,154,95,0.7)', color: '#8fd6a5', background: 'rgba(60,154,95,0.12)' },
      bannerWarn: { borderColor: 'rgba(201,162,39,0.7)', color: '#e8cc6a', background: 'rgba(201,162,39,0.12)' },
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
      progressBar: { height: '100%', background: 'var(--dsh-accent, #4c8dff)', transition: 'width 0.2s ease' },
      label: { display: 'block', fontSize: '13px', fontWeight: 500, color: 'inherit', opacity: 0.85, marginBottom: '3px' },
      field: { display: 'block', marginTop: '10px' },
      grid2: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px', marginTop: '12px' },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '12.5px' },
      diag: { fontSize: '12px', color: 'inherit', opacity: 0.72, marginTop: '6px', wordBreak: 'break-word' },
      pre: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'inherit' },
    };

    var MODES = ['decorate', 'overlay', 'off'];
    var STATUS_COLORS = { fresh: '#3c9a5f', stale: '#c9a227', untranslated: '#8b949e', draft: '#a06bd0' };

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
        props.kind === 'error' ? STYLES.bannerError : props.kind === 'warn' ? STYLES.bannerWarn : STYLES.bannerOk;
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
      var key = props.status;
      var color = STATUS_COLORS[key] || '#8b949e';
      return h('span', { style: sx(STYLES.badge, { borderColor: color, color: 'inherit', fontWeight: 500 }) }, tr('status.' + key));
    }

    function field(tr, label, child) {
      return h('label', { style: STYLES.field }, h('span', { style: STYLES.label }, label), child);
    }

    function infoRow(tr, label, value) {
      var text = value === undefined || value === null || value === '' ? tr('page.none') : String(value);
      return h(
        'div',
        { style: { marginTop: '8px' } },
        h('div', { style: STYLES.label }, label),
        h('div', { style: STYLES.pre }, text)
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
      var useState = React.useState;
      var [query, setQuery] = useState('');
      var [filter, setFilter] = useState('all');
      var [categoryFilter, setCategoryFilter] = useState('');

      var lowered = asString(query).replace(/^\s+|\s+$/g, '').toLowerCase();
      var filters = ['all', 'untranslated', 'stale', 'draft'];
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

      // 分类下拉：按主分类筛选（与 / 菜单分组一致），括号内为该分类技能数
      var categoryCounts = {};
      for (var cc = 0; cc < skills.length; cc++) {
        var ccId = skills[cc].zh ? resolveSection(index, skills[cc].zh.category).id : 'untranslated';
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
              style: sx(STYLES.button, filter === key ? { fontWeight: 600, borderColor: 'var(--dsh-accent, #4c8dff)' } : null),
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
        listRows.push(h('div', { key: 'empty', style: sx(STYLES.muted, { padding: '24px 8px', textAlign: 'center' }) }, tr('table.empty')));
      }
      for (var r = 0; r < rows.length; r++) {
        var row = rows[r];
        var rowZh = isObject(row.zh) ? row.zh : null;
        var summaryText = asString(rowZh && rowZh.summary) || clipText(row.description, 160);
        var openRow = (function (name) {
          return function () {
            props.onOpen(name);
          };
        })(row.name);
        var rowSection = row.zh ? resolveSection(index, row.zh.category) : null;
        var rowSectionId = rowSection ? rowSection.id : 'untranslated';
        if (rowSectionId !== lastSectionId) {
          lastSectionId = rowSectionId;
          listRows.push(
            h(
              'div',
              {
                key: 'section-' + rowSectionId,
                style: {
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
                },
              },
              h('span', null, (rowSection && rowSection.icon ? rowSection.icon + ' ' : '') + (rowSection ? rowSection.zh : tr('status.untranslated'))),
              h('span', { style: { fontWeight: 400, opacity: 0.8 } }, String(sectionCounts[rowSectionId] || 0))
            )
          );
        }
        listRows.push(
          h(
            'div',
            {
              key: row.name,
              role: 'button',
              tabIndex: 0,
              style: {
                display: 'flex',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: '10px',
                padding: '10px 6px',
                borderBottom: '1px solid var(--dsh-border, rgba(127,127,127,0.16))',
                cursor: 'pointer',
              },
              onClick: openRow,
              onKeyDown: function (event) {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  openRow();
                }
              },
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
                  rowZh && rowZh.name ? rowZh.name : row.name
                ),
                h('span', { style: sx(STYLES.mono, { color: 'inherit', opacity: 0.78 }) }, '/' + row.name)
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
              h('span', { style: sx(STYLES.badge, { color: 'inherit', borderColor: 'rgba(127,127,127,0.45)' }) }, categoryText(index, rowZh && rowZh.category)),
              h(StatusBadge, { tr: tr, status: skillStatusKey(row) }),
              h(
                'button',
                {
                  type: 'button',
                  style: STYLES.button,
                  onClick: (function (name) {
                    return function (event) {
                      try {
                        event.stopPropagation();
                      } catch (e) {}
                      props.onOpen(name);
                    };
                  })(row.name),
                },
                tr('table.edit')
              )
            )
          )
        );
      }

      return h(
        'div',
        null,
        h(
          'div',
          { style: sx(STYLES.row, { marginTop: '12px', justifyContent: 'space-between' }) },
          h(
            'div',
            { style: STYLES.row },
            h('input', {
              value: query,
              onChange: function (event) {
                setQuery(event.target.value);
              },
              placeholder: tr('filter.placeholder'),
              style: sx(STYLES.input, { width: '280px' }),
              'aria-label': tr('filter.placeholder'),
            }),
            h(
              'select',
              {
                value: categoryFilter,
                onChange: function (event) {
                  setCategoryFilter(event.target.value);
                },
                style: sx(STYLES.input, { width: '170px', cursor: 'pointer' }),
                'aria-label': tr('filter.categoryAll'),
              },
              h('option', { value: '' }, tr('filter.categoryAll')),
              categoryOptions
            ),
            filterButtons
          ),
          h('span', { style: sx(STYLES.muted, STYLES.small) }, tr('list.count', { count: rows.length }))
        ),
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

      useEffect(
        function () {
          setForm(emptyForm(skill));
          setInitial(emptyForm(skill));
        },
        [skill && skill.name, skill && skill.updatedAt, skill && skill.zh ? skill.zh.name : '']
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

      function save() {
        if (saving) return;
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
          if (typeof props.onBack === 'function') props.onBack();
          return;
        }
        // 空表单保存会让「未翻译」技能变成 fresh 并污染覆盖率：至少要有中文名或中文简介。
        var hasContent = contentFields.some(function (field) {
          var value = next[field];
          if (Array.isArray(value)) return value.length > 0;
          return typeof value === 'string' && value.trim() !== '';
        });
        if (!hasContent) {
          if (props.setNotice) props.setNotice({ kind: 'error', text: tr('detail.emptyZh') });
          return;
        }
        // 只提交实际改动的字段：内置/项目层内容不会被整份复制进用户层。
        if (changedContent) patch.origin = 'manual';
        setSaving(true);
        if (props.setNotice) props.setNotice(null);
        apiPost(API_BASE + '/save', {
          name: skill.name,
          review: changedContent || confirmReview ? 'reviewed' : undefined,
          zh: patch,
        })
          .then(function () {
            setSaving(false);
            if (props.setNotice) props.setNotice({ kind: 'ok', text: tr('detail.saveOk') });
            if (typeof props.onChanged === 'function') props.onChanged();
            // 保存成功后回到列表，成功提示由页面顶部的横幅展示，避免用户停在长表单里看不到反馈。
            if (typeof props.onBack === 'function') props.onBack();
          })
          .catch(function (err) {
            setSaving(false);
            if (props.setNotice) props.setNotice({ kind: 'error', text: tr('detail.saveFail') + '：' + errorText(err) });
          });
      }

      function regenerate() {
        if (busy) return;
        setBusy(true);
        apiPost(API_BASE + '/translate', { scope: 'selected', names: [skill.name] })
          .then(function () {
            setBusy(false);
            if (props.setNotice) props.setNotice({ kind: 'ok', text: tr('detail.regenerating') });
            if (typeof props.onChanged === 'function') props.onChanged();
          })
          .catch(function (err) {
            setBusy(false);
            if (props.setNotice) props.setNotice({ kind: 'error', text: tr('detail.regenerateFail') + '：' + errorText(err) });
          });
      }

      function removeOverride() {
        if (removing) return;
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
        if (uninstalling) return;
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
            if (typeof props.onBack === 'function') props.onBack();
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
          { style: sx(STYLES.row, { marginTop: '12px' }) },
          h(
            'button',
            { type: 'button', style: STYLES.button, onClick: props.onBack },
            '← ' + tr('detail.back')
          ),
          h('strong', null, zh && zh.name ? zh.name : skill.name),
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
                { type: 'button', style: sx(STYLES.button, { marginLeft: '10px' }), onClick: regenerate, disabled: busy },
                busy ? tr('detail.regenerating') : tr('detail.regenerate')
              )
            )
          : null,
        h(
          'div',
          { style: STYLES.grid2 },
          h(
            'div',
            { style: STYLES.card },
            h('strong', null, tr('detail.source')),
            infoRow(tr, tr('table.skill'), '/' + skill.name),
            infoRow(tr, 'description', skill.description),
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
            { style: STYLES.card },
            h('strong', null, tr('detail.zh')),
            h('div', { style: sx(STYLES.muted, STYLES.small, { margin: '4px 0 8px' }) }, tr('detail.layers') + '：' + layerText),
            skill.install
              ? h(
                  'div',
                  { style: sx(STYLES.row, { alignItems: 'center', marginBottom: '6px' }) },
                  h(
                    'a',
                    {
                      href: skill.install.sourceUrl,
                      target: '_blank',
                      rel: 'noopener noreferrer',
                      style: sx(STYLES.small, { color: 'inherit', marginRight: '8px' }),
                    },
                    tr('detail.installSource') + '：' + (skill.install.source || skill.install.sourceUrl)
                  ),
                  h(
                    'button',
                    { type: 'button', style: sx(STYLES.button, { fontSize: '11px' }), onClick: loadSource, disabled: sourceBusy },
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
                style: STYLES.input,
                onChange: function (event) {
                  setField('summary', event.target.value);
                },
              })
            ),
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
                { type: 'button', style: sx(STYLES.button, { fontSize: '11px' }), onClick: applySourceDescription },
                tr('detail.useSource')
              ),
              h('span', { style: sx(STYLES.muted, STYLES.small) }, tr('detail.useSourceHint'))
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
            h(
              'div',
              { style: sx(STYLES.row, { marginTop: '14px' }) },
              h(
                'button',
                { type: 'button', style: STYLES.buttonPrimary, onClick: save, disabled: saving },
                saving ? tr('detail.saving') : tr('detail.save')
              ),
              h(
                'button',
                { type: 'button', style: STYLES.button, onClick: regenerate, disabled: busy },
                busy ? tr('detail.regenerating') : tr('detail.regenerate')
              )
            ),
            hasUserLayer
              ? h(
                  'div',
                  { style: sx(STYLES.row, { marginTop: '10px', alignItems: 'center' }) },
                  h(
                    'button',
                    { type: 'button', style: sx(STYLES.button, { fontSize: '11px' }), onClick: removeOverride, disabled: removing },
                    removing ? tr('detail.removing') : removeArmed ? tr('detail.removeConfirm') : tr('detail.removeOverride')
                  ),
                  h('span', { style: sx(STYLES.muted, STYLES.small) }, tr('detail.removeHint'))
                )
              : null,
            uninstallable
              ? h(
                  'div',
                  {
                    style: sx(STYLES.row, {
                      marginTop: '12px',
                      paddingTop: '10px',
                      alignItems: 'center',
                      borderTop: '1px dashed var(--dsh-border, rgba(127,127,127,0.28))',
                    }),
                  },
                  h(
                    'button',
                    {
                      type: 'button',
                      style: sx(STYLES.button, { fontSize: '11px', color: '#ff9d9d', borderColor: 'rgba(217,83,79,0.6)' }),
                      onClick: uninstallSkill,
                      disabled: uninstalling,
                    },
                    uninstalling
                      ? tr('detail.uninstalling')
                      : uninstallArmed
                        ? tr('detail.uninstallConfirm')
                        : tr('detail.uninstall')
                  ),
                  h('span', { style: sx(STYLES.muted, STYLES.small) }, tr('detail.uninstallHint'))
                )
              : null,
            !zh ? h('div', { style: sx(STYLES.muted, STYLES.small, { marginTop: '8px' }) }, tr('detail.empty')) : null
          )
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

      function act(id, path, okKey) {
        if (busyId) return;
        setBusyId(id);
        apiPost(API_BASE + path, { id: id })
          .then(function () {
            setBusyId('');
            setArmedId('');
            load();
            if (typeof props.onChanged === 'function') props.onChanged();
            if (props.setNotice) props.setNotice({ kind: 'ok', text: tr(okKey) });
          })
          .catch(function (err) {
            setBusyId('');
            setArmedId('');
            if (props.setNotice) props.setNotice({ kind: 'error', text: tr('settings.trashFail') + '：' + errorText(err) });
          });
      }

      function purge(entry) {
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
        body = h('div', { style: sx(STYLES.small, { color: '#ff9d9d', marginTop: '6px' }) }, error);
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
                    style: sx(STYLES.button, { fontSize: '11px' }),
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
                    style: sx(STYLES.button, { fontSize: '11px', color: '#ff9d9d' }),
                    onClick: function () {
                      purge(entry);
                    },
                    disabled: !!busyId,
                  },
                  armedId === entry.id ? tr('settings.trashPurgeConfirm') : tr('settings.trashPurge')
                )
              )
            );
          })
        );
      }

      return h(
        'div',
        { style: sx(STYLES.card, { marginTop: '12px' }) },
        h('strong', null, tr('settings.trash')),
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

      useEffect(
        function () {
          setForm(formFromSettings(settings));
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
            if (props.setNotice) props.setNotice({ kind: 'ok', text: tr('settings.saveOk') });
            if (typeof props.onSaved === 'function') props.onSaved();
          })
          .catch(function (err) {
            setSaving(false);
            if (props.setNotice) props.setNotice({ kind: 'error', text: tr('settings.saveFail') + '：' + errorText(err) });
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
      return h(
        'div',
        null,
        h(
          'div',
          { style: sx(STYLES.card, { marginTop: '12px' }) },
          h('strong', null, tr('settings.title')),
          checkbox(tr, tr('settings.enabled'), form.enabled, function (next) {
            setField('enabled', next);
          }),
          h('div', { style: sx(STYLES.muted, STYLES.small) }, tr('settings.enabledHint')),
          h('div', { style: { marginTop: '16px' } }, h('strong', null, tr('settings.mode'))),
          modeOptions,
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
          { style: sx(STYLES.card, { marginTop: '12px' }) },
          h('strong', null, tr('settings.provider')),
          h(
            'div',
            { style: STYLES.grid2 },
            field(
              tr,
              tr('settings.provider'),
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
          h('div', { style: sx(STYLES.muted, STYLES.small, { marginTop: '6px' }) }, tr('settings.modelHint')),
          h(
            'div',
            { style: sx(STYLES.row, { marginTop: '14px' }) },
            h(
              'button',
              { type: 'button', style: STYLES.buttonPrimary, onClick: save, disabled: saving },
              saving ? tr('settings.saving') : tr('settings.save')
            ),
            h(
              'button',
              {
                type: 'button',
                style: STYLES.button,
                onClick: function () {
                  clearRecent();
                  if (props.setNotice) props.setNotice({ kind: 'ok', text: tr('settings.recentCleared') });
                },
              },
              tr('settings.clearRecent')
            )
          )
        ),
        h(
          'div',
          { style: sx(STYLES.card, { marginTop: '12px' }) },
          h('strong', null, tr('settings.store')),
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
      if (!diag) return h('div', { style: STYLES.diag }, tr('diag.title') + '：' + tr('diag.none'));
      var text = (diag.decorated ? tr('diag.decorated', { rows: Number(diag.rows) || 0 }) : tr('diag.skipped')) +
        ' · ' + tr('diag.mode') + '：' + modeLabel(tr, diag.mode) +
        ' · ' + tr('diag.at') + '：' + formatTime(diag.at);
      if (diag.error) text += ' · ' + tr('diag.error') + '：' + diag.error;
      return h('div', { style: STYLES.diag }, tr('diag.title') + '：' + text);
    }

    function Page(props) {
      var tr = pageTranslate(props && typeof props.t === 'function' ? props.t : null);
      var useState = React.useState;
      var useEffect = React.useEffect;
      var useCallback = React.useCallback;

      var [tab, setTab] = useState('library');
      var [data, setData] = useState(null);
      var [loading, setLoading] = useState(true);
      var [error, setError] = useState('');
      var [notice, setNotice] = useState(null);
      var [selected, setSelected] = useState('');

      var refresh = useCallback(function (force) {
        if (force) invalidateIndex();
        setLoading(true);
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
              setError(indexError ? errorText(indexError) : tr('error.loadList'));
              return;
            }
            setError('');
            setData({ index: index, status: status });
          })
          .catch(function (err) {
            setLoading(false);
            setError(errorText(err));
          });
      }, []);

      useEffect(function () {
        refresh(false);
        var timer = null;
        try {
          timer = setInterval(function () {
            refresh(false);
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
      var runningJobId = '';
      for (var i = 0; i < jobs.length; i++) {
        if (jobs[i] && jobs[i].state === 'running') {
          runningJobId = String(jobs[i].id);
          break;
        }
      }

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

      useEffect(function () {
        if (!notice) return undefined;
        var timer = setTimeout(function () {
          setNotice(null);
        }, 6000);
        return function () {
          clearTimeout(timer);
        };
      }, [notice]);

      if (!data) {
        if (error) {
          return h(
            'div',
            { style: STYLES.page },
            h('div', { style: STYLES.header }, h('h1', { style: STYLES.title }, tr('page.title'))),
            h(Banner, { tr: tr, kind: 'error', text: error }),
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
        return h('div', { style: STYLES.page }, h('div', { style: STYLES.muted }, tr('page.loading')));
      }

      var index = data.index;
      var status = data.status;
      var coverage = index.coverage || {};
      var total = Number(coverage.total) || 0;
      var translated = Number(coverage.translated) || 0;
      var percent = percentOf(translated, total);
      var diagnostics = status && status.diagnostics ? status.diagnostics : null;
      var diag = diagnostics && diagnostics.lastClientDecorate ? diagnostics.lastClientDecorate : lastDecorateReport;

      var tabs = [
        { id: 'library', label: tr('tabs.library') },
        { id: 'settings', label: tr('tabs.settings') },
      ];
      var tabButtons = [];
      for (var tIdx = 0; tIdx < tabs.length; tIdx++) {
        tabButtons.push(
          h(
            'button',
            {
              key: tabs[tIdx].id,
              type: 'button',
              style: sx(STYLES.tab, tab === tabs[tIdx].id ? STYLES.tabActive : null),
              onClick: (function (next) {
                return function () {
                  setTab(next);
                  setSelected('');
                  setNotice(null);
                };
              })(tabs[tIdx].id),
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
                onBack: function () {
                  setSelected('');
                },
                onChanged: function () {
                  refresh(true);
                },
                setNotice: setNotice,
              })
            : h(
                'div',
                { style: sx(STYLES.card, { marginTop: '12px' }) },
                h(
                  'button',
                  { type: 'button', style: STYLES.button, onClick: function () { setSelected(''); } },
                  '← ' + tr('detail.back')
                ),
                h('span', { style: sx(STYLES.muted, { marginLeft: '10px' }) }, tr('page.unknown'))
              );
        } else {
          content = h(LibraryTab, {
            tr: tr,
            index: index,
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
          onSaved: function () {
            refresh(true);
          },
        });
      }

      return h(
        'div',
        { style: STYLES.page },
        h(
          'div',
          { style: STYLES.header },
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
        h(
          'div',
          { style: sx(STYLES.card, { marginTop: '12px' }) },
          h(
            'div',
            { style: sx(STYLES.row, { justifyContent: 'space-between' }) },
            h('strong', null, tr('coverage.title')),
            h('span', { style: sx(STYLES.muted, STYLES.small) }, tr('coverage.line', { translated: translated, total: total, percent: percent }))
          ),
          h(
            'div',
            { style: STYLES.progress },
            h('div', { style: sx(STYLES.progressBar, { width: percent + '%' }) })
          ),
          h(
            'div',
            { style: sx(STYLES.row, { marginTop: '8px' }) },
            h('span', { style: sx(STYLES.muted, STYLES.small) }, tr('coverage.translated') + ' ' + translated),
            h('span', { style: sx(STYLES.muted, STYLES.small) }, tr('coverage.untranslated') + ' ' + (Number(coverage.untranslated) || 0)),
            h('span', { style: sx(STYLES.muted, STYLES.small) }, tr('coverage.stale') + ' ' + (Number(coverage.stale) || 0)),
            h('span', { style: sx(STYLES.muted, STYLES.small) }, tr('coverage.draft') + ' ' + (Number(coverage.draft) || 0))
          ),
          h(DiagLine, { tr: tr, diag: diag })
        ),
        h('div', { style: STYLES.tabRow }, tabButtons),
        content
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
