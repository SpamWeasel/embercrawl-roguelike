import { contextBridge, ipcRenderer } from "electron";
import { type EmbercrawlBridge, IPC } from "../shared/bridge";

const bridge: EmbercrawlBridge = {
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  signalReady: (details) => ipcRenderer.send(IPC.rendererReady, details),
  toggleFullscreen: () => ipcRenderer.invoke(IPC.toggleFullscreen),
  saves: {
    list: () => ipcRenderer.invoke(IPC.listCharacters),
    load: (id) => ipcRenderer.invoke(IPC.loadCharacter, id),
    create: (name) => ipcRenderer.invoke(IPC.createCharacter, name),
    write: (save) => ipcRenderer.invoke(IPC.writeCharacter, save),
  },
};

contextBridge.exposeInMainWorld("embercrawl", bridge);
