import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// A separate trusted window keeps consent outside the requesting renderer.
export function prompt(parent, root, { title, message, detail, confirm }) {
  return new Promise(resolve => {
    const file = join(root, 'dist', 'prompt.html');
    const child = new BrowserWindow({ parent, modal: true, frame: false, width: 480, height: 350, resizable: false, show: false, backgroundColor: '#141716',
      webPreferences: { preload: join(root, 'electron', 'prompt-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    let answered = false;
    const finish = value => { if (answered) return; answered = true; ipcMain.removeListener('spot:prompt', reply); resolve(value); if (!child.isDestroyed()) child.close(); };
    const reply = (event, value) => {
      if (event.sender !== child.webContents || event.senderFrame !== child.webContents.mainFrame || event.senderFrame.url !== pathToFileURL(file).href || typeof value !== 'boolean') return;
      finish(value);
    };
    ipcMain.on('spot:prompt', reply);
    child.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    child.webContents.on('will-navigate', e=>e.preventDefault());
    child.once('closed',()=>finish(false));
    child.once('ready-to-show',()=>{child.webContents.send('spot:prompt-content',{title,message,detail,confirm});if(parent.isVisible())child.show();});
    child.loadFile(file).catch(()=>finish(false));
  });
}

