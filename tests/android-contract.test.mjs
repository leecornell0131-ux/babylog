import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const read = p => readFile(new URL('../android-app/app/src/main/' + p, import.meta.url), 'utf8');
test('new APK no longer schedules polling and cancels the previous job ID', async () => {
  const s = await read('java/kr/babylog/app/Push.kt');
  assert.doesNotMatch(s, /\.setPeriodic\(/);
  assert.match(s, /JOB_ID = 7101/); assert.match(s, /\.cancel\(JOB_ID\)/);
  assert.match(s, /fun init\(ctx: Context\)\s*\{\s*cancelLegacyPoll\(ctx\)/);
});
test('an old pending job cannot make HTTP calls after the APK upgrade', async () => {
  const s = await read('java/kr/babylog/app/PollJob.kt');
  assert.doesNotMatch(s, /Push\.poll|thread\s*\{/);
  assert.match(s, /onStartJob\(params: JobParameters\): Boolean = false/);
});
test('legacy web bridge and foreground/FCM widget paths are preserved', async () => {
  const bridge = await read('assets/bridge.js'), main = await read('java/kr/babylog/app/MainActivity.kt');
  assert.match(bridge, /babylog-v1/); assert.match(bridge, /BabySync\.local/); assert.match(bridge, /end: null/);
  assert.match(main, /BabyApp\.refresh\(\)/); assert.match(main, /Widgets\.save/);
  assert.match(await read('java/kr/babylog/app/PushService.kt'), /Push\.apply/);
});
