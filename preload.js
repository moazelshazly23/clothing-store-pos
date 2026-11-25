const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('posDB', {
  load: () => ipcRenderer.sendSync('db:load'),
  save: S => ipcRenderer.sendSync('db:save', S),
  path: () => ipcRenderer.sendSync('db:path'),
  version: () => ipcRenderer.sendSync('app:version'),
  print: silent => ipcRenderer.invoke('print', silent),
  openWA: url => ipcRenderer.invoke('open:wa', url),
  backupNow: () => ipcRenderer.invoke('backup:now'),
  backupOpen: () => ipcRenderer.invoke('backup:open'),
  backupList: () => ipcRenderer.invoke('backup:list'),
  backupRead: n => ipcRenderer.invoke('backup:read', n),
  pickFolder: () => ipcRenderer.invoke('dialog:folder'),
  sync: o => ipcRenderer.invoke('sync:run', o),
  desktop: true
});
