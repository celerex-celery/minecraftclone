/**
 * Entry point: load every asset, build the game, show the title screen.
 *
 * This file also owns three things the real game's launcher owns, because they
 * are all about the process around the game rather than the game itself:
 *
 *  - the loading screen, including the splash text the real game shows above
 *    the progress bar,
 *  - a crash screen, so a fatal error is a report the player can read and copy
 *    rather than a line in a console they may never have open,
 *  - the WebGL context guard, which is the one browser-level failure a voxel
 *    game actually hits in normal use.
 */

import { Game } from './core/Game.js';
import { Assets, blockTextureManifest, itemTextureManifest } from './core/Assets.js';
import { Blocks } from './world/Blocks.js';
import { Items } from './world/Items.js';
import { audio } from './audio/SoundEngine.js';
import { randomSplash, SPLASHES } from './ui/Splashes.js';
import { createLogger, recent } from './core/Logger.js';

// The source Vanilla prints for its own boot lines is `(Minecraft)`; ours is the
// game's name, which says the same thing at a glance in a terminal mixed with
// other processes.
const log = createLogger('Minecraft Voxel');

const crashEl = document.getElementById('crash-screen');
const crashTitleEl = document.getElementById('crash-title');
const crashSubEl = document.getElementById('crash-sub');
const crashCodeEl = document.getElementById('crash-code');
const crashReportEl = document.getElementById('crash-report');
const crashHintEl = document.getElementById('crash-hint');
const crashDismissEl = document.getElementById('crash-dismiss');

async function boot() {
  const canvas = document.getElementById('game-canvas');

  log.info('Starting Minecraft Voxel');

  const assets = new Assets();
  await assets.load({
    blocks: blockTextureManifest(Blocks),
    items: itemTextureManifest(Items),
    font: 'assets/font/ascii.png',
    clouds: 'assets/textures/clouds.png',
  });
  log.info('Loaded textures and font');

  const game = new Game(canvas, assets);
  window.game = game;
  log.info('Built the game');

  // The font sheet has arrived by now, which is what the splash needs. Vanilla
  // draws its splash from the same sheet the rest of the UI uses, so it cannot
  // appear before that sheet is loaded either.

  // load the language file before anything renders text
  await game.initLanguage();
  log.info('Loaded language (%s)', game.settings.language ?? 'en_us');

  // restore the saved options before anything reads them
  await game.loadSettings();
  log.info('Loaded settings');

  // the version comes out of package.json rather than a translated string, which
  // is how the title managed to say 1.2 while the game was at 1.4
  await game.loadVersion();
  log.info('Version %s', game.version ?? 'unknown');

  // show the title screen
  // Check if running in Electron desktop app
  if (!window.electronSaves) {
    // Not in Electron - show warning overlay with Continue option
    const container = document.getElementById('viewport');
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; inset: 0; z-index: 1000;
      background: rgba(16, 16, 16, 0.95);
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      color: #fff; font-family: 'Minecraft', 'Minecraftia', monospace;
      text-align: center; padding: 40px;
    `;
    overlay.innerHTML = `
      <h1 style="font-size: 28px; margin-bottom: 16px; color: #e6d91a; text-shadow: 2px 2px 0 #000;">
        Warning: Running on Localhost
      </h1>
      <p style="font-size: 18px; max-width: 500px; margin-bottom: 16px; line-height: 1.5;">
        Minecraft Voxel is designed for the <strong>Electron desktop app</strong> to save worlds and settings.
      </p>
      <p style="font-size: 16px; color: #aaa; margin-bottom: 32px;">
        Running in a browser (localhost) uses <strong>session-only storage</strong> — your world will be <strong>lost when you close the tab</strong>.
        <br>Use <code style="background:#333;padding:2px 6px;">start-electron.bat</code> or <code style="background:#333;padding:2px 6px;">npm run electron</code> for persistent saves.
      </p>
      <div style="display: flex; gap: 16px; flex-wrap: wrap; justify-content: center;">
        <button id="continue-btn" style="
          padding: 12px 32px;
          font-size: 16px;
          font-family: 'Minecraft', 'Minecraftia', monospace;
          background: #8a6d00;
          border: 2px solid #5a4a00;
          color: #fff;
          cursor: pointer;
          box-shadow: inset 1px 1px 0 #ffffff55, inset -1px -1px 0 #00000066;
        ">Continue Anyway (No Saves)</button>
        <button id="electron-btn" style="
          padding: 12px 32px;
          font-size: 16px;
          font-family: 'Minecraft', 'Minecraftia', monospace;
          background: #5a5a5a;
          border: 2px solid #2f2f2f;
          color: #fff;
          cursor: pointer;
          box-shadow: inset 1px 1px 0 #ffffff55, inset -1px -1px 0 #00000066;
        ">Open in Electron App</button>
      </div>
    `;
    container.appendChild(overlay);
    
    document.getElementById('continue-btn').addEventListener('click', () => {
      overlay.remove();
      game.screens.title.show();
      game.start();
      game.applySettings();
      log.info('Reached the title screen (localhost mode, no saves)');
    });
    
    document.getElementById('electron-btn').addEventListener('click', () => {
      overlay.remove();
      if (window.electronSaves) {
        location.reload();
      } else {
        alert('Please close this tab and run "start-electron.bat" or "npm run electron" from the project folder.');
      }
    });
    
    return; // Wait for user choice
  }
  
  game.screens.title.show();
  game.start();
  game.applySettings();
  log.info('Reached the title screen');

  // resume audio on the first interaction (browser autoplay policy)
  const resume = () => {
    audio.init();
    audio.resume();
    if (game.state === 'title') audio.playMusic('menu');
  };
  window.addEventListener('pointerdown', resume);
  window.addEventListener('keydown', resume);

  installContextGuard(game, canvas);
  watchForStaleCode();
}

/* ================================================================
   crash screen
   ================================================================ */

/** One report, however many errors arrive: the first is the interesting one. */
let crashShown = false;
let lastReport = '';

function reportCode() {
  const d = new Date();
  const stamp = [
    d.getFullYear().toString().slice(2),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('');
  const tail = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  return `MCVOXEL-${stamp}-${tail}`;
}

/**
 * The text behind the "copy details" button.
 *
 * It carries the things a bug report actually needs and nothing that would
 * identify the player: the game version, when it happened, which stage of boot
 * it happened in, the browser, the error with its stack, and - as Vanilla's
 * crash reports do - the tail of the log, which says what the game was doing
 * in the moments before it died.
 */
function buildReport(err, where) {
  const lines = [];
  const version = window.game?.version;
  lines.push(`Minecraft Voxel${version ? ` ${version}` : ' (dev)'}`);
  lines.push(`When: ${new Date().toISOString()}`);
  lines.push(`Stage: ${where}`);
  lines.push(`Browser: ${navigator.userAgent}`);
  lines.push('');
  if (err instanceof Error) {
    lines.push(`${err.name}: ${err.message}`);
    if (err.stack) lines.push(err.stack);
  } else if (err !== undefined && err !== null) {
    lines.push(typeof err === 'string' ? err : JSON.stringify(err, null, 2));
  } else {
    lines.push('Unknown error');
  }
  const tail = recent(40);
  if (tail.length) {
    lines.push('');
    lines.push('------------------------------8<------------------------------');
    lines.push('Recent log output:');
    lines.push(...tail);
  }
  return lines.join('\n');
}

/**
 * Show the crash screen.
 *
 * The error is logged as an ERROR line before the screen takes over, so the
 * terminal keeps it even if the player closes the window without copying the
 * report.
 *
 * @param {unknown} err what went wrong
 * @param {string} where which stage it went wrong in
 * @param {{title?: string, sub?: string, hint?: string, dismissible?: boolean}} [opts]
 */
function showCrash(err, where, opts = {}) {
  log.error('%s during %s', err instanceof Error ? err.message : String(err), where, err);
  if (crashShown) {
    // keep the first report, but never lose a later one entirely
    lastReport += `\n\n--- also during ${where} ---\n${err instanceof Error ? err.stack || err.message : String(err)}`;
    crashReportEl.textContent = lastReport;
    return;
  }
  crashShown = true;

  crashTitleEl.textContent = opts.title ?? 'Minecraft Voxel has crashed!';
  crashSubEl.textContent = opts.sub ?? 'Sorry :(';
  crashCodeEl.textContent = reportCode();
  lastReport = buildReport(err, where);
  crashReportEl.textContent = lastReport;
  crashHintEl.textContent = opts.hint ?? '';
  // a boot failure cannot be dismissed - there is no game to go back to
  crashDismissEl.classList.toggle('hidden', opts.dismissible === false);

  if (crashEl) crashEl.classList.remove('hidden');
}

function hideCrash() {
  crashShown = false;
  if (crashEl) crashEl.classList.add('hidden');
}

if (crashEl) {
  crashEl.querySelector('#crash-reload')
    ?.addEventListener('click', () => window.location.reload());

  crashEl.querySelector('#crash-copy')
    ?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(lastReport);
        crashHintEl.textContent = 'Details copied to the clipboard.';
      } catch {
        // no clipboard permission: the report is selectable, so say so instead
        crashHintEl.textContent = 'Could not reach the clipboard - the details below can be selected and copied by hand.';
      }
    });

  crashDismissEl?.addEventListener('click', () => {
    hideCrash();
    crashHintEl.textContent = '';
  });
}

/**
 * Catch what escapes.
 *
 * An error thrown inside a `requestAnimationFrame` callback or an event
 * listener has no caller left to report it to, so without these it lands in
 * the console and the game carries on in a state nobody chose. Anything that
 * reaches here is shown instead.
 */
function installCrashHandling() {
  window.addEventListener('error', (ev) => {
    showCrash(ev.error ?? ev.message, 'runtime', {
      title: 'Minecraft Voxel has crashed!',
      sub: 'Sorry :(',
      hint: 'If the game still looks playable underneath, Dismiss returns to it.',
    });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    showCrash(ev.reason, 'async', {
      title: 'Minecraft Voxel has crashed!',
      sub: 'Sorry :(',
      hint: 'If the game still looks playable underneath, Dismiss returns to it.',
    });
  });
}

/* ================================================================
   webgl context
   ================================================================ */

/**
 * Survive the GPU driver resetting underneath the game.
 *
 * A lost context is not a crash and it is not recoverable in place: three.js
 * rebuilds its state when the context comes back, but the world on the other
 * side is not the one you were standing in. So the world is written out first,
 * the frame loop is stopped so nothing throws into a dead context, and the
 * player is told what happened. If the browser restores the context on its own
 * the loop picks straight back up.
 */
function installContextGuard(game, canvas) {
  let stopped = false;

  canvas.addEventListener('webglcontextlost', (ev) => {
    // without this the browser will not attempt a restore at all
    ev.preventDefault();
    stopped = true;
    if (game.raf) {
      cancelAnimationFrame(game.raf);
      game.raf = 0;
    }
    try {
      game.save(true);
    } catch (err) {
      log.warn('could not save after losing the graphics context', err);
    }
    showCrash(
      new Error('The WebGL context was lost. The GPU driver reset, the laptop '
        + 'switched graphics, or the browser reclaimed the context.'),
      'graphics',
      {
        title: 'Graphics context lost',
        sub: 'Your world has been saved.',
        hint: 'The game will pick up again if the browser restores the context; otherwise reload.',
        dismissible: false,
      },
    );
  }, false);

  canvas.addEventListener('webglcontextrestored', () => {
    hideCrash();
    if (!stopped) return;
    stopped = false;
    game.start();
  }, false);
}

/**
 * Tell the player when the tab is running code that is older than the files on
 * disk.
 *
 * This exists because of a specific, repeated trap. A tab that has been open for
 * an hour keeps running the modules it loaded an hour ago, and `no-store` on
 * every response cannot help with that - it only governs the next fetch. The
 * symptom is always the same and always confusing: an error about a property
 * that plainly exists in the file, or a feature that "does nothing", because the
 * copy in the tab predates the edit.
 *
 * So the page asks the server what it last modified and says so, loudly, when the
 * answer has moved on. A reload is all it takes, and now the reload is requested
 * rather than guessed at.
 */
function watchForStaleCode() {
  const mine = Date.now();
  let ask = true;
  const check = async () => {
    // A server that answers 404 has not got the route, which means it was started
    // before the stamp existed. Stop asking rather than filling the console with a
    // 404 every four seconds, and say once that the check is not available.
    if (!ask) return;
    try {
      const res = await fetch(`/__stamp?at=${Date.now()}`, { cache: 'no-store' });
      if (res.status === 404) {
        ask = false;
        log.info('Reload check off: this server was started before the stale-code check existed. Restart it to turn the check back on.');
        return;
      }
      if (!res.ok) return;
      const theirs = Number(await res.text());
      if (!theirs || theirs <= mine) {
        document.title = 'Minecraft Voxel';
        return;
      }
      document.title = 'Minecraft Voxel - RELOAD';
      log.warn('This tab is running code older than the files on disk. Nothing you changed will appear until you reload.');
    } catch {
      // the stamp is a convenience; a server that will not answer it is fine
    }
  };
  const tick = () => { check(); setTimeout(tick, 4000); };
  setTimeout(tick, 4000);
}

// installed before boot so a failure inside it is reported like any other
installCrashHandling();

boot().catch((err) => {
  showCrash(err, 'startup', {
    title: 'Minecraft Voxel could not start',
    sub: 'The report below says where it stopped.',
    dismissible: false,
  });
});
