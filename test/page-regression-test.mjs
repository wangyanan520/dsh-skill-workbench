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
const PAYLOAD = fixture.payload;
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
  TextEncoder,
  TextDecoder,
  AbortController,
  fetch: async (path, options) => {
    const url = String(path);
    requests.push(url);
    const body = url.includes('/list') ? PAYLOAD : {};
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  },
};
sandbox.globalThis = sandbox;
// 浏览器里 location 既是 window.location 也是全局变量；插件代码用的是裸 location，
// 补上才能覆盖「深链/hash 路由」相关分支。
sandbox.location = sandbox.window.location;
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
  // 清掉路由恢复记录，让重挂载停在列表页，模拟用户重新点进详情。
  storage.removeItem('skw:route');
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

await act(async () => { renderer.unmount(); });

const failed = results.filter((r) => !r.ok);
fixture.cleanup();
console.log(failed.length ? `\nPAGE REGRESSION FAILED：${failed.length} 项` : '\nPAGE REGRESSION ALL GREEN');
process.exit(failed.length ? 1 : 0);
