// 附加运行态测试：①overlay 兼容模式中文候选 ②项目级 store 覆盖与回退
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';

const CLIENT_PATH = decodeURIComponent(new URL('../client.js', import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const ORIGIN = (process.env.DSH_PLUGIN_ORIGIN || 'http://127.0.0.1:51825').replace(/\/+$/, '') + '/';
const BASE = new URL('api/dsh-skill-workbench/', ORIGIN);

let failures = 0;
const assert = (cond, label) => {
  if (cond) console.log('ok - ' + label);
  else { console.error('FAIL - ' + label); failures += 1; }
};
const api = async (path, options) => {
  const res = await fetch(new URL(path, BASE), options);
  return { status: res.status, body: await res.json() };
};
const post = (path, payload) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });

const status0 = await api('status');
const originalMode = status0.body.settings ? status0.body.settings.mode : 'decorate';

// ---------- ① overlay 兼容模式 ----------
try {
  const set = await post('config', { settings: { mode: 'overlay' } });
  assert(set.status === 200 && set.body.ok !== false, 'POST /config 切到 overlay 模式（status=' + set.status + '）');

  const source = fs.readFileSync(CLIENT_PATH, 'utf8');
  let record = null;
  const sources = [];
  const sandbox = {
    window: { __ModuleLoader__: { load(r) { record = r; } }, location: { pathname: '/' } },
    document: { documentElement: { lang: 'zh-CN' } },
    navigator: { language: 'zh-CN' },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, URL,
    TextEncoder, TextDecoder, AbortController,
    fetch: (path, options) => fetch(new URL(path, ORIGIN), options),
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'client.js' });
  const plugin = record.factory((id) => (id === 'react' ? React : (() => { throw new Error('require ' + id); })()));
  plugin.apply({
    get(name) { return name === 'inputTriggers' ? { live: { sources }, registerSource(s) { sources.push(s); return () => {}; } } : undefined; },
    locale: { register: () => () => {}, bind: () => (k) => k },
    slots: { inject: () => () => {}, register: () => () => {} },
    effect: (cb) => { try { cb(); } catch (e) {} },
  });
  const overlay = sources.find((s) => s && s.trigger === '/' && s.name === '技能');
  assert(!!overlay, 'overlay source 已注册（trigger=/，分组名「技能」）');
  const rows = await overlay.candidates({ sessionId: 't' }, { query: '' });
  assert(Array.isArray(rows) && rows.length === 52, 'overlay 候选 52 行（实际 ' + (rows && rows.length) + '）');
  assert(rows.every((r) => r.label && /[\u4e00-\u9fff]/.test(r.label)), 'overlay 全部候选中文 label');
  assert(rows.every((r) => r.section && /[\u4e00-\u9fff]/.test(r.section)), 'overlay 全部候选中文 section');
  const reach = rows.find((r) => r.name === 'agent-reach');
  assert(!!reach && reach.label === '全网调研', 'overlay label=全网调研');
  const pick = overlay.onPick({ candidate: { name: 'agent-reach' } });
  assert(pick && pick.text === '/agent-reach ', 'overlay onPick 插入 /agent-reach');
} catch (err) {
  console.error('FAIL - overlay 测试异常: ' + (err && err.message));
  failures += 1;
} finally {
  const restore = await post('config', { settings: { mode: originalMode } });
  assert(restore.status === 200, '恢复原模式 ' + originalMode);
}

// ---------- ② 项目级 store（MVP：只读覆盖；写操作落用户级） ----------
const PROJECT_DIR = 'D:\\工作区\\_dsh_design\\proj-store-test';
const PROJECT_FILE = PROJECT_DIR + '\\.dsh\\skill-cn\\zh-index.json';
try {
  fs.mkdirSync(PROJECT_DIR + '\\.git', { recursive: true });

  const saved = await post('save', { name: 'agent-reach', zh: { name: '项目级测试名' }, cwd: PROJECT_DIR });
  assert(saved.status === 200 && saved.body.ok !== false, 'POST /save 带 cwd 可保存');
  assert(!fs.existsSync(PROJECT_FILE), 'MVP 约定：save 写用户级 store，不自动创建项目级文件');
  const afterSave = (await api('list?cwd=' + encodeURIComponent('D:\\工作区'))).body.skills.find((s) => s.name === 'agent-reach');
  assert(afterSave && afterSave.zh && afterSave.zh.name === '项目级测试名', 'save 之后用户级 override 生效（工作区视图）');

  // 手工铺一个项目级覆盖文件，验证三层合并读取（project > user > builtin）
  fs.mkdirSync(PROJECT_DIR + '\\.dsh\\skill-cn', { recursive: true });
  fs.writeFileSync(
    PROJECT_FILE,
    JSON.stringify({
      schemaVersion: 1,
      entries: {
        'agent-reach': {
          zh: {
            name: '项目层名字',
            summary: '项目级简介',
            description: '项目级详细说明',
            whenToUse: '项目内调研时',
            notFor: '项目外调研',
            category: 'research',
            tags: ['调研', '项目'],
            keywords: ['项目级'],
            pinyin: 'xiangmucengmingzi',
            pinyinInitials: 'xmcmz',
            origin: 'manual',
            review: 'reviewed',
          },
        },
      },
    }),
    'utf8'
  );
  const inProject = await api('list?cwd=' + encodeURIComponent(PROJECT_DIR));
  const projectRow = inProject.body.skills.find((s) => s.name === 'agent-reach');
  const rootRow = (await api('list?cwd=' + encodeURIComponent('D:\\工作区'))).body.skills.find((s) => s.name === 'agent-reach');
  assert(projectRow && projectRow.zh && projectRow.zh.name === '项目层名字', '项目内 /list 读取项目级覆盖「项目层名字」');
  assert(rootRow && rootRow.zh && rootRow.zh.name === '项目级测试名', '工作区 /list 仍读用户级（项目层不串味）');

  fs.rmSync(PROJECT_FILE, { force: true });
  const after = (await api('list?cwd=' + encodeURIComponent(PROJECT_DIR))).body.skills.find((s) => s.name === 'agent-reach');
  assert(after && after.zh && after.zh.name === '项目级测试名', '删项目级文件后回退到用户级');
} catch (err) {
  console.error('FAIL - 项目级 store 测试异常: ' + (err && err.message));
  failures += 1;
} finally {
  // 清理测试产生的用户级 override，恢复内置显示名
  try { await post('delete', { name: 'agent-reach' }); } catch (e) {}
  try { fs.rmSync(PROJECT_DIR, { recursive: true, force: true }); } catch (e) {}
}

console.log(failures ? 'EXTRA TEST FAILED（' + failures + '）' : 'EXTRA TEST ALL GREEN');
process.exit(failures ? 1 : 0);
