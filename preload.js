const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('posDB', {
  load: () => ipcRenderer.sendSync('db:load'),
  save: S => ipcRenderer.sendSync('db:save', S),
  path: () => ipcRenderer.sendSync('db:path'),
  print: silent => ipcRenderer.invoke('print', silent),
  desktop: true
});
