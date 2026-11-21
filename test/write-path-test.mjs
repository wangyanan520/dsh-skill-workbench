// 写路径测试入口：T02 先证明夹具能通过真实 makeRoutes 拿到 /list；
// T03/T04 再在这里补保存与审核链路。页面渲染回归仍由 page-regression-test.mjs 负责。
import assert from 'node:assert/strict';
import { createFixture } from './fixture.mjs';
import { createHarness } from './host-harness.mjs';

const fixture = await createFixture();
const ctx = { workingDirectory: { get: () => fixture.projectRoot } };
const harness = createHarness({ ctx });

try {
  const list = await harness.get('/list');
  assert.equal(list.status, 200, 'GET /list 返回 200');
  assert.equal(list.json.ok, true, 'GET /list 返回 ok');
  assert.equal(list.json.skills.length, 6, '真实 makeRoutes 扫到 6 条夹具技能');
  assert.equal(list.json.coverage.total, 6, 'coverage.total 与夹具一致');
  assert.equal(list.json.skills[0].name, 'agent-reach', '夹具第一条是 agent-reach');

  const status = await harness.get('/status');
  assert.equal(status.status, 200, 'GET /status 返回 200');
  assert.ok(Array.isArray(status.json.jobs), 'GET /status 下发 jobs 数组');

  console.log('WRITE PATH HARNESS ALL GREEN');
} finally {
  fixture.cleanup();
}
