// 管理页离线回归：不依赖运行中的宿主，/list 数据由 host/ 的真实扫描逻辑就地生成。
// 覆盖：渲染、中文行走查、英文 token 保留、覆盖率卡、拼音搜索、详情页打开。
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { scanSkills } from '../host/scan.js';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CLIENT_PATH = decodeURIComponent(new URL('../client.js', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');

// 用真实 host 扫描生成 /list 夹具，避免“夹具写死、数据一变就红”
const scanned = await scanSkills({}, { cwd: process.cwd() });
const PAYLOAD = {
  skills: scanned.skills,
  categories: scanned.stores.userStore.categories,
  coverage: scanned.coverage,
  generatedAt: scanned.generatedAt,
  settings: {},
  store: {},
};
const TOTAL = scanned.skills.length;
const CJK_SKILLS = scanned.skills.filter((s) => s.zh && s.zh.name).length;

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

let renderer = null;
await act(async () => {
  renderer = TestRenderer.create(React.createElement(main.Component, {}));
  await new Promise((resolve) => setTimeout(resolve, 600));
});

const rows = () => renderer.root.findAll((n) => n.type === 'a' && n.props && n.props['data-skw-row']);
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

await act(async () => { renderer.unmount(); });

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\nPAGE REGRESSION FAILED：${failed.length} 项` : '\nPAGE REGRESSION ALL GREEN');
process.exit(failed.length ? 1 : 0);
