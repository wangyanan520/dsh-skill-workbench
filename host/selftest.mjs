// dsh-skill-workbench · host 自测（不依赖 DSH 宿主进程；真实技能目录 + 临时 DSH_HOME）
// 运行：node host/selftest.mjs   （全部通过打印 ALL GREEN，退出码 0）
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
import { computeCoverage, computeSkillStatus, resolveLocalization, scanSkills } from './scan.js';
import { normalizeModelZh, parseModelOutput } from './translate.js';
import { applyHostPlugin, isLoopbackRequest, readJsonBody, makeRoutes } from './routes.js';

const HOST_DIR = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = resolve(HOST_DIR, '..');
const REAL_AGENTS_SKILLS = 'C:\\Users\\Administrator\\.agents\\skills';
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

function realSkillsCount() {
  try {
    return readdirSync(REAL_AGENTS_SKILLS, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
  } catch {
    return 0;
  }
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
        return () => {};
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
    effects,
    cleanup() {
      for (const effect of effects) {
        if (typeof effect.cleanup === 'function') effect.cleanup();
      }
    },
  };
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

    // ---- 4. 真实技能目录扫描（文件系统兜底 + name 归并）
    const expectedCount = Math.max(realSkillsCount() - 1, 0);
    await test('真实技能目录扫描（registry 不可用时文件系统兜底）', async () => {
      assert.ok(expectedCount > 0, `技能目录不存在：${REAL_AGENTS_SKILLS}`);
      const ctx = { skills: { list: async () => { throw new Error('no registry'); } } };
      const result = await scanSkills(ctx, { cwd: null, ...EMPTY_STORES });
      assert.equal(result.skills.length, expectedCount);
      assert.equal(result.coverage.total, expectedCount);
      assert.equal(result.coverage.untranslated, expectedCount);
      for (const name of [
        'image-to-code',
        'full-output-enforcement',
        'redesign-existing-projects',
        'high-end-visual-design',
      ]) {
        assert.ok(result.skills.some((skill) => skill.name === name), `缺少映射技能：${name}`);
      }
      const sample = result.skills.find((skill) => skill.name === 'agent-reach');
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

    // ---- 8. HTTP 路由（fake req/res，真 handler）
    const fake = makeFakeContext();
    applyHostPlugin(fake.ctx);
    assert.equal(fake.registered.length, 11, '应注册 11 条路由');
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
    assert.ok(
      [listRoute, statusRoute, saveRoute, deleteRoute, importRoute, exportRoute, healthRoute, configRoute, translateRoute, cancelRoute, diagRoute].every(Boolean),
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

      const agentReach = json.skills.find((item) => item.name === 'agent-reach');
      assert.ok(agentReach, '真实技能目录中的 agent-reach 应被扫描到');
      assert.equal(agentReach.path, join(REAL_AGENTS_SKILLS, 'agent-reach', 'SKILL.md'));
      assert.ok(typeof agentReach.hash.frontmatter === 'string');
      assert.equal(agentReach.source.kind, 'user-agents');
      assert.equal(agentReach.source.rank, 500);
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
      badBody.destroy = () => {
        badBody.destroyedFlag = true;
      };
      setImmediate(() => badBody.emit('data', Buffer.alloc(1024 * 1024 + 1)));
      const tooLarge = await readJsonBody(badBody);
      assert.deepEqual(tooLarge, { ok: false, reason: 'too-large' });
      assert.equal(badBody.destroyedFlag, true);
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

    await test('applyHostPlugin 单实例守卫 + cleanup', () => {
      const second = makeFakeContext();
      applyHostPlugin(second.ctx);
      assert.equal(second.registered.length, 0, '已挂载时不应重复注册');
      fake.cleanup();
      const third = makeFakeContext();
      applyHostPlugin(third.ctx);
      assert.equal(third.registered.length, 11, 'cleanup 后应允许重新挂载');
      third.cleanup();
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
      assert.equal(fourth.registered.length, 11);
      fourth.cleanup();
    });

    // ---- 11. makeRoutes 只读构造
    await test('makeRoutes 生成 11 条 exact 路由且均带 handler', () => {
      const jobs = { start: () => ({ jobId: 'x', total: 0 }), cancel: () => false, get: () => null, snapshot: () => [], dispose: () => {} };
      const routes = makeRoutes({ skills: { list: async () => [] }, workingDirectory: { get: () => null } }, { jobs });
      assert.equal(routes.length, 11);
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
      { pluginRoot: PLUGIN_ROOT, skillsDir: REAL_AGENTS_SKILLS, expectedSkills: Math.max(realSkillsCount() - 1, 0) },
      null,
      2,
    ),
  );
}

await main();
