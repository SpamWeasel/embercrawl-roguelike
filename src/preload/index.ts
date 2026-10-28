import { contextBridge, ipcRenderer } from "electron";
import { type EmbercrawlBridge, IPC } from "../shared/bridge";

const bridge: EmbercrawlBridge = {
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  signalReady: (details) => ipcRenderer.send(IPC.rendererReady, details),
  toggleFullscreen: () => ipcRenderer.invoke(IPC.toggleFullscreen),
  saves: {
    list: () => ipcRenderer.invoke(IPC.listCharacters),
    load: (id) => ipcRenderer.invoke(IPC.loadCharacter, id),
    create: (name, difficulty) => ipcRenderer.invoke(IPC.createCharacter, name, difficulty),
    write: (save) => ipcRenderer.invoke(IPC.writeCharacter, save),
    rename: (id, name) => ipcRenderer.invoke(IPC.renameCharacter, id, name),
    remove: (id) => ipcRenderer.invoke(IPC.deleteCharacter, id),
    exportCharacter: (id) => ipcRenderer.invoke(IPC.exportCharacter, id),
    importCharacter: () => ipcRenderer.invoke(IPC.importCharacter),
    resolveImport: (token, choice) => ipcRenderer.invoke(IPC.resolveImport, token, choice),
    backups: (id) => ipcRenderer.invoke(IPC.listBackups, id),
    restore: (id, backup) => ipcRenderer.invoke(IPC.restoreBackup, id, backup),
    openFolder: () => ipcRenderer.invoke(IPC.openSavesFolder),
    features: { recycleBin: true, backups: true, folder: true },
  },
  settings: {
    load: () => ipcRenderer.invoke(IPC.loadSettings),
    save: (settings) => ipcRenderer.invoke(IPC.saveSettings, settings),
  },
};

contextBridge.exposeInMainWorld("embercrawl", bridge);
