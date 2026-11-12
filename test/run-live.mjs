// 一键跑联网测试：需要运行中的 DSH App（管理页/菜单测试走真实 HTTP API）
// 用法：node test/run-live.mjs   或   $env:DSH_PLUGIN_ORIGIN='http://127.0.0.1:<port>'; node test/run-live.mjs
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const origin = (process.env.DSH_PLUGIN_ORIGIN || 'http://127.0.0.1:51825').replace(/\/+$/, '');
const scripts = ['render-page-test.mjs', 'menu-live-test.mjs', 'test-extra.mjs'];

let failures = 0;
for (const script of scripts) {
  console.log('\n=== ' + script + ' (origin=' + origin + ') ===');
  const result = spawnSync(process.execPath, [path.join(here, script)], {
    stdio: 'inherit',
    env: { ...process.env, DSH_PLUGIN_ORIGIN: origin },
  });
  if (result.status !== 0) {
    failures += 1;
    console.error('*** ' + script + ' FAILED (exit ' + result.status + ')');
  }
}
console.log(failures === 0 ? '\nLIVE TESTS ALL GREEN' : '\nLIVE TESTS FAILED: ' + failures + ' script(s)');
process.exit(failures === 0 ? 0 : 1);
