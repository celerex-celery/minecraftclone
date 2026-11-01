import { createLogger } from '../core/Logger.js';

const log = createLogger('Lang');

const LANG_DIR = 'assets/lang/';

export const LANGUAGES = [
  { code: 'en_us', label: 'English (US)' },
  { code: 'en_gb', label: 'English (UK)' },
  { code: 'es_es', label: 'Espanol' },
];

const DEFAULT = 'en_us';

class Lang {
  constructor() {
    this.code = DEFAULT;

    this.files = new Map();
    this.fallback = {};
    this._listeners = new Set();
  }

  async load(code = DEFAULT) {
    if (this.files.has(code)) {
      this.files.delete(code);
    }
    try {
      const res = await fetch(`${LANG_DIR}${code}.json?v=${Date.now()}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      this.files.set(code, data);
    } catch (err) {
      log.warn('could not load %s.json, falling back to %s', code, DEFAULT, err);
      if (code !== DEFAULT) {
        this.code = DEFAULT;
        this._notify();
        return;
      }
      this.files.set(code, {});
    }
    if (code === DEFAULT) this.fallback = this.files.get(DEFAULT) ?? {};
    this.code = code;
    this._notify();
  }

  async preload() {

    if (!this.files.has(DEFAULT)) await this.load(DEFAULT);
  }

  get active() {
    return this.files.get(this.code) ?? this.fallback;
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _notify() {
    for (const fn of this._listeners) fn(this.code);
  }

  t(key, ...args) {
    const table = this.active;
    let s = table[key];
    if (s === undefined) s = this.fallback[key];
    if (s === undefined) s = key;
    return format(s, args);
  }

  has(key) {
    return this.active[key] !== undefined || this.fallback[key] !== undefined;
  }

  displayName(name, kind, fallbackLabel) {
    const key = `${kind}.${name}`;
    if (this.has(key)) return this.t(key);

    const other = kind === 'block' ? 'item' : 'block';
    if (this.has(`${other}.${name}`)) return this.t(`${other}.${name}`);
    return fallbackLabel ?? name;
  }

  displayLanguage(code) {
    const own = this.active.languages;
    if (own && typeof own[code] === 'string') return own[code];

    if (code === this.code) {
      const meta = this.active._meta ?? {};
      if (meta.nativeName) return meta.nativeName;
    }
    return LANGUAGES.find((l) => l.code === code)?.label ?? code;
  }

  splashes(englishFallback) {
    const own = this.active.splash;
    if (Array.isArray(own) && own.length) return own.filter((s) => typeof s === 'string');
    return englishFallback;
  }

  get index() {
    const i = LANGUAGES.findIndex((l) => l.code === this.code);
    return i < 0 ? 0 : i;
  }

  applyToDom(render) {
    for (const el of document.querySelectorAll('[data-i18n]')) {
      const key = el.getAttribute('data-i18n');
      if (!key) continue;
      render(el, this.t(key));
    }
  }
}

function format(template, args) {
  if (!args.length) return template;
  let i = 0;
  return template.replace(/%s/g, () => (i < args.length ? String(args[i++]) : '%s'));
}

export const lang = new Lang();

export const t = (key, ...args) => lang.t(key, ...args);
