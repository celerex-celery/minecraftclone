/**
 * Localisation.
 *
 * Language files are plain JSON under `assets/lang/`, in the same spirit as
 * Minecraft's own en_us.json - adding a language means dropping in a new file
 * and listing it in LANGUAGES, with no code changes.
 *
 *   assets/lang/en_us.json
 *   assets/lang/en_gb.json
 *   assets/lang/es_es.json
 *
 * `t('hud.dropped', label)` looks the key up in the active language and falls
 * back to en_us, then to the key itself, so a missing translation degrades
 * gracefully instead of showing an empty string. `%s` placeholders are
 * substituted positionally.
 */

import { createLogger } from '../core/Logger.js';

const log = createLogger('Lang');

const LANG_DIR = 'assets/lang/';

/** Shown in the options list, in this order. */
export const LANGUAGES = [
  { code: 'en_us', label: 'English (US)' },
  { code: 'en_gb', label: 'English (UK)' },
  { code: 'es_es', label: 'Espanol' },
];

const DEFAULT = 'en_us';

class Lang {
  constructor() {
    this.code = DEFAULT;
    /** @type {Map<string, Record<string,string>>} */
    this.files = new Map();
    this.fallback = {};
    this._listeners = new Set();
  }

  async load(code = DEFAULT) {
    if (this.files.has(code)) {
      this.files.delete(code); // Force reload to pick up new translations
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
    // the default file has to be present for fallbacks to work
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

  /**
   * @param {string} key
   * @param {...any} args values for the %s placeholders
   */
  t(key, ...args) {
    const table = this.active;
    let s = table[key];
    if (s === undefined) s = this.fallback[key];
    if (s === undefined) s = key;
    return format(s, args);
  }

  /** True when the key exists in the active language or the fallback. */
  has(key) {
    return this.active[key] !== undefined || this.fallback[key] !== undefined;
  }

  /**
   * Translated display name for an item or block.
   *
   * Looks for `block.stone` or `item.stone`; when the language does not
   * translate it the English registry label is used, so a partial translation
   * is always usable.
   *
   * @param {string} name
   * @param {'block'|'item'} kind
   * @param {string} fallbackLabel
   */
  displayName(name, kind, fallbackLabel) {
    const key = `${kind}.${name}`;
    if (this.has(key)) return this.t(key);
    // a block can be registered as an item, and vice versa
    const other = kind === 'block' ? 'item' : 'block';
    if (this.has(`${other}.${name}`)) return this.t(`${other}.${name}`);
    return fallbackLabel ?? name;
  }

  /**
   * The name to show for a language in the currently active language.
   *
   * Every language file carries a `languages` map naming all of the other
   * languages, so a Spanish player sees "Ingles (Estados Unidos)" while an
   * English player sees "Spanish (Espanol)". Falls back to the English name in
   * LANGUAGES when a translation is missing.
   *
   * @param {string} code
   */
  displayLanguage(code) {
    const own = this.active.languages;
    if (own && typeof own[code] === 'string') return own[code];
    // the active language is always shown in its own name
    if (code === this.code) {
      const meta = this.active._meta ?? {};
      if (meta.nativeName) return meta.nativeName;
    }
    return LANGUAGES.find((l) => l.code === code)?.label ?? code;
  }

  /**
   * The splash texts for the active language. Languages may supply their own
   * `splash` array in their JSON; anything they leave out falls back to the
   * shared English list in Splashes.js.
   * @returns {string[]}
   */
  splashes(englishFallback) {
    const own = this.active.splash;
    if (Array.isArray(own) && own.length) return own.filter((s) => typeof s === 'string');
    return englishFallback;
  }

  /** Index of the active language in LANGUAGES. */
  get index() {
    const i = LANGUAGES.findIndex((l) => l.code === this.code);
    return i < 0 ? 0 : i;
  }

  /**
   * Translate every `[data-i18n]` element in the document.
   *
   * @param {(el: HTMLElement, text: string) => void} render
   *        called with each element and its translated text; Screens supplies
   *        the bitmap-font version and falls back to plain text.
   */
  applyToDom(render) {
    for (const el of document.querySelectorAll('[data-i18n]')) {
      const key = el.getAttribute('data-i18n');
      if (!key) continue;
      render(el, this.t(key));
    }
  }
}

/** Substitute %s placeholders left to right. */
function format(template, args) {
  if (!args.length) return template;
  let i = 0;
  return template.replace(/%s/g, () => (i < args.length ? String(args[i++]) : '%s'));
}

export const lang = new Lang();

/** Shorthand used throughout the UI. */
export const t = (key, ...args) => lang.t(key, ...args);
