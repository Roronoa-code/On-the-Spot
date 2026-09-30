const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('onTheSpot', {
  state: () => ipcRenderer.invoke('spot:state'),
  command: (action, payload = {}) => ipcRenderer.invoke('spot:command', action, payload),
});
