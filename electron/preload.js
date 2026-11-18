const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  onOpenFiles: (callback) => {
    ipcRenderer.on('open-glb-files', (_event, entries) => callback(entries));
  },
  onTriggerOpenDialog: (callback) => {
    ipcRenderer.on('trigger-open-dialog', () => callback());
  },
});
