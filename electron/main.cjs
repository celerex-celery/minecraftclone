/**
 * Electron shell around the game.
 *
 * The game itself is a plain web app served by tools/serve.js, so this just
 * starts that server, points a BrowserWindow at it, and cleans both up on quit.
 * No game code is touched.
 */

const { app, BrowserWindow, shell, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

// Make the app show up as "Minecraft Voxel" in Task Manager and the
// notification area instead of the generic Electron entry.
app.setName('Minecraft Voxel');
app.setAppUserModelId('com.yourname.minecraftvoxel');

/* ---------------------------------- logging ---------------------------------
 *
 * One line shape for the whole app, the way Vanilla writes it:
 *
 *   [14:32:07] [main/INFO]: (Minecraft Voxel) serving at http://localhost:3066
 *   [14:32:07] [Render thread/WARN]: (TextureAtlas) no tile named "missing"
 *
 * The renderer side lives in src/core/Logger.js, which formats the line and
 * sends it here over the `terminal` bridge in preload.cjs; everything this file
 * prints itself goes through logLine() so it matches. Anything left using a raw
 * console.* call in the renderer is caught by the `console-message` handler in
 * createWindow and printed with the same shape, so nothing reaches the terminal
 * as an unlabelled blob.
 */

/** Local time, hours to seconds, as it appears in the brackets. */
function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Write one line to stdout in the standard shape.
 *
 * @param {string} thread 'main' for this process, 'Render thread' for the game
 * @param {string} level ERROR | WARN | INFO | DEBUG | TRACE
 * @param {string} text the message itself
 */
function logLine(thread, level, text) {
  process.stdout.write(`[${stamp()}] [${thread}/${level}]: ${text}\n`);
}

// The renderer's loggers arrive here already formatted; a level is sent too so
// a future filter could drop DEBUG lines without parsing them back apart.
ipcMain.on('terminal-log', (_e, level, line) => {
  logLine('Render thread', level, line);
});

/* ---------------------------------- memory ---------------------------------
 *
 * The renderer is a voxel game, so its high-water mark is set by chunk meshes
 * and block data rather than by anything the shell does. Two switches keep
 * that bounded and let the heap be handed back on a schedule instead of only
 * when V8 decides to:
 *
 *   --max-old-space-size  caps JS heap growth before V8 slows down hard
 *   --expose-gc           puts window.gc() in the renderer for the periodic
 *                         trim Game.frame() runs; absent in a plain browser
 *
 * Neither changes what the game draws or how it plays; they only bound memory.
 */
app.commandLine.appendSwitch(
  'js-flags',
  '--max-old-space-size=2048 --expose-gc'
);

const ROOT = path.join(__dirname, '..');
const PORT = 3066;
const URL = `http://localhost:${PORT}/`;

/* ============================ saves on disk ============================
 *
 * Worlds live as plain JSON files in %APPDATA%\Minecraft Voxel\worlds,
 * one file per world, so they can be inspected and backed up without
 * digging through the Electron profile's IndexedDB.
 */

function worldsDir() {
  const dir = path.join(app.getPath('userData'), 'worlds');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function worldFile(id) {
  if (typeof id !== 'string' || !/^[\w.-]{1,128}$/.test(id)) {
    throw new Error(`invalid world id: ${id}`);
  }
  return path.join(worldsDir(), `${id}.json`);
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

ipcMain.handle('saves:list', async () => {
  const dir = worldsDir();
  const out = [];
  for (const name of await fsp.readdir(dir)) {
    if (!name.endsWith('.json')) continue;
    const rec = await readJson(path.join(dir, name), null);
    if (rec) out.push(rec);
  }
  return out.sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0));
});

ipcMain.handle('saves:get', async (_e, id) => {
  return (await readJson(worldFile(id), null)) ?? null;
});

ipcMain.handle('saves:put', async (_e, record) => {
  const file = worldFile(record.id);
  await fsp.writeFile(file, JSON.stringify(record), 'utf8');
  return record;
});

ipcMain.handle('saves:remove', async (_e, id) => {
  try {
    await fsp.rm(worldFile(id), { force: true });
  } catch {
    /* already gone */
  }
  return true;
});

ipcMain.handle('saves:usage', async () => {
  const dir = worldsDir();
  let total = 0;
  for (const name of await fsp.readdir(dir)) {
    try {
      total += (await fsp.stat(path.join(dir, name))).size;
    } catch {
      /* ignore */
    }
  }
  return total;
});

ipcMain.handle('saves:getSettings', async () => {
  return (await readJson(settingsFile(), null)) ?? null;
});

ipcMain.handle('saves:putSettings', async (_e, settings) => {
  await fsp.writeFile(settingsFile(), JSON.stringify(settings), 'utf8');
  return true;
});

ipcMain.handle('app:quit', () => app.quit());

ipcMain.handle('app:gpu-info', async () => {
  try {
    const info = await win.webContents.getGPUInfo();
    const d = info.gpuDevice;
    return d && d.active
      ? { vendorId: d.vendorId, deviceId: d.deviceId }
      : null;
  } catch {
    return null;
  }
});

let serveProc = null;
let mainWin = null;

function startDevServer() {
  return new Promise((resolve, reject) => {
    serveProc = spawn('node', [path.join(ROOT, 'tools', 'serve.js'), String(PORT)], {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    // Each chunk can carry several lines, so they are split rather than logged
    // as one entry with newlines inside it.
    const echo = (level) => (chunk) => {
      for (const line of String(chunk).split('\n')) {
        const text = line.trim();
        if (text) logLine('main', level, text);
      }
    };

    serveProc.stdout.on('data', (chunk) => {
      echo('INFO')(chunk);
      // The server says "running at" once it is listening. Until it does there
      // is nothing at PORT to load, so the promise stays open here.
      if (!settled && String(chunk).includes('running at')) {
        settled = true;
        resolve();
      }
    });
    serveProc.stderr.on('data', echo('ERROR'));
    serveProc.on('error', fail);
    serveProc.on('exit', (code) => {
      if (settled) return;
      fail(new Error(`dev server exited before it was ready (code ${code}) - is port ${PORT} in use?`));
    });
  });
}

function stopDevServer() {
  if (serveProc) {
    serveProc.kill();
    serveProc = null;
  }
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 800,
    minHeight: 500,
    title: 'Minecraft Voxel',
    icon: path.join(ROOT, 'favicon.ico'),
    backgroundColor: '#1b1b1b',
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWin = win;
  win.setMenu(null);
  await win.loadURL(URL);

  // Every half minute, print what each side is holding. The Node side here
  // should stay flat; if the renderer numbers keep climbing that is a leak in
  // the game, not in the shell, and the two sides log separately.
  setInterval(async () => {
    const main = process.memoryUsage();
    logLine('main', 'INFO',
      `memory main rss ${(main.rss / 1048576).toFixed(0)}MB, ` +
      `heapUsed ${(main.heapUsed / 1048576).toFixed(0)}MB`);
    try {
      const m = await win.webContents.executeJavaScript(
        '({ js: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize })'
      );
      logLine('Render thread', 'INFO',
        `memory heapUsed ${(m.js / 1048576).toFixed(0)}MB, ` +
        `heapTotal ${(m.total / 1048576).toFixed(0)}MB`);
    } catch {
      /* window gone */
    }
    try {
      const gpu = await win.webContents.getGPUInfo();
      const d = gpu.gpuDevice;
      if (d && d.active) {
        logLine('Render thread', 'INFO',
          `gpu vendorId 0x${d.vendorId?.toString(16) ?? '?'} deviceId 0x${d.deviceId?.toString(16) ?? '?'} active`);
      }
    } catch {
      /* gpu info not available */
    }
  }, 30000);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Catch renderer output that bypasses Logger.js - three.js warnings, the
  // browser's own complaints - so it reaches the terminal labelled instead of
  // as an unlabelled blob. Lines the logger sends are not console output and so
  // do not come through here: there is exactly one print per line.
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const name = ['TRACE', 'INFO', 'WARN', 'ERROR'][level] ?? 'INFO';
    const where = sourceId ? ` (${sourceId.split('/').pop()}:${line})` : '';
    logLine('Render thread', name, `${message}${where}`);
  });
}

app.whenReady().then(async () => {
  try {
    await startDevServer();
  } catch (err) {
    app.quit();
    throw err;
  }
  await createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopDevServer();
  app.quit();
});

app.on('will-quit', stopDevServer);
