/**
 * Logging, the way the real game writes it.
 *
 * Vanilla Minecraft writes one line per event, in the same shape every time:
 *
 *   [14:32:07] [Render thread/INFO]: (Minecraft) Loaded 7 recipes
 *   [14:32:07] [Render thread/WARN]: (Minecraft) abc.json could not be parsed
 *   [14:32:07] [Render thread/ERROR]: Exception in tick
 *   	at net.minecraft.server.MinecraftServer.run(...)
 *
 * The shape is the whole point. A timestamp, a thread and a level in brackets,
 * a source in brackets, then one sentence. Every tool that reads the output -
 * a terminal, a diff between two runs, a bug report pasted into an issue -
 * works the moment the shape is consistent.
 *
 * So this module owns the shape and nothing else. Modules get a named logger
 * with `createLogger('WorldGen')` and call `.info()`, `.warn()` and friends on
 * it; the level decides whether a line is written at all, and where it goes.
 *
 * Where it goes is the one interesting part. Running inside the desktop app,
 * lines are handed to the Electron main process over the `terminal` bridge in
 * preload.cjs, which prints them to stdout in the same format. Running in a
 * plain browser there is no shell to print to, so the lines land in the
 * developer console instead. Either way the line is written exactly once.
 *
 * The default level is INFO, like a release build: warnings and errors are
 * always written, life-cycle events are written, per-frame trivia is not. A
 * debug session re-enables DEBUG for everything with `?log=DEBUG` in the URL,
 * or `Log.setLevel('DEBUG')` from the console.
 */

/* ============================ levels ============================ */

export const LEVEL = {
  ERROR: 'ERROR',
  WARN: 'WARN',
  INFO: 'INFO',
  DEBUG: 'DEBUG',
  TRACE: 'TRACE',
};

/** Ascending severity order, for the "is this worth printing" test. */
const ORDER = { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4 };

/**
 * How many lines are kept for crash reports.
 *
 * Vanilla ends a crash report with the tail of its own log, because the tail is
 * what says what the game was doing when it died. Same idea: the last few
 * hundred lines are held in memory and appended to the report, capped so a
 * long session cannot grow this without bound.
 */
const HISTORY = 300;

/** Where all lines go, newest last. @type {string[]} */
const history = [];

/** Current threshold, as a level name. */
let level = LEVEL.INFO;

/** Cache of the loggers handed out, keyed by `thread/source`. */
const loggers = new Map();

/* ============================ formatting ============================ */

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * The `[14:32:07]` part: local time, hours to seconds, whole seconds only.
 * Milliseconds would make a frame loop line unreadable.
 *
 * @param {Date} [d]
 * @returns {string}
 */
export function stamp(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * One level of a stack trace, with its leading whitespace stripped.
 *
 * The tab keeps Vanilla's shape, where frames read as an indented list under
 * the line that failed rather than as part of the sentence.
 *
 * @param {Error} err
 * @returns {string[]}
 */
function stackLines(err) {
  if (!err || !err.stack) return [];
  return err.stack
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Turn an error into the lines that follow the message line.
 *
 * @param {Error} err
 * @returns {string[]}
 */
function detailLines(err) {
  if (!err) return [];
  // A plain object with a .stack - a DOMException, say - still prints its stack.
  return stackLines(err).map((frame) => `\t${frame}`);
}

/* ============================ output ============================ */

/**
 * Write one formatted line, plus any continuation lines it brought with it.
 *
 * Inside the desktop app the line goes to the shell; in a browser it goes to
 * the developer console with the level mapped onto the matching console method,
 * so ERROR still opens the door to a stack trace in devtools.
 *
 * @param {string} levelName one of LEVEL
 * @param {string} line the fully formatted line, already stamped
 * @param {string[]} [continuation] stack frames and similar, unindented
 */
function write(levelName, line, continuation = []) {
  const rendered = continuation.length ? [line, ...continuation].join('\n') : line;

  // newest last, floored to HISTORY lines
  history.push(rendered);
  if (history.length > HISTORY) history.splice(0, history.length - HISTORY);

  const shell = window.mcVoxel?.terminal;
  if (shell) {
    try {
      shell(levelName, rendered);
      return;
    } catch {
      // the bridge went away mid-session; fall through to the console so the
      // line is not lost
    }
  }

  const method = levelName === LEVEL.ERROR ? 'error'
    : levelName === LEVEL.WARN ? 'warn'
    : levelName === LEVEL.DEBUG ? 'debug'
    : 'log';
  console[method](rendered);
}

/**
 * The lines most recently written, formatted exactly as they were printed.
 *
 * @param {number} [count]
 * @returns {string[]}
 */
export function recent(count = 50) {
  return history.slice(-count);
}

/**
 * Change the threshold. Valid names are the keys of LEVEL, case-insensitive.
 *
 * @param {string} name
 */
export function setLevel(name) {
  const upper = String(name || '').toUpperCase();
  if (!(upper in ORDER)) {
    write(LEVEL.WARN, `unknown log level "${name}", keeping ${level}`);
    return;
  }
  level = upper;
}

/** The level in force, as a LEVEL name. @returns {string} */
export function currentLevel() {
  return level;
}

function allowed(levelName) {
  return ORDER[levelName] >= ORDER[level];
}

/**
 * Read the level a `?log=` query parameter asks for, so a debugging session can
 * turn on DEBUG lines without editing code.
 *
 * An unmatched or misspelled value is a typo, not a request to fail, so it is
 * ignored and INFO stays where it was.
 */
function applyQueryOverride() {
  try {
    const wanted = new URLSearchParams(window.location.search).get('log');
    if (!wanted) return;
    const upper = wanted.toUpperCase();
    if (upper in ORDER) setLevel(upper);
  } catch {
    // no location (a worker, say): the default stands
  }
}

/* ============================ the logger ============================ */

/**
 * A named logger: the `(Source)` in the line.
 *
 * One per module, created once at module scope:
 *
 *   const log = createLogger('WorldGen');
 *   log.info('generated chunk %d,%d with %d blocks', cx, cz, count);
 *
 * printf-style numbers are the real game's habit and they read well in a fixed
 * stack of lines; a plain string works just as well.
 *
 * @param {string} source the module or subsystem name
 * @param {string} [thread] 'Render thread' for the game, 'main' for the shell
 * @returns {{error:Function, warn:Function, info:Function, debug:Function,
 *            trace:Function, fatal:Function}}
 */
export function createLogger(source, thread = 'Render thread') {
  const key = `${thread}/${source}`;
  const cached = loggers.get(key);
  if (cached) return cached;

  /** @param {string} levelName @param {unknown[]} args */
  const emit = (levelName, args) => {
    if (!allowed(levelName)) return;
    const line = `[${stamp()}] [${thread}/${levelName}]: (${source}) ${sprintf(args)}`;
    write(levelName, line, detailLines(lastError(args)));
  };

  /**
   * The trailing argument, when it is an Error, contributes its stack as
   * continuation lines. This is why `log.error('saving failed', err)` works the
   * way it does - the sentence stays a sentence and the stack hangs under it.
   *
   * @param {unknown[]} args
   * @returns {Error|null}
   */
  const lastError = (args) => {
    if (!args.length) return null;
    const last = args[args.length - 1];
    return last instanceof Error ? last : null;
  };

  /**
   * `%s`, `%d`, `%j` and `%%` in the first argument, filled from the rest.
   * A stray argument with no placeholder is appended, which is what makes
   * `log.warn('message', err)` read correctly when it forgets the format.
   *
   * @param {unknown[]} args
   * @returns {string}
   */
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
    // An Error contributes its stack (see detailLines) rather than its message,
    // which the sentence already carries - so appending it would say the same
    // thing twice on one line.
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
