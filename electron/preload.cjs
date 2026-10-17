/**
 * Bridge between the renderer and the shell.
 *
 * Two objects are exposed:
 *
 *  window.electronSaves - read and write save files on disk. Absent in a plain
 *  browser (see SaveGame.js), so those calls only exist inside the shell.
 *
 *  window.mcVoxel.terminal - hand a formatted log line to the shell so it can
 *  be printed to stdout in the terminal the app was started from. Logger.js
 *  formats the line; this only carries it across the process boundary.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronSaves', {
  list: () => ipcRenderer.invoke('saves:list'),
  get: (id) => ipcRenderer.invoke('saves:get', id),
  put: (record) => ipcRenderer.invoke('saves:put', record),
  remove: (id) => ipcRenderer.invoke('saves:remove', id),
  usage: () => ipcRenderer.invoke('saves:usage'),
  getSettings: () => ipcRenderer.invoke('saves:getSettings'),
  putSettings: (settings) => ipcRenderer.invoke('saves:putSettings', settings),
});

contextBridge.exposeInMainWorld('mcVoxel', {
  /**
   * @param {string} level ERROR | WARN | INFO | DEBUG | TRACE
   * @param {string} line the formatted line, written by the caller
   */
  terminal: (level, line) => ipcRenderer.send('terminal-log', level, line),
});
