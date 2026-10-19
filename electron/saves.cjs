/**
 * Save files on disk.
 *
 * Worlds live as plain JSON files in %APPDATA%\Minecraft Voxel\worlds, one
 * file per world, so they can be inspected and backed up without digging
 * through the Electron profile's IndexedDB.
 *
 * Two things keep a save from being lost to a crash mid-write:
 *
 *   <id>.json        the world
 *   <id>.json.bak    the previous version - the last one known to parse
 *
 * A write goes to <id>.json.tmp first and is flushed to disk before it is
 * renamed over <id>.json. A rename is atomic, so the file on disk is always
 * either the whole old world or the whole new one, never a half-written mix
 * of the two. The old file is copied to the .bak before the rename, so if the
 * new one turns out to be damaged there is still a version to fall back to.
 *
 * This lives apart from main.cjs so it can be exercised without starting
 * Electron - see tools/save-test.mjs.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * The file a world lives in.
 *
 * The id becomes a filename, so it must not be able to point anywhere else:
 * no path separators, no parent directory, no drive letter.
 *
 * @param {string} dir the worlds folder
 * @param {string} id
 * @returns {string}
 */
function worldFile(dir, id) {
  if (typeof id !== 'string' || !id || id.length > 128) {
    throw new Error(`invalid world id: ${id}`);
  }
  if (/[\\/]/.test(id) || id.includes('..') || /^[A-Za-z]:/.test(id)) {
    throw new Error(`invalid world id: ${id}`);
  }
  return path.join(dir, `${id}.json`);
}

/**
 * The names in the worlds folder that are worlds, rather than the temporary
 * and backup files that sit alongside them.
 */
function isWorldFile(name) {
  return name.endsWith('.json')
    && !name.endsWith('.json.tmp')
    && !name.endsWith('.json.bak');
}

/**
 * Read one JSON file and say what happened.
 *
 * The old version of this swallowed every failure into the same null, so a
 * world truncated by a power cut read as "no such world" and the player was
 * never told the difference. The reason is reported instead.
 *
 * @param {string} file
 * @returns {Promise<{ok: true, value: any}
 *   | {ok: false, reason: 'missing'|'corrupt'|'unreadable', error?: Error}>}
 */
async function readJsonFile(file) {
  let text;
  try {
    text = await fsp.readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: false, reason: 'missing' };
    return { ok: false, reason: 'unreadable', error: err };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, reason: 'corrupt', error: err };
  }
}

/**
 * Write a JSON file so that it is never seen half-written.
 *
 * The new content goes to <file>.tmp and is flushed to disk before it is
 * renamed over <file>. The old file is kept as <file>.bak first, so a world
 * that turns out to be damaged still has a version to fall back to.
 *
 * @param {string} file
 * @param {any} value
 */
async function writeJsonAtomic(file, value) {
  const text = JSON.stringify(value);
  const tmp = `${file}.tmp`;
  const bak = `${file}.bak`;

  const handle = await fsp.open(tmp, 'w');
  try {
    await handle.writeFile(text, 'utf8');
    // Flush before the rename. Without this the new file can still be sitting
    // in the OS cache when the rename lands, and a power cut would leave the
    // renamed file empty.
    await handle.sync();
  } finally {
    await handle.close();
  }

  // The file being replaced is the last version known to parse, so it becomes
  // the backup. A file that is not there yet is normal for a first save.
  try {
    await fsp.copyFile(file, bak);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  // rename() over an existing file is atomic. On Windows it can fail with
  // EPERM if something else happens to have the file open, so that is retried
  // a few times before giving up.
  for (let attempt = 0; ; attempt++) {
    try {
      await fsp.rename(tmp, file);
      return;
    } catch (err) {
      const retryable = err.code === 'EPERM'
        || err.code === 'EBUSY'
        || err.code === 'EACCES';
      if (!retryable || attempt >= 4) throw err;
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

/**
 * Build the save handlers over a folder.
 *
 * @param {object} opts
 * @param {() => string} opts.dir where the worlds folder is
 * @param {() => string} opts.settingsFile where the settings file is
 * @param {(level: string, text: string) => void} opts.log
 */
function createSaves({ dir, settingsFile, log }) {
  const worldsDir = () => {
    const d = dir();
    fs.mkdirSync(d, { recursive: true });
    return d;
  };

  /**
   * Read a JSON file, falling back to its .bak when the main copy will not
   * parse.
   *
   * @param {string} file
   * @returns {Promise<{value: any, damaged: boolean, recovered: boolean}>}
   *   `damaged` means the file on disk would not parse. `recovered` means the
   *   value came from the backup instead, so it is one save behind.
   */
  async function readJsonWithBackup(file) {
    const primary = await readJsonFile(file);
    if (primary.ok) return { value: primary.value, damaged: false, recovered: false };

    if (primary.reason === 'missing') {
      return { value: null, damaged: false, recovered: false };
    }

    const what = primary.reason === 'corrupt'
      ? 'is not valid JSON'
      : 'could not be read';
    log('ERROR', `${path.basename(file)} ${what}: ${primary.error?.message ?? 'unknown error'}`);

    // The backup is the last version written from a record that parsed, so it
    // is worth trying before telling the player the world is gone.
    const backup = await readJsonFile(`${file}.bak`);
    if (backup.ok) {
      log('WARN', `recovered ${path.basename(file)} from ${path.basename(`${file}.bak`)}`);
      return { value: backup.value, damaged: true, recovered: true };
    }

    log('ERROR', `${path.basename(file)} could not be recovered from its backup`);
    return { value: null, damaged: true, recovered: false };
  }

  return {
    /**
     * @returns {Promise<Array>} one entry per world, most recently played first
     */
    async list() {
      const folder = worldsDir();
      const out = [];
      for (const name of await fsp.readdir(folder)) {
        if (!isWorldFile(name)) continue;
        const file = path.join(folder, name);
        const { value, damaged, recovered } = await readJsonWithBackup(file);
        if (value) {
          out.push({ ...value, damaged, recovered });
        } else if (damaged) {
          // The file is on disk but unreadable and there is no backup to fall
          // back on. It is listed anyway so the player can see that it is
          // there and delete it, rather than it vanishing with no
          // explanation.
          const stat = await fsp.stat(file).catch(() => null);
          const id = name.slice(0, -'.json'.length);
          out.push({
            id,
            name: id,
            gameMode: 'survival',
            worldType: 'default',
            difficulty: 'normal',
            created: stat?.birthtimeMs ?? stat?.mtimeMs ?? 0,
            lastPlayed: stat?.mtimeMs ?? 0,
            damaged: true,
            recovered: false,
          });
        }
      }
      return out.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
    },

    /**
     * @returns {Promise<{record: any, damaged: boolean, recovered: boolean}>}
     */
    async get(id) {
      const { value, damaged, recovered } = await readJsonWithBackup(worldFile(worldsDir(), id));
      return { record: value, damaged, recovered };
    },

    async put(record) {
      if (!record || typeof record !== 'object' || typeof record.id !== 'string') {
        throw new Error('save record has no id');
      }
      await writeJsonAtomic(worldFile(worldsDir(), record.id), record);
      return record;
    },

    async remove(id) {
      const file = worldFile(worldsDir(), id);
      // The backup and any half-written temporary go with it, so a deleted
      // world cannot come back from the fallback the next time the folder is
      // read.
      for (const p of [file, `${file}.bak`, `${file}.tmp`]) {
        try {
          await fsp.rm(p, { force: true });
        } catch {
          /* already gone */
        }
      }
      return true;
    },

    async usage() {
      const folder = worldsDir();
      let total = 0;
      for (const name of await fsp.readdir(folder)) {
        if (!isWorldFile(name)) continue;
        try {
          total += (await fsp.stat(path.join(folder, name))).size;
        } catch {
          /* ignore */
        }
      }
      return total;
    },

    async getSettings() {
      const { value, damaged } = await readJsonWithBackup(settingsFile());
      if (damaged) {
        // Settings are not worth failing over - the defaults are fine - but the
        // player should know their keybinds did not come back.
        log('WARN', 'settings were damaged; falling back to defaults');
      }
      return value ?? null;
    },

    async putSettings(settings) {
      await writeJsonAtomic(settingsFile(), settings);
      return true;
    },
  };
}

module.exports = { createSaves, writeJsonAtomic, readJsonFile, worldFile };
