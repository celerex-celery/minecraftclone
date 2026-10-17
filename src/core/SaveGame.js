/**
 * Save storage, backed by plain JSON files in %APPDATA%\Minecraft Voxel:
 *
 *   worlds\<id>.json   one file per world
 *   settings.json      settings
 *
 * The Electron shell (electron/preload.cjs) exposes window.electronSaves,
 * which talks to the main process over IPC and reads and writes those files.
 * That means saves can be inspected, backed up or moved like any other
 * folder, and they survive profile tweaks.
 *
 * In a plain browser (start.bat) there is no main process, so saves fall
 * back to in-memory storage: the game still plays, but nothing persists
 * after the tab closes. Use the desktop app for saving.
 *
 * A world record is:
 *
 *   { id, name, seed, gameMode, worldType, difficulty,
 *     created, lastPlayed, payload }
 *
 * `payload` holds the modified chunk data, inventory, survival stats and time.
 */

import { createLogger } from './Logger.js';

const log = createLogger('SaveGame');

const file =
  typeof window !== 'undefined' && window.electronSaves
    ? window.electronSaves
    : null;

/*
 * Session-only fallback for browser mode.
 *
 * No persistence on purpose: the desktop app is the only place saves live,
 * so the browser never ends up with a stale second copy of the same world.
 */
if (!file) {
  log.warn(
    'not running inside the desktop app - '
    + 'saving is session-only and worlds will be lost when you close the tab',
  );
}

const memory = {
  worlds: new Map(),
  settings: null,

  async list() {
    return [...this.worlds.values()].sort(
      (a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0),
    );
  },
  async get(id) {
    return this.worlds.get(id) ?? null;
  },
  async put(record) {
    this.worlds.set(record.id, record);
    return record;
  },
  async remove(id) {
    this.worlds.delete(id);
    return true;
  },
  async usage() {
    return 0;
  },
  async getSettings() {
    return this.settings;
  },
  async putSettings(settings) {
    this.settings = settings;
    return true;
  },
};

const store = file ?? memory;

/* ================================================================
    thin wrapper so callers do not care where the save lives
    ================================================================ */

export const SaveGame = {
  /** @returns {Promise<Array>} worlds, most recently played first */
  list: () => store.list(),

  get: (id) => store.get(id),

  /** Insert or update a world record. */
  put: (record) => store.put({ ...record, lastPlayed: Date.now() }),

  remove: (id) => store.remove(id),

  usage: () => store.usage(),

  getSettings: () => store.getSettings(),
  putSettings: (settings) => store.putSettings(settings),
};
