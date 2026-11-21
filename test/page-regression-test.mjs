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
    requests.push(url);
    const body = url.includes('/list') ? currentPayload : {};
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
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

// 旧宿主：/list 没有 layers；只展示来源未知/没中文/过期 + 升级说明，页面不崩。
const legacyPayload = clonePayload();
legacyPayload.skills = legacyPayload.skills.map((skill) => {
  const next = { ...skill };
  delete next.layers;
  return next;
});
await refreshWith(legacyPayload);
text = JSON.stringify(renderer.toJSON());
assert(rows().length === TOTAL, `旧宿主载荷仍渲染 ${TOTAL} 条（实际 ${rows().length}）`);
assert(gapCount('unknown') === FIXTURE.cjkTotal, `旧宿主把 ${FIXTURE.cjkTotal} 条中文归入来源未知`);
assert(gapCount('none') === FIXTURE.buckets.none, `旧宿主没中文桶 ${FIXTURE.buckets.none}`);
assert(gapCount('stale') === FIXTURE.buckets.stale, `旧宿主过期桶 ${FIXTURE.buckets.stale}`);
assert(gapNode('builtin') === undefined, '旧宿主不伪造内置包桶');
assert(text.includes('当前宿主不提供分层来源'), '旧宿主显示升级说明');

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

await act(async () => { renderer.unmount(); });

const failed = results.filter((r) => !r.ok);
fixture.cleanup();
console.log(failed.length ? `\nPAGE REGRESSION FAILED：${failed.length} 项` : '\nPAGE REGRESSION ALL GREEN');
process.exit(failed.length ? 1 : 0);
