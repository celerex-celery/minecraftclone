/**
 * Minimal static file server for local development.
 *
 * ES modules need a real HTTP origin, so the game cannot be opened straight
 * from the file system. Run this and open the printed URL.
 *
 *   node tools/serve.js [port]
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] ?? 3066);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * A 404 that looks like it belongs to the game.
 *
 * A mistyped path is the most common thing anyone asks this server for, and
 * "Not found: /aseets/textures" in plain text tells them nothing about where
 * they went wrong. This is styled in the same panel grey and hard borders the
 * rest of the UI uses, and it names the path back at them.
 */
function notFoundPage(urlPath) {
  const safe = urlPath.replace(/[<>&"]/g, (c) => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]
  ));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>404 - Minecraft Voxel</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    background: #1b1b1b; color: #fff;
    font-family: Consolas, "DejaVu Sans Mono", monospace;
  }
  .box {
    max-width: 560px; padding: 28px; text-align: center;
    background: #c6c6c6; color: #1f1f1f;
    border: 3px solid #000; box-shadow: inset 0 0 0 3px #fff;
  }
  .code { font-size: 56px; font-weight: bold; color: #8b2b2b; line-height: 1; }
  h1 { font-size: 18px; margin: 12px 0 16px; }
  .path {
    padding: 8px; margin-bottom: 18px; text-align: left;
    background: #8b8b8b; color: #fff; word-break: break-all; font-size: 13px;
  }
  a {
    display: inline-block; padding: 8px 18px; text-decoration: none;
    background: #7d7d7d; color: #fff; border: 3px solid;
    border-color: #6f6f6f #2b2b2b #2b2b2b #6f6f6f;
  }
  a:hover { background: #a5cfa5; }
  .note { margin-top: 16px; font-size: 12px; color: #4a4a4a; }
</style>
</head>
<body>
  <div class="box">
    <div class="code">404</div>
    <h1>That block is not in this world</h1>
    <div class="path">${safe}</div>
    <a href="/">Back to the title screen</a>
    <div class="note">the dev server serves the game folder as it is on disk</div>
  </div>
</body>
</html>
`;
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  /**
   * A stamp of the newest source file, for the client to poll.
   *
   * `no-store` on everything below stops the *next* fetch from being stale. It
   * cannot help a tab that has been open the whole time, which is the case that
   * actually bites: a page loaded an hour ago keeps running the modules it
   * loaded an hour ago, no matter what has been edited since, and the symptom is
   * an error about a property that plainly exists in the file. The game asks for
   * this and tells you when the answer has moved, so "is my tab stale?" is a
   * glance rather than a guess.
   */
  if (urlPath === '/__stamp') {
    let newest = 0;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(js|mjs|css|html)$/.test(entry.name)) {
          const m = fs.statSync(full).mtimeMs;
          if (m > newest) newest = m;
        }
      }
    };
    walk(path.join(ROOT, 'src'));
    walk(path.join(ROOT, 'styles'));
    for (const f of ['index.html']) {
      const m = fs.statSync(path.join(ROOT, f)).mtimeMs;
      if (m > newest) newest = m;
    }
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    }).end(String(newest));
    return;
  }

  const filePath = path.join(ROOT, path.normalize(urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // a browser gets the styled page, anything else gets the bare path,
      // because a script asking for a missing file wants the fact, not the
      // decoration
      if (!String(req.headers.accept ?? '').includes('text/html')) {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found: ' + urlPath);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
        .end(notFoundPage(urlPath));
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': TYPES[ext] ?? 'application/octet-stream',
      // no-store, not no-cache: a browser that revalidates a module can still
      // hold the old ES module in its registry, which shows up as a bogus
      // "does not provide an export named ..." error after an edit
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(data);
  });
});

/**
 * A busy port is the single most common way this server fails to start - a
 * second copy of start.bat, or a leftover from the last session still holding
 * the port. Node's answer to that is an unhandled 'error' event and a raw
 * stack trace, which tells the person at the keyboard nothing about what to do
 * about it, so it is answered here instead.
 */
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\n  Port ${PORT} is already in use.\n`
      + `  Something is already serving this folder - most likely another copy\n`
      + `  of this server, or a game already running in the browser tab.\n\n`
      + `  Either close that window, or start on a different port:\n`
      + `      node tools/serve.js ${PORT + 1}\n`,
    );
    process.exit(1);
  }
  if (err.code === 'EACCES') {
    console.error(`\n  Not allowed to listen on port ${PORT}.\n  Try a port above 1024.\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(
    `\n  Minecraft Voxel\n`
    + `  ----------------\n`
    + `  running at  http://localhost:${PORT}/\n\n`
    + `  stop with Ctrl+C\n`,
  );
});
