// 用真实 React + react-test-renderer 渲染 dsh-skill-workbench 管理页，
// 数据走运行中 App 的真实 HTTP API（默认 http://127.0.0.1:51825，可用 DSH_PLUGIN_ORIGIN 覆盖）。
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const CLIENT_PATH = decodeURIComponent(new URL('../client.js', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const ORIGIN = (process.env.DSH_PLUGIN_ORIGIN || 'http://127.0.0.1:51825').replace(/\/+$/, '') + '/';

const source = fs.readFileSync(CLIENT_PATH, 'utf8');
let moduleRecord = null;

const storage = (() => {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(String(k), String(v)),
    removeItem: (k) => map.delete(k),
  };
})();

const sandbox = {
  window: {
    __ModuleLoader__: {
      load(record) {
        moduleRecord = record;
      },
    },
    location: { pathname: '/', href: ORIGIN },
  },
  document: { documentElement: { lang: 'zh-CN' } },
  navigator: { language: 'zh-CN', languages: ['zh-CN'] },
  localStorage: storage,
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
  fetch: (path, options) => fetch(new URL(path, ORIGIN), options),
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'client.js' });

const assert = (cond, label) => {
  if (!cond) {
    console.error('FAIL - ' + label);
    process.exitCode = 1;
  } else {
    console.log('ok - ' + label);
  }
};

assert(moduleRecord !== null, 'client.js 调用 window.__ModuleLoader__.load');
assert(moduleRecord && moduleRecord.id === 'dsh-skill-workbench', '模块 id 正确');

const plugin = moduleRecord.factory((id) => {
  if (id === 'react') return React;
  throw new Error('unexpected require: ' + id);
});

const registered = [];
const fakeCtx = {
  get() {
    return undefined;
  },
  locale: {
    register: () => () => {},
    bind: () => (key) => key,
  },
  slots: {
    inject: (name, cb) => {
      try {
        cb();
      } catch (error) {
        console.error('slot inject failed: ' + name, error);
      }
      return () => {};
    },
    register: (options, Component) => {
      registered.push({ options, Component });
      return () => {};
    },
  },
  effect: (cb) => {
    try {
      cb();
    } catch (error) {
      /* ignore */
    }
  },
};

plugin.apply(fakeCtx);
const main = registered.find((item) => item && item.options && item.options.name === 'main');
assert(!!main, '注册 main 页面组件');
const side = registered.find((item) => item && item.options && item.options.name === 'sidebar.panellist');
assert(!!side && side.options.label().length >= 2, '注册侧栏入口，label=' + (side && side.options.label && side.options.label()));

let renderer = null;
await act(async () => {
  renderer = TestRenderer.create(React.createElement(main.Component, {}));
  await new Promise((resolve) => setTimeout(resolve, 800));
});

let text = JSON.stringify(renderer.toJSON());
assert(text.includes('技能中文'), '页面标题显示「技能中文」');
assert(!text.includes('加载中…'), '加载完成（无加载中占位）');
assert(text.includes('共 52 条'), '属性列表显示「共 52 条」');
assert(text.includes('全网调研'), '中文显示名（agent-reach → 全网调研）渲染成功');
assert(text.includes('改名 / 编辑'), '每行有「改名 / 编辑」按钮');
assert(text.includes('中文覆盖'), '覆盖率卡片渲染');
assert(text.includes('/agent-reach'), '行内保留英文 token /agent-reach');
assert(text.includes('信息数据与可视化'), '卡片列表有中文分类分组头（信息数据与可视化）');
assert(text.includes('技术设计与开发'), '卡片列表有中文分类分组头（技术设计与开发）');
assert(text.includes('全部分类'), '工具栏有分类筛选下拉（全部分类）');


const rows = renderer.root.findAll((node) => node.type === 'div' && node.props && node.props.role === 'button');
assert(rows.length >= 40, '卡片行数量 >= 40（实际 ' + rows.length + '）');

await act(async () => {
  rows[0].props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 100));
});
text = JSON.stringify(renderer.toJSON());
assert(text.includes('显示名称（中文名）'), '点击卡片打开详情，出现「显示名称（中文名）」');
assert(text.includes('采用原文简介'), '详情页有「采用原文简介」按钮');

const nameInput = renderer.root.findAll((node) => node.type === 'input').find((node) => node.props && node.props.value !== undefined);
assert(!!nameInput, '详情页有可编辑的显示名称 input');

await act(async () => {
  renderer.unmount();
});
console.log(process.exitCode ? 'RENDER TEST FAILED' : 'RENDER TEST ALL GREEN');
process.exit(process.exitCode || 0);
