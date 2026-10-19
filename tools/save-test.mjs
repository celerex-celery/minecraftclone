/**
 * Save file tests.
 *
 * The save path is the one place in the game where a bug loses work that
 * cannot be recovered, so it is checked directly rather than through the
 * game: a world is written, read back, damaged, and read again.
 *
 * The logic lives in electron/saves.cjs, which is plain CommonJS and needs
 * no Electron, so it can be exercised here.
 *
 *   node tools/save-test.mjs
 */

import { createRequire } from 'node:module';
import { mkdtemp, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createSaves } = require('../electron/saves.cjs');

/* ------------------------------------------------------------------ */
/* harness                                                             */
/* ------------------------------------------------------------------ */

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? 'assertion failed');
}

function section(title) {
  console.log(`\n${title}`);
}

/* ------------------------------------------------------------------ */
/* fixture                                                             */
/* ------------------------------------------------------------------ */

const root = await mkdtemp(path.join(tmpdir(), 'mcvoxel-save-'));
const dir = path.join(root, 'worlds');
const settingsPath = path.join(root, 'settings.json');

const logged = [];
const saves = createSaves({
  dir: () => dir,
  settingsFile: () => settingsPath,
  log: (level, text) => logged.push({ level, text }),
});

const worldFile = (id) => path.join(dir, `${id}.json`);
const backupFile = (id) => path.join(dir, `${id}.json.bak`);
const tmpFile = (id) => path.join(dir, `${id}.json.tmp`);

const record = (id, n) => ({ id, name: `world ${n}`, seed: 1234, payload: { n } });

/* ------------------------------------------------------------------ */

section('writing');

await check('a world round-trips', async () => {
  await saves.put(record('a', 1));
  const { record: got, damaged, recovered } = await saves.get('a');
  assert(got, 'the world was not read back');
  assert(got.name === 'world 1', `wrong name: ${got.name}`);
  assert(damaged === false && recovered === false, 'a healthy world reported as damaged');
});

await check('the write leaves no temporary behind', async () => {
  await saves.put(record('b', 1));
  const names = await readdir(dir);
  assert(!names.includes('b.json.tmp'), `a temporary was left behind: ${names.join(', ')}`);
});

await check('the file on disk parses as JSON', async () => {
  await saves.put(record('c', 1));
  const text = await readFile(worldFile('c'), 'utf8');
  const parsed = JSON.parse(text);
  assert(parsed.id === 'c', 'the file does not hold the record');
});

await check('the previous version is kept as a backup', async () => {
  await saves.put(record('d', 1));
  await saves.put(record('d', 2));
  const backup = JSON.parse(await readFile(backupFile('d'), 'utf8'));
  assert(backup.payload.n === 1, `the backup holds the wrong version: ${backup.payload.n}`);
  const live = JSON.parse(await readFile(worldFile('d'), 'utf8'));
  assert(live.payload.n === 2, `the live file holds the wrong version: ${live.payload.n}`);
});

await check('the first save has no backup to keep', async () => {
  await saves.put(record('e', 1));
  let hasBackup = true;
  try {
    await stat(backupFile('e'));
  } catch {
    hasBackup = false;
  }
  assert(!hasBackup, 'a backup was made for a file that did not exist');
});

/* ------------------------------------------------------------------ */

section('damaged files');

await check('a truncated world is read back from the backup', async () => {
  await saves.put(record('f', 1));
  await saves.put(record('f', 2));
  // What a power cut mid-write leaves behind.
  await writeFile(worldFile('f'), '{"id":"f","payl', 'utf8');

  const { record: got, damaged, recovered } = await saves.get('f');
  assert(got, 'nothing came back at all');
  assert(got.payload.n === 1, `the wrong version came back: ${got.payload.n}`);
  assert(damaged === true, 'the damage was not reported');
  assert(recovered === true, 'the recovery was not reported');
});

await check('the damage is logged rather than swallowed', async () => {
  logged.length = 0;
  await saves.put(record('g', 1));
  await saves.put(record('g', 2));
  await writeFile(worldFile('g'), 'not json at all', 'utf8');
  await saves.get('g');
  assert(logged.some((l) => l.level === 'ERROR'), 'the corruption was not logged as an error');
  assert(logged.some((l) => l.level === 'WARN' && /recovered/i.test(l.text)),
    'the recovery was not logged as a warning');
});

await check('a world with no backup reads as damaged, not missing', async () => {
  await saves.put(record('h', 1));
  await writeFile(worldFile('h'), '{"id":"h"', 'utf8');

  const { record: got, damaged, recovered } = await saves.get('h');
  assert(got === null, 'a damaged world produced a record');
  assert(damaged === true, 'the damage was not reported');
  assert(recovered === false, 'a recovery was claimed without a backup');
});

await check('a world that is not there reads as missing', async () => {
  const { record: got, damaged, recovered } = await saves.get('nope');
  assert(got === null, 'a missing world produced a record');
  assert(damaged === false, 'a missing world was reported as damaged');
  assert(recovered === false, 'a missing world was reported as recovered');
});

/* ------------------------------------------------------------------ */

section('the world list');

await check('backups and temporaries are not listed as worlds', async () => {
  await saves.put(record('i', 1));
  await saves.put(record('i', 2));
  const worlds = await saves.list();
  const ids = worlds.map((w) => w.id);
  assert(ids.includes('i'), 'the world was not listed');
  assert(ids.every((id) => !id.endsWith('.bak') && !id.endsWith('.tmp')),
    `a helper file was listed as a world: ${ids.join(', ')}`);
  assert(worlds.length === ids.length, 'the list has duplicates');
});

await check('a damaged world is still listed so it can be deleted', async () => {
  await saves.put(record('j', 1));
  await writeFile(worldFile('j'), 'broken', 'utf8');

  const worlds = await saves.list();
  const w = worlds.find((x) => x.id === 'j');
  assert(w, 'the damaged world vanished from the list');
  assert(w.damaged === true, 'the damaged world was not flagged');
});

await check('a recovered world is flagged as recovered', async () => {
  await saves.put(record('k', 1));
  await saves.put(record('k', 2));
  await writeFile(worldFile('k'), 'broken', 'utf8');

  const worlds = await saves.list();
  const w = worlds.find((x) => x.id === 'k');
  assert(w, 'the world was not listed');
  assert(w.damaged === true && w.recovered === true, 'the recovery was not flagged');
});

/* ------------------------------------------------------------------ */

section('deleting');

await check('deleting a world takes its backup with it', async () => {
  await saves.put(record('l', 1));
  await saves.put(record('l', 2));
  await saves.remove('l');

  const names = await readdir(dir);
  assert(!names.includes('l.json'), 'the world file was left behind');
  assert(!names.includes('l.json.bak'), 'the backup was left behind');
  assert(!names.includes('l.json.tmp'), 'a temporary was left behind');
});

await check('deleting a world that is not there is not an error', async () => {
  await saves.remove('never-existed');
});

/* ------------------------------------------------------------------ */

section('settings');

await check('settings round-trip', async () => {
  await saves.putSettings({ renderDistance: 12, keybinds: {} });
  const got = await saves.getSettings();
  assert(got?.renderDistance === 12, `the settings did not come back: ${JSON.stringify(got)}`);
});

await check('damaged settings fall back without throwing', async () => {
  await writeFile(settingsPath, 'not json', 'utf8');
  const got = await saves.getSettings();
  assert(got === null, 'damaged settings produced a value');
});

/* ------------------------------------------------------------------ */

section('hostile input');

await check('an id cannot escape the worlds folder', async () => {
  for (const bad of ['../evil', 'a/b', 'a\\b', '..', 'C:evil']) {
    let threw = false;
    try {
      await saves.get(bad);
    } catch {
      threw = true;
    }
    assert(threw, `the id "${bad}" was accepted`);
  }
});

await check('a record with no id is rejected', async () => {
  let threw = false;
  try {
    await saves.put({ name: 'no id' });
  } catch {
    threw = true;
  }
  assert(threw, 'a record with no id was written');
});

/* ------------------------------------------------------------------ */

await rm(root, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f.name}: ${f.err.stack}`);
  process.exitCode = 1;
}
