// 写路径测试入口：T02 先证明夹具能通过真实 makeRoutes 拿到 /list；
// T03/T04 再在这里补保存与审核链路。页面渲染回归仍由 page-regression-test.mjs 负责。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createFixture, FIXTURE } from './fixture.mjs';
import { createHarness } from './host-harness.mjs';

const fixture = await createFixture();
const ctx = { workingDirectory: { get: () => fixture.projectRoot } };
const harness = createHarness({ ctx });

try {
  const list = await harness.get('/list');
  assert.equal(list.status, 200, 'GET /list 返回 200');
  assert.equal(list.json.ok, true, 'GET /list 返回 ok');
  assert.equal(list.json.skills.length, FIXTURE.total, `真实 makeRoutes 扫到 ${FIXTURE.total} 条夹具技能`);
  assert.equal(list.json.coverage.total, FIXTURE.total, 'coverage.total 与夹具一致');
  assert.equal(list.json.skills[0].name, 'agent-reach', '夹具第一条是 agent-reach');

  const status = await harness.get('/status');
  assert.equal(status.status, 200, 'GET /status 返回 200');
  assert.ok(Array.isArray(status.json.jobs), 'GET /status 下发 jobs 数组');

  // T03：保存只写显式字段，bound/hash/updatedAt 落盘，layers/install 不被 normalize 丢掉。
  const lark = list.json.skills.find((skill) => skill.name === 'lark-base');
  assert.ok(lark, '夹具里能找到 lark-base');
  assert.equal(lark.install?.sourceUrl, 'https://github.com/fixture/dsh-skills', 'install 透传到 /list');
  const beforeZh = { ...lark.zh };
  const beforeLayerSources = lark.layers.map((layer) => layer.source);
  const saved = await harness.post('/save', {
    name: 'lark-base',
    zh: { summary: '夹具保存后的简介' },
  });
  assert.equal(saved.status, 200, 'POST /save 返回 200');
  assert.equal(saved.json.ok, true, 'POST /save 返回 ok');
  assert.equal(saved.json.entry.zh.summary, '夹具保存后的简介', '只改 summary');
  assert.ok(saved.json.entry.bound && saved.json.entry.bound.kind, 'entry 写入 bound');
  assert.ok(saved.json.entry.hash && saved.json.entry.hash.frontmatter, 'entry 写入 hash');
  assert.ok(saved.json.entry.updatedAt, 'entry 写入 updatedAt');

  const afterList = await harness.get('/list');
  const after = afterList.json.skills.find((skill) => skill.name === 'lark-base');
  assert.equal(after.zh.summary, '夹具保存后的简介', '保存后 /list 读到新 summary');
  for (const key of Object.keys(beforeZh)) {
    if (key === 'summary') continue;
    assert.deepEqual(after.zh[key], beforeZh[key], `保存只改 summary，${key} 不变`);
  }
  assert.deepEqual(after.layers.map((layer) => layer.source), beforeLayerSources, '保存后 layers 不丢层');
  assert.equal(after.install?.sourceUrl, 'https://github.com/fixture/dsh-skills', '保存后 install 不丢');

  const storePath = path.join(fixture.root, 'dsh', 'dsh-skill-workbench', 'index.json');
  const storeAfter = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  assert.equal(storeAfter.entries['lark-base'].zh.summary, '夹具保存后的简介', 'index.json 落盘新 summary');
  assert.ok(storeAfter.entries['lark-base'].hash?.frontmatter, 'index.json 落盘 frontmatter hash');
  assert.ok(storeAfter.entries['lark-base'].bound?.path, 'index.json 落盘 bound.path');

  // T03：给无中文的技能保存中文名+简介，/list 的状态、覆盖率、layers 要真的变。
  const plainBefore = list.json.skills.find((skill) => skill.name === 'plain-notes');
  assert.equal(plainBefore.status, 'untranslated', 'plain-notes 保存前未翻译');
  assert.equal(plainBefore.layers.length, 0, 'plain-notes 保存前没有中文层');
  const translatedBefore = list.json.coverage.translated;
  const plainSaved = await harness.post('/save', {
    name: 'plain-notes',
    zh: { name: '纯文本笔记', summary: '按标签整理本地纯文本笔记。' },
  });
  assert.equal(plainSaved.status, 200, 'plain-notes 保存中文返回 200');
  const plainAfterList = await harness.get('/list');
  const plainAfter = plainAfterList.json.skills.find((skill) => skill.name === 'plain-notes');
  assert.equal(plainAfter.status, 'fresh', 'plain-notes 保存后状态变为 fresh');
  assert.equal(plainAfter.zh.name, '纯文本笔记', 'plain-notes 保存后中文名生效');
  assert.equal(plainAfter.zh.summary, '按标签整理本地纯文本笔记。', 'plain-notes 保存后简介生效');
  assert.deepEqual(plainAfter.layers.map((layer) => layer.source), ['user'], 'plain-notes 保存后有用户层');
  assert.equal(
    plainAfterList.json.coverage.translated,
    translatedBefore + 1,
    '保存中文后覆盖率 translated 加一',
  );
  const storeAfterPlain = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  assert.equal(storeAfterPlain.entries['plain-notes'].zh.name, '纯文本笔记', 'plain-notes 落盘中文名');
  assert.ok(storeAfterPlain.entries['plain-notes'].bound?.path, 'plain-notes 落盘 bound.path');
  assert.ok(storeAfterPlain.entries['plain-notes'].hash?.frontmatter, 'plain-notes 落盘 hash');

  // T04：review-only 只落审核状态，不改内容、不把 origin 改成 manual。
  const larkImBefore = list.json.skills.find((skill) => skill.name === 'lark-im');
  assert.equal(larkImBefore.zh.review, 'draft', 'lark-im 保存前是草稿');
  const larkImZhBefore = { ...larkImBefore.zh };
  const reviewOnly = await harness.post('/save', {
    name: 'lark-im',
    zh: {},
    review: 'reviewed',
  });
  assert.equal(reviewOnly.status, 200, 'review-only 保存返回 200');
  assert.equal(reviewOnly.json.entry.zh.review, 'reviewed', 'review-only 把 review 落为 reviewed');
  for (const key of Object.keys(larkImZhBefore)) {
    if (key === 'review') continue;
    assert.deepEqual(reviewOnly.json.entry.zh[key], larkImZhBefore[key], `review-only 不改 ${key}`);
  }
  assert.equal(reviewOnly.json.entry.zh.origin, 'manual', 'review-only 不把 origin 改成别的');
  assert.equal(
    reviewOnly.json.entry.hash.frontmatter,
    larkImBefore.hash.frontmatter,
    'review-only 写回当前 frontmatter hash',
  );
  assert.equal(
    reviewOnly.json.entry.hash.body,
    larkImBefore.hash.body,
    'review-only 写回当前 body hash',
  );
  assert.equal(reviewOnly.json.entry.bound.path, larkImBefore.path, 'review-only 写回当前 bound.path');

  const reviewList = await harness.get('/list');
  assert.equal(reviewList.json.coverage.draft, 0, 'review-only 后 coverage.draft 归零');
  assert.equal(
    reviewList.json.coverage.translated,
    plainAfterList.json.coverage.translated,
    'review-only 不改变 translated 计数',
  );

  // 完整表单提交（本夹具没有内置草稿；内置包 53 条 review 全 reviewed，
  // 用同一条 /save 路径的用户草稿覆盖「内容与表单一致」这一条）。
  const fullForm = { ...larkImZhBefore, summary: '审核时改的简介', review: 'reviewed' };
  const fullSave = await harness.post('/save', {
    name: 'lark-im',
    zh: fullForm,
    review: 'reviewed',
    origin: 'manual',
  });
  assert.equal(fullSave.status, 200, '完整表单保存返回 200');
  assert.equal(fullSave.json.entry.zh.summary, '审核时改的简介', '完整表单的 summary 生效');
  assert.equal(fullSave.json.entry.zh.review, 'reviewed', '完整表单的 review 生效');
  for (const key of Object.keys(larkImZhBefore)) {
    if (key === 'summary' || key === 'review') continue;
    assert.deepEqual(fullSave.json.entry.zh[key], larkImZhBefore[key], `完整表单不静默改 ${key}`);
  }

  const storeBeforeFailures = JSON.parse(fs.readFileSync(storePath, 'utf8'));

  // 空内容保存必须 400 ERR_EMPTY_ZH，且不能创建条目。
  // 用 pinyin 这种非内容字段绕过「没有可保存字段」的早退，才能覆盖合并后内容为空的分支。
  const empty = await harness.post('/save', { name: 'project-only', zh: { pinyin: 'ceshi' } });
  assert.equal(empty.status, 400, '空内容保存返回 400');
  assert.equal(empty.json.code, 'ERR_EMPTY_ZH', '空内容保存返回 ERR_EMPTY_ZH');
  const storeAfterEmpty = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  assert.deepEqual(storeAfterEmpty, storeBeforeFailures, '空内容保存不写盘');

  // 未知技能：契约用 ERR_NOT_FOUND（不是 ERR_NAME），失败后索引保持原样。
  const unknown = await harness.post('/save', { name: 'missing-notes', zh: { summary: '不存在' } });
  assert.equal(unknown.status, 404, '未知技能保存返回 404');
  assert.equal(unknown.json.code, 'ERR_NOT_FOUND', '未知技能保存返回 ERR_NOT_FOUND');
  const storeAfterUnknown = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  assert.deepEqual(storeAfterUnknown, storeBeforeFailures, '未知技能保存不写盘');

  // 用户层没有中文只提交 review：当前路由返回 400 ERR_BAD_REQUEST（不是 ERR_EMPTY_ZH），
  // 语义上应更接近 ERR_EMPTY_ZH；这里按实际契约断言，并在票里记录差异。
  const reviewEmpty = await harness.post('/save', {
    name: 'project-only',
    zh: {},
    review: 'reviewed',
  });
  assert.equal(reviewEmpty.status, 400, '无中文 review-only 返回 400');
  assert.equal(reviewEmpty.json.code, 'ERR_BAD_REQUEST', '无中文 review-only 返回可行动错误码');
  const storeAfterReviewEmpty = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  assert.deepEqual(storeAfterReviewEmpty, storeBeforeFailures, '无中文 review-only 不写盘');

  console.log('WRITE PATH HARNESS ALL GREEN');
} finally {
  fixture.cleanup();
}
