import { createLogger } from './Logger.js';

const log = createLogger('SaveGame');

const file =
  typeof window !== 'undefined' && window.electronSaves
    ? window.electronSaves
    : null;

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
    return [...this.worlds.values()]
      .map((w) => ({ ...w, damaged: false, recovered: false }))
      .sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
  },
  async get(id) {

    return { record: this.worlds.get(id) ?? null, damaged: false, recovered: false };
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

export const SaveGame = {

  list: () => store.list(),

  get: (id) => store.get(id),

  put: (record) => store.put({ ...record, lastPlayed: Date.now() }),

  remove: (id) => store.remove(id),

  usage: () => store.usage(),

  getSettings: () => store.getSettings(),
  putSettings: (settings) => store.putSettings(settings),
};
