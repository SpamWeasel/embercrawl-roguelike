import { contextBridge, ipcRenderer } from "electron";
import { type EmbercrawlBridge, IPC } from "../shared/bridge";

const bridge: EmbercrawlBridge = {
  getAppInfo: () => ipcRenderer.invoke(IPC.getAppInfo),
  signalReady: (details) => ipcRenderer.send(IPC.rendererReady, details),
};

contextBridge.exposeInMainWorld("embercrawl", bridge);
