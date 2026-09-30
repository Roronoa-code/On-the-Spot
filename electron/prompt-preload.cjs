const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('spotPrompt',{
  content: callback=>ipcRenderer.once('spot:prompt-content',(_event,value)=>callback(value)),
  reply: value=>ipcRenderer.send('spot:prompt',value),
});
