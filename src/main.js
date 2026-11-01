import { Game, STATE } from './core/Game.js';
import { Assets, blockTextureManifest, itemTextureManifest } from './core/Assets.js';
import { Blocks } from './world/blocks/Blocks.js';
import { Items } from './world/blocks/Items.js';
import { audio } from './audio/SoundEngine.js';
import { randomSplash, SPLASHES } from './ui/Splashes.js';
import { createLogger, recent } from './core/Logger.js';
import { LoadingScreen } from './ui/LoadingScreen.js';

const log = createLogger('Minexel');

const crashEl = document.getElementById('crash-screen');
const crashTitleEl = document.getElementById('crash-title');
const crashSubEl = document.getElementById('crash-sub');
const crashCodeEl = document.getElementById('crash-code');
const crashReportEl = document.getElementById('crash-report');
const crashHintEl = document.getElementById('crash-hint');
const crashDismissEl = document.getElementById('crash-dismiss');

async function boot() {
  const canvas = document.getElementById('game-canvas');

  log.info('Starting Minexel');

  const loadingEl = document.getElementById('loading-screen');
  loadingEl?.classList.remove('hidden');
  const progressFill = document.getElementById('load-progress-fill');
  const statusEl = document.getElementById('load-status');

  const assets = new Assets();
  await assets.load({
    blocks: blockTextureManifest(Blocks),
    items: itemTextureManifest(Items),
    font: 'assets/font/ascii.png',
    clouds: 'assets/textures/clouds.png',
  }, (pct, label) => {
    if (progressFill) progressFill.style.width = Math.round(pct * 100) + '%';
    if (statusEl) statusEl.textContent = label;
  });
  log.info('Loaded textures and font');

  const game = new Game(canvas, assets);
  window.game = game;
  log.info('Built the game');

  const loadingScreen = new LoadingScreen(game);

  loadingScreen.setProgress(0.85);
  loadingScreen.setStatus('Loading language...');
  await game.initLanguage();
  log.info('Loaded language (%s)', game.settings.language ?? 'en_us');

  loadingScreen.setProgress(0.9);
  loadingScreen.setStatus('Loading settings...');
  await game.loadSettings();
  log.info('Loaded settings');

  loadingScreen.hide();

  if (!window.electronSaves) {

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
        Minexel is designed for the <strong>Electron desktop app</strong> to save worlds and settings.
      </p>
      <p style="font-size: 16px; color: #aaa; margin-bottom: 32px;">
        Running in a browser uses <strong>session-only storage</strong> — your world will be <strong>lost when you close the tab</strong>.
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
    document.body.appendChild(overlay);

    document.getElementById('continue-btn').addEventListener('click', () => {
      overlay.remove();

      game.state = STATE.LOADING;
      game.screens.title.show();
      game.start();
      game.applySettings();
      log.info('Reached the title screen (browser mode, no saves)');

      const resume = () => {
        audio.init();
        audio.resume();
        if (game.state === 'title') audio.playMusic('menu');
      };
      window.addEventListener('pointerdown', resume, { once: true });
      window.addEventListener('keydown', resume, { once: true });
    });

    document.getElementById('electron-btn').addEventListener('click', () => {
      overlay.remove();

      const msg = document.createElement('div');
      msg.style.cssText = `
        position: fixed; inset: 0; z-index: 1000;
        background: rgba(16, 16, 16, 0.98);
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        color: #fff; font-family: 'Minecraft', 'Minecraftia', monospace;
        text-align: center; padding: 40px;
      `;
      msg.innerHTML = `
        <h2 style="color: #e6d91a; margin-bottom: 20px;">Launch Electron App</h2>
        <p style="max-width: 500px; margin-bottom: 16px; line-height: 1.6;">
          You need to close this browser tab and run the game from the <strong>Electron desktop app</strong>:
        </p>
        <pre style="background: #1a1a1a; padding: 16px; border: 2px solid #373737; border-radius: 4px; margin: 16px 0; text-align: left;">
<code>start-electron.bat</code>
        </pre>
        <p style="font-size: 14px; color: #aaa;">Or run: <code>npm run electron</code></p>
        <button id="close-msg" style="
          padding: 10px 24px;
          font-family: 'Minecraft', 'Minecraftia', monospace;
          background: #5a5a5a;
          border: 2px solid #2f2f2f;
          color: #fff;
          cursor: pointer;
        ">Close</button>
      `;
      document.body.appendChild(msg);
      document.getElementById('close-msg').addEventListener('click', () => msg.remove());
    });

    return;
  }

  game.screens.title.show();
  game.start();
  game.applySettings();
  log.info('Reached the title screen');

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

function buildReport(err, where) {
  const lines = [];
  const version = window.game?.version;
  lines.push(`Minexel${version ? ` ${version}` : ' (dev)'}`);
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

function showCrash(err, where, opts = {}) {
  log.error('%s during %s', err instanceof Error ? err.message : String(err), where, err);
  if (crashShown) {

    lastReport += `\n\n--- also during ${where} ---\n${err instanceof Error ? err.stack || err.message : String(err)}`;
    crashReportEl.textContent = lastReport;
    return;
  }
  crashShown = true;

  crashTitleEl.textContent = opts.title ?? 'Minexel has crashed!';
  crashSubEl.textContent = opts.sub ?? 'Sorry :(';
  crashCodeEl.textContent = reportCode();
  lastReport = buildReport(err, where);
  crashReportEl.textContent = lastReport;
  crashHintEl.textContent = opts.hint ?? '';

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

        crashHintEl.textContent = 'Could not reach the clipboard - the details below can be selected and copied by hand.';
      }
    });

  crashDismissEl?.addEventListener('click', () => {
    hideCrash();
    crashHintEl.textContent = '';
  });
}

function installCrashHandling() {
  window.addEventListener('error', (ev) => {
    showCrash(ev.error ?? ev.message, 'runtime', {
      title: 'Minexel has crashed!',
      sub: 'Sorry :(',
      hint: 'If the game still looks playable underneath, Dismiss returns to it.',
    });
  });
  window.addEventListener('unhandledrejection', (ev) => {
    showCrash(ev.reason, 'async', {
      title: 'Minexel has crashed!',
      sub: 'Sorry :(',
      hint: 'If the game still looks playable underneath, Dismiss returns to it.',
    });
  });
}

function installContextGuard(game, canvas) {
  let stopped = false;

  canvas.addEventListener('webglcontextlost', (ev) => {

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

function watchForStaleCode() {
  const mine = Date.now();
  let ask = true;
  const check = async () => {

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
        document.title = 'Minexel';
        return;
      }
      document.title = 'Minexel - RELOAD';
      log.warn('This tab is running code older than the files on disk. Nothing you changed will appear until you reload.');
    } catch {

    }
  };
  const tick = () => { check(); setTimeout(tick, 4000); };
  setTimeout(tick, 4000);
}

installCrashHandling();

boot().catch((err) => {
  showCrash(err, 'startup', {
    title: 'Minexel could not start',
    sub: 'The report below says where it stopped.',
    dismissible: false,
  });
});
