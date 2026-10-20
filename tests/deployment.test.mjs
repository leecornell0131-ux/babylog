import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = p => readFile(new URL('../' + p, import.meta.url), 'utf8');
test('PWA versions match and notification module is available offline', async () => {
  const page = await read('index.html'), sw = await read('sw.js');
  assert.equal(page.match(/const VERSION='([^']+)'/)[1], sw.match(/const VERSION = 'babylog-([^']+)'/)[1]);
  assert.match(sw, /'push-server\/web-notify\.js'/);
});
test('deployment tests and D1 migration precede the Worker deployment on main only', async () => {
  const s = await read('.github/workflows/push-server.yml');
  assert.match(s, /if: github\.ref == 'refs\/heads\/main'/);
  assert.ok(s.indexOf('node --test') < s.indexOf('wrangler@4.151.2 deploy'));
  assert.ok(s.indexOf('d1 migrations apply DB --remote') < s.indexOf('wrangler@4.151.2 deploy'));
  assert.match(s, /set -euo pipefail/);
});
