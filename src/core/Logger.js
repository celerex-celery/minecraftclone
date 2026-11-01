export const LEVEL = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG',
  TRACE: 'TRACE',
};

const ORDER = { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4 };

const HISTORY = 300;

const history = [];

let level = LEVEL.INFO;

const loggers = new Map();

function pad(n) {
  return String(n).padStart(2, '0');
}

export function stamp(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function stackLines(err) {
  if (!err || !err.stack) return [];
  return err.stack
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean);
}

function detailLines(err) {
  if (!err) return [];

  return stackLines(err).map((frame) => `\t${frame}`);
}

function write(levelName, line, continuation = []) {
  const rendered = continuation.length ? [line, ...continuation].join('\n') : line;

  history.push(rendered);
  if (history.length > HISTORY) history.splice(0, history.length - HISTORY);

  const shell = window.mcVoxel?.terminal;
  if (shell) {
    try {
      shell(levelName, rendered);
      return;
    } catch {

    }
  }

  const method = levelName === LEVEL.ERROR ? 'error'
    : levelName === LEVEL.WARN ? 'warn'
    : levelName === LEVEL.DEBUG ? 'debug'
    : 'log';
  console[method](rendered);
}

export function recent(count = 50) {
  return history.slice(-count);
}

export function setLevel(name) {
  const upper = String(name || '').toUpperCase();
  if (!(upper in ORDER)) {
    write(LEVEL.WARN, `unknown log level "${name}", keeping ${level}`);
    return;
  }
  level = upper;
}

export function currentLevel() {
  return level;
}

function allowed(levelName) {
  return ORDER[levelName] >= ORDER[level];
}

function applyQueryOverride() {
  try {
    const wanted = new URLSearchParams(window.location.search).get('log');
    if (!wanted) return;
    const upper = wanted.toUpperCase();
    if (upper in ORDER) setLevel(upper);
  } catch {

  }
}

export function createLogger(source, thread = 'Render thread') {
  const key = `${thread}/${source}`;
  const cached = loggers.get(key);
  if (cached) return cached;

  const emit = (levelName, args) => {
    if (!allowed(levelName)) return;
    const line = `[${stamp()}] [${thread}/${levelName}]: (${source}) ${sprintf(args)}`;
    write(levelName, line, detailLines(lastError(args)));
  };

  const lastError = (args) => {
    if (!args.length) return null;
    const last = args[args.length - 1];
    return last instanceof Error ? last : null;
  };

  const sprintf = (args) => {
    if (!args.length) return '';
    const head = typeof args[0] === 'string' ? args[0] : String(args[0]);
    let i = 1;
    const out = head.replace(/%[sdj%]/g, (m) => {
      if (m === '%%') return '%';
      if (i >= args.length) return m;
      const v = args[i++];
      if (m === '%d') return String(Math.trunc(Number(v)));
      if (m === '%j') {
        try { return JSON.stringify(v); } catch { return String(v); }
      }
      return String(v);
    });

    const leftovers = args.slice(i)
      .filter((v) => !(v instanceof Error))
      .map((v) => String(v));
    return leftovers.length ? `${out} ${leftovers.join(' ')}` : out;
  };

  const logger = {
    error: (...args) => emit(LEVEL.ERROR, args),
    warn: (...args) => emit(LEVEL.WARN, args),
    info: (...args) => emit(LEVEL.INFO, args),
    debug: (...args) => emit(LEVEL.DEBUG, args),
    trace: (...args) => emit(LEVEL.TRACE, args),
  };

  loggers.set(key, logger);
  return logger;
}

applyQueryOverride();
