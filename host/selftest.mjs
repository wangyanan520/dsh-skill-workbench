// dsh-skill-workbench · host 自测（不依赖 DSH 宿主进程；真实技能目录 + 临时 DSH_HOME）
// 运行：node host/selftest.mjs   （全部通过打印 ALL GREEN，退出码 0）
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  hashBody,
  hashFrontmatter,
  nowIso,
  pluginVersion,
  sha256hex,
  stripFrontmatter,
  userStorePath,
  builtinPackPath,
} from './util.js';
import { parseSkillContent } from './frontmatter.js';
import {
  hasChinese,
  parseGithubRepo,
  parseSkillMention,
  rawCandidates,
  readSkillLock,
  sourceForSkill,
} from './install-source.js';
import {
  DEFAULT_SETTINGS,
  applySettingsPatch,
  defaultStore,
  loadBuiltinPack,
  loadProjectStore,
  loadUserStore,
  mergeCategories,
  mergeZhLayers,
  mutateUserStore,
  normalizeZh,
} from './store.js';
import {
  buildSkillViews,
  computeCoverage,
  computeSkillStatus,
  insertCandidate,
  resolveLocalization,
  scanSkills,
} from './scan.js';
import { createJobManager, normalizeModelZh, parseModelOutput } from './translate.js';
import { applyHostPlugin, isLoopbackRequest, readJsonBody, makeRoutes } from './routes.js';

const HOST_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HOST_DIR, '..');
const REAL_AGENTS_SKILLS = process.env.SKILLS_DIR || join(homedir(), '.agents', 'skills');
// CI（或没有真实技能目录的环境）用 SKIP_REAL_AGENTS_SCAN=1 跳过本机技能集相关断言。
const SKIP_REAL_AGENTS_SCAN = process.env.SKIP_REAL_AGENTS_SCAN === '1';
const EMPTY_PACK = { schemaVersion: 1, version: null, lang: 'zh-CN', categories: [], entries: {} };
const EMPTY_STORES = {
  userStore: defaultStore(),
  projectStore: { entries: {}, categories: [] },
  builtin: EMPTY_PACK,
};

let checks = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    checks += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`FAIL  ${name}`);
    console.error(error);
  }
}

// 从本机真实技能目录现算「应被扫到的技能名」，与 scanRoot 同口径：
// 目录取 <dir>/SKILL.md，根下裸 .md 直接取，按 frontmatter name 去重。
// 不写死具体技能名——本机技能集是用户态数据，装一个卸一个都会变，
// 写死会让「插件没坏、只是技能集变了」也变红。
function realSkillNames() {
  let entries;
  try {
    entries = readdirSync(REAL_AGENTS_SKILLS, { withFileTypes: true });
  } catch {
    return [];
  }
  const names = new Set();
  for (const entry of entries) {
    let filePath;
    if (entry.isDirectory()) filePath = join(REAL_AGENTS_SKILLS, entry.name, 'SKILL.md');
    else if (entry.isFile() && entry.name.endsWith('.md')) filePath = join(REAL_AGENTS_SKILLS, entry.name);
    else continue;
    let content;
    try {
      content = readFileSync(filePath, 'utf8');
    } catch {
      continue;
    }
    const parsed = parseSkillContent(content);
    if (parsed && typeof parsed.name === 'string' && parsed.name !== '') names.add(parsed.name);
  }
  return [...names];
}

function realSkillsCount() {
  return realSkillNames().length;
}

// ---------------------------------------------------------------- fake HTTP
function makeRequest({ method = 'GET', url = '/', body, remoteAddress = '127.0.0.1', headers = {} } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.socket = { remoteAddress };
  req.headers = { host: '127.0.0.1:61751', ...headers };
  req.destroyedByHandler = false;
  req.destroy = () => {
    req.destroyedByHandler = true;
  };
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  setImmediate(() => {
    for (const chunk of chunks) req.emit('data', chunk);
    req.emit('end');
  });
  return req;
}

function makeResponse() {
  return {
    headersSent: false,
    status: 0,
    headers: null,
    bodyText: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      this.headersSent = true;
    },
    end(text) {
      this.bodyText = text ?? '';
    },
    destroy() {},
  };
}

async function callRoute(route, options = {}) {
  const req = makeRequest(options);
  const res = makeResponse();
  await route.handler(req, res);
  let json = null;
  try {
    json = res.bodyText ? JSON.parse(res.bodyText) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, req, res };
}

function makeFakeContext() {
  const registered = [];
  const released = [];
  const effects = [];
  const ctx = {
    skills: {
      list: async () => {
        throw new Error('registry unavailable in selftest');
      },
    },
    workingDirectory: {
      get: () => null,
    },
    webServer: {
      register(route) {
        registered.push(route);
        return () => {
          released.push(route);
        };
      },
    },
    effect(fn, label) {
      const cleanup = fn();
      effects.push({ label, cleanup });
      return () => {
        if (typeof cleanup === 'function') cleanup();
      };
    },
  };
  return {
    ctx,
    registered,
    released,
    effects,
    cleanup() {
      for (const effect of effects) {
        if (typeof effect.cleanup === 'function') effect.cleanup();
      }
    },
  };
}

// ---------------------------------------------------------- translate job fixtures
// 临时项目夹具：真写 SKILL.md，扫描仍走 host/scan.js，不依赖本机技能目录或运行中宿主。
function makeJobProject(parent, names) {
  const dir = mkdtempSync(join(parent, 'translate-jobs-'));
  mkdirSync(join(dir, '.git'), { recursive: true });
  for (const name of names) {
    const skillDir = join(dir, '.agents', 'skills', name);
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name} selftest fixture\n---\nBody for ${name}.\n`,
    );
  }
  return dir;
}

/** 构造 scan 层测试用的候选；hash 默认与 name 绑定，便于断言 fresh/stale。 */
function makeScanCandidate(name, overrides = {}) {
  return {
    name,
    description: `${name} fixture`,
    whenToUse: null,
    modelInvocable: true,
    userInvocable: true,
    path: `/tmp/${name}/SKILL.md`,
    kind: 'project-agents',
    rank: 200,
    hash: { frontmatter: `fm-${name}`, body: `body-${name}` },
    bodyPreview: '',
    dirName: name,
    provider: 'filesystem',
    virtual: false,
    ...overrides,
  };
}

/**
 * 精确计数扫描必须隔离本机 ~/.agents/skills：scanSkills 即使带 cwd 也会扫用户层。
 * 临时改 DSH_AGENTS_HOME/DSH_BUNDLED_SKILL_DIR，结束后恢复，避免影响后续真实扫描断言。
 */
async function withIsolatedSkillRoots(agentsHomeDir, fn) {
  const previousAgentsHome = process.env.DSH_AGENTS_HOME;
  const previousBundledDir = process.env.DSH_BUNDLED_SKILL_DIR;
  process.env.DSH_AGENTS_HOME = agentsHomeDir;
  delete process.env.DSH_BUNDLED_SKILL_DIR;
  try {
    return await fn();
  } finally {
    if (previousAgentsHome === undefined) delete process.env.DSH_AGENTS_HOME;
    else process.env.DSH_AGENTS_HOME = previousAgentsHome;
    if (previousBundledDir === undefined) delete process.env.DSH_BUNDLED_SKILL_DIR;
    else process.env.DSH_BUNDLED_SKILL_DIR = previousBundledDir;
  }
}

function makeJobContext(streamFor) {
  return {
    get: (name) => (name === 'llm' ? { stream: streamFor } : undefined),
    skills: {
      list: async () => {
        throw new Error('registry unavailable in selftest');
      },
    },
    workingDirectory: { get: () => null },
  };
}

function skillNameFromParams(params) {
  const content = params && params.messages && params.messages[0] ? params.messages[0].content : null;
  const text = Array.isArray(content) && content[0] && typeof content[0].text === 'string' ? content[0].text : '';
  const match = /^技能 name: (.+)$/m.exec(text);
  return match ? match[1].trim() : '';
}

async function* successStream() {
  yield { type: 'text-delta', text: JSON.stringify({ name: '成功技能', summary: '自测用的成功翻译结果' }) };
  yield { type: 'finish', reason: { kind: 'stop' } };
}

async function* failingStream(code, message) {
  throw { code, message };
}

// 卡住直到任务被取消（signal abort），用于验证取消时未开始的目标不进 failures。
async function* blockingStream(signal) {
  await new Promise((resolve, reject) => {
    const onAbort = () => reject({ code: 'ABORTED', message: 'aborted by selftest' });
    if (signal && signal.aborted) {
      onAbort();
      return;
    }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
  yield { type: 'text-delta', text: '{}' };
  yield { type: 'finish', reason: { kind: 'stop' } };
}

async function waitForJobEnd(manager, jobId) {
  let job = manager.get(jobId);
  for (let attempt = 0; attempt < 300 && job && job.state === 'running'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    job = manager.get(jobId);
  }
  assert.ok(job, '任务应存在');
  assert.notEqual(job.state, 'running', '任务应在自测超时前结束');
  return job;
}

// ---------------------------------------------------------------- main
async function main() {
  const tempHome = mkdtempSync(join(tmpdir(), 'dsh-skill-workbench-selftest-'));
  process.env.DSH_HOME = tempHome;

  try {
    // ---- 1. 基础工具与 hash 规范
    await test('pluginVersion 可读取', () => {
      assert.match(pluginVersion(), /^\d+\.\d+\.\d+/);
    });

    await test('sha256 参考常量', () => {
      assert.equal(sha256hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
      assert.equal(sha256hex('hello world'), 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9');
      assert.equal(
        sha256hex('abc\ndef'),
        'd53d6b91af7caf8fe3d8021f116270137c0079d579a1e16965da80c2ed138ffb',
      );
    });

    await test('hashFrontmatter/hashBody/stripFrontmatter 符合契约 §1.2', () => {
      assert.equal(hashFrontmatter(' demo-skill ', ' 描述 '), sha256hex('demo-skill\n描述'));
      const content = '---\nname: demo-skill\ndescription: Demo\n---\nBody text\n';
      assert.equal(stripFrontmatter(content).trim(), 'Body text');
      assert.equal(hashBody(content), sha256hex('Body text'));
      assert.equal(stripFrontmatter('no frontmatter'), 'no frontmatter');
      const crlf = '---\r\nname: demo-skill\r\ndescription: Demo\r\n---\r\nCRLF body\r\n';
      assert.equal(hashBody(crlf), sha256hex('CRLF body'));
    });

    // ---- 2. frontmatter 解析（文档实测的四种格式 + 布尔）
    await test('frontmatter: plain/引号/折叠/字面块', () => {
      const plain = parseSkillContent('---\nname: demo-skill\ndescription: Plain desc\nwhenToUse: when needed\n---\nBody\n');
      assert.equal(plain.name, 'demo-skill');
      assert.equal(plain.description, 'Plain desc');
      assert.equal(plain.whenToUse, 'when needed');
      assert.equal(plain.body, 'Body');

      const quoted = parseSkillContent('---\nname: "quoted-skill"\ndescription: "中文 描述"\n---\nx\n');
      assert.equal(quoted.name, 'quoted-skill');
      assert.equal(quoted.description, '中文 描述');

      const single = parseSkillContent("---\nname: single-skill\ndescription: 'It''s a test'\n---\nx\n");
      assert.equal(single.description, "It's a test");

      const folded = parseSkillContent('---\nname: fold-skill\ndescription: >\n  Folded line one\n  line two\n---\nx\n');
      assert.equal(folded.description, 'Folded line one line two');

      const literal = parseSkillContent('---\nname: literal-skill\ndescription: |\n  Line one\n  Line two\n---\nx\n');
      assert.equal(literal.description, 'Line one\nLine two');

      assert.equal(parseSkillContent('---\nname: Bad_Name\ndescription: x\n---\n'), null);
      assert.equal(parseSkillContent('---\nname: no-desc\n---\n'), null);
    });
    await test('frontmatter: 无 body 的技能仍可解析', () => {
      const parsed = parseSkillContent('---\nname: no-body\ndescription: desc only\n---\n');
      assert.ok(parsed);
      assert.equal(parsed.name, 'no-body');
      assert.equal(parsed.body, '');
    });

    await test('frontmatter: invocation 布尔字段', () => {
      const parsed = parseSkillContent(
        '---\nname: inv-skill\ndescription: x\ndisable-model-invocation: true\nuser-invocable: false\n---\nx\n',
      );
      assert.equal(parsed.modelInvocable, false);
      assert.equal(parsed.userInvocable, false);
    });

    // ---- 3. 三层合并 / 状态 / 分类 / coverage
    await test('mergeZhLayers 字段级非空覆盖', () => {
      const merged = mergeZhLayers([
        { name: '中文名', summary: '' },
        { name: '', summary: '中文简介', description: '详细说明', tags: ['标签'] },
      ]);
      assert.equal(merged.name, '中文名');
      assert.equal(merged.summary, '中文简介');
      assert.equal(merged.description, '详细说明');
      assert.deepEqual(merged.tags, ['标签']);
    });

    await test('mergeCategories 字段级覆盖 + order 排序', () => {
      const categories = mergeCategories(
        [
          { id: 'tooling', zh: '工具', order: 20, icon: '🛠' },
          { id: 'research', zh: '研究', order: 30, icon: '🔎' },
        ],
        [{ id: 'research', zh: '调研' }],
      );
      assert.deepEqual(categories.map((item) => item.id), ['tooling', 'research']);
      assert.equal(categories[1].zh, '调研');
      assert.equal(categories[1].icon, '🔎');
    });

    await test('resolveLocalization + computeSkillStatus 三层状态', () => {
      const stores = {
        projectStore: { entries: {} },
        userStore: {
          entries: {
            demo: {
              zh: { name: '演示', summary: '简介', origin: 'user', review: 'reviewed' },
              hash: { frontmatter: 'fm1', body: 'body1', at: 't' },
              updatedAt: 't',
            },
          },
        },
        builtin: EMPTY_PACK,
      };
      const localization = resolveLocalization('demo', stores);
      assert.equal(localization.zh.name, '演示');
      assert.equal(localization.origin, 'user');
      assert.equal(computeSkillStatus(localization, { hash: { frontmatter: 'fm1', body: 'body1' } }), 'fresh');
      assert.equal(computeSkillStatus(localization, { hash: { frontmatter: 'fm2', body: 'body1' } }), 'stale');
      assert.equal(computeSkillStatus(localization, { hash: { frontmatter: null, body: null } }), 'stale');

      const builtinStores = {
        projectStore: { entries: {} },
        userStore: { entries: {} },
        builtin: { ...EMPTY_PACK, entries: { demo2: { zh: { name: '内置', summary: '简介' } } } },
      };
      const loc2 = resolveLocalization('demo2', builtinStores);
      assert.equal(loc2.origin, 'builtin');
      assert.equal(computeSkillStatus(loc2, { hash: { frontmatter: 'x', body: 'y' } }), 'fresh');
    });

    await test('computeCoverage 统计口径', () => {
      const coverage = computeCoverage([
        { zh: null, status: 'untranslated' },
        { zh: { name: 'A', origin: 'user', review: 'draft' }, status: 'fresh' },
        { zh: { name: 'B', origin: 'user', review: 'reviewed' }, status: 'stale' },
        { zh: { name: 'C', origin: 'builtin', review: 'reviewed' }, status: 'fresh' },
      ]);
      assert.deepEqual(coverage, { total: 4, translated: 2, draft: 1, stale: 1, untranslated: 1 });
    });

    await test('normalizeZh 只保留契约字段', () => {
      const zh = normalizeZh({ name: '名称', summary: '简介', bogus: 'x', tags: ['a', 'a', ''], origin: 'llm' });
      assert.deepEqual(Object.keys(zh).sort(), ['name', 'origin', 'summary', 'tags']);
      assert.deepEqual(zh.tags, ['a']);
    });

    // ---- 3.5 同名候选遮蔽 / 分层健康（T11）
    await test('insertCandidate：rank 小者胜，同名 loser 按 name 合并进 shadowed', () => {
      const map = new Map();
      const shadowed = [];
      const project = makeScanCandidate('shadow-demo', {
        kind: 'project-agents',
        rank: 200,
        path: '/project/shadow-demo/SKILL.md',
      });
      const user = makeScanCandidate('shadow-demo', {
        kind: 'user-agents',
        rank: 500,
        path: '/user/shadow-demo/SKILL.md',
      });
      insertCandidate(map, project, shadowed);
      assert.equal(shadowed.length, 0, '只有一个候选时不算遮蔽');
      insertCandidate(map, user, shadowed);
      assert.equal(map.get('shadow-demo').kind, 'project-agents');
      assert.deepEqual(shadowed, [
        {
          name: 'shadow-demo',
          winner: { kind: 'project-agents', path: '/project/shadow-demo/SKILL.md' },
          losers: [{ kind: 'user-agents', path: '/user/shadow-demo/SKILL.md' }],
        },
      ]);

      // 更小 rank 反转 winner，旧 winner 追加进 losers。
      const projectDsh = makeScanCandidate('shadow-demo', {
        kind: 'project-dsh',
        rank: 100,
        path: '/project/.dsh/skills/shadow-demo/SKILL.md',
      });
      insertCandidate(map, projectDsh, shadowed);
      assert.equal(map.get('shadow-demo').kind, 'project-dsh');
      assert.deepEqual(shadowed[0].winner, {
        kind: 'project-dsh',
        path: '/project/.dsh/skills/shadow-demo/SKILL.md',
      });
      assert.deepEqual(
        shadowed[0].losers.map((loser) => loser.kind).sort(),
        ['project-agents', 'user-agents'],
      );

      // 同 rank 保留已有，新候选进 losers。
      const sameRank = makeScanCandidate('shadow-demo', { kind: 'runtime', rank: 100, path: '/runtime/shadow-demo' });
      insertCandidate(map, sameRank, shadowed);
      assert.equal(map.get('shadow-demo').kind, 'project-dsh');
      assert.deepEqual(
        shadowed[0].losers.map((loser) => loser.kind).sort(),
        ['project-agents', 'runtime', 'user-agents'],
      );

      // 同一路径被重复扫描不算遮蔽，不产生 winner=loser 的假记录。
      const duplicatePath = makeScanCandidate('duplicate-path-demo', {
        kind: 'project-dsh',
        rank: 100,
        path: '/project/.dsh/skills/duplicate-path-demo/SKILL.md',
      });
      const duplicateMap = new Map();
      const duplicateShadowed = [];
      insertCandidate(duplicateMap, duplicatePath, duplicateShadowed);
      insertCandidate(duplicateMap, duplicatePath, duplicateShadowed);
      assert.equal(duplicateMap.get('duplicate-path-demo').kind, 'project-dsh');
      assert.equal(
        duplicateShadowed.find((record) => record.name === 'duplicate-path-demo'),
        undefined,
        '同路径重复扫描不应生成遮蔽记录',
      );
    });

    await test('buildSkillViews：内置层 unverifiable 但整技能 fresh，active 只在生效层', () => {
      const candidate = makeScanCandidate('builtin-demo', { kind: 'user-agents', rank: 500 });
      const stores = {
        projectStore: { entries: {} },
        userStore: { entries: {} },
        builtin: {
          ...EMPTY_PACK,
          entries: {
            'builtin-demo': {
              zh: { name: '内置演示', summary: '内置层没有 hash', origin: 'builtin', review: 'reviewed' },
            },
          },
        },
      };
      const [view] = buildSkillViews([candidate], stores);
      assert.equal(view.status, 'fresh', '内置层无 hash 不应把整技能判 stale');
      assert.deepEqual(view.layers, [
        {
          source: 'builtin',
          origin: 'builtin',
          review: 'reviewed',
          reviewedBy: 'builtin',
          updatedAt: null,
          status: 'unverifiable',
          active: true,
        },
      ]);
      assert.equal('health' in view, false, 'health 是扫描级结果，不塞进单条技能');
    });

    await test('buildSkillViews：用户层 hash 过期 → 该层 stale，active 只在最高层', () => {
      const winner = makeScanCandidate('layer-demo', {
        kind: 'project-agents',
        rank: 200,
        path: '/project/layer-demo/SKILL.md',
        hash: { frontmatter: 'fm-project', body: 'body-project' },
      });
      // 被项目层遮蔽的用户层候选：应靠自己的 bound.path 找到，而不是拿生效层 hash 去比。
      const shadowedUser = makeScanCandidate('layer-demo', {
        kind: 'user-agents',
        rank: 500,
        path: '/user/layer-demo/SKILL.md',
        hash: { frontmatter: 'fm-user-layer', body: 'body-user-layer' },
      });
      const userOnly = makeScanCandidate('user-stale-demo', { kind: 'user-agents', rank: 500 });
      const stores = {
        projectStore: {
          entries: {
            'layer-demo': {
              zh: { name: '项目层', summary: '项目中文', origin: 'manual', review: 'reviewed' },
              bound: { kind: 'project-agents', rank: 200, path: '/project/layer-demo/SKILL.md' },
              hash: { frontmatter: 'fm-project', body: 'body-project' },
              reviewedBy: 'human',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        },
        userStore: {
          entries: {
            'user-stale-demo': {
              zh: { name: '用户层', summary: '用户中文', origin: 'manual', review: 'reviewed' },
              bound: { kind: 'user-agents', rank: 500, path: '/user/user-stale-demo/SKILL.md' },
              hash: { frontmatter: 'fm-old', body: 'body-old' },
              updatedAt: '2026-01-02T00:00:00.000Z',
            },
            'layer-demo': {
              zh: { name: '用户层（被项目层覆盖）', summary: '用户层中文', origin: 'manual', review: 'reviewed' },
              bound: { kind: 'user-agents', rank: 500, path: '/user/layer-demo/SKILL.md' },
              hash: { frontmatter: 'fm-user-layer', body: 'body-user-layer' },
              updatedAt: null,
            },
          },
        },
        builtin: {
          ...EMPTY_PACK,
          entries: { 'user-stale-demo': { zh: { name: '内置层', origin: 'builtin', review: 'reviewed' } } },
        },
      };
      const views = buildSkillViews([winner, userOnly], stores, [winner, userOnly, shadowedUser]);
      const layered = views.find((view) => view.name === 'layer-demo');
      assert.deepEqual(layered.layers.map((layer) => layer.source), ['project', 'user']);
      assert.deepEqual(layered.layers.map((layer) => layer.active), [true, false]);
      assert.equal(layered.layers[0].status, 'fresh');
      assert.equal(layered.layers[1].status, 'fresh', '下层按自己的 bound.path 比对，不拿生效层 hash');
      assert.equal(layered.layers[0].reviewedBy, 'human');
      assert.equal(layered.layers[1].reviewedBy, 'unknown');
      assert.equal(layered.layers[0].updatedAt, '2026-01-01T00:00:00.000Z');
      assert.equal(layered.layers[1].updatedAt, null);
      assert.equal(layered.status, 'fresh');

      const stale = views.find((view) => view.name === 'user-stale-demo');
      assert.deepEqual(stale.layers.map((layer) => layer.source), ['user', 'builtin']);
      assert.deepEqual(stale.layers.map((layer) => layer.active), [true, false]);
      assert.equal(stale.layers[0].status, 'stale');
      assert.equal(stale.layers[1].status, 'unverifiable');
      assert.equal(stale.layers[1].reviewedBy, 'builtin');
      assert.equal(stale.status, 'stale');
    });

    await test('buildSkillViews：reviewedBy 合法值直用，旧 reviewed 记 unknown，draft 记 null', () => {
      const entries = {};
      const candidates = [];
      const cases = [
        ['human-reviewed', 'human', 'human'],
        ['assistant-reviewed', 'assistant', 'assistant'],
        ['import-reviewed', 'import', 'import'],
        ['legacy-reviewed', undefined, 'unknown'],
        ['draft-demo', undefined, null],
        ['bogus-reviewed', 'robot', 'unknown'],
      ];
      for (const [name, reviewedBy, expected] of cases) {
        const zh = {
          name: `${name} 中文`,
          origin: 'manual',
          review: name === 'draft-demo' ? 'draft' : 'reviewed',
        };
        entries[name] = { zh, hash: { frontmatter: `fm-${name}` } };
        if (reviewedBy !== undefined) entries[name].reviewedBy = reviewedBy;
        candidates.push(makeScanCandidate(name));
      }
      const stores = { projectStore: { entries: {} }, userStore: { entries }, builtin: EMPTY_PACK };
      const views = buildSkillViews(candidates, stores);
      for (const [name, , expected] of cases) {
        const view = views.find((item) => item.name === name);
        assert.equal(view.layers[0].reviewedBy, expected, `${name} reviewedBy 应为 ${expected}`);
      }
    });

    await test('buildSkillViews：旧索引缺 bound/hash 与空 stores 不崩', () => {
      const legacy = makeScanCandidate('legacy-demo');
      const noHash = makeScanCandidate('legacy-nohash-demo');
      const stores = {
        projectStore: { entries: {} },
        userStore: {
          entries: {
            // 旧索引没有 bound：退回同名候选，hash 不一致仍能判 stale。
            'legacy-demo': {
              zh: { name: '旧条目', summary: '没有 bound', origin: 'manual', review: 'reviewed' },
              hash: { frontmatter: 'deadbeef' },
            },
            // 连 hash 都没有：该层 unverifiable，但整技能不受影响。
            'legacy-nohash-demo': {
              zh: { name: '无 hash 条目', summary: '旧索引', origin: 'manual', review: 'reviewed' },
            },
          },
        },
        builtin: EMPTY_PACK,
      };
      const views = buildSkillViews([legacy, noHash], stores);
      const legacyView = views.find((view) => view.name === 'legacy-demo');
      assert.equal(legacyView.layers[0].status, 'stale', '无 bound 时按同名候选回退');
      assert.equal(legacyView.status, 'stale');
      const noHashView = views.find((view) => view.name === 'legacy-nohash-demo');
      assert.equal(noHashView.layers[0].status, 'unverifiable');
      assert.equal(noHashView.status, 'fresh');

      const bare = makeScanCandidate('bare-demo', { hash: undefined });
      const [bareView] = buildSkillViews([bare], undefined, [bare]);
      assert.deepEqual(bareView.layers, []);
      assert.equal(bareView.status, 'untranslated');
    });

    // ---- 4. 真实技能目录扫描（文件系统兜底 + name 归并）
    // 期望值从磁盘现算，不写死技能名：本机技能集是用户态数据，装一个卸一个都会变。
    // 写死名字会让「插件没坏、只是技能集变了」也变红——假红灯和假绿灯一样有害。
    const expectedNames = realSkillNames();
    const expectedCount = expectedNames.length;
    await test('真实技能目录扫描（registry 不可用时文件系统兜底）', async () => {
      if (SKIP_REAL_AGENTS_SCAN) {
        console.log('SKIP  真实技能目录扫描（SKIP_REAL_AGENTS_SCAN=1）');
        return;
      }
      assert.ok(expectedCount > 0, `技能目录不存在：${REAL_AGENTS_SKILLS}`);
      const ctx = { skills: { list: async () => { throw new Error('no registry'); } } };
      const result = await scanSkills(ctx, { cwd: null, ...EMPTY_STORES });
      assert.equal(result.skills.length, expectedCount);
      assert.equal(result.coverage.total, expectedCount);
      assert.equal(result.coverage.untranslated, expectedCount);
      const scanned = new Set(result.skills.map((skill) => skill.name));
      for (const name of expectedNames) {
        assert.ok(scanned.has(name), `漏扫技能：${name}`);
      }
      const sample = result.skills[0];
      assert.ok(sample);
      assert.equal(sample.source.kind, 'user-agents');
      assert.equal(sample.source.rank, 500);
      assert.equal(sample.status, 'untranslated');
      assert.ok(typeof sample.hash.frontmatter === 'string' && sample.hash.frontmatter.length === 64);
      assert.ok(typeof sample.hash.body === 'string' && sample.hash.body.length === 64);
      assert.ok(sample.bodyPreview.length > 0 && !sample.bodyPreview.startsWith('---'));
    });

    await test('registry 补充 runtime 技能（path 缺失仍列出）', async () => {
      const ctx = {
        skills: {
          list: async () => [
            { name: 'remote-skill', description: 'remote description', source: 'runtime', invocation: { modelInvocable: true } },
          ],
        },
      };
      const result = await scanSkills(ctx, { cwd: null, ...EMPTY_STORES });
      const remote = result.skills.find((skill) => skill.name === 'remote-skill');
      assert.ok(remote, 'runtime 技能应被列出');
      assert.equal(remote.path, null);
      assert.equal(remote.hash.body, null);
      assert.equal(remote.bodyPreview, '');
      assert.equal(remote.status, 'untranslated');
      assert.equal(result.skills.length, expectedCount + 1);
    });

    // ---- 4.5 scanSkills 级健康（T11）：孤儿条目 / 同名遮蔽 / 分层状态
    await test('scanSkills：health.orphanEntries 收录用户/项目层孤儿，coverage 总数不变', async () => {
      const projectDir = makeJobProject(tempHome, ['anchor-skill']);
      const agentsHomeDir = join(tempHome, 'scan-agents-orphan');
      mkdirSync(agentsHomeDir, { recursive: true });
      const userStore = {
        ...defaultStore(),
        entries: {
          'ghost-user-skill': {
            zh: { name: '幽灵用户技能', summary: '磁盘上已不存在', origin: 'manual', review: 'reviewed' },
            updatedAt: '2026-01-03T00:00:00.000Z',
          },
        },
      };
      const projectStore = {
        categories: [],
        entries: {
          'ghost-project-skill': {
            zh: { name: '幽灵项目技能', summary: '磁盘上已不存在', origin: 'manual', review: 'draft' },
            updatedAt: '2026-01-04T00:00:00.000Z',
          },
        },
      };
      const result = await withIsolatedSkillRoots(agentsHomeDir, () =>
        scanSkills({}, { cwd: projectDir, userStore, projectStore, builtin: EMPTY_PACK }),
      );
      assert.equal(result.skills.length, 1, '只应扫到磁盘上的 anchor-skill');
      assert.equal(result.coverage.total, 1, '孤儿中文条目不应改变覆盖率总数');
      assert.deepEqual(result.health.orphanEntries, [
        {
          name: 'ghost-user-skill',
          layer: 'user',
          zhName: '幽灵用户技能',
          updatedAt: '2026-01-03T00:00:00.000Z',
        },
        {
          name: 'ghost-project-skill',
          layer: 'project',
          zhName: '幽灵项目技能',
          updatedAt: '2026-01-04T00:00:00.000Z',
        },
      ]);
      assert.deepEqual(result.health.shadowedSkills, []);
    });

    await test('scanSkills：project/user 同名遮蔽进入 health.shadowedSkills', async () => {
      const projectDir = makeJobProject(tempHome, []);
      const projectSkillDir = join(projectDir, '.agents', 'skills', 'shadow-scan-demo');
      mkdirSync(projectSkillDir, { recursive: true });
      writeFileSync(
        join(projectSkillDir, 'SKILL.md'),
        '---\nname: shadow-scan-demo\ndescription: project fixture\n---\nProject body.\n',
      );
      const agentsHomeDir = join(tempHome, 'scan-agents-shadow');
      const userSkillDir = join(agentsHomeDir, 'skills', 'shadow-scan-demo');
      mkdirSync(userSkillDir, { recursive: true });
      writeFileSync(
        join(userSkillDir, 'SKILL.md'),
        '---\nname: shadow-scan-demo\ndescription: user fixture\n---\nUser body.\n',
      );
      const result = await withIsolatedSkillRoots(agentsHomeDir, () =>
        scanSkills(
          {},
          {
            cwd: projectDir,
            userStore: defaultStore(),
            projectStore: { entries: {}, categories: [] },
            builtin: EMPTY_PACK,
          },
        ),
      );
      assert.equal(result.skills.length, 1);
      const [skill] = result.skills;
      assert.equal(skill.name, 'shadow-scan-demo');
      assert.equal(skill.path, join(projectSkillDir, 'SKILL.md'), 'project 候选 rank 更小应获胜');
      assert.equal(result.health.shadowedSkills.length, 1);
      assert.deepEqual(result.health.shadowedSkills[0], {
        name: 'shadow-scan-demo',
        winner: { kind: 'project-agents', path: join(projectSkillDir, 'SKILL.md') },
        losers: [{ kind: 'user-agents', path: join(userSkillDir, 'SKILL.md') }],
      });
    });

    await test('scanSkills：内置层 unverifiable 但整技能 fresh，health 只挂在顶层', async () => {
      const projectDir = makeJobProject(tempHome, ['builtin-scan-demo']);
      const builtin = {
        ...EMPTY_PACK,
        entries: {
          'builtin-scan-demo': {
            zh: { name: '内置扫描', summary: '内置包不带 hash', origin: 'builtin', review: 'reviewed' },
          },
        },
      };
      const agentsHomeDir = join(tempHome, 'scan-agents-builtin');
      mkdirSync(agentsHomeDir, { recursive: true });
      const result = await withIsolatedSkillRoots(agentsHomeDir, () =>
        scanSkills(
          {},
          {
            cwd: projectDir,
            userStore: defaultStore(),
            projectStore: { entries: {}, categories: [] },
            builtin,
          },
        ),
      );
      const [skill] = result.skills;
      assert.equal(skill.name, 'builtin-scan-demo');
      assert.equal(skill.status, 'fresh');
      assert.equal(skill.origin, 'builtin');
      assert.equal(skill.layers[0].status, 'unverifiable');
      assert.equal(skill.layers[0].reviewedBy, 'builtin');
      assert.equal(skill.layers[0].active, true);
      assert.equal('health' in skill, false);
      assert.ok(result.health, 'health 应挂在 scan 结果顶层');
      assert.equal(result.coverage.translated, 1);
    });

    await test('scanSkills：用户层 hash 过期仅该层 stale；旧索引无 bound 不崩', async () => {
      const projectDir = makeJobProject(tempHome, ['stale-scan-demo', 'legacy-scan-demo']);
      const stalePath = join(projectDir, '.agents', 'skills', 'stale-scan-demo', 'SKILL.md');
      const userStore = {
        ...defaultStore(),
        entries: {
          'stale-scan-demo': {
            zh: { name: '过期扫描', summary: '用户层 hash 与磁盘不一致', origin: 'manual', review: 'reviewed' },
            bound: { kind: 'project-agents', rank: 200, path: stalePath },
            hash: { frontmatter: 'deadbeef' },
            updatedAt: '2026-01-05T00:00:00.000Z',
          },
          'legacy-scan-demo': {
            zh: { name: '旧索引扫描', summary: '没有 bound 与 hash', origin: 'manual', review: 'reviewed' },
          },
        },
      };
      const builtin = {
        ...EMPTY_PACK,
        entries: { 'stale-scan-demo': { zh: { name: '内置过期', origin: 'builtin', review: 'reviewed' } } },
      };
      const agentsHomeDir = join(tempHome, 'scan-agents-stale');
      mkdirSync(agentsHomeDir, { recursive: true });
      const result = await withIsolatedSkillRoots(agentsHomeDir, () =>
        scanSkills(
          {},
          {
            cwd: projectDir,
            userStore,
            projectStore: { entries: {}, categories: [] },
            builtin,
          },
        ),
      );
      const stale = result.skills.find((skill) => skill.name === 'stale-scan-demo');
      assert.deepEqual(stale.layers.map((layer) => layer.source), ['user', 'builtin']);
      assert.deepEqual(stale.layers.map((layer) => layer.active), [true, false]);
      assert.equal(stale.layers[0].status, 'stale');
      assert.equal(stale.layers[1].status, 'unverifiable');
      assert.equal(stale.status, 'stale');

      const legacy = result.skills.find((skill) => skill.name === 'legacy-scan-demo');
      assert.equal(legacy.layers.length, 1);
      assert.equal(legacy.layers[0].status, 'unverifiable');
      assert.equal(legacy.status, 'fresh');
      assert.deepEqual(result.health.orphanEntries, []);
    });

    // ---- 5. 项目级 store
    await test('loadProjectStore 读取 <project>/.dsh/skill-cn/zh-index.json', () => {
      const projectDir = join(tempHome, 'project');
      mkdirSync(join(projectDir, '.git'), { recursive: true });
      mkdirSync(join(projectDir, '.dsh', 'skill-cn'), { recursive: true });
      writeFileSync(
        join(projectDir, '.dsh', 'skill-cn', 'zh-index.json'),
        JSON.stringify({
          schemaVersion: 1,
          categories: [{ id: 'research', zh: '调研', order: 30 }],
          entries: {
            'agent-reach': {
              zh: { name: '智能体触达', summary: '触达多平台', origin: 'existing-zh', review: 'reviewed' },
              hash: { frontmatter: 'fm', body: 'body', at: 't' },
            },
          },
        }),
      );
      const loaded = loadProjectStore(projectDir);
      assert.equal(loaded.status, 'ok');
      assert.equal(loaded.root, projectDir);
      assert.equal(loaded.entries['agent-reach'].zh.name, '智能体触达');
      assert.equal(loaded.categories[0].zh, '调研');
    });

    // ---- 6. 用户 store 持久化 / 损坏备份
    await test('用户 store：缺失 → 写入 → 读回', async () => {
      const missing = loadUserStore();
      assert.equal(missing.status, 'missing');
      assert.equal(missing.store.settings.mode, 'decorate');
      const entry = await mutateUserStore((store) => {
        store.entries.demo = {
          zh: { name: '演示', summary: '简介', origin: 'manual', review: 'reviewed' },
          updatedAt: nowIso(),
        };
        return store.entries.demo;
      });
      assert.equal(entry.zh.name, '演示');
      const loaded = loadUserStore();
      assert.equal(loaded.status, 'ok');
      assert.equal(loaded.store.entries.demo.zh.name, '演示');
      assert.equal(loaded.store.schemaVersion, 1);
      assert.ok(existsSync(userStorePath()));
    });

    await test('用户 store：损坏时降级 + 备份原文件（不静默覆盖）', async () => {
      writeFileSync(userStorePath(), '{ not valid json');
      const loaded = loadUserStore();
      assert.equal(loaded.status, 'invalid');
      await mutateUserStore((store) => {
        store.settings.mode = 'overlay';
      });
      const dir = dirname(userStorePath());
      const backups = readdirSync(dir).filter((name) => name.includes('.corrupt-'));
      assert.ok(backups.length >= 1, '应生成 .corrupt-*.bak 备份');
      const recovered = loadUserStore();
      assert.equal(recovered.status, 'ok');
      assert.equal(recovered.store.settings.mode, 'overlay');
      assert.deepEqual(recovered.store.entries, {});
    });

    await test('applySettingsPatch 合并设置', async () => {
      const settings = await mutateUserStore((store) => applySettingsPatch(store, { mode: 'decorate', pinyinSearch: false }));
      assert.equal(settings.mode, 'decorate');
      assert.equal(settings.pinyinSearch, false);
      assert.equal(settings.enabled, DEFAULT_SETTINGS.enabled);
    });

    // ---- 7. 内置包缺失降级
    await test('内置包缺失/损坏时降级为空层', () => {
      const pack = loadBuiltinPack();
      assert.ok(pack && typeof pack.entries === 'object' && Array.isArray(pack.categories));
      if (!existsSync(builtinPackPath())) {
        assert.equal(pack.version, null);
        assert.equal(pack.categories.length, 0);
        assert.deepEqual(pack.entries, {});
      }
    });

    // ---- 7.5 安装来源解析（纯函数，不发网络）
    await test('install-source: parseSkillMention 表格/列表/标题', () => {
      const table = ['| Skill | Description |', '| --- | --- |', '| `lark-im` | 发送/回复消息、群聊管理 |'].join('\n');
      assert.deepEqual(parseSkillMention(table, 'lark-im'), { summary: '发送/回复消息、群聊管理', lang: 'zh' });
      const list = ['1. **brainstorming** - 头脑风暴与方案发散', '- `oil-ui`: 界面设计技能'].join('\n');
      assert.deepEqual(parseSkillMention(list, 'brainstorming'), { summary: '头脑风暴与方案发散', lang: 'zh' });
      assert.deepEqual(parseSkillMention(list, 'oil-ui'), { summary: '界面设计技能', lang: 'zh' });
      const heading = ['## my-skill', '', '把任何东西变成中文简介。', '', '更多内容'].join('\n');
      assert.deepEqual(parseSkillMention(heading, 'my-skill'), { summary: '把任何东西变成中文简介。', lang: 'zh' });
      const english = '- `foo`: A tiny English summary.';
      assert.deepEqual(parseSkillMention(english, 'foo'), { summary: 'A tiny English summary.', lang: 'en' });
      assert.equal(parseSkillMention(english, 'bar'), null);
    });

    await test('install-source: parseGithubRepo / rawCandidates / hasChinese', () => {
      assert.deepEqual(parseGithubRepo('https://github.com/larksuite/cli.git'), { owner: 'larksuite', repo: 'cli' });
      assert.equal(parseGithubRepo('https://gitlab.com/a/b'), null);
      const urls = rawCandidates('https://github.com/obra/superpowers', 'skills/brainstorming/SKILL.md');
      assert.equal(urls[0].url, 'https://raw.githubusercontent.com/obra/superpowers/main/skills/brainstorming/README.zh.md');
      assert.ok(urls.some((item) => item.file === 'README.md'));
      assert.equal(new Set(urls.map((item) => item.url)).size, urls.length);
      assert.equal(hasChinese('中文'), true);
      assert.equal(hasChinese('english'), false);
    });

    await test('install-source: readSkillLock / sourceForSkill', () => {
      const dir = mkdtempSync(join(tmpdir(), 'dsh-skill-lock-'));
      writeFileSync(
        join(dir, '.skill-lock.json'),
        JSON.stringify({
          version: 3,
          skills: {
            'lark-im': {
              source: 'larksuite/cli',
              sourceType: 'github',
              sourceUrl: 'https://github.com/larksuite/cli',
              skillPath: 'skills/lark-im/SKILL.md',
            },
          },
        }),
        'utf8',
      );
      const lock = readSkillLock(dir);
      assert.ok(lock && lock['lark-im']);
      assert.equal(sourceForSkill(lock, 'lark-im').sourceUrl, 'https://github.com/larksuite/cli');
      assert.equal(sourceForSkill(lock, 'missing'), null);
      rmSync(dir, { recursive: true, force: true });
    });

    // ---- 8. HTTP 路由（fake req/res，真 handler）
    const fake = makeFakeContext();
    applyHostPlugin(fake.ctx);
    assert.equal(fake.registered.length, 17, '应注册 17 条路由');
    const routeMap = new Map(fake.registered.map((route) => [route.path, route]));
    const listRoute = routeMap.get('/api/dsh-skill-workbench/list');
    const statusRoute = routeMap.get('/api/dsh-skill-workbench/status');
    const saveRoute = routeMap.get('/api/dsh-skill-workbench/save');
    const deleteRoute = routeMap.get('/api/dsh-skill-workbench/delete');
    const importRoute = routeMap.get('/api/dsh-skill-workbench/import');
    const exportRoute = routeMap.get('/api/dsh-skill-workbench/export');
    const healthRoute = routeMap.get('/api/dsh-skill-workbench/health');
    const configRoute = routeMap.get('/api/dsh-skill-workbench/config');
    const translateRoute = routeMap.get('/api/dsh-skill-workbench/translate');
    const cancelRoute = routeMap.get('/api/dsh-skill-workbench/cancel');
    const diagRoute = routeMap.get('/api/dsh-skill-workbench/diag');
    const uninstallRoute = routeMap.get('/api/dsh-skill-workbench/uninstall');
    const trashRoute = routeMap.get('/api/dsh-skill-workbench/trash');
    const restoreRoute = routeMap.get('/api/dsh-skill-workbench/restore');
    const purgeRoute = routeMap.get('/api/dsh-skill-workbench/purge');
    const sourceBatchRoute = routeMap.get('/api/dsh-skill-workbench/source/batch');
    assert.ok(
      [
        listRoute,
        statusRoute,
        saveRoute,
        deleteRoute,
        importRoute,
        exportRoute,
        healthRoute,
        configRoute,
        translateRoute,
        cancelRoute,
        diagRoute,
        uninstallRoute,
        trashRoute,
        restoreRoute,
        purgeRoute,
        sourceBatchRoute,
      ].every(Boolean),
    );

    // 独立项目内的示例技能：不依赖 catalog 内置包进度，用于 save/delete/import/translate 路由测试
    const projectDir = join(tempHome, 'http-project');
    mkdirSync(join(projectDir, '.git'), { recursive: true });
    mkdirSync(join(projectDir, '.agents', 'skills', 'demo-skill'), { recursive: true });
    writeFileSync(
      join(projectDir, '.agents', 'skills', 'demo-skill', 'SKILL.md'),
      '---\nname: demo-skill\ndescription: Demo skill for selftest\nwhenToUse: testing the plugin\n---\nDemo body text.\n',
    );
    const listWithProject = `/api/dsh-skill-workbench/list?cwd=${encodeURIComponent(projectDir)}`;

    await test('HTTP：非 loopback 403，method 不符 405', async () => {
      const forbidden = await callRoute(listRoute, { remoteAddress: '8.8.8.8' });
      assert.equal(forbidden.status, 403);
      assert.deepEqual(forbidden.json, { ok: false, code: 'ERR_FORBIDDEN', message: '仅允许从本机回环地址访问' });
      const proxied = await callRoute(listRoute, { headers: { 'x-forwarded-for': '8.8.8.8' } });
      assert.equal(proxied.status, 403);
      const badMethod = await callRoute(listRoute, { method: 'POST' });
      assert.equal(badMethod.status, 405);
      assert.equal(badMethod.json.code, 'ERR_METHOD');
    });

    await test('HTTP：GET list 返回 SkillView/coverage', async () => {
      const { status, json } = await callRoute(listRoute, { url: listWithProject });
      assert.equal(status, 200);
      assert.equal(json.ok, true);
      assert.ok(json.skills.length >= expectedCount + 1, '应包含真实技能目录 + 项目内 demo-skill');
      assert.equal(json.coverage.total, json.skills.length);
      assert.ok(json.coverage.untranslated >= 1);
      assert.ok(json.health && Array.isArray(json.health.orphanEntries), '/list 应下发 health.orphanEntries');
      assert.ok(Array.isArray(json.health.shadowedSkills), '/list 应下发 health.shadowedSkills');
      assert.equal(typeof json.store.userPath, 'string');
      assert.ok(json.store.builtinVersion === null || typeof json.store.builtinVersion === 'string');
      assert.ok(Array.isArray(json.categories));

      const demo = json.skills.find((item) => item.name === 'demo-skill');
      assert.ok(demo, '项目内技能应被扫描到');
      assert.equal(demo.status, 'untranslated');
      assert.equal(demo.zh, null);
      assert.equal(demo.origin, null);
      assert.deepEqual(demo.source, { kind: 'project-agents', rank: 200 });
      assert.equal(demo.path, join(projectDir, '.agents', 'skills', 'demo-skill', 'SKILL.md'));

      if (realSkillsCount() > 0) {
        const realNames = realSkillNames();
        const picked = json.skills.find((item) => realNames.includes(item.name));
        assert.ok(picked, '真实技能目录里的技能应被扫描到');
        assert.ok(picked.path.startsWith(REAL_AGENTS_SKILLS) && picked.path.endsWith('SKILL.md'));
        assert.ok(typeof picked.hash.frontmatter === 'string');
        assert.equal(picked.source.kind, 'user-agents');
        assert.equal(picked.source.rank, 500);
      }
    });

    await test('HTTP：cwd 非绝对路径 400', async () => {
      const { status, json } = await callRoute(listRoute, { url: '/api/dsh-skill-workbench/list?cwd=relative/path' });
      assert.equal(status, 400);
      assert.equal(json.code, 'ERR_BAD_REQUEST');
    });

    await test('HTTP：save 写入条目并计算 fresh 状态', async () => {
      const { status, json } = await callRoute(saveRoute, {
        method: 'POST',
        body: {
          name: 'demo-skill',
          cwd: projectDir,
          zh: { name: '演示技能', summary: '用于插件自测的演示技能', category: 'tooling' },
          review: 'draft',
        },
      });
      assert.equal(status, 200);
      assert.equal(json.ok, true);
      assert.equal(json.entry.zh.name, '演示技能');
      assert.equal(json.entry.zh.origin, 'manual');
      assert.equal(json.entry.zh.review, 'draft');
      assert.equal(json.entry.bound.kind, 'project-agents');
      assert.equal(json.entry.bound.rank, 200);
      assert.ok(typeof json.entry.hash.body === 'string' && json.entry.hash.body.length === 64);
      const list = await callRoute(listRoute, { url: listWithProject });
      const skill = list.json.skills.find((item) => item.name === 'demo-skill');
      assert.equal(skill.status, 'fresh');
      assert.equal(skill.zh.name, '演示技能');
      assert.equal(skill.origin, 'user');
      assert.ok(list.json.coverage.draft >= 1);
      assert.ok(list.json.coverage.translated >= 1);
    });

    await test('HTTP：save 分类校验（未知回退 / 自定义保留 / 缺省与空串不覆盖）', async () => {
      const bad = await callRoute(saveRoute, {
        method: 'POST',
        body: { name: 'demo-skill', cwd: projectDir, zh: { name: '演示技能', category: 'no-such-category' } },
      });
      assert.equal(bad.status, 200);
      assert.equal(bad.json.entry.zh.category, 'uncategorized');

      // 项目层自定义分类（<project>/.dsh/skill-cn/zh-index.json）也算已知分类
      const projectStoreDir = join(projectDir, '.dsh', 'skill-cn');
      mkdirSync(projectStoreDir, { recursive: true });
      const projectStoreFile = join(projectStoreDir, 'zh-index.json');
      writeFileSync(projectStoreFile, JSON.stringify({ categories: [{ id: 'custom-x', zh: '自定义分类', order: 500 }] }));
      const custom = await callRoute(saveRoute, {
        method: 'POST',
        body: { name: 'demo-skill', cwd: projectDir, zh: { name: '演示技能', category: 'custom-x' } },
      });
      assert.equal(custom.status, 200);
      assert.equal(custom.json.entry.zh.category, 'custom-x');
      rmSync(projectStoreFile);

      // patch 不含 category、或 category 为空串，都不应覆盖已有分类
      const noCategory = await callRoute(saveRoute, {
        method: 'POST',
        body: { name: 'demo-skill', cwd: projectDir, zh: { name: '演示技能' } },
      });
      assert.equal(noCategory.status, 200);
      assert.equal(noCategory.json.entry.zh.category, 'custom-x');
      const emptyCategory = await callRoute(saveRoute, {
        method: 'POST',
        body: { name: 'demo-skill', cwd: projectDir, zh: { name: '演示技能', category: '' } },
      });
      assert.equal(emptyCategory.status, 200);
      assert.equal(emptyCategory.json.entry.zh.category, 'custom-x');

      // 合法内置分类写回，恢复后续用例依赖的初始状态
      const restored = await callRoute(saveRoute, {
        method: 'POST',
        body: { name: 'demo-skill', cwd: projectDir, zh: { name: '演示技能', category: 'tooling' } },
      });
      assert.equal(restored.status, 200);
      assert.equal(restored.json.entry.zh.category, 'tooling');
      assert.equal(restored.json.entry.zh.name, '演示技能');
    });

    await test('HTTP：空中文保存 400 ERR_EMPTY_ZH（不污染覆盖率）', async () => {
      mkdirSync(join(projectDir, '.agents', 'skills', 'blank-skill'), { recursive: true });
      writeFileSync(
        join(projectDir, '.agents', 'skills', 'blank-skill', 'SKILL.md'),
        '---\nname: blank-skill\ndescription: Blank skill for empty-zh test\n---\nBody.\n',
      );
      const rejected = await callRoute(saveRoute, {
        method: 'POST',
        body: { name: 'blank-skill', cwd: projectDir, zh: { category: 'tooling' } },
      });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.json.code, 'ERR_EMPTY_ZH');
      const list = await callRoute(listRoute, { url: listWithProject });
      assert.equal(list.json.skills.find((item) => item.name === 'blank-skill').status, 'untranslated');
      const accepted = await callRoute(saveRoute, {
        method: 'POST',
        body: { name: 'blank-skill', cwd: projectDir, zh: { name: '空白技能' } },
      });
      assert.equal(accepted.status, 200);
      assert.equal(accepted.json.entry.zh.name, '空白技能');
    });

    await test('HTTP：空 zh + review 只更新审核状态，无用户层时拒绝', async () => {
      const toDraft = await callRoute(saveRoute, {
        method: 'POST',
        body: { name: 'blank-skill', cwd: projectDir, review: 'draft', zh: { name: '空白技能' } },
      });
      assert.equal(toDraft.status, 200);
      assert.equal(toDraft.json.entry.zh.review, 'draft');
      const confirmed = await callRoute(saveRoute, {
        method: 'POST',
        body: { name: 'blank-skill', cwd: projectDir, review: 'reviewed', zh: {} },
      });
      assert.equal(confirmed.status, 200, JSON.stringify(confirmed.json));
      assert.equal(confirmed.json.entry.zh.review, 'reviewed');
      assert.equal(confirmed.json.entry.zh.name, '空白技能');
      // 用户层没有中文内容时，只带 review 的空保存不能创建空条目。
      mkdirSync(join(projectDir, '.agents', 'skills', 'review-only'), { recursive: true });
      writeFileSync(
        join(projectDir, '.agents', 'skills', 'review-only', 'SKILL.md'),
        '---\nname: review-only\ndescription: Review only test\n---\nBody.\n',
      );
      const withoutLayer = await callRoute(saveRoute, {
        method: 'POST',
        body: { name: 'review-only', cwd: projectDir, review: 'reviewed', zh: {} },
      });
      assert.equal(withoutLayer.status, 400);
      assert.equal(withoutLayer.json.code, 'ERR_BAD_REQUEST');
      const withoutReview = await callRoute(saveRoute, {
        method: 'POST',
        body: { name: 'blank-skill', cwd: projectDir, zh: {} },
      });
      assert.equal(withoutReview.status, 400);
    });

    await test('HTTP：未知技能 save 404', async () => {
      const { status, json } = await callRoute(saveRoute, {
        method: 'POST',
        body: { name: 'no-such-skill', zh: { name: '不存在' } },
      });
      assert.equal(status, 404);
      assert.equal(json.code, 'ERR_NOT_FOUND');
    });

    await test('HTTP：config 合并设置', async () => {
      const { status, json } = await callRoute(configRoute, {
        method: 'POST',
        body: { settings: { mode: 'off', pinyinSearch: false } },
      });
      assert.equal(status, 200);
      assert.equal(json.settings.mode, 'off');
      assert.equal(json.settings.pinyinSearch, false);
      assert.equal(json.settings.enabled, true);
      const list = await callRoute(listRoute);
      assert.equal(list.json.settings.mode, 'off');
    });

    await test('HTTP：import 预览（fill 策略与 manual 冲突）', async () => {
      const pack = {
        schemaVersion: 1,
        version: '1.0.0',
        lang: 'zh-CN',
        categories: [],
        entries: {
          'demo-skill': { zh: { name: '导入演示', summary: '导入简介', origin: 'builtin', review: 'reviewed' } },
          'no-such-skill': { zh: { name: '不存在', summary: 'x' } },
        },
      };
      const preview = await callRoute(importRoute, {
        method: 'POST',
        body: { pack, strategy: 'fill', apply: false, cwd: projectDir },
      });
      assert.equal(preview.status, 200);
      assert.deepEqual(preview.json.preview, { added: 0, updated: 0, skipped: 1, conflict: 1, stale: 0 });
      assert.equal(preview.json.applied, false);
    });

    await test('HTTP：delete 后 import apply 可写入条目', async () => {
      const removed = await callRoute(deleteRoute, { method: 'POST', body: { name: 'demo-skill' } });
      assert.equal(removed.status, 200);
      assert.equal(removed.json.deleted, true);
      const listAfterDelete = await callRoute(listRoute, { url: listWithProject });
      assert.equal(listAfterDelete.json.skills.find((item) => item.name === 'demo-skill').status, 'untranslated');

      const pack = {
        schemaVersion: 1,
        version: '1.0.0',
        lang: 'zh-CN',
        categories: [],
        entries: {
          'demo-skill': { zh: { name: '演示技能', summary: '导入的演示技能', origin: 'builtin', review: 'reviewed' } },
          'no-such-skill': { zh: { name: '不存在', summary: 'x' } },
        },
      };
      const preview = await callRoute(importRoute, {
        method: 'POST',
        body: { pack, strategy: 'fill', apply: false, cwd: projectDir },
      });
      assert.deepEqual(preview.json.preview, { added: 1, updated: 0, skipped: 1, conflict: 0, stale: 0 });
      const applied = await callRoute(importRoute, {
        method: 'POST',
        body: { pack, strategy: 'fill', apply: true, cwd: projectDir },
      });
      assert.equal(applied.json.applied, true);
      const list = await callRoute(listRoute, { url: listWithProject });
      const skill = list.json.skills.find((item) => item.name === 'demo-skill');
      assert.equal(skill.zh.name, '演示技能');
      assert.equal(skill.origin, 'user');
    });

    await test('HTTP：export 返回裸 BuiltinPack', async () => {
      const { status, json } = await callRoute(exportRoute);
      assert.equal(status, 200);
      assert.equal(json.ok, undefined, 'export 不套 ok');
      assert.equal(json.schemaVersion, 1);
      assert.equal(json.lang, 'zh-CN');
      assert.ok(json.entries && typeof json.entries === 'object');
      const builtin = loadBuiltinPack();
      if (builtin.version) {
        assert.ok(json.entries['agent-reach'], '内置包已就绪时应导出 agent-reach');
        assert.equal(typeof json.entries['agent-reach'].zh.name, 'string');
      }
      const translated = await callRoute(exportRoute, { url: '/api/dsh-skill-workbench/export?scope=translated' });
      assert.equal(translated.status, 200);
      assert.equal(translated.json.schemaVersion, 1);
    });

    await test('HTTP：status 返回版本/settings/jobs/diagnostics', async () => {
      const { status, json } = await callRoute(statusRoute);
      assert.equal(status, 200);
      assert.match(json.version, /^\d+\.\d+\.\d+/);
      assert.equal(json.settings.mode, 'off');
      assert.ok(Array.isArray(json.jobs));
      assert.ok(json.diagnostics && typeof json.diagnostics === 'object');
    });

    await test('HTTP：diag 写入最后一次客户端诊断', async () => {
      const posted = await callRoute(diagRoute, {
        method: 'POST',
        body: { mode: 'decorate', decorated: true, rows: 12, error: null },
      });
      assert.equal(posted.status, 200);
      assert.deepEqual(posted.json, { ok: true });
      const status = await callRoute(statusRoute);
      assert.equal(status.json.diagnostics.lastClientDecorate.rows, 12);
      assert.equal(status.json.diagnostics.lastClientDecorate.decorated, true);
      assert.equal(status.json.diagnostics.lastClientDecorate.error, null);
      const bad = await callRoute(diagRoute, { method: 'POST', body: { mode: 'x', decorated: 'yes', rows: 1 } });
      assert.equal(bad.status, 400);
    });

    await test('HTTP：translate 无 llm 时 job 失败 ERR_NO_LLM（不 crash）', async () => {
      const started = await callRoute(translateRoute, {
        method: 'POST',
        body: { scope: 'selected', names: ['demo-skill'], cwd: projectDir },
      });
      assert.equal(started.status, 200);
      assert.equal(started.json.ok, true);
      assert.ok(started.json.jobId);
      assert.equal(started.json.total, 1);
      const status = await callRoute(statusRoute);
      const job = status.json.jobs.find((item) => item.id === started.json.jobId);
      assert.ok(job);
      assert.equal(job.state, 'failed');
      assert.equal(job.error.code, 'ERR_NO_LLM');
      assert.equal(job.kind, 'translate');

      const unknown = await callRoute(cancelRoute, { method: 'POST', body: { jobId: 'job_nope' } });
      assert.equal(unknown.status, 404);
      const cancelled = await callRoute(cancelRoute, { method: 'POST', body: { jobId: started.json.jobId } });
      assert.equal(cancelled.status, 200);
      assert.equal(cancelled.json.cancelled, false);
    });

    await test('HTTP：bad JSON / 超大 body 错误码', async () => {
      const bad = await callRoute(saveRoute, { method: 'POST', body: '{bad json' });
      assert.equal(bad.status, 400);
      assert.equal(bad.json.code, 'ERR_BAD_REQUEST');
      const badBody = new EventEmitter();
      badBody.headers = { host: '127.0.0.1:61751' };
      badBody.socket = { remoteAddress: '127.0.0.1' };
      badBody.destroyedFlag = false;
      badBody.resumed = false;
      badBody.destroy = () => {
        badBody.destroyedFlag = true;
      };
      badBody.resume = () => {
        badBody.resumed = true;
      };
      setImmediate(() => badBody.emit('data', Buffer.alloc(1024 * 1024 + 1)));
      const tooLarge = await readJsonBody(badBody);
      assert.deepEqual(tooLarge, { ok: false, reason: 'too-large' });
      // R17：不能再 destroy——断开会话会让客户端收到 ECONNRESET 而不是 413 JSON。
      // 正确行为是停止累积并 drain，让 413 响应能写出去。
      assert.equal(badBody.destroyedFlag, false);
      assert.equal(badBody.resumed, true);
    });

    await test('translate 并发上限：第 3 个并发任务被拒（ERR_BUSY）', async () => {
      const isolated = createJobManager({ get: () => null }, {});
      try {
        // 不 await：让两个任务停在「已占位、尚未结束」的状态上。
        const first = isolated.start({ scope: 'selected', names: [], cwd: projectDir });
        const second = isolated.start({ scope: 'selected', names: [], cwd: projectDir });
        const third = await isolated.start({ scope: 'selected', names: [], cwd: projectDir }).then(
          () => 'started',
          (error) => (error && error.code) || 'unknown',
        );
        assert.equal(third, 'ERR_BUSY');
        await Promise.all([first, second]);
      } finally {
        isolated.dispose();
      }
    });

    await test('translate 并发上限：路由映射为 429 而不是 500', async () => {
      const busyJobs = {
        start: async () => {
          throw { code: 'ERR_BUSY', message: '已有 2 个翻译任务在运行' };
        },
        cancel: () => false,
        get: () => null,
        snapshot: () => [],
        dispose: () => {},
      };
      const failingJobs = {
        ...busyJobs,
        start: async () => {
          throw new Error('内部细节：/Users/someone/secret 不该出现在响应里');
        },
      };
      const baseCtx = { skills: { list: async () => [] }, workingDirectory: { get: () => null }, get: () => null };
      const busyRoutes = makeRoutes(baseCtx, { jobs: busyJobs });
      const failingRoutes = makeRoutes(baseCtx, { jobs: failingJobs });
      const body = { scope: 'all', cwd: projectDir };
      const busy = await callRoute(busyRoutes.find((route) => route.path.endsWith('/translate')), {
        method: 'POST',
        body,
      });
      assert.equal(busy.status, 429);
      assert.equal(busy.json.code, 'ERR_BUSY');
      const failing = await callRoute(failingRoutes.find((route) => route.path.endsWith('/translate')), {
        method: 'POST',
        body,
      });
      assert.equal(failing.status, 500);
      assert.equal(failing.json.code, 'ERR_TRANSLATE');
      assert.equal(String(failing.json.message).includes('secret'), false);
    });

    await test('translate 输出上限：超长 chunk 让任务失败且不写盘', async () => {
      const hugeCtx = {
        skills: {
          list: async () => {
            throw new Error('registry unavailable in selftest');
          },
        },
        workingDirectory: { get: () => null },
        get: (name) =>
          name === 'llm'
            ? {
                stream: async function* () {
                  // 一个 chunk 就超过 MAX_OUTPUT_CHARS，模拟 adapter 不守 maxTokens。
                  yield { type: 'text-delta', text: 'x'.repeat(25_000) };
                  yield { type: 'finish', reason: { kind: 'stop' } };
                },
              }
            : null,
      };
      const before = JSON.stringify(loadUserStore().store.entries);
      const guarded = createJobManager(hugeCtx, {});
      try {
        const started = await guarded.start({ scope: 'selected', names: ['demo-skill'], cwd: projectDir });
        let job = guarded.get(started.jobId);
        for (let attempt = 0; attempt < 50 && job && job.state === 'running'; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          job = guarded.get(started.jobId);
        }
        assert.ok(job, '任务应存在');
        assert.equal(job.state, 'failed');
        assert.equal(String(job.error && job.error.message).includes('字符上限'), true);
        assert.equal(JSON.stringify(loadUserStore().store.entries), before, '失败任务不应写入任何条目');
      } finally {
        guarded.dispose();
      }
    });

    await test('translate failures：部分失败 state=done 且 failures 有明细', async () => {
      const dir = makeJobProject(tempHome, ['job-ok', 'job-bad']);
      const context = makeJobContext((params) =>
        skillNameFromParams(params) === 'job-bad' ? failingStream('ERR_NO_FINISH', 'LLM 流未返回 finish') : successStream(),
      );
      const manager = createJobManager(context, {});
      try {
        const started = await manager.start({ scope: 'selected', names: ['job-ok', 'job-bad'], cwd: dir });
        assert.equal(started.total, 2);
        const job = await waitForJobEnd(manager, started.jobId);
        assert.equal(job.state, 'done');
        assert.equal(job.done, 1);
        assert.equal(job.failed, 1);
        assert.equal(job.failuresTruncated, false);
        assert.deepEqual(job.failures, [
          { name: 'job-bad', code: 'ERR_NO_FINISH', message: '返回格式不符合要求' },
        ]);
        // 公开 Job 不携带 target、prompt、模型输出或绝对路径。
        assert.equal('target' in job, false);
        assert.equal('prompt' in job, false);
        assert.equal(/\/Users\/|\/home\/|[A-Za-z]:\\/.test(JSON.stringify(job)), false);
      } finally {
        manager.dispose();
      }
    });

    await test('translate failures：51 条失败保留计数并截断到 50 条', async () => {
      const names = Array.from({ length: 51 }, (_, index) => `job-trunc-${String(index).padStart(2, '0')}`);
      const dir = makeJobProject(tempHome, names);
      const context = makeJobContext(() => failingStream('ERR_BAD_JSON', '模型输出不是合法 JSON'));
      const manager = createJobManager(context, {});
      try {
        const started = await manager.start({ scope: 'selected', names, cwd: dir });
        assert.equal(started.total, 51);
        const job = await waitForJobEnd(manager, started.jobId);
        assert.equal(job.state, 'failed');
        assert.equal(job.done, 0);
        assert.equal(job.failed, 51);
        assert.equal(job.failures.length, 50);
        assert.equal(job.failuresTruncated, true);
        assert.equal(new Set(job.failures.map((failure) => failure.name)).size, 50);
        assert.ok(job.failures.every((failure) => failure.code === 'ERR_BAD_JSON'));
        assert.ok(job.failures.every((failure) => failure.message === '返回格式不符合要求'));
        assert.ok(job.error && typeof job.error.message === 'string' && job.error.message !== '');
      } finally {
        manager.dispose();
      }
    });

    await test('translate failures：公开明细脱敏绝对路径并截断到 160 字符', async () => {
      const dir = makeJobProject(tempHome, ['job-path']);
      const unixPath = '/Users/alice/private/secret/SKILL.md';
      const windowsPath = 'C:\\Users\\bob\\private\\secret.md';
      const context = makeJobContext(() =>
        failingStream('ERR_STREAM', `读取 ${unixPath} 与 ${windowsPath} 失败 ${'x'.repeat(300)}`),
      );
      const manager = createJobManager(context, {});
      try {
        const started = await manager.start({ scope: 'selected', names: ['job-path'], cwd: dir });
        const job = await waitForJobEnd(manager, started.jobId);
        assert.equal(job.state, 'failed');
        assert.equal(job.failures.length, 1);
        const detail = job.failures[0];
        assert.equal(detail.name, 'job-path');
        assert.equal(detail.code, 'ERR_STREAM');
        assert.equal(detail.message.includes('/Users/'), false);
        assert.equal(detail.message.includes('C:\\'), false);
        assert.ok(detail.message.includes('<路径>'));
        assert.ok(Array.from(detail.message).length <= 160);
        assert.equal(JSON.stringify(job).includes(unixPath), false);
        assert.equal(JSON.stringify(job).includes('alice'), false);
      } finally {
        manager.dispose();
      }
    });

    await test('translate failures：全部失败 state=failed，error 给总原因', async () => {
      const dir = makeJobProject(tempHome, ['job-all-a', 'job-all-b']);
      const context = makeJobContext(() => failingStream('AUTH', 'credential rejected'));
      const manager = createJobManager(context, {});
      try {
        const started = await manager.start({
          scope: 'selected',
          names: ['job-all-a', 'job-all-b'],
          cwd: dir,
        });
        const job = await waitForJobEnd(manager, started.jobId);
        assert.equal(job.state, 'failed');
        assert.equal(job.done, 0);
        assert.equal(job.failed, 2);
        assert.equal(job.failures.length, 2);
        assert.ok(job.failures.every((failure) => failure.message === '模型不可用'));
        assert.ok(job.error && job.error.code === 'ERR_NO_LLM');
        assert.ok(typeof job.error.message === 'string' && job.error.message.length > 0);
      } finally {
        manager.dispose();
      }
    });

    await test('translate failures：固定中文短原因覆盖写入/超时/兜底', async () => {
      const names = ['job-save', 'job-timeout', 'job-odd'];
      const dir = makeJobProject(tempHome, names);
      const context = makeJobContext((params) => {
        const name = skillNameFromParams(params);
        if (name === 'job-save') return failingStream('ERR_SAVE', 'ENOSPC: no space left on device');
        if (name === 'job-timeout') return failingStream('ERR_TIMEOUT', 'deadline exceeded');
        return failingStream('ERR_ODD', '');
      });
      const manager = createJobManager(context, {});
      try {
        const started = await manager.start({ scope: 'selected', names, cwd: dir });
        const job = await waitForJobEnd(manager, started.jobId);
        assert.equal(job.state, 'failed');
        assert.equal(job.failed, 3);
        const messages = Object.fromEntries(job.failures.map((failure) => [failure.name, failure.message]));
        assert.equal(messages['job-save'], '写入失败');
        assert.equal(messages['job-timeout'], '超时');
        assert.equal(messages['job-odd'], '翻译失败');
      } finally {
        manager.dispose();
      }
    });

    await test('translate failures：取消时未开始目标不进 failures，已完成保留', async () => {
      const names = ['job-cancel-a', 'job-cancel-b', 'job-cancel-c', 'job-cancel-d'];
      const dir = makeJobProject(tempHome, names);
      const context = makeJobContext((params) =>
        skillNameFromParams(params) === 'job-cancel-a' ? successStream() : blockingStream(params.signal),
      );
      const manager = createJobManager(context, {});
      try {
        const started = await manager.start({ scope: 'selected', names, cwd: dir });
        let job = manager.get(started.jobId);
        for (let attempt = 0; attempt < 300 && job && job.state === 'running' && job.done === 0; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          job = manager.get(started.jobId);
        }
        assert.ok(job, '任务应存在');
        assert.equal(job.done, 1, '取消前应已完成 1 个目标');
        assert.equal(manager.cancel(started.jobId), true);
        // 让两个在途 worker 收到 abort 后收尾，避免把取消误记为失败。
        await new Promise((resolve) => setTimeout(resolve, 30));
        job = manager.get(started.jobId);
        assert.equal(job.state, 'cancelled');
        assert.equal(job.total, 4);
        assert.equal(job.done, 1);
        assert.equal(job.failed, 0);
        assert.equal(job.failures.length, 0);
        assert.equal(job.failuresTruncated, false);
      } finally {
        manager.dispose();
      }
    });

    await test('HTTP health / loopback 判定', async () => {
      const health = await callRoute(healthRoute);
      assert.equal(health.status, 200);
      assert.equal(health.json.ok, true);
      assert.match(health.json.version, /^\d+\.\d+\.\d+/);
      const accept = {
        socket: { remoteAddress: '::1' },
        headers: { host: 'localhost:61751' },
      };
      assert.equal(isLoopbackRequest(accept), true);
      const cf = { socket: { remoteAddress: '127.0.0.1' }, headers: { host: '127.0.0.1:1', 'cf-connecting-ip': '1.2.3.4' } };
      assert.equal(isLoopbackRequest(cf), false);
      const crossSite = {
        socket: { remoteAddress: '127.0.0.1' },
        headers: { host: '127.0.0.1:1', 'sec-fetch-site': 'cross-site' },
      };
      assert.equal(isLoopbackRequest(crossSite), false);
      const crossOrigin = {
        socket: { remoteAddress: '127.0.0.1' },
        headers: { host: '127.0.0.1:1', origin: 'http://evil.example' },
      };
      assert.equal(isLoopbackRequest(crossOrigin), false);
    });

    await test('HTTP：uninstall 移到回收站 / restore / purge + 锁文件清理', async () => {
      const agentsDir = mkdtempSync(join(tmpdir(), 'dsh-agents-'));
      const skillsRoot = join(agentsDir, 'skills');
      const skillDir = join(skillsRoot, 'trash-demo');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(
        join(skillDir, 'SKILL.md'),
        '---\nname: trash-demo\ndescription: Demo skill for uninstall\n---\nDemo body.\n',
      );
      const lockPath = join(agentsDir, '.skill-lock.json');
      writeFileSync(
        lockPath,
        JSON.stringify({
          version: 3,
          skills: {
            'trash-demo': {
              source: 'demo/repo',
              sourceUrl: 'https://github.com/demo/repo',
              skillPath: 'trash-demo/SKILL.md',
            },
          },
        }),
      );
      const previousAgentsHome = process.env.DSH_AGENTS_HOME;
      process.env.DSH_AGENTS_HOME = agentsDir;
      try {
        const uninstalled = await callRoute(uninstallRoute, {
          method: 'POST',
          body: { name: 'trash-demo', cwd: projectDir },
        });
        assert.equal(uninstalled.status, 200);
        assert.equal(uninstalled.json.ok, true);
        assert.equal(uninstalled.json.name, 'trash-demo');
        assert.equal(typeof uninstalled.json.id, 'string');
        assert.equal(existsSync(skillDir), false, '技能目录应被移到回收站');
        const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
        assert.equal(lock.skills['trash-demo'], undefined, '安装记录应被清理');

        const trash = await callRoute(trashRoute);
        assert.equal(trash.status, 200);
        const entry = trash.json.entries.find((item) => item.name === 'trash-demo');
        assert.ok(entry, '回收站应列出条目');
        assert.equal(entry.present, true);

        const restored = await callRoute(restoreRoute, { method: 'POST', body: { id: entry.id } });
        assert.equal(restored.status, 200);
        assert.equal(restored.json.name, 'trash-demo');
        assert.equal(existsSync(join(skillDir, 'SKILL.md')), true, '恢复后文件应回到原位');
        const restoredLock = JSON.parse(readFileSync(lockPath, 'utf8'));
        assert.equal(
          restoredLock.skills['trash-demo'] && restoredLock.skills['trash-demo'].sourceUrl,
          'https://github.com/demo/repo',
          '恢复后安装记录应写回锁文件（安装来源能力不丢失）',
        );
        const emptyTrash = await callRoute(trashRoute);
        assert.equal(emptyTrash.json.entries.length, 0);

        const again = await callRoute(uninstallRoute, {
          method: 'POST',
          body: { name: 'trash-demo', cwd: projectDir },
        });
        assert.equal(again.status, 200);
        const purged = await callRoute(purgeRoute, { method: 'POST', body: { id: again.json.id } });
        assert.equal(purged.status, 200);
        assert.equal(purged.json.purged, true);
        assert.equal(existsSync(skillDir), false, '永久删除后技能目录应不存在');
        const finalTrash = await callRoute(trashRoute);
        assert.equal(finalTrash.json.entries.length, 0);
      } finally {
        if (previousAgentsHome === undefined) delete process.env.DSH_AGENTS_HOME;
        else process.env.DSH_AGENTS_HOME = previousAgentsHome;
        rmSync(agentsDir, { recursive: true, force: true });
      }
    });

    await test('HTTP：非个人技能不可卸载（403 ERR_NOT_UNINSTALLABLE）', async () => {
      const projectSkill = await callRoute(uninstallRoute, {
        method: 'POST',
        body: { name: 'demo-skill', cwd: projectDir },
      });
      assert.equal(projectSkill.status, 403);
      assert.equal(projectSkill.json.code, 'ERR_NOT_UNINSTALLABLE');
    });

    await test('HTTP：source/batch 无安装来源候选时返回 0', async () => {
      const emptyAgents = mkdtempSync(join(tmpdir(), 'dsh-wb-batch-'));
      const previousAgentsHome = process.env.DSH_AGENTS_HOME;
      process.env.DSH_AGENTS_HOME = emptyAgents;
      try {
        const result = await callRoute(sourceBatchRoute, {
          method: 'POST',
          body: { cwd: projectDir },
        });
        assert.equal(result.status, 200);
        assert.equal(result.json.ok, true);
        assert.equal(result.json.attempted, 0);
        assert.equal(result.json.filled, 0);
        assert.equal(result.json.remaining, 0);
        assert.deepEqual(result.json.items, []);
      } finally {
        if (previousAgentsHome === undefined) delete process.env.DSH_AGENTS_HOME;
        else process.env.DSH_AGENTS_HOME = previousAgentsHome;
        rmSync(emptyAgents, { recursive: true, force: true });
      }
    });

    await test('applyHostPlugin 重复挂载：后挂载者接管，旧 disposer 不误删', () => {
      const second = makeFakeContext();
      applyHostPlugin(second.ctx);
      assert.equal(second.registered.length, 17, '重复挂载应由新实例接管注册');
      assert.equal(fake.released.length, 17, '接管时应释放旧实例注册的路由');
      fake.cleanup();
      assert.equal(second.released.length, 0, '旧实例的迟到 cleanup 不得卸载新挂载');
      const third = makeFakeContext();
      applyHostPlugin(third.ctx);
      assert.equal(third.registered.length, 17, '再次挂载应再次接管');
      assert.equal(second.released.length, 17, '被接管的实例应释放自己注册的路由');
      third.cleanup();
      assert.equal(third.released.length, 17, '自身 cleanup 应释放全部路由');
      const fourth = makeFakeContext();
      applyHostPlugin(fourth.ctx);
      assert.equal(fourth.registered.length, 17, '全部清理后应允许重新挂载');
      fourth.cleanup();
    });

    // ---- 9. 模型输出解析 / normalizeModelZh
    await test('translate: parseModelOutput / normalizeModelZh', () => {
      const zh = normalizeModelZh(
        {
          name: '智能体触达',
          summary: '调研多平台内容并汇总',
          category: 'research',
          tags: ['调研', '平台'],
          alias: ['触达'],
          bogus: 'x',
        },
        new Set(['research']),
      );
      assert.equal(zh.name, '智能体触达');
      assert.equal(zh.summary, '调研多平台内容并汇总');
      assert.equal(zh.category, 'research');
      assert.deepEqual(zh.tags, ['调研', '平台']);
      assert.equal(normalizeModelZh({ name: '只有名字' }, new Set()), null);
      assert.equal(normalizeModelZh({ name: '名称', summary: '简介', category: '未知' }, new Set(['research'])).category, 'uncategorized');
      const parsed = parseModelOutput('```json\n{"name":"名称","summary":"简介","category":"research"}\n```', new Set(['research']));
      assert.equal(parsed.name, '名称');
      assert.equal(parseModelOutput('not json', new Set()), null);
    });

    // ---- 10. 插件入口形状
    await test('index.js 导出 name/inject/apply', async () => {
      const entry = await import('../index.js');
      assert.equal(entry.name, 'dsh-skill-workbench');
      assert.deepEqual(entry.inject, ['webServer', 'skills']);
      assert.equal(typeof entry.apply, 'function');
      const fourth = makeFakeContext();
      entry.apply(fourth.ctx, {});
      assert.equal(fourth.registered.length, 17);
      fourth.cleanup();
    });

    // ---- 11. makeRoutes 只读构造
    await test('makeRoutes 生成 17 条 exact 路由且均带 handler', () => {
      const jobs = { start: () => ({ jobId: 'x', total: 0 }), cancel: () => false, get: () => null, snapshot: () => [], dispose: () => {} };
      const routes = makeRoutes({ skills: { list: async () => [] }, workingDirectory: { get: () => null } }, { jobs });
      assert.equal(routes.length, 17);
      for (const route of routes) {
        assert.equal(route.kind, 'exact');
        assert.ok(route.path.startsWith('/api/dsh-skill-workbench/'));
        assert.equal(typeof route.handler, 'function');
      }
    });
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }

  console.log(`\n${checks} checks passed, ${failures.length} failed`);
  if (failures.length > 0) {
    for (const failure of failures) console.error(`- ${failure.name}: ${failure.error?.message ?? failure.error}`);
    process.exitCode = 1;
    return;
  }
  console.log('ALL GREEN');
  console.log(
    JSON.stringify(
      { pluginRoot: PLUGIN_ROOT, skillsDir: REAL_AGENTS_SKILLS, expectedSkills: realSkillsCount() },
      null,
      2,
    ),
  );
}

await main();
