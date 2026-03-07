const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('capture', {
  getClipboard: () => ipcRenderer.invoke('get-clipboard'),
  getNodes: () => ipcRenderer.invoke('get-nodes'),
  saved: (nodeId) => ipcRenderer.invoke('capture-saved', nodeId),
  close: () => ipcRenderer.invoke('close-capture'),
});
