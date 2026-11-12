/**
 * dsh-skill-workbench 客户端 bundle 自测。
 *
 * 只依赖 Node 内置模块：node:vm 造沙箱（假 window.__ModuleLoader__ / 假 react /
 * 假 ctx / 假 localStorage / 可控时钟 / mock fetch），不需要浏览器、不新增依赖。
 *
 * 运行：node client.selftest.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const HERE = new URL('./', import.meta.url);
const bundleSource = fs.readFileSync(new URL('./client.js', HERE), 'utf8');

let passed = 0;
function ok(name) {
  passed += 1;
  console.log('ok ' + passed + ' - ' + name);
}

const RECENT_KEY = 'dsh-skill-workbench:recent';
const BASE_TIME = 1700000000000;

// ---------------------------------------------------------------------------
// mock 数据（形状严格照 docs/API-CONTRACT.md §2）
// ---------------------------------------------------------------------------
const CATEGORIES = [
  { id: 'project', zh: '项目与需求', order: 10, icon: '📋' },
  { id: 'tooling', zh: '技术设计与开发', order: 20, icon: '🛠' },
  { id: 'quality', zh: '质量与发布', order: 30, icon: '✅' },
  { id: 'frontend', zh: '前端与视觉设计', order: 40, icon: '🎨' },
  { id: 'image', zh: '图像与创意生成', order: 50, icon: '🖼' },
  { id: 'research', zh: '信息数据与可视化', order: 60, icon: '🔎' },
  { id: 'writing', zh: '内容创作与写作', order: 70, icon: '✍' },
];

const ZH_ENTRIES = {
  'agent-reach': {
    name: '全网调研',
    alias: ['联网调研', '跨平台搜索'],
    summary: '跨平台搜索与深入调研',
    description: '用统一接口检索多个平台并汇总证据。',
    whenToUse: '需要全网调研某个话题时。',
    notFor: '只查一个已知链接时。',
    category: 'research',
    tags: ['调研', '搜索'],
    keywords: ['research', 'xiaohongshu'],
    pinyin: 'quanwangdiaoyan',
    pinyinInitials: 'qwdy',
    origin: 'builtin',
    review: 'reviewed',
  },
  'bug-hunt': {
    name: '缺陷定位',
    alias: ['修 bug'],
    summary: '复现并定位问题',
    description: '给最小复现与验证路径。',
    whenToUse: '出现 bug 时。',
    notFor: '纯功能变更不适用。',
    category: 'quality',
    tags: ['bug'],
    keywords: ['bugfix'],
    pinyin: 'quexiandingwei',
    pinyinInitials: 'qxdw',
    origin: 'builtin',
    review: 'reviewed',
  },
  'data-analysis': {
    name: '数据分析',
    alias: ['Excel 分析'],
    summary: '统计、透视与导出',
    description: '对表格数据做统计与导出。',
    whenToUse: '上传 Excel/CSV 需要分析时。',
    notFor: '无数据时。',
    category: 'research',
    tags: ['表格'],
    keywords: ['excel'],
    pinyin: 'shujufenxi',
    pinyinInitials: 'sjfx',
    origin: 'builtin',
    review: 'reviewed',
  },
  'karpathy-guidelines': {
    name: '编码守则',
    alias: [],
    summary: '减少编码错误的守则',
    description: '避免过度设计，做外科手术式修改。',
    whenToUse: '写代码或改代码时。',
    notFor: '与代码无关时。',
    category: 'tooling',
    tags: ['规范'],
    keywords: ['coding'],
    pinyin: 'bianmashouze',
    pinyinInitials: 'bmsz',
    origin: 'builtin',
    review: 'reviewed',
  },
};

const SKILL_ORDER = ['agent-reach', 'bug-hunt', 'data-analysis', 'karpathy-guidelines', 'unknown-skill'];

function makePayload(mutator) {
  const payload = {
    ok: true,
    generatedAt: '2026-11-12T00:00:00.000Z',
    store: { userPath: 'C:\\Users\\Administrator\\.dsh\\skill-i18n', builtinVersion: '1.0.0' },
    settings: {
      enabled: true,
      mode: 'decorate',
      pinyinSearch: true,
      showRecent: true,
      translatorProvider: 'deepseek-account',
      translatorModel: 'deepseek-flash',
    },
    categories: CATEGORIES.map((cat) => Object.assign({}, cat)),
    skills: SKILL_ORDER.map((name) => {
      const slug = name === 'unknown-skill' ? 'Unknown Skill' : name.replace(/-/g, ' ');
      const zh = ZH_ENTRIES[name] ? Object.assign({}, ZH_ENTRIES[name]) : null;
      return {
        name,
        description: 'English description of ' + slug + '.',
        whenToUse: 'English when-to-use.',
        modelInvocable: true,
        path: '/skills/' + name + '/SKILL.md',
        source: { kind: 'builtin', rank: 1 },
        hash: { frontmatter: 'aaaaaaaaaaaa', body: 'bbbbbbbbbbbb' },
        bodyPreview: '# ' + name,
        status: zh ? 'fresh' : 'untranslated',
        zh,
        origin: zh ? 'builtin' : null,
        updatedAt: '2026-11-01T10:00:00.000Z',
        dirName: name,
      };
    }),
    coverage: { total: SKILL_ORDER.length, translated: 4, draft: 0, stale: 0, untranslated: 1 },
  };
  if (typeof mutator === 'function') mutator(payload);
  return payload;
}

// ---------------------------------------------------------------------------
// 假环境
// ---------------------------------------------------------------------------
function makeStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(String(key));
    },
  };
}

function createWorld(options) {
  const opts = options || {};
  const clock = { now: BASE_TIME };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(clock.now);
      else super(...args);
    }
    static now() {
      return clock.now;
    }
  }

  const calls = {
    fetch: [],
    warns: [],
    errors: [],
    slots: [],
    effects: [],
    listeners: {},
    requires: [],
  };
  const timers = { intervals: new Map(), timeouts: new Map(), seq: 0 };

  let payload = opts.payload || makePayload(opts.mutate);

  const localStorage = makeStorage(
    opts.recent ? { [RECENT_KEY]: JSON.stringify(opts.recent) } : {}
  );

  const skillSource = {
    trigger: '/',
    name: 'skill',
    order: 2,
    candidatesCalls: [],
    picks: [],
    async candidates(session, request) {
      this.candidatesCalls.push(request && Object.assign({}, request));
      if (opts.origThrows) throw new Error('orig candidates 失败');
      const query = request && typeof request.query === 'string' ? request.query : '';
      const rows = payload.skills.map((skill) => ({ name: skill.name, description: skill.description }));
      if (!query) return rows;
      return rows.filter((row) => row.name.toLowerCase().includes(query.toLowerCase()));
    },
    onPick(pick) {
      this.picks.push(pick);
      const name = pick && pick.candidate ? pick.candidate.name : '';
      return { text: '/' + name + ' ' };
    },
  };

  const inputTriggers = {
    live: { sources: opts.noSource ? [] : [skillSource] },
    registerSource(source) {
      if (this.live.sources.some((item) => item.trigger === source.trigger && item.name === source.name)) {
        throw new Error('slash source "' + source.name + '" is already registered');
      }
      this.live.sources.push(source);
      const owner = this;
      return function dispose() {
        const at = owner.live.sources.indexOf(source);
        if (at >= 0) owner.live.sources.splice(at, 1);
      };
    },
  };

  const dictionaries = new Map();
  const locale = {
    register(ns, dicts) {
      if (dictionaries.has(ns)) throw new Error('locale namespace 已注册: ' + ns);
      dictionaries.set(ns, dicts);
      return () => dictionaries.delete(ns);
    },
    bind(ns) {
      const dicts = dictionaries.get(ns) || {};
      const primary = dicts.zh || {};
      const fallback = dicts.en || {};
      return function seatTranslate(key, params) {
        let value = primary[key];
        if (value === undefined) value = fallback[key];
        if (typeof value !== 'string') return key;
        if (params) {
          value = value.replace(/\{(\w+)\}/g, (match, name) =>
            params[name] === undefined || params[name] === null ? match : String(params[name])
          );
        }
        return value;
      };
    },
  };

  const slots = {
    inject(name, callback) {
      const result = callback();
      return typeof result === 'function' ? result : () => {};
    },
    register(slotOptions, Component) {
      calls.slots.push({ options: slotOptions, Component });
      return () => {};
    },
  };

  const layout = {
    selectedPanels: [],
    selectPanel(id) {
      this.selectedPanels.push(id);
    },
  };

  function jsonResponse(body, status) {
    const code = status || 200;
    return {
      ok: code < 400,
      status: code,
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
  }

  function statusPayload() {
    return {
      ok: true,
      version: '0.1.0',
      settings: payload.settings,
      store: payload.store,
      jobs: opts.jobs || [],
      diagnostics: { lastClientDecorate: opts.diag || null },
    };
  }

  async function fakeFetch(url, init) {
    const text = String(url);
    calls.fetch.push({ url: text, init: init || {} });
    if (opts.fetchFail) throw new Error('network down');
    if (text.includes('api/dsh-skill-workbench/list')) {
      if (opts.listStatus && opts.listStatus >= 400) {
        return jsonResponse({ ok: false, code: 'ERR_LIST', message: '列表不可用' }, opts.listStatus);
      }
      return jsonResponse(payload);
    }
    if (text.includes('api/dsh-skill-workbench/status')) return jsonResponse(statusPayload());
    if (text.includes('api/dsh-skill-workbench/diag')) return jsonResponse({ ok: true });
    if (text.includes('api/dsh-skill-workbench/save')) return jsonResponse({ ok: true, entry: {} });
    if (text.includes('api/dsh-skill-workbench/translate')) return jsonResponse({ ok: true, jobId: 'job-1', total: 2 });
    if (text.includes('api/dsh-skill-workbench/cancel')) return jsonResponse({ ok: true });
    if (text.includes('api/dsh-skill-workbench/config')) return jsonResponse({ ok: true, settings: {} });
    return jsonResponse({ ok: true });
  }

  function createElement(type, props) {
    const children = Array.prototype.slice.call(arguments, 2);
    const merged = Object.assign({}, props || {});
    if (children.length === 1) merged.children = children[0];
    else if (children.length > 1) merged.children = children;
    return { type, props: merged };
  }
  class FakeComponent {
    constructor(props) {
      this.props = props || {};
    }
  }
  const fakeReact = {
    createElement,
    Component: FakeComponent,
    useState() {
      throw new Error('自测不应渲染管理页（React.useState 被调用）');
    },
    useEffect() {
      throw new Error('自测不应渲染管理页（React.useEffect 被调用）');
    },
    useCallback() {
      throw new Error('自测不应渲染管理页（React.useCallback 被调用）');
    },
  };

  const ctx = {
    get(name) {
      if (opts.getThrows) throw new Error('get 失败');
      if (name === 'slots') return opts.badSlots ? opts.badSlots : slots;
      if (name === 'locale') return opts.badLocale ? opts.badLocale : locale;
      if (name === 'inputTriggers') return opts.badInputTriggers ? opts.badInputTriggers : inputTriggers;
      if (name === 'layout') return opts.noLayout ? undefined : layout;
      return undefined;
    },
    locale,
    slots,
    inputTriggers,
    layout,
    effect(callback, label) {
      calls.effects.push({ label, dispose: callback() });
      return () => {};
    },
    on(event, callback) {
      if (!calls.listeners[event]) calls.listeners[event] = [];
      calls.listeners[event].push(callback);
      return () => {};
    },
  };

  let definition = null;
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(value) {
          definition = value;
        },
      },
    },
    console: {
      log() {},
      warn(...args) {
        calls.warns.push(args.map(String).join(' '));
      },
      error(...args) {
        calls.errors.push(args.map(String).join(' '));
      },
    },
    fetch: fakeFetch,
    localStorage,
    document: { documentElement: { lang: 'zh-CN' } },
    navigator: { languages: ['zh-CN'], language: 'zh-CN' },
    Date: FakeDate,
    setTimeout: (fn, ms) => {
      const id = ++timers.seq;
      timers.timeouts.set(id, { fn, ms });
      return id;
    },
    clearTimeout: (id) => timers.timeouts.delete(id),
    setInterval: (fn, ms) => {
      const id = ++timers.seq;
      timers.intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval: (id) => timers.intervals.delete(id),
    JSON,
    Math,
    Object,
    Array,
    Promise,
    Map,
    Set,
    Error,
    TypeError,
    Number,
    String,
    Boolean,
    RegExp,
    parseInt,
    parseFloat,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
  };
  vm.createContext(sandbox);
  vm.runInContext(bundleSource, sandbox, { filename: 'client.js' });

  return {
    clock,
    calls,
    ctx,
    payload: () => payload,
    setPayload(next) {
      payload = next;
    },
    rename: skillSource,
    skillSource,
    inputTriggers,
    locale,
    layout,
    storage: localStorage,
    overlaySource() {
      return inputTriggers.live.sources.find((source) => source && source.name === '技能');
    },
    load() {
      assert.ok(definition, '__ModuleLoader__.load 未被调用');
      assert.equal(typeof definition.factory, 'function');
      const requires = [];
      const requireFn = (id) => {
        requires.push(id);
        if (id !== 'react') throw new Error('client.js 不应 require("' + id + '")，只允许 react');
        return fakeReact;
      };
      const exports = definition.factory(requireFn);
      calls.requires = requires;
      return exports;
    },
  };
}

function rawSkillNames(rows) {
  // 结果数组产自 vm realm，转成宿主 realm 数组再比较
  return Array.from(rows, (row) => row.name);
}

// ---------------------------------------------------------------------------
// 场景 1：apply 注册、菜单装饰、搜索、最近使用、onPick、diag、三模式
// ---------------------------------------------------------------------------
async function scenarioMain() {
  const world = createWorld({ recent: ['bug-hunt'] });
  const exports = world.load();
  ok('factory 只 require("react")');
  assert.deepEqual(world.calls.requires, ['react']);

  assert.equal(exports.name, 'dsh-skill-workbench');
  assert.equal(Array.from(exports.inject).join(','), 'slots,locale,inputTriggers');
  assert.equal(typeof exports.apply, 'function');

  const cleanup = exports.apply(world.ctx);
  assert.equal(typeof cleanup, 'function');
  ok('apply 执行不抛错并返回 cleanup');

  // 侧栏 + main 座位
  const panel = world.calls.slots.find((entry) => entry.options.name === 'sidebar.panellist');
  const main = world.calls.slots.find((entry) => entry.options.name === 'main');
  assert.ok(panel, '缺少 sidebar.panellist 注册');
  assert.ok(main, '缺少 main 注册');
  assert.equal(panel.options.id, 'dsh-skill-workbench');
  assert.equal(panel.options.order, 60);
  assert.equal(panel.options.locale, 'dsh-skill-workbench');
  assert.equal(panel.options.label(), '技能管理');
  assert.equal(main.options.key, 'dsh-skill-workbench');
  assert.equal(main.options.locale, 'dsh-skill-workbench');
  const iconNode = panel.Component({ size: 18 });
  assert.equal(iconNode.props['data-dsh-panel-entry'], 'dsh-skill-workbench');
  ok('管理页侧栏行 + main keyed 页注册正确（中文 label）');

  const source = world.skillSource;
  assert.ok(source.__dsh_skill_i18n_mark__, '内置 skill source 未被标记包装');
  const overlay = world.overlaySource();
  assert.ok(overlay, 'overlay source 未注册');
  assert.equal(overlay.trigger, '/');
  assert.equal(overlay.name, '技能');
  assert.equal(overlay.order, 3);
  assert.equal(overlay.showGroupTitle, false);
  assert.equal(typeof overlay.onPick, 'function');
  ok('overlay source（trigger/name/order/showGroupTitle）注册正确');

  // 空 query：最近使用 → 分类 order → 未翻译末位
  const decorated = await source.candidates({ sessionId: 's1' }, { query: '' });
  assert.deepEqual(rawSkillNames(decorated), [
    'bug-hunt',
    'karpathy-guidelines',
    'agent-reach',
    'data-analysis',
    'unknown-skill',
  ]);
  assert.equal(decorated[0].section, '最近使用');
  assert.equal(decorated[1].label, '编码守则');
  assert.equal(decorated[1].section, '技术设计与开发');
  assert.equal(decorated[2].label, '全网调研');
  assert.equal(decorated[2].section, '信息数据与可视化');
  assert.match(decorated[2].description, /跨平台搜索/);
  assert.equal(typeof decorated[2].icon, 'function');
  assert.equal(decorated[4].section, '未翻译');
  assert.equal(decorated[4].label, undefined);
  assert.match(decorated[4].description, /English description/);
  ok('空 query：中文 label/section/description、最近使用置顶、分类排序、未翻译末位');

  // 原 source 必须收到 query:''（中文过滤由包装层负责）
  assert.equal(source.candidatesCalls[source.candidatesCalls.length - 1].query, '');
  ok('包装层向 orig 传 query:"" 取全量');

  // 中文 query
  const byChinese = await source.candidates({}, { query: '调研' });
  assert.equal(byChinese[0].name, 'agent-reach');
  assert.equal(byChinese[0].label, '全网调研');
  ok('中文 query「调研」命中 agent-reach');

  // 拼音全拼 / 首字母
  const byPinyin = await source.candidates({}, { query: 'qwdy' });
  assert.equal(byPinyin[0].name, 'agent-reach');
  const byInitials = await source.candidates({}, { query: 'qwd' });
  assert.equal(byInitials[0].name, 'agent-reach');
  ok('拼音全拼 / 首字母 query 命中');

  // 别名
  const byAlias = await source.candidates({}, { query: 'Excel' });
  assert.equal(byAlias[0].name, 'data-analysis');
  ok('别名（大小写不敏感）query 命中');

  // 英文原名
  const byEnglish = await source.candidates({}, { query: 'analysis' });
  assert.equal(byEnglish[0].name, 'data-analysis');
  ok('英文 name query 命中');

  const noMatch = await source.candidates({}, { query: 'no-such-skill-xyz' });
  assert.equal(noMatch.length, 0);
  ok('无匹配 query 返回空数组');

  // aborted signal
  const aborted = await source.candidates({}, { query: '', signal: { aborted: true } });
  assert.equal(aborted.length, 0);
  ok('signal.aborted 时返回空数组');

  // onPick：记录最近使用并透传原返回值
  const pickResult = await source.onPick({ candidate: { name: 'agent-reach' }, session: {}, position: 0, via: 'menu' });
  assert.equal(pickResult.text, '/agent-reach ');
  assert.equal(source.picks.length, 1);
  const recentStored = JSON.parse(world.storage.getItem(RECENT_KEY));
  assert.deepEqual(recentStored.slice(0, 2), ['agent-reach', 'bug-hunt']);
  ok('onPick 包一层：记录最近使用 + 原样返回 {text:"/name "}');

  // diag：首次装饰成功上报一次
  const diagCalls = world.calls.fetch.filter((call) => call.url.includes('api/dsh-skill-workbench/diag'));
  assert.equal(diagCalls.length, 1);
  const diagBody = JSON.parse(diagCalls[0].init.body);
  assert.equal(diagBody.mode, 'decorate');
  assert.equal(diagBody.decorated, true);
  assert.equal(diagBody.rows, 5);
  assert.ok(diagBody.at);
  ok('首次装饰成功后 POST diag（mode/decorated/rows/at）且只上报一次');

  // 默认 decorate 模式下 overlay 不返回候选
  assert.equal((await overlay.candidates({}, { query: '' })).length, 0);
  ok('decorate 模式下 overlay source 返回空（组不显示）');

  // 模式切换：decorate → off（TTL 30s 过期后重新取 list）
  world.payload().settings.mode = 'off';
  world.clock.now += 31000;
  const offRows = await source.candidates({}, { query: '' });
  assert.deepEqual(rawSkillNames(offRows), SKILL_ORDER);
  assert.equal(offRows[0].label, undefined);
  assert.equal((await overlay.candidates({}, { query: '' })).length, 0);
  ok('mode=off：菜单回退英文原行，overlay 也不返回候选');

  // 模式切换：off → overlay
  world.payload().settings.mode = 'overlay';
  world.clock.now += 31000;
  const overlayRows = await overlay.candidates({}, { query: '' });
  assert.ok(overlayRows.length > 0);
  assert.equal(overlayRows[0].name, 'agent-reach');
  assert.equal(overlayRows[0].label, '全网调研');
  assert.equal(overlayRows[0].section, '最近使用');
  const decorateInOverlay = await source.candidates({}, { query: '' });
  assert.equal(decorateInOverlay[0].label, undefined);
  assert.deepEqual(rawSkillNames(decorateInOverlay), SKILL_ORDER);
  ok('mode=overlay：装饰包装不生效，overlay source 返回中文行');

  // overlay onPick
  const overlayPick = await overlay.onPick({ candidate: { name: 'data-analysis' }, via: 'menu' });
  assert.equal(overlayPick.text, '/data-analysis ');
  ok('overlay onPick 返回 {text:"/english-name "}');

  // enabled=false
  world.payload().settings.mode = 'decorate';
  world.payload().settings.enabled = false;
  world.clock.now += 31000;
  const disabledRows = await source.candidates({}, { query: '' });
  assert.deepEqual(rawSkillNames(disabledRows), SKILL_ORDER);
  assert.equal((await overlay.candidates({}, { query: '' })).length, 0);
  ok('enabled=false：菜单与 overlay 都回退英文');

  const listCalls = world.calls.fetch.filter((call) => call.url.includes('api/dsh-skill-workbench/list'));
  assert.equal(listCalls.length, 4, '预期 4 次 list 拉取（首次 + 3 次模式切换）');
  ok('索引 30s TTL + 模式切换后重新拉取 list');

  // 手动刷新类场景：invalidateIndex 后可重新拉取由页面驱动，这里只确认 diag 未重复
  assert.equal(world.calls.fetch.filter((call) => call.url.includes('/diag')).length, 1);
  ok('diag 整个生命周期只上报一次');

  cleanup();
  ok('cleanup 可重复调用（幂等）');
  cleanup();
}

// ---------------------------------------------------------------------------
// 场景 2：服务端 404 → 优雅降级 + 失败重试窗口
// ---------------------------------------------------------------------------
async function scenarioUnavailable() {
  const world = createWorld({ listStatus: 404 });
  const exports = world.load();
  exports.apply(world.ctx);
  const source = world.skillSource;

  const rows = await source.candidates({}, { query: '' });
  assert.deepEqual(rawSkillNames(rows), SKILL_ORDER);
  assert.equal(rows[0].label, undefined);
  ok('list API 404：菜单原样回退英文（不抛错、不白屏）');

  const diagCalls = world.calls.fetch.filter((call) => call.url.includes('/diag'));
  assert.equal(diagCalls.length, 1);
  const diagBody = JSON.parse(diagCalls[0].init.body);
  assert.equal(diagBody.decorated, false);
  assert.ok(diagBody.error && diagBody.error.length > 0);
  ok('索引不可用时 diag 上报 decorated:false + error');

  const listCallsBefore = world.calls.fetch.filter((call) => call.url.includes('/list')).length;
  await source.candidates({}, { query: '' });
  const listCallsAfter = world.calls.fetch.filter((call) => call.url.includes('/list')).length;
  assert.equal(listCallsAfter, listCallsBefore, '失败后的 10s 重试窗口内不应重复请求');
  ok('失败后 10s 内不重复请求 list（single-flight/重试窗口）');

  world.clock.now += 11000;
  await source.candidates({}, { query: '' });
  assert.equal(
    world.calls.fetch.filter((call) => call.url.includes('/list')).length,
    listCallsAfter + 1
  );
  ok('10s 重试窗口过后重新尝试 list');

  assert.equal((await world.overlaySource().candidates({}, { query: '' })).length, 0);
  ok('索引不可用时 overlay 返回空');
}

// ---------------------------------------------------------------------------
// 场景 3：原 source 抛错 → 不挂死（异常回退）
// ---------------------------------------------------------------------------
async function scenarioOrigThrows() {
  const world = createWorld({ origThrows: true });
  const exports = world.load();
  exports.apply(world.ctx);
  await assert.rejects(
    () => world.skillSource.candidates({}, { query: '' }),
    /orig candidates 失败/
  );
  ok('原 source 抛错时异常向外传递（由 input-trigger 记录 source-failed），不会静默白屏');
}

// ---------------------------------------------------------------------------
// 场景 4：覆盖率为 0 / 空索引 → 原样返回
// ---------------------------------------------------------------------------
async function scenarioEmptyCoverage() {
  const world = createWorld({
    mutate(payload) {
      payload.coverage = { total: 5, translated: 0, draft: 0, stale: 0, untranslated: 5 };
      payload.skills = payload.skills.map((skill) => Object.assign({}, skill, { zh: null, status: 'untranslated' }));
    },
  });
  const exports = world.load();
  exports.apply(world.ctx);
  const rows = await world.skillSource.candidates({}, { query: '' });
  assert.deepEqual(rawSkillNames(rows), SKILL_ORDER);
  assert.equal(rows.some((row) => row.label !== undefined), false);
  ok('coverage.translated===0：原样返回 orig（英文菜单完整）');
}

// ---------------------------------------------------------------------------
// 场景 5：拼音搜索关闭时 pinyin query 不命中
// ---------------------------------------------------------------------------
async function scenarioPinyinOff() {
  const world = createWorld({
    mutate(payload) {
      payload.settings.pinyinSearch = false;
    },
  });
  const exports = world.load();
  exports.apply(world.ctx);
  const rows = await world.skillSource.candidates({}, { query: 'qwdy' });
  assert.equal(rows.length, 0, 'pinyinSearch=false 时不应命中拼音 query');
  ok('pinyinSearch=false：拼音 query 不命中');
}

// ---------------------------------------------------------------------------
// 场景 6：apply 在恶意/残缺 ctx 下不抛错
// ---------------------------------------------------------------------------
async function scenarioBadContexts() {
  const badContexts = [
    null,
    undefined,
    {},
    { get() { throw new Error('get boom'); } },
    {
      get() { throw new Error('get boom'); },
      locale: { register() { throw new Error('register boom'); }, bind() { throw new Error('bind boom'); } },
      slots: { inject() { throw new Error('inject boom'); }, register() { throw new Error('register boom'); } },
      effect() { throw new Error('effect boom'); },
      on() { throw new Error('on boom'); },
    },
  ];
  for (let i = 0; i < badContexts.length; i++) {
    const world = createWorld({ noSource: true, noLayout: true });
    const exports = world.load();
    let cleanup;
    assert.doesNotThrow(() => {
      cleanup = exports.apply(badContexts[i]);
    }, 'apply 在坏 ctx #' + i + ' 下不应抛错');
    if (typeof cleanup === 'function') cleanup();
  }
  ok('apply 在 null/残缺/抛错 ctx 下均不抛错（全局 try/catch 生效）');
}

// ---------------------------------------------------------------------------
// 场景 7：注册座位抛错时其余注册继续
// ---------------------------------------------------------------------------
async function scenarioBadSlots() {
  const world = createWorld({
    badSlots: {
      inject() {
        throw new Error('inject boom');
      },
      register() {
        throw new Error('register boom');
      },
    },
  });
  const exports = world.load();
  let cleanup;
  assert.doesNotThrow(() => {
    cleanup = exports.apply(world.ctx);
  });
  if (typeof cleanup === 'function') cleanup();
  ok('slots.inject/register 抛错时 apply 不抛错（每个注册单独 try/catch）');
}

// ---------------------------------------------------------------------------
// 运行
// ---------------------------------------------------------------------------
async function main() {
  await scenarioMain();
  await scenarioUnavailable();
  await scenarioOrigThrows();
  await scenarioEmptyCoverage();
  await scenarioPinyinOff();
  await scenarioBadContexts();
  await scenarioBadSlots();
  console.log('\n全部通过：' + passed + ' 项断言组。');
}

main().catch((err) => {
  console.error('\n自测失败：');
  console.error(err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
