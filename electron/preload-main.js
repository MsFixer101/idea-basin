const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ideaBasin', {
  capture: () => ipcRenderer.send('trigger-capture'),
  popout: (html, title) => ipcRenderer.invoke('popout-window', html, title),
});
