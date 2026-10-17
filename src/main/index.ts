import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import { type AppInfo, IPC, type ReadyDetails } from "../shared/bridge";

/** When set, the app renders once, saves a screenshot and report to this path, then quits. */
const smokeScreenshotPath = process.env.EMBERCRAWL_SMOKE_SCREENSHOT;

// One running copy at a time, so two windows can never write the same save files.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on("window-all-closed", () => app.quit());
  void app.whenReady().then(start);
}

function start(): void {
  if (app.isPackaged) Menu.setApplicationMenu(null);

  ipcMain.handle(
    IPC.getAppInfo,
    (): AppInfo => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      platform: process.platform,
      arch: process.arch,
    }),
  );

  const window = createMainWindow();
  if (smokeScreenshotPath) runSmokeTest(window, smokeScreenshotPath);
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: "#07070b",
    title: "Embercrawl",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.once("ready-to-show", () => window.show());

  // The game never opens other pages; links go to the player's default browser instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devServerUrl) void window.loadURL(devServerUrl);
  else void window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
}

/** Waits for the first rendered frames, then records a screenshot and any console errors. */
function runSmokeTest(window: BrowserWindow, screenshotPath: string): void {
  const errors: string[] = [];
  let finished = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const finish = async (details: ReadyDetails | null, failure?: string): Promise<void> => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    let size: Electron.Size | null = null;
    if (!failure) {
      const image = await window.webContents.capturePage();
      await writeFile(screenshotPath, image.toPNG());
      size = image.getSize();
    }
    const ok = !failure && errors.length === 0;
    const report = {
      ok,
      failure: failure ?? null,
      errors,
      renderer: details?.renderer ?? null,
      size,
    };
    await writeFile(`${screenshotPath}.json`, JSON.stringify(report, null, 2));
    app.exit(ok ? 0 : 1);
  };

  timeout = setTimeout(
    () => void finish(null, "The game window did not report ready within 20 seconds."),
    20_000,
  );
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    void finish(null, `The game window crashed: ${details.reason}`);
  });
  ipcMain.once(IPC.rendererReady, (_event, details: ReadyDetails) => {
    // Let a few frames of animation draw before capturing.
    setTimeout(() => void finish(details), 750);
  });
}
