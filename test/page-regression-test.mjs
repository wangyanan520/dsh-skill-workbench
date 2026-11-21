// 管理页离线回归：不依赖运行中的宿主，也不依赖本机技能目录。
// /list 载荷由 test/fixture.mjs 在临时目录里造出（文件系统与扫描逻辑都是真的，
// 只有根目录被指到 tmp），因此在 CI 与任意开发机上结果一致，可以当门禁用。
// 覆盖：渲染、中文行走查、英文 token 保留、覆盖率卡、拼音搜索、详情页打开、
// layers 透传、草稿救援全流程。
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createFixture, FIXTURE } from './fixture.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CLIENT_PATH = decodeURIComponent(new URL('../client.js', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');

const fixture = await createFixture();
const scanned = fixture.scanned;
let currentPayload = fixture.payload;
const TOTAL = fixture.payload.skills.length;

const storage = (() => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(String(k), String(v)),
    removeItem: (k) => map.delete(k),
  };
})();

const requests = [];
const requestLog = [];
let statusPayload = {};
function mockResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}
let translateResponder = () => mockResponse(200, { ok: true, jobId: 'job-batch-default', total: 1 });
let cancelResponder = () => mockResponse(200, { ok: true, cancelled: true });
const fakeElement = () => ({
  style: {},
  setAttribute() {},
  appendChild() {},
  remove() {},
  addEventListener() {},
  removeEventListener() {},
  classList: { add() {}, remove() {}, toggle() {} },
});

const fakeDocument = {
  documentElement: { lang: 'zh-CN', getAttribute: () => null, className: '', appendChild() {}, style: {} },
  body: { appendChild() {}, classList: { add() {}, remove() {} }, getAttribute: () => null, style: {} },
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  createElement: () => fakeElement(),
  addEventListener() {},
  removeEventListener() {},
  head: { appendChild() {} },
};

const confirmCalls = [];
let confirmResult = false;
const windowHandlers = new Map();

const sandbox = {
  window: {
    __ModuleLoader__: { load(record) { moduleRecordHolder.record = record; } },
    location: { pathname: '/', href: 'http://mock.local/', hash: '' },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  },
  document: fakeDocument,
  navigator: { language: 'zh-CN', languages: ['zh-CN'] },
  localStorage: storage,
  sessionStorage: storage,
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  queueMicrotask,
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  AbortController,
  fetch: async (path, options) => {
    const url = String(path);
    const method = (options && options.method) || 'GET';
    requests.push(url);
    requestLog.push({ url, method, body: options && typeof options.body === 'string' ? options.body : '' });
    if (url.includes('/translate')) return translateResponder(options);
    if (url.includes('/cancel')) return cancelResponder(options);
    if (url.includes('/status')) return mockResponse(200, statusPayload);
    const body = url.includes('/list') ? currentPayload : {};
    return mockResponse(200, body);
  },
};
sandbox.window.confirm = (message) => {
  confirmCalls.push(String(message || ''));
  return confirmResult;
};
sandbox.confirm = sandbox.window.confirm;
sandbox.window.addEventListener = (type, handler) => {
  if (!windowHandlers.has(type)) windowHandlers.set(type, []);
  windowHandlers.get(type).push(handler);
};
sandbox.window.removeEventListener = (type, handler) => {
  const list = windowHandlers.get(type) || [];
  const index = list.indexOf(handler);
  if (index >= 0) list.splice(index, 1);
};
const emitWindow = (type, event) => {
  const list = windowHandlers.get(type) || [];
  for (const handler of [...list]) handler(event);
};
const setLocationFromUrl = (url) => {
  const text = String(url || '');
  const index = text.indexOf('#');
  const hash = index >= 0 ? text.slice(index) : '';
  sandbox.window.location.hash = hash;
  sandbox.window.location.href = 'http://mock.local/' + hash;
};
sandbox.window.history = {
  pushState(_state, _title, url) { setLocationFromUrl(url); },
  replaceState(_state, _title, url) { setLocationFromUrl(url); },
};

sandbox.globalThis = sandbox;
// 浏览器里 location/history 既是 window 属性也是全局变量；插件代码用的是裸
// location/history，补上才能覆盖「深链/hash 路由」相关分支。
sandbox.location = sandbox.window.location;
sandbox.history = sandbox.window.history;
const moduleRecordHolder = { record: null };
// 只给离线回归打开 normalize 的测试钩子；生产窗口没有这个标记。
sandbox.window.__SKW_TEST__ = true;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(CLIENT_PATH, 'utf8'), sandbox, { filename: 'client.js' });

const results = [];
const assert = (cond, label) => {
  results.push({ ok: !!cond, label });
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`);
  if (!cond) process.exitCode = 1;
};

assert(moduleRecordHolder.record && moduleRecordHolder.record.id === 'dsh-skill-workbench', 'client.js 通过 __ModuleLoader__ 注册模块');
const plugin = moduleRecordHolder.record.factory((id) => {
  if (id === 'react') return React;
  throw new Error('unexpected require: ' + id);
});

const registered = [];
plugin.apply({
  get: () => undefined,
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: {
    inject: (name, cb) => { try { cb(); } catch (error) { console.error('slot inject failed: ' + name, error); } return () => {}; },
    register: (options, Component) => { registered.push({ options, Component }); return () => {}; },
  },
  effect: (cb) => { try { cb(); } catch { /* ignore */ } },
});

const main = registered.find((item) => item.options && item.options.name === 'main');
assert(!!main, '注册 main 页面组件');

// 夹具自检：扫描结果必须与夹具声明一致。不一致是链路坏了，不能当环境差异跳过。
assert(
  TOTAL === FIXTURE.total,
  `夹具扫描出 ${FIXTURE.total} 条技能（实际 ${TOTAL}）`,
);
assert(
  scanned.skills.filter((s) => s.zh && s.zh.name).length === FIXTURE.cjkTotal,
  `夹具中 ${FIXTURE.cjkTotal} 条有中文名（实际 ${scanned.skills.filter((s) => s.zh && s.zh.name).length}）`,
);

// ---------------------------------------------------------------------------
// T13：normalize 白名单必须保留 layer 体检字段与 /list.health。
// T13 还没有体检面板，因此直接验证 normalize 结果；生产窗口不暴露这组钩子。
// ---------------------------------------------------------------------------
const copyPayload = (payload) => JSON.parse(JSON.stringify(payload));
assert(
  plugin.__test
  && typeof plugin.__test.normalizeSkillView === 'function'
  && typeof plugin.__test.normalizeIndex === 'function',
  '测试钩子暴露 normalizeSkillView / normalizeIndex',
);
const normalizeIndexForTest = plugin.__test.normalizeIndex;
const normalizeSkillViewForTest = plugin.__test.normalizeSkillView;

const normalized = normalizeIndexForTest(fixture.payload);
assert(
  normalized.byName.size === new Set(scanned.skills.map((skill) => skill.name)).size,
  `normalize 后 byName 仍有 ${normalized.byName.size} 条唯一技能`,
);
assert(
  normalized.skills.filter((skill) => skill.name === 'shadow-skill').length === 1,
  '同名遮蔽技能在 normalize 列表里只出现一次',
);
assert(!normalized.byName.has('ghost-skill'), '孤儿条目不会进入技能 byName');

const normalizedShadow = normalized.byName.get('shadow-skill');
assert(!!normalizedShadow && normalizedShadow.layers.length === 2, 'shadow-skill 保留 project/user 两层');
assert(
  normalizedShadow.layers[0].source === 'project'
  && normalizedShadow.layers[0].active === true
  && normalizedShadow.layers[1].source === 'user'
  && normalizedShadow.layers[1].active === false,
  'shadow-skill 的 project 层生效、user 层不生效',
);
assert(
  normalizedShadow.layers.every((layer) => layer.status === 'unverifiable'),
  'shadow-skill 两层无 hash 时 status 收敛为 unverifiable',
);
assert(
  normalizedShadow.layers[0].reviewedBy === 'human'
  && normalizedShadow.layers[1].reviewedBy === 'assistant',
  'shadow-skill 两层 reviewedBy 没被 normalize 丢掉',
);
assert(
  normalized.byName.get('lark-doc').layers[0].status === 'stale'
  && normalized.byName.get('lark-doc').layers[0].reviewedBy === 'unknown',
  'lark-doc 的 stale/unknown 层状态保留',
);
assert(
  normalized.byName.get('lark-im').layers[0].reviewedBy === null,
  'lark-im 草稿层的 reviewedBy=null 保留',
);
assert(
  normalized.byName.get('lark-base').layers[0].reviewedBy === 'import'
  && normalized.byName.get('agent-reach').layers[0].reviewedBy === 'builtin',
  'import/builtin 两种 reviewedBy 保留',
);

assert(
  normalized.health.orphanEntries.some(
    (entry) => entry.name === 'ghost-skill' && entry.layer === 'user',
  ),
  'normalizeIndex 保留 health.orphanEntries（ghost-skill）',
);
const normalizedShadowHealth = normalized.health.shadowedSkills.find(
  (entry) => entry.name === 'shadow-skill',
);
assert(
  !!normalizedShadowHealth
  && normalizedShadowHealth.winner.kind === FIXTURE.health.shadowedWinner
  && normalizedShadowHealth.losers.some(
    (loser) => loser.kind === FIXTURE.health.shadowedLoser,
  ),
  'normalizeIndex 保留 health.shadowedSkills（project 胜出、user 被遮蔽）',
);
assert(
  FIXTURE.health.orphanNames.every(
    (name) => scanned.health.orphanEntries.some((entry) => entry.name === name),
  )
  && FIXTURE.health.shadowedNames.every(
    (name) => scanned.health.shadowedSkills.some((entry) => entry.name === name),
  ),
  '夹具扫描出的 health 名称与 FIXTURE 声明一致',
);

// 旧宿主：缺 health 与 layer 的 status/reviewedBy/active，不能崩，按规则补默认值。
const oldPayload = copyPayload(fixture.payload);
delete oldPayload.health;
for (const skill of oldPayload.skills) {
  for (const layer of Array.isArray(skill.layers) ? skill.layers : []) {
    delete layer.status;
    delete layer.reviewedBy;
    delete layer.active;
  }
}
const oldNormalized = normalizeIndexForTest(oldPayload);
assert(
  Array.isArray(oldNormalized.health.orphanEntries)
  && oldNormalized.health.orphanEntries.length === 0
  && Array.isArray(oldNormalized.health.shadowedSkills)
  && oldNormalized.health.shadowedSkills.length === 0,
  '旧载荷无 health 时补空数组',
);
const oldShadow = oldNormalized.byName.get('shadow-skill');
assert(
  oldShadow.layers.every((layer) => layer.status === 'unverifiable')
  && oldShadow.layers.every((layer) => layer.reviewedBy === null)
  && oldShadow.layers[0].active === true
  && oldShadow.layers[1].active === false,
  '旧载荷缺 layer 字段时按 unverifiable/null/首个 active 补齐',
);

// 非法值与显式 active：非法值收敛，显式布尔按输入保留。
const invalidPayload = copyPayload(fixture.payload);
const invalidShadow = invalidPayload.skills.find((skill) => skill.name === 'shadow-skill');
invalidShadow.layers[0].status = 'broken';
invalidShadow.layers[0].reviewedBy = 'robot';
invalidShadow.layers[0].active = false;
invalidShadow.layers[1].active = true;
const invalidShadowNormalized = normalizeSkillViewForTest(invalidShadow);
assert(
  invalidShadowNormalized.layers[0].status === 'unverifiable'
  && invalidShadowNormalized.layers[0].reviewedBy === null,
  '非法 status/reviewedBy 收敛为 unverifiable/null',
);
assert(
  invalidShadowNormalized.layers[0].active === false
  && invalidShadowNormalized.layers[1].active === true,
  '显式 active 按输入保留（含被翻转的生效层）',
);

const partialActiveShadow = copyPayload(fixture.payload).skills.find(
  (skill) => skill.name === 'shadow-skill',
);
delete partialActiveShadow.layers[0].active;
partialActiveShadow.layers[1].active = true;
const partialActiveNormalized = normalizeSkillViewForTest(partialActiveShadow);
assert(
  partialActiveNormalized.layers[0].active === false
  && partialActiveNormalized.layers[1].active === true,
  '只有部分层显式给 active 时，缺失层补 false',
);

const brokenHealth = copyPayload(fixture.payload);
brokenHealth.health = { orphanEntries: 'ghost', shadowedSkills: null };
const brokenHealthNormalized = normalizeIndexForTest(brokenHealth);
assert(
  Array.isArray(brokenHealthNormalized.health.orphanEntries)
  && brokenHealthNormalized.health.orphanEntries.length === 0
  && Array.isArray(brokenHealthNormalized.health.shadowedSkills)
  && brokenHealthNormalized.health.shadowedSkills.length === 0,
  'health 内非数组字段收敛为空数组',
);

let renderer = null;
await act(async () => {
  renderer = TestRenderer.create(React.createElement(main.Component, {}));
  await new Promise((resolve) => setTimeout(resolve, 600));
});

const rows = () => renderer.root.findAll((n) => n.type === 'a' && n.props && n.props['data-skw-row']);
const buttonByText = (needle) =>
  renderer.root
    .findAll((n) => n.type === 'button')
    .find((n) => JSON.stringify(n.props.children || '').includes(needle));
let text = JSON.stringify(renderer.toJSON());
assert(requests.some((u) => u.includes('/list')), '页面加载时请求 /list');
assert(rows().length === TOTAL, `列表渲染出全部 ${TOTAL} 条（实际 ${rows().length}）`);
assert(text.includes('中文覆盖'), '覆盖率卡片存在');

// 覆盖来源四桶：数字从夹具声明现算，不写死本机数据。
const gapNode = (key) =>
  renderer.root.findAll((n) => n.props && n.props['data-skw-gap'] === key)[0];
const gapCount = (key) => {
  const node = gapNode(key);
  if (!node) return null;
  const match = /(\d+)/.exec(JSON.stringify(node.props.children || ''));
  return match ? Number(match[1]) : null;
};
assert(
  gapCount('builtin') === FIXTURE.buckets.builtin,
  `覆盖来源内置包桶 ${FIXTURE.buckets.builtin}（实际 ${gapCount('builtin')}）`,
);
assert(
  gapCount('local') === FIXTURE.buckets.local,
  `覆盖来源仅自己补桶 ${FIXTURE.buckets.local}（实际 ${gapCount('local')}）`,
);
assert(
  gapCount('none') === FIXTURE.buckets.none,
  `覆盖来源没中文桶 ${FIXTURE.buckets.none}（实际 ${gapCount('none')}）`,
);
assert(gapCount('unknown') === null, 'unknown=0 时不显示来源未知');
assert(
  (gapCount('builtin') || 0) + (gapCount('local') || 0) + (gapCount('none') || 0) + (gapCount('unknown') || 0) === TOTAL,
  `页面渲染的四桶之和等于总数 ${TOTAL}`,
);
assert(
  FIXTURE.buckets.builtin + FIXTURE.buckets.local + FIXTURE.buckets.none === TOTAL,
  `夹具四桶之和等于总数 ${TOTAL}`,
);
const builtinNode = gapNode('builtin');
assert(
  builtinNode && String(builtinNode.props['aria-label'] || '').includes(String(FIXTURE.buckets.builtin)),
  '覆盖来源数字带 aria-label',
);
text = JSON.stringify(renderer.toJSON());
assert(
  text.includes('内置包 ' + FIXTURE.buckets.builtin),
  '正常宿主显示内置包来源数量',
);

// 缺口入口：复用既有 setFilter，不新增 filter 值。
const routeFilter = () => {
  try {
    return JSON.parse(storage.getItem('skw:route') || '{}').filter;
  } catch (error) {
    return null;
  }
};
const untranslatedButton = buttonByText('查看没中文');
assert(!!untranslatedButton, '覆盖率卡有「查看没中文」按钮');
await act(async () => {
  untranslatedButton.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 200));
});
assert(
  rows().length === FIXTURE.buckets.none,
  `查看没中文后筛出 ${FIXTURE.buckets.none} 条（实际 ${rows().length}）`,
);
assert(routeFilter() === 'untranslated', '查看没中文复用 untranslated 筛选');
const staleButton = buttonByText('查看过期');
assert(!!staleButton, '覆盖率卡有「查看过期」按钮');
await act(async () => {
  staleButton.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 200));
});
assert(
  rows().length === FIXTURE.buckets.stale,
  `查看过期后筛出 ${FIXTURE.buckets.stale} 条（实际 ${rows().length}）`,
);
assert(routeFilter() === 'stale', '查看过期复用 stale 筛选');
await act(async () => {
  buttonByText('全部').props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 200));
});
assert(rows().length === TOTAL, '恢复全部筛选后行数回到总数');
assert(routeFilter() === 'all', '恢复全部筛选后路由 filter=all');
const sample = scanned.skills.find((s) => s.name === 'lark-doc');
assert(sample && text.includes(sample.zh.name), `中文名渲染（${sample ? sample.zh.name : 'lark-doc'}）`);
assert(text.includes('/lark-doc'), '行内保留英文调用 token /lark-doc');
assert(!text.includes('加载中'), '加载完成，无加载中占位');

// 拼音搜索：feishu 应命中全部 lark 技能
const larkCount = scanned.skills.filter((s) => s.name.startsWith('lark-')).length;
const searchInput = () => renderer.root.findAll((n) => n.type === 'input' && n.props && typeof n.props.onChange === 'function' && String(n.props.placeholder || '').includes('搜索'))[0];
assert(!!searchInput(), '工具栏有搜索框');

await act(async () => {
  searchInput().props.onChange({ target: { value: 'feishu' } });
  await new Promise((resolve) => setTimeout(resolve, 300));
});
assert(rows().length === larkCount, `拼音搜索 feishu 命中 ${larkCount} 条（实际 ${rows().length}）`);

await act(async () => {
  searchInput().props.onChange({ target: { value: 'dwbg' } });
  await new Promise((resolve) => setTimeout(resolve, 300));
});
text = JSON.stringify(renderer.toJSON());
assert(rows().length >= 1 && text.includes('多维表格'), '首字母搜索 dwbg 命中「多维表格」');

await act(async () => {
  searchInput().props.onChange({ target: { value: '' } });
  await new Promise((resolve) => setTimeout(resolve, 300));
});
assert(rows().length === TOTAL, '清空搜索后恢复全部行');

// 打开详情
await act(async () => {
  rows()[0].props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 200));
});
text = JSON.stringify(renderer.toJSON());
assert(text.includes('显示名称（中文名）'), '点击行打开详情，出现中文名编辑区');

// R1 回归：用户层技能的详情应透传 layers（「清除中文覆盖」可见、中文来源非“—”）。
const userLayered = scanned.skills.find(
  (s) =>
    Array.isArray(s.layers) &&
    s.layers.some((layer) => layer.source === 'user') &&
    !s.layers.some((layer) => layer.source === 'project'),
);
assert(!!userLayered, '夹具存在用户层技能（草稿救援与 layers 断言的前提）');
if (userLayered) {
  await act(async () => {
    buttonByText('返回列表').props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  const userRow = rows().find((n) => String(n.props.href || '').includes(userLayered.name));
  assert(!!userRow, `找到用户层技能行（${userLayered.name}）`);
  await act(async () => {
    userRow.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  text = JSON.stringify(renderer.toJSON());
  assert(text.includes('清除中文覆盖'), '用户层技能详情显示「清除中文覆盖」（layers 已透传）');
  assert(text.includes('中文来源：用户'), '中文来源行显示用户层（layerText 非 “—”）');

  // 草稿救援：编辑后卸载（模拟宿主切面板等拦不住的路径），重开应提示恢复。
  const draftValue = userLayered.zh.name + '（改）';
  const nameInput = () =>
    renderer.root
      .findAll((n) => n.type === 'input' && n.props.onChange)
      .find((n) => n.props.value === userLayered.zh.name);
  assert(!!nameInput(), '详情页中文名输入框存在');
  await act(async () => {
    nameInput().props.onChange({ target: { value: draftValue } });
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  assert(
    storage.getItem('skw:draft:' + userLayered.name) !== null,
    '脏表单镜像到 sessionStorage（草稿救援）',
  );
  await act(async () => {
    renderer.unmount();
  });
  // 清掉路由恢复记录并把 hash 退回列表，让重挂载停在列表页，模拟用户重新点进详情。
  storage.removeItem('skw:route');
  sandbox.window.location.hash = '#library';
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(main.Component, {}));
    await new Promise((resolve) => setTimeout(resolve, 600));
  });
  const reopenedRow = () => rows().find((n) => String(n.props.href || '').includes(userLayered.name));
  await act(async () => {
    reopenedRow().props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  text = JSON.stringify(renderer.toJSON());
  assert(text.includes('发现上次未保存的草稿'), '重新打开详情时提示恢复未保存草稿');
  // 恢复路径
  await act(async () => {
    buttonByText('恢复草稿').props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  const restoredInput = renderer.root
    .findAll((n) => n.type === 'input' && n.props.onChange)
    .find((n) => n.props.value === draftValue);
  assert(!!restoredInput, '恢复草稿后表单内容回来了');
  assert(
    storage.getItem('skw:draft:' + userLayered.name) !== null,
    '恢复后的脏表单继续镜像到 sessionStorage',
  );
  // 丢弃路径：再来一轮，点「丢弃草稿」
  await act(async () => {
    renderer.unmount();
  });
  storage.removeItem('skw:route');
  sandbox.window.location.hash = '#library';
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(main.Component, {}));
    await new Promise((resolve) => setTimeout(resolve, 600));
  });
  await act(async () => {
    reopenedRow().props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
  text = JSON.stringify(renderer.toJSON());
  assert(text.includes('发现上次未保存的草稿'), '第二轮重开详情仍提示未保存草稿');
  await act(async () => {
    buttonByText('丢弃草稿').props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  assert(
    storage.getItem('skw:draft:' + userLayered.name) === null,
    '丢弃草稿后清理 sessionStorage',
  );
} else {
  // 夹具是确定数据，不该走到这里；上面已有硬断言，这里保留兜底以免后续改动漏掉分支。
  assert(false, '夹具缺少用户层技能，layers 与草稿救援断言未执行');
}

// T05：脏检查真实触发——返回/切分区、beforeunload、草稿救援。
// 这里显式给 window 补 confirm/history/addEventListener，不再让客户端走「无法询问」的兜底分支。
confirmResult = true;
confirmCalls.length = 0;
// 上一段草稿测试结束时停在详情页；先回到列表再开 T05。
if (buttonByText('返回列表')) {
  await act(async () => {
    buttonByText('返回列表').props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 150));
  });
}
confirmResult = false;
await act(async () => {
  rows().find((n) => String(n.props.href || '').includes(userLayered.name)).props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 200));
});
const t05Input = () =>
  renderer.root
    .findAll((n) => n.type === 'input' && n.props.onChange)
    .find((n) => n.props.value === userLayered.zh.name || n.props.value === t05Draft);
const t05Draft = userLayered.zh.name + '（脏检查）';
assert(!!t05Input(), 'T05 详情的名称输入框存在');
await act(async () => {
  t05Input().props.onChange({ target: { value: t05Draft } });
  await new Promise((resolve) => setTimeout(resolve, 100));
});
assert(
  storage.getItem('skw:draft:' + userLayered.name) !== null,
  '脏表单镜像到 sessionStorage（T05）',
);
assert(
  (windowHandlers.get('beforeunload') || []).length >= 1,
  '脏详情注册 beforeunload handler',
);
const unloadEvent = {
  defaultPrevented: false,
  returnValue: '',
  preventDefault() { this.defaultPrevented = true; },
};
emitWindow('beforeunload', unloadEvent);
assert(unloadEvent.defaultPrevented === true, 'dirty 时 beforeunload 调 preventDefault');

// confirm=false：返回与切分区都必须留在详情，表单内容不丢。
confirmResult = false;
await act(async () => {
  buttonByText('返回列表').props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 100));
});
text = JSON.stringify(renderer.toJSON());
assert(text.includes('显示名称（中文名）'), 'confirm=false 时返回被拦在详情');
assert(
  renderer.root.findAll((n) => n.type === 'input' && n.props.onChange).some((n) => n.props.value === t05Draft),
  'confirm=false 后表单内容不丢',
);
assert(confirmCalls.length >= 1, '返回触发了 window.confirm');
await act(async () => {
  buttonByText('设置').props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 100));
});
text = JSON.stringify(renderer.toJSON());
assert(text.includes('显示名称（中文名）'), 'confirm=false 时切分区被拦在详情');

// popstate：脏表单离开前必须确认；confirm=false 与 confirm 抛错都要留在原地。
sandbox.window.location.hash = '#library';
confirmResult = false;
await act(async () => {
  emitWindow('popstate', {});
  await new Promise((resolve) => setTimeout(resolve, 100));
});
text = JSON.stringify(renderer.toJSON());
assert(text.includes('显示名称（中文名）'), 'popstate + confirm=false 留在脏详情');
const savedConfirm = sandbox.window.confirm;
sandbox.window.confirm = () => { throw new Error('confirm unavailable'); };
sandbox.window.location.hash = '#settings';
await act(async () => {
  emitWindow('popstate', {});
  await new Promise((resolve) => setTimeout(resolve, 100));
});
text = JSON.stringify(renderer.toJSON());
assert(text.includes('显示名称（中文名）'), 'confirm 不可用时 fail-closed 留在脏详情');
sandbox.window.confirm = savedConfirm;

// 未识别 hash 也不能绕过确认。
confirmResult = false;
sandbox.window.location.hash = '#unknown-route';
await act(async () => {
  emitWindow('popstate', {});
  await new Promise((resolve) => setTimeout(resolve, 100));
});
text = JSON.stringify(renderer.toJSON());
assert(text.includes('显示名称（中文名）'), '未识别 hash + confirm=false 留在脏详情');

// confirm=true：离开详情回列表；草稿仍在；beforeunload handler 被清理。
confirmResult = true;
sandbox.window.location.hash = '#library';
await act(async () => {
  buttonByText('返回列表').props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 150));
});
assert(rows().length === TOTAL, 'confirm=true 后回到列表');
assert(
  storage.getItem('skw:draft:' + userLayered.name) !== null,
  'confirm=true 离开后草稿仍在（可恢复）',
);
assert(
  (windowHandlers.get('beforeunload') || []).length === 0,
  '干净详情不再挂 beforeunload',
);
const cleanUnloadEvent = {
  defaultPrevented: false,
  returnValue: '',
  preventDefault() { this.defaultPrevented = true; },
};
emitWindow('beforeunload', cleanUnloadEvent);
assert(cleanUnloadEvent.defaultPrevented === false, '干净时 beforeunload 不拦');
confirmResult = false;
confirmCalls.length = 0;
storage.removeItem('skw:draft:' + userLayered.name);

// T06：hash 前进/后退恢复 filter 与详情；非法 filter 退 all。
// 先等 T05 的返回列表 effect 落盘，避免它把第一次 popstate 的 hash 覆盖回 #library。
await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
});
const popTo = async (hash) => {
  sandbox.window.location.hash = hash;
  await act(async () => {
    emitWindow('popstate', {});
    await new Promise((resolve) => setTimeout(resolve, 200));
  });
};
const pressedFilters = () =>
  renderer.root
    .findAll((n) => n.type === 'button' && n.props && n.props['aria-pressed'] === true)
    .map((n) => JSON.stringify(n.props.children || ''));

await popTo('#library?filter=untranslated');
assert(rows().length === FIXTURE.buckets.none, `hash 前进到未翻译筛出 ${FIXTURE.buckets.none} 条`);
assert(routeFilter() === 'untranslated', 'hash 未翻译同步到 route');
await popTo('#library');
assert(rows().length === TOTAL, 'hash 后退到 library 恢复全部');
assert(routeFilter() === 'all', 'hash 后退后 route filter=all');

// 库页交互同步 hash：搜索、分类、状态筛选。
const t06SearchInput = () =>
  renderer.root.findAll((n) => n.type === 'input' && n.props && n.props.className === 'skw-search')[0];
const t06CategorySelect = () =>
  renderer.root.findAll((n) => n.type === 'select' && n.props && n.props.className === 'skw-category')[0];
await act(async () => {
  t06SearchInput().props.onChange({ target: { value: '飞书' } });
  await new Promise((resolve) => setTimeout(resolve, 300));
});
assert(decodeURIComponent(sandbox.window.location.hash).includes('q=飞书'), `搜索词同步到 hash（实际 ${sandbox.window.location.hash}）`);
assert(rows().length === 3, `搜索「飞书」命中 3 条（实际 ${rows().length}）`);
await act(async () => {
  t06CategorySelect().props.onChange({ target: { value: 'lark' } });
  await new Promise((resolve) => setTimeout(resolve, 300));
});
assert(sandbox.window.location.hash.includes('cat=lark'), `分类同步到 hash（实际 ${sandbox.window.location.hash}）`);
assert(rows().length === 3, `分类 lark + 搜索命中 3 条（实际 ${rows().length}）`);
await act(async () => {
  t06SearchInput().props.onChange({ target: { value: '' } });
  t06CategorySelect().props.onChange({ target: { value: '' } });
  await new Promise((resolve) => setTimeout(resolve, 100));
});
assert(rows().length === TOTAL, '清空搜索/分类恢复全部');
await act(async () => {
  buttonByText('未翻译').props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 300));
});
assert(sandbox.window.location.hash.includes('filter=untranslated'), `状态筛选同步到 hash（实际 ${sandbox.window.location.hash}）`);
assert(rows().length === FIXTURE.buckets.none, `状态筛选命中 ${FIXTURE.buckets.none} 条`);
await act(async () => {
  buttonByText('全部').props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 100));
});
assert(rows().length === TOTAL, '切回全部恢复完整列表');

// 前进/后退恢复 query/category/tab。
await popTo('#library?q=飞书&cat=lark');
assert(rows().length === 3, 'hash 恢复 query+category 命中 3 条');
assert(t06SearchInput().props.value === '飞书', 'hash 恢复搜索框');
assert(t06CategorySelect().props.value === 'lark', 'hash 恢复分类下拉');
await popTo('#settings');
text = JSON.stringify(renderer.toJSON());
assert(text.includes('启用中文层'), 'hash 前进到设置页');
await popTo('#library');
assert(rows().length === TOTAL, 'hash 从设置页后退回列表');

await popTo('#library?filter=not-a-filter');
assert(rows().length === TOTAL, '非法 filter 退化为全部');
const pressedAfterIllegal = pressedFilters();
assert(
  pressedAfterIllegal.length === 1 && pressedAfterIllegal[0].includes('全部'),
  '非法 filter 只按下「全部」，没有非法按钮按下态',
);

await popTo('#skill/lark-doc');
text = JSON.stringify(renderer.toJSON());
assert(text.includes('显示名称（中文名）'), 'hash 前进到详情打开 lark-doc');
const originalGetById = fakeDocument.getElementById;
let focusHit = false;
fakeDocument.getElementById = (id) => (id === 'skw-row-lark-doc' ? { focus() { focusHit = true; } } : null);
await popTo('#library');
assert(rows().length === TOTAL, 'hash 后退关闭详情回到列表');
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
assert(focusHit, 'hash 从详情后退回列表时焦点回到原行');
fakeDocument.getElementById = originalGetById;

// 脏详情后退：confirm=false 留在详情，confirm=true 才离开。
await act(async () => {
  rows().find((n) => String(n.props.href || '').includes('lark-doc')).props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 200));
});
const t06Input = () =>
  renderer.root
    .findAll((n) => n.type === 'input' && n.props.onChange)
    .find((n) => n.props.value === '飞书云文档' || n.props.value === '飞书云文档（hash）');
const t06Draft = '飞书云文档（hash）';
await act(async () => {
  t06Input().props.onChange({ target: { value: t06Draft } });
  await new Promise((resolve) => setTimeout(resolve, 100));
});
confirmResult = false;
await popTo('#library');
text = JSON.stringify(renderer.toJSON());
assert(text.includes('显示名称（中文名）'), '脏详情后退 + confirm=false 留在详情');
confirmResult = true;
await popTo('#library');
assert(rows().length === TOTAL, '脏详情后退 + confirm=true 回到列表');
storage.removeItem('skw:draft:lark-doc');
confirmResult = false;

// 刷新/重挂载：从 hash 恢复；未知 hash 用 sessionStorage 兜底。
const remount = async () => {
  await act(async () => {
    renderer.unmount();
    await new Promise((resolve) => setTimeout(resolve, 50));
    renderer = TestRenderer.create(React.createElement(main.Component, {}));
    await new Promise((resolve) => setTimeout(resolve, 600));
  });
};
await popTo('#library');
sandbox.window.location.hash = '#library?filter=untranslated';
await remount();
assert(rows().length === FIXTURE.buckets.none, '刷新后从 hash 恢复 status=untranslated');
assert(routeFilter() === 'untranslated', '刷新后 route 仍为 untranslated');
storage.setItem('skw:route', JSON.stringify({ tab: 'library', selected: '', query: '', filter: 'untranslated', category: '' }));
sandbox.window.location.hash = '#unknown-route';
await remount();
assert(rows().length === FIXTURE.buckets.none, '未知 hash 用 sessionStorage 路由兜底');
assert(sandbox.window.location.hash.includes('filter=untranslated'), `未知 hash 被安全默认路由替换（实际 ${sandbox.window.location.hash}）`);
storage.removeItem('skw:route');
sandbox.window.location.hash = '#library';
await remount();

// R18：非法 filter 必须退化为 all，不能把列表整空且没有任何按下态。
storage.removeItem('skw:route');
sandbox.window.location.hash = '#library?filter=bogus';
await act(async () => {
  renderer.unmount();
  renderer = TestRenderer.create(React.createElement(main.Component, {}));
  await new Promise((resolve) => setTimeout(resolve, 600));
});
assert(
  rows().length === TOTAL,
  `#library?filter=bogus 退化为全部（实际 ${rows().length} 条，应为 ${TOTAL}）`,
);
sandbox.window.location.hash = '';

// 换载荷后必须点「刷新」绕过 30s indexCache。
const refreshWith = async (payload) => {
  currentPayload = payload;
  const refreshButton = buttonByText('刷新');
  assert(!!refreshButton, '刷新按钮可用');
  await act(async () => {
    refreshButton.props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
};
const clonePayload = () => JSON.parse(JSON.stringify(fixture.payload));

// 新宿主但单条技能缺 layers：unknown>0 时才追加「来源未知」，且不误判为旧宿主。
const partialPayload = clonePayload();
const missingLayerSkill = partialPayload.skills.find((skill) => skill.name === 'lark-base');
missingLayerSkill.layers = [];
await refreshWith(partialPayload);
text = JSON.stringify(renderer.toJSON());
assert(gapCount('unknown') === 1, '部分技能缺 layers 时 unknown=1');
assert(text.includes('来源未知 1'), 'unknown>0 时追加来源未知');
assert(!text.includes('当前宿主不提供分层来源'), '仍有其他 layers 时不显示旧宿主升级说明');

// 全内置：只剩一句「全部由内置包覆盖」，不再显示「仅自己补 0」。
const builtinPayload = clonePayload();
builtinPayload.skills = builtinPayload.skills.map((skill) => ({
  ...skill,
  zh: skill.zh && skill.zh.name ? skill.zh : { name: skill.name + ' 中文', review: 'reviewed' },
  status: 'fresh',
  layers: [{ source: 'builtin', origin: 'builtin', review: 'reviewed', updatedAt: null }],
}));
builtinPayload.coverage = { total: TOTAL, translated: TOTAL, draft: 0, stale: 0, untranslated: 0 };
await refreshWith(builtinPayload);
text = JSON.stringify(renderer.toJSON());
assert(text.includes('全部由内置包覆盖'), '全内置时显示「全部由内置包覆盖」');
assert(!text.includes('仅自己补'), '全内置时不显示「仅自己补 0」');

// 旧宿主：/list 没有 layers/health；只展示来源未知/没中文/过期 + 升级说明，页面不崩。
const legacyPayload = clonePayload();
legacyPayload.skills = legacyPayload.skills.map((skill) => {
  const next = { ...skill };
  delete next.layers;
  return next;
});
delete legacyPayload.health;
await refreshWith(legacyPayload);
text = JSON.stringify(renderer.toJSON());
assert(rows().length === TOTAL, `旧宿主载荷仍渲染 ${TOTAL} 条（实际 ${rows().length}）`);
assert(gapCount('unknown') === FIXTURE.cjkTotal, `旧宿主把 ${FIXTURE.cjkTotal} 条中文归入来源未知`);
assert(gapCount('none') === FIXTURE.buckets.none, `旧宿主没中文桶 ${FIXTURE.buckets.none}`);
assert(gapCount('stale') === FIXTURE.buckets.stale, `旧宿主过期桶 ${FIXTURE.buckets.stale}`);
assert(gapNode('builtin') === undefined, '旧宿主不伪造内置包桶');
assert(text.includes('当前宿主不提供分层来源'), '旧宿主显示升级说明');

// ---------------------------------------------------------------------------
// T09：批量翻译入口（范围选择 + 5 秒确认 + 按 jobId 精确轮询 + 错误分流）
// ---------------------------------------------------------------------------
await refreshWith(clonePayload());
const t09Coverage = {
  untranslated: Number(currentPayload.coverage.untranslated),
  stale: Number(currentPayload.coverage.stale),
};
const batchScopeSelect = () =>
  renderer.root.findAll((n) => n.type === 'select' && n.props && n.props.className === 'skw-batch-scope')[0];
const batchStartButton = () =>
  renderer.root.findAll((n) => n.type === 'button' && n.props && n.props['data-skw-batch-start'] === '1')[0];
const batchConfirmNode = () =>
  renderer.root.findAll((n) => n.props && n.props['data-skw-batch-confirm'] === '1')[0];
const alertNode = () => renderer.root.findAll((n) => n.props && n.props.role === 'alert')[0];
const nodeText = (node) => {
  const parts = [];
  const walk = (value) => {
    if (value === null || value === undefined || typeof value === 'boolean') return;
    if (typeof value === 'string' || typeof value === 'number') {
      parts.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value.props) walk(value.props.children);
  };
  walk(node && node.props ? node.props.children : node);
  return parts.join('');
};
const translateRequests = () => requestLog.filter((item) => item.url.includes('/translate'));
const armBatch = async () => {
  await act(async () => {
    batchStartButton().props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
};
const confirmBatch = async () => {
  await act(async () => {
    buttonByText('确认翻译').props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 120));
  });
};

assert(!!batchScopeSelect(), '工具栏有批量翻译范围 select');
assert(
  batchScopeSelect().props['aria-label'] === '批量翻译范围',
  `范围 select 的 aria-label 为「批量翻译范围」（实际 ${batchScopeSelect().props['aria-label']}）`,
);
const t09ScopeOptions = nodeText(batchScopeSelect());
assert(
  t09ScopeOptions.includes(`未翻译（${t09Coverage.untranslated}）`),
  `范围 select 的未翻译数量来自 coverage（应 ${t09Coverage.untranslated}）`,
);
assert(
  t09ScopeOptions.includes(`过期（${t09Coverage.stale}）`),
  `范围 select 的过期数量来自 coverage（应 ${t09Coverage.stale}）`,
);
assert(!!batchStartButton(), '工具栏有批量翻译按钮');
assert(
  nodeText(batchStartButton()).includes(`批量翻译（${t09Coverage.untranslated}）`),
  '批量按钮默认显示未翻译数量',
);
assert(batchStartButton().props.disabled === false, '有可翻译技能时批量按钮可用');

// 点击先进 armed：确认 + 取消，文案覆盖数量/草稿/不覆盖/失败处理。
await armBatch();
assert(!!batchConfirmNode(), '点击批量翻译后出现确认');
const t09ConfirmText = nodeText(batchConfirmNode());
assert(t09ConfirmText.includes(String(t09Coverage.untranslated)), `确认文案含数量 ${t09Coverage.untranslated}`);
assert(t09ConfirmText.includes('草稿'), '确认文案说明 AI 结果标为草稿');
assert(t09ConfirmText.includes('不会覆盖'), '确认文案说明不覆盖已有手动中文');
assert(t09ConfirmText.includes('重试') && t09ConfirmText.includes('取消'), '确认文案说明失败可重试/取消');
assert(!!buttonByText('取消'), '确认时提供取消按钮');
await act(async () => {
  buttonByText('取消').props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 60));
});
assert(!batchConfirmNode(), '取消后确认复位');

// 5 秒自动复位：真实等待约 5.2s，不删断言。
await armBatch();
assert(!!batchConfirmNode(), '自动复位测试前确认已出现');
await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 5200));
});
assert(!batchConfirmNode(), '5 秒后确认自动复位');

// 确认启动：POST body 只有 scope，不带 names；成功后记录 batchJobId。
statusPayload = { ok: true, jobs: [] };
translateResponder = () =>
  mockResponse(200, { ok: true, jobId: 'job-batch-t09', total: t09Coverage.untranslated });
const t09TranslateBefore = translateRequests().length;
await armBatch();
await confirmBatch();
const t09TranslateAfter = translateRequests();
assert(t09TranslateAfter.length === t09TranslateBefore + 1, '确认后只发一次 /translate');
const t09Body = JSON.parse(t09TranslateAfter[t09TranslateAfter.length - 1].body || '{}');
assert(t09Body.scope === 'untranslated', `批量翻译 body.scope=untranslated（实际 ${t09Body.scope}）`);
assert(!Object.prototype.hasOwnProperty.call(t09Body, 'names'), '批量翻译 body 不带 names');
assert(!batchConfirmNode(), '确认启动后收起确认');
text = JSON.stringify(renderer.toJSON());
assert(text.includes('批量翻译已开始'), '启动后显示开始提示');

// 轮询按 batchJobId：另一个 running job 排第一也不能串台。
statusPayload = {
  ok: true,
  jobs: [
    { id: 'job-other-t09', state: 'running', total: 9, done: 0, failed: 0 },
    { id: 'job-batch-t09', state: 'running', total: t09Coverage.untranslated, done: 1, failed: 0 },
  ],
};
await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 1700));
});
assert(batchStartButton().props.disabled === true, '批量任务运行时按钮禁用');
statusPayload = {
  ok: true,
  jobs: [
    { id: 'job-other-t09', state: 'running', total: 9, done: 0, failed: 0 },
    { id: 'job-batch-t09', state: 'done', total: t09Coverage.untranslated, done: t09Coverage.untranslated, failed: 0 },
  ],
};
await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 1700));
});
text = JSON.stringify(renderer.toJSON());
assert(text.includes('批量翻译任务已结束'), '按 batchJobId 轮询到结束后提示已刷新');
assert(batchStartButton().props.disabled === true, '另一个 running job 仍让按钮保持禁用');

statusPayload = { ok: true, jobs: [] };
await refreshWith(clonePayload());
assert(batchStartButton().props.disabled === false, '运行任务清空后批量按钮恢复可用');

// 已有 running job 时按钮禁用，且点击不会进入确认。
statusPayload = { ok: true, jobs: [{ id: 'job-running-t09', state: 'running', total: 3, done: 0, failed: 0 }] };
await refreshWith(clonePayload());
assert(batchStartButton().props.disabled === true, '已有 running job 时批量按钮禁用');
await armBatch();
assert(!batchConfirmNode(), '已有 running job 时点击不会进入确认');
statusPayload = { ok: true, jobs: [] };
await refreshWith(clonePayload());

// 429 ERR_BUSY：面板内 role=alert。
translateResponder = () => mockResponse(429, { ok: false, code: 'ERR_BUSY', message: 'busy' });
await armBatch();
await confirmBatch();
const t09BusyAlert = alertNode();
assert(!!t09BusyAlert, 'ERR_BUSY 用面板内 role=alert 展示');
assert(nodeText(t09BusyAlert).includes('已有翻译任务在运行'), 'ERR_BUSY 提示文案正确');
assert(!batchConfirmNode(), '启动失败后收起确认');

// 旧宿主 404/405：提示升级插件。
for (const t09Status of [404, 405]) {
  translateResponder = () => mockResponse(t09Status, { ok: false, code: 'ERR_HTTP', message: 'not found' });
  await armBatch();
  await confirmBatch();
  const t09UpgradeAlert = alertNode();
  assert(!!t09UpgradeAlert, `${t09Status} 用面板内 role=alert 展示`);
  assert(nodeText(t09UpgradeAlert).includes('升级 DSH 或插件'), `${t09Status} 提示升级插件`);
}

// 切换范围：清理旧确认，数量随范围切换。
await armBatch();
assert(!!batchConfirmNode(), '切换范围前确认已出现');
await act(async () => {
  batchScopeSelect().props.onChange({ target: { value: 'stale' } });
  await new Promise((resolve) => setTimeout(resolve, 80));
});
assert(!batchConfirmNode(), '切换范围后确认复位');
assert(batchScopeSelect().props.value === 'stale', '范围 select 已切到 stale');
assert(
  nodeText(batchStartButton()).includes(`批量翻译（${t09Coverage.stale}）`),
  '批量按钮数量随范围切到过期数量',
);

// 离开列表（进详情再返回）：确认不残留、不抛错。
await armBatch();
assert(!!batchConfirmNode(), '离开列表前确认已出现');
await act(async () => {
  rows()[0].props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 200));
});
text = JSON.stringify(renderer.toJSON());
assert(text.includes('返回列表'), '进入详情成功');
assert(!batchConfirmNode(), '进入详情后确认不出现');
await act(async () => {
  buttonByText('返回列表').props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 120));
});
assert(!batchConfirmNode(), '返回列表后确认仍复位');

// 切分区：确认不残留，回到技能库也不重新出现。
await armBatch();
assert(!!batchConfirmNode(), '切分区前确认已出现');
await act(async () => {
  buttonByText('设置').props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 120));
});
text = JSON.stringify(renderer.toJSON());
assert(text.includes('启用中文层'), '切到设置页');
assert(!batchConfirmNode(), '切到设置页后确认不出现');
await act(async () => {
  buttonByText('技能库').props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 120));
});
assert(!batchConfirmNode(), '回到技能库后确认仍复位');

// 还原状态，交给后续空索引用例。
statusPayload = { ok: true, jobs: [] };
translateResponder = () => mockResponse(200, { ok: true, jobId: 'job-batch-default', total: 1 });
await refreshWith(clonePayload());

// ---------------------------------------------------------------------------
// T10：批量任务进度 / 结果面板（运行中进度、失败明细、取消、重试）
// ---------------------------------------------------------------------------
const t10Wait = async (ms) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};
const batchJobNode = () =>
  renderer.root.findAll((n) => n.props && n.props['data-skw-batch-job'] === '1')[0];
const batchProgressNode = () =>
  renderer.root.findAll((n) => n.props && n.props['data-skw-batch-progress'] === '1')[0];
const batchCancelJobNode = () =>
  renderer.root.findAll((n) => n.type === 'button' && n.props && n.props['data-skw-batch-cancel-job'] === '1')[0];
const batchRetryNode = () =>
  renderer.root.findAll((n) => n.type === 'button' && n.props && n.props['data-skw-batch-retry'] === '1')[0];
const batchFailuresNode = () =>
  renderer.root.findAll((n) => n.props && n.props['data-skw-batch-failures'] === '1')[0];
const batchFailureLinks = () =>
  renderer.root.findAll((n) => n.type === 'a' && n.props && typeof n.props['data-skw-batch-failure'] === 'string');
const batchDismissNode = () =>
  renderer.root.findAll((n) => n.type === 'button' && n.props && n.props['data-skw-batch-dismiss'] === '1')[0];

// T09 结束时范围停在 stale，且可能留着上一轮终态面板；先复位到未翻译并清掉。
await act(async () => {
  batchScopeSelect().props.onChange({ target: { value: 'untranslated' } });
  await new Promise((resolve) => setTimeout(resolve, 80));
});
if (batchDismissNode()) {
  await act(async () => {
    batchDismissNode().props.onClick();
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
}
assert(!batchJobNode(), 'T10 起始时上一轮批量面板可关闭');
assert(batchScopeSelect().props.value === 'untranslated', 'T10 起始范围回到 untranslated');

// --- 运行中进度：0/2 → 1/2 → 2/2 done，进度条 aria 值同步，结束后刷新 /list ---
statusPayload = { ok: true, jobs: [] };
translateResponder = () => mockResponse(200, { ok: true, jobId: 'job-t10-run', total: 2 });
await armBatch();
await confirmBatch();
assert(
  !!batchJobNode() && batchJobNode().props['data-skw-batch-state'] === 'running',
  '确认启动后立即出现运行中面板',
);
assert(!!batchProgressNode(), '运行中面板有 role=progressbar 的进度条');
assert(batchProgressNode().props.role === 'progressbar', '进度条 role=progressbar');
assert(batchProgressNode().props['aria-valuemin'] === 0, '进度条 aria-valuemin=0');
assert(batchProgressNode().props['aria-valuemax'] === 2, '进度条 aria-valuemax=total=2');
assert(batchProgressNode().props['aria-valuenow'] === 0, '启动快照的 aria-valuenow=0');
assert(nodeText(batchJobNode()).includes('翻译中 0/2 · 失败 0'), '启动时显示「翻译中 0/2 · 失败 0」');

statusPayload = {
  ok: true,
  jobs: [{ id: 'job-t10-run', state: 'running', total: 2, done: 1, failed: 0, current: 'lark-doc' }],
};
await t10Wait(1700);
assert(batchProgressNode().props['aria-valuenow'] === 1, '第一次轮询后 aria-valuenow=1');
assert(
  nodeText(batchJobNode()).includes('翻译中 1/2 · 失败 0 · 正在处理：lark-doc'),
  '运行中文本包含 done/total、失败数与正在处理的技能名',
);
assert(rows().length === TOTAL, '运行中不整表 loading、不清空现有列表');

const t10ListBeforeDone = requests.filter((url) => url.includes('/list')).length;
statusPayload = {
  ok: true,
  jobs: [{ id: 'job-t10-run', state: 'done', total: 2, done: 2, failed: 0 }],
};
await t10Wait(1700);
assert(batchJobNode().props['data-skw-batch-state'] === 'done', '任务结束后面板进入 done 态');
assert(!batchProgressNode(), '结束后不再显示运行进度条');
assert(nodeText(batchJobNode()).includes('完成 2 个，失败 0 个'), 'done 文案显示完成/失败数量');
assert(
  requests.filter((url) => url.includes('/list')).length > t10ListBeforeDone,
  '任务结束后重新请求 /list 刷新列表',
);
assert(batchStartButton().props.disabled === false, '任务结束后批量按钮恢复可用');

// --- done + 失败明细：最多 20 条、还有 N 条、超限提示、技能名链接、重试请求体 ---
statusPayload = { ok: true, jobs: [] };
await refreshWith(clonePayload());
const t10FailureNames = Array.from({ length: 50 }, (_, index) => 'missing-skill-' + (index + 1));
const t10Failures = t10FailureNames.map((name, index) => ({
  name,
  code: 'ERR_MODEL',
  message: '原因 ' + (index + 1),
}));
translateResponder = () => mockResponse(200, { ok: true, jobId: 'job-t10-failures', total: 61 });
await armBatch();
await confirmBatch();
statusPayload = {
  ok: true,
  jobs: [
    {
      id: 'job-t10-failures',
      state: 'done',
      total: 61,
      done: 1,
      failed: 60,
      failures: t10Failures,
      failuresTruncated: true,
    },
  ],
};
await t10Wait(1700);
assert(batchJobNode().props['data-skw-batch-state'] === 'done', '部分失败时面板仍为 done 态');
assert(nodeText(batchJobNode()).includes('完成 1 个，失败 60 个'), 'done 文案包含部分失败数量');
assert(batchFailureLinks().length === 20, `失败列表最多渲染 20 条（实际 ${batchFailureLinks().length}）`);
const t10FirstFailureLi = batchFailuresNode().findAll((n) => n.type === 'li')[0];
assert(
  nodeText(t10FirstFailureLi).includes('missing-skill-1 — 原因 1'),
  '失败项文本为「技能名 — 短原因」',
);
assert(
  batchFailureLinks()[0].props.href === '#skill/missing-skill-1',
  '失败项技能名是指向 #skill/<name> 的链接',
);
const t10MoreNode = renderer.root.findAll((n) => n.props && n.props['data-skw-batch-failures-more'] === '1')[0];
assert(!!t10MoreNode, '失败多于 20 条时显示剩余条数');
assert(nodeText(t10MoreNode).includes('还有 40 条未显示'), '剩余条数按 failed - 20 计算');
const t10TruncatedNode = renderer.root.findAll(
  (n) => n.props && n.props['data-skw-batch-failures-truncated'] === '1',
)[0];
assert(!!t10TruncatedNode, 'failuresTruncated 时显示截断提示');
assert(nodeText(t10TruncatedNode).includes('只保留前 50 条'), '截断提示写明只保留前 50 条');
assert(nodeText(batchRetryNode()).includes('重试失败项（50）'), '重试按钮显示可重试的失败项数');
assert(
  batchFailuresNode().findAll((n) => n.type === 'button').length === 0,
  '重试按钮在失败列表之外',
);

statusPayload = {
  ok: true,
  jobs: [{ id: 'job-t10-retry', state: 'running', total: 50, done: 0, failed: 0 }],
};
translateResponder = () => mockResponse(200, { ok: true, jobId: 'job-t10-retry', total: 50 });
const t10TranslateBeforeRetry = translateRequests().length;
await act(async () => {
  batchRetryNode().props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 150));
});
const t10RetryBody = JSON.parse(translateRequests()[t10TranslateBeforeRetry].body || '{}');
assert(t10RetryBody.scope === 'selected', '有失败技能名时重试 scope=selected');
assert(Array.isArray(t10RetryBody.names) && t10RetryBody.names.length === 50, '重试 names 覆盖全部失败技能名');
assert(t10RetryBody.names[0] === 'missing-skill-1', '重试 names 保留失败技能名');
assert(
  batchJobNode().props['data-skw-batch-state'] === 'running' &&
    nodeText(batchJobNode()).includes('翻译中 0/50 · 失败 0'),
  '重试后重新进入 running 并清空上一轮结果',
);

// 让这次重试的轮询结束（status 里没有该 job），再进入下一场景。
statusPayload = { ok: true, jobs: [] };
await t10Wait(1700);

// --- failed：显示错误短原因，仍保留失败列表与重试；重试失败就地 role=alert ---
await refreshWith(clonePayload());
translateResponder = () => mockResponse(200, { ok: true, jobId: 'job-t10-failed', total: 3 });
await armBatch();
await confirmBatch();
statusPayload = {
  ok: true,
  jobs: [
    {
      id: 'job-t10-failed',
      state: 'failed',
      total: 3,
      done: 1,
      failed: 2,
      error: { code: 'ERR_MODEL', message: '模型调用超时' },
      failures: [
        { name: 'alpha-skill', code: 'ERR_X', message: '失败原因甲' },
        { name: 'beta-skill', code: 'ERR_Y', message: '失败原因乙' },
      ],
      failuresTruncated: false,
    },
  ],
};
await t10Wait(1700);
const t10FailedOutcome = renderer.root.findAll(
  (n) => n.props && n.props['data-skw-batch-outcome'] === 'failed',
)[0];
assert(!!t10FailedOutcome, '任务失败时显示 failed 结果');
assert(nodeText(t10FailedOutcome).includes('任务失败：模型调用超时'), 'failed 文案使用 job.error 的短原因');
assert(batchFailureLinks().length === 2, 'failed 时仍显示失败明细列表');
assert(nodeText(batchRetryNode()).includes('重试失败项（2）'), 'failed 时仍提供重试按钮');

translateResponder = () => mockResponse(500, { ok: false, code: 'ERR_MODEL', message: '模型挂了' });
await act(async () => {
  batchRetryNode().props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 150));
});
let t10RetryAlert = alertNode();
assert(!!t10RetryAlert, '重试失败时就地显示 role=alert');
assert(nodeText(t10RetryAlert).includes('重试失败：模型挂了'), '重试失败提示带短原因');

translateResponder = () => mockResponse(429, { ok: false, code: 'ERR_BUSY', message: 'busy' });
await act(async () => {
  batchRetryNode().props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 150));
});
t10RetryAlert = alertNode();
assert(!!t10RetryAlert, '重试遇 429 时就地显示 role=alert');
assert(nodeText(t10RetryAlert).includes('已有翻译任务在运行'), '重试 429 复用任务占用提示');
assert(
  batchJobNode().props['data-skw-batch-state'] === 'failed',
  '重试失败不破坏上一轮失败结果',
);

// --- cancelled：取消按钮调用 /cancel，取消中禁用；终态显示已取消且不自动重试 ---
statusPayload = { ok: true, jobs: [] };
await refreshWith(clonePayload());
translateResponder = () => mockResponse(200, { ok: true, jobId: 'job-t10-cancel', total: 3 });
await armBatch();
await confirmBatch();
statusPayload = {
  ok: true,
  jobs: [{ id: 'job-t10-cancel', state: 'running', total: 3, done: 1, failed: 0, current: 'alpha-skill' }],
};
await t10Wait(1700);
assert(!!batchCancelJobNode(), '运行中面板提供取消按钮');
assert(batchCancelJobNode().props.disabled === false, '运行中取消按钮可用');

// 取消失败：就地 role=alert，按钮恢复可用，任务继续轮询。
cancelResponder = () => mockResponse(500, { ok: false, code: 'ERR_CANCEL', message: '取消失败了' });
await act(async () => {
  batchCancelJobNode().props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 200));
});
const t10CancelFailAlert = alertNode();
assert(!!t10CancelFailAlert, '取消失败时就地显示 role=alert');
assert(nodeText(t10CancelFailAlert).includes('取消失败：取消失败了'), '取消失败提示带短原因');
assert(batchCancelJobNode().props.disabled === false, '取消失败后按钮恢复可用');
assert(nodeText(batchCancelJobNode()).includes('取消'), '取消失败后按钮文案恢复');

// 取消成功：POST /cancel 带 jobId，取消中按钮禁用且显示状态。
cancelResponder = () => mockResponse(200, { ok: true, cancelled: true });
const t10CancelCount = requestLog.filter((item) => item.url.includes('/cancel')).length;
await act(async () => {
  batchCancelJobNode().props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 200));
});
const t10CancelRequest = requestLog.filter((item) => item.url.includes('/cancel'))[t10CancelCount];
assert(!!t10CancelRequest && t10CancelRequest.method === 'POST', '取消按钮调用 POST /cancel');
assert(JSON.parse(t10CancelRequest.body || '{}').jobId === 'job-t10-cancel', '/cancel body 带当前 jobId');
assert(batchCancelJobNode().props.disabled === true, '取消中按钮禁用');
assert(nodeText(batchCancelJobNode()).includes('正在取消'), '取消中按钮显示取消状态');

const t10TranslateBeforeCancelDone = translateRequests().length;
statusPayload = {
  ok: true,
  jobs: [{ id: 'job-t10-cancel', state: 'cancelled', total: 3, done: 1, failed: 2 }],
};
await t10Wait(1700);
assert(batchJobNode().props['data-skw-batch-state'] === 'cancelled', '取消后进入 cancelled 态');
assert(
  nodeText(batchJobNode()).includes('已取消：完成 1，失败 2'),
  'cancelled 文案显示完成/失败数量',
);
assert(!batchCancelJobNode(), '取消完成后不再显示取消按钮');
assert(
  translateRequests().length === t10TranslateBeforeCancelDone,
  '取消后不自动发起重试 /translate',
);
await t10Wait(1200);
assert(
  translateRequests().length === t10TranslateBeforeCancelDone,
  '取消后等待一个轮询周期仍不自动重试',
);

// --- 旧宿主无 failures：只显示失败数量，不编造技能名；重试退回按范围重跑 ---
await refreshWith(clonePayload());
translateResponder = () => mockResponse(200, { ok: true, jobId: 'job-t10-legacy', total: 3 });
await armBatch();
await confirmBatch();
statusPayload = {
  ok: true,
  jobs: [
    {
      id: 'job-t10-legacy',
      state: 'failed',
      total: 3,
      done: 1,
      failed: 2,
      error: { code: 'ERR_MODEL', message: '旧宿主错误' },
    },
  ],
};
await t10Wait(1700);
const t10LegacyNode = renderer.root.findAll((n) => n.props && n.props['data-skw-batch-legacy-failures'] === '1')[0];
assert(!!t10LegacyNode, '旧宿主无 failures 时显示降级说明');
assert(
  nodeText(t10LegacyNode).includes('失败 2 个（当前宿主不提供明细）'),
  'old host 只显示失败数量且说明无明细',
);
assert(batchFailureLinks().length === 0, 'old host 不编造失败技能名链接');
const t10RetryHint = renderer.root.findAll(
  (n) => n.props && n.props['data-skw-batch-retry-hint'] === '1',
)[0];
assert(
  !!t10RetryHint && nodeText(t10RetryHint).includes('可能重复已完成项'),
  '无明细重试前提示可能重复已完成项',
);

translateResponder = () => mockResponse(200, { ok: true, jobId: 'job-t10-legacy-retry', total: 2 });
const t10TranslateBeforeScopeRetry = translateRequests().length;
await act(async () => {
  batchRetryNode().props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 150));
});
const t10ScopeRetryBody = JSON.parse(translateRequests()[t10TranslateBeforeScopeRetry].body || '{}');
assert(
  JSON.stringify(t10ScopeRetryBody) === JSON.stringify({ scope: 'untranslated' }),
  `无失败技能名时按当前 batchScope 重跑（实际 ${JSON.stringify(t10ScopeRetryBody)}）`,
);
const t10ScopeRetryText = JSON.stringify(renderer.toJSON());
assert(
  t10ScopeRetryText.includes('已按当前范围重新翻译') && t10ScopeRetryText.includes('可能重复已完成项'),
  '按范围重跑后就地提示可能重复已完成项',
);

statusPayload = {
  ok: true,
  jobs: [{ id: 'job-t10-legacy-retry', state: 'cancelled', total: 2, done: 0, failed: 0 }],
};
await t10Wait(1700);
assert(!!batchDismissNode(), '终态面板提供关闭按钮');
await act(async () => {
  batchDismissNode().props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 80));
});
assert(!batchJobNode(), '关闭后终态面板消失');

// 还原状态，交给后续空索引用例。
statusPayload = { ok: true, jobs: [] };
translateResponder = () => mockResponse(200, { ok: true, jobId: 'job-batch-default', total: 1 });
await refreshWith(clonePayload());

// total=0：空态，不显示四桶数字与缺口按钮。
const emptyPayload = clonePayload();
emptyPayload.skills = [];
emptyPayload.coverage = { total: 0, translated: 0, draft: 0, stale: 0, untranslated: 0 };
await refreshWith(emptyPayload);
text = JSON.stringify(renderer.toJSON());
assert(rows().length === 0, '空索引时列表无行');
assert(text.includes('还没有扫描到技能'), '空索引时显示空态文案');
assert(gapNode('builtin') === undefined && gapNode('unknown') === undefined, '空索引不显示四桶数字');
assert(!buttonByText('查看没中文') && !buttonByText('查看过期'), '空索引不显示缺口按钮');
assert(
  nodeText(batchStartButton()).includes('批量翻译（0）'),
  `空索引时批量按钮数量为 0（实际 ${nodeText(batchStartButton())}）`,
);
assert(batchStartButton().props.disabled === true, '可翻译数量为 0 时批量按钮禁用');

await act(async () => { renderer.unmount(); });

const failed = results.filter((r) => !r.ok);
fixture.cleanup();
console.log(failed.length ? `\nPAGE REGRESSION FAILED：${failed.length} 项` : '\nPAGE REGRESSION ALL GREEN');
process.exit(failed.length ? 1 : 0);
