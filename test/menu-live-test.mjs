// / 菜单装饰「真数据」联调测试：用运行中 App 的真实 /list 数据，
// 复刻官方 skill source 的候选形态，验证包装后的中文 label/section/description 与 onPick token。
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';

const CLIENT_PATH = decodeURIComponent(new URL('../client.js', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const ORIGIN = (process.env.DSH_PLUGIN_ORIGIN || 'http://127.0.0.1:51825').replace(/\/+$/, '') + '/';
const source = fs.readFileSync(CLIENT_PATH, 'utf8');

const assert = (cond, label) => {
  if (!cond) {
    console.error('FAIL - ' + label);
    process.exitCode = 1;
  } else {
    console.log('ok - ' + label);
  }
};

let moduleRecord = null;
const storageMap = new Map();
const sandbox = {
  window: {
    __ModuleLoader__: { load(record) { moduleRecord = record; } },
    location: { pathname: '/', href: ORIGIN },
  },
  document: { documentElement: { lang: 'zh-CN' } },
  navigator: { language: 'zh-CN', languages: ['zh-CN'] },
  localStorage: {
    getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: (k, v) => storageMap.set(String(k), String(v)),
    removeItem: (k) => storageMap.delete(k),
  },
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

const plugin = moduleRecord.factory((id) => {
  if (id === 'react') return React;
  throw new Error('unexpected require: ' + id);
});

const sources = [];
const inputTriggers = {
  live: { sources },
  registerSource(src) {
    sources.push(src);
    return () => {
      const i = sources.indexOf(src);
      if (i >= 0) sources.splice(i, 1);
    };
  },
};
const fakeCtx = {
  get(name) {
    return name === 'inputTriggers' ? inputTriggers : undefined;
  },
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: { inject: () => () => {}, register: () => () => {} },
  effect: (cb) => { try { cb(); } catch (e) {} },
};

plugin.apply(fakeCtx);
assert(sources.some((s) => s && s.name === '技能' && s.trigger === '/'), 'overlay 兼容 source 已注册（name=技能, trigger=/）');

// 模拟官方 dsh-client-ui-skill 的 source 形态（英文行 + rankByName 过滤 + onPick 插入 /name）
const skillSource = {
  trigger: '/',
  name: 'skill',
  order: 2,
  async candidates(session, options) {
    const query = String((options && options.query) || '').toLowerCase();
    const rows = allSkills
      .filter((s) => !query || s.name.toLowerCase().includes(query))
      .map((s) => ({ name: s.name, description: s.description }));
    return rows;
  },
  onPick(candidate) {
    return { text: '/' + candidate.name + ' ' };
  },
  openReference() {},
  lexicon() { return []; },
  subscribeLexicon() { return () => {}; },
};

let allSkills = [];
const listRes = await fetch(new URL('api/dsh-skill-workbench/list', ORIGIN));
const listBody = await listRes.json();
allSkills = listBody.skills || [];
assert(allSkills.length >= 44, '真实 /list 返回 ' + allSkills.length + ' 条技能');

sources.push(skillSource);
for (let i = 0; i < 40 && !skillSource.__dsh_skill_i18n_mark__; i++) {
  await new Promise((r) => setTimeout(r, 100));
}
assert(!!skillSource.__dsh_skill_i18n_mark__, '包装器在 500ms 轮询内找到并包装了官方 source');

const fullRows = await skillSource.candidates({ sessionId: 'test' }, { query: '' });
assert(Array.isArray(fullRows) && fullRows.length >= 44, '装饰后返回全量候选（' + (fullRows && fullRows.length) + ' 行）');
assert(fullRows.every((row) => typeof row.label === 'string' && /[\u4e00-\u9fff]/.test(row.label)), '全部候选都有中文 label（' + fullRows.length + '/' + fullRows.length + '）');
assert(fullRows.every((row) => typeof row.section === 'string' && /[\u4e00-\u9fff]/.test(row.section)), '全部候选都有中文分类 section');

const reach = fullRows.find((row) => row.name === 'agent-reach');
assert(!!reach, '候选中保留英文 name=agent-reach');
assert(reach && reach.label === '全网调研', '行 label 显示中文名「全网调研」');
assert(reach && reach.section === '信息数据与可视化', '行 section 显示中文分类「信息数据与可视化」');
assert(reach && typeof reach.description === 'string' && /[\u4e00-\u9fff]/.test(reach.description), '行 description 为中文简介：「' + (reach && reach.description) + '」');

const queryRows = await skillSource.candidates({ sessionId: 'test' }, { query: '调研' });
assert(queryRows.some((row) => row.name === 'agent-reach'), '中文 query「调研」命中 agent-reach');
const pinyinRows = await skillSource.candidates({ sessionId: 'test' }, { query: 'qwdy' });
assert(pinyinRows.some((row) => row.name === 'agent-reach'), '拼音首字母 query「qwdy」命中全网调研');

const picked = skillSource.onPick({ name: 'agent-reach', label: '全网调研' });
assert(picked && picked.text === '/agent-reach ', 'onPick 插入的仍是英文 token /agent-reach');
assert(storageMap.get('dsh-skill-workbench:recent') !== undefined, '最近使用已写入 localStorage');

await new Promise((r) => setTimeout(r, 300));
const statusRes = await fetch(new URL('api/dsh-skill-workbench/status', ORIGIN));
const statusBody = await statusRes.json();
const last = statusBody.diagnostics && statusBody.diagnostics.lastClientDecorate;
assert(!!last && last.decorated === true && last.rows >= 44, '宿主已收到客户端装饰诊断 decorated=true rows=' + (last && last.rows));

console.log(process.exitCode ? 'MENU LIVE TEST FAILED' : 'MENU LIVE TEST ALL GREEN');
process.exit(process.exitCode || 0);
