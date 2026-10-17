import { randomInt, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  shell,
} from "electron";
import { newCharacter } from "../engine/save";
import { type AppInfo, IPC, type ReadyDetails, type Scene } from "../shared/bridge";
import { SaveStore } from "./save-store";

/** When set, the app renders once, saves a screenshot and report to this path, then quits. */
const smokeScreenshotPath = process.env.EMBERCRAWL_SMOKE_SCREENSHOT;
const SMOKE_SCENES: readonly Scene[] = ["title", "game", "pack"];
const smokeScene: Scene =
  SMOKE_SCENES.find((scene) => scene === process.env.EMBERCRAWL_SMOKE_SCENE) ?? "title";

// Development builds keep their own saves, so testing never touches a player's real characters.
// Tests can point the app at a throwaway folder instead.
if (process.env.EMBERCRAWL_USER_DATA) app.setPath("userData", process.env.EMBERCRAWL_USER_DATA);
else if (!app.isPackaged) app.setPath("userData", join(app.getPath("appData"), "Embercrawl Dev"));

const devServerUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
const rendererFile = join(__dirname, "../renderer/index.html");
/** Only pages starting with this address may use the save bridge. */
const trustedPagePrefix = devServerUrl ?? pathToFileURL(rendererFile).href;

const saves = new SaveStore(join(app.getPath("userData"), "Saves"));

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
  // Finish any save still being written before the process exits.
  let savesFlushed = false;
  app.on("before-quit", (event) => {
    if (savesFlushed) return;
    event.preventDefault();
    void saves.flush().finally(() => {
      savesFlushed = true;
      app.quit();
    });
  });
  void app.whenReady().then(start);
}

function start(): void {
  if (app.isPackaged) Menu.setApplicationMenu(null);
  registerIpcHandlers();
  const window = createMainWindow();
  if (smokeScreenshotPath) runSmokeTest(window, smokeScreenshotPath);
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC.getAppInfo, (event): AppInfo => {
    assertTrustedSender(event);
    return {
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      platform: process.platform,
      arch: process.arch,
    };
  });
  ipcMain.handle(IPC.listCharacters, (event) => {
    assertTrustedSender(event);
    return saves.list();
  });
  ipcMain.handle(IPC.loadCharacter, (event, id: unknown) => {
    assertTrustedSender(event);
    if (typeof id !== "string") throw new TypeError("A character id must be text.");
    return saves.load(id);
  });
  ipcMain.handle(IPC.createCharacter, async (event, name: unknown) => {
    assertTrustedSender(event);
    if (typeof name !== "string") throw new TypeError("A character name must be text.");
    const save = newCharacter({
      id: randomUUID(),
      name,
      now: new Date().toISOString(),
      seed: randomInt(0, 2 ** 32),
    });
    await saves.write(save);
    return save;
  });
  ipcMain.handle(IPC.writeCharacter, (event, data: unknown) => {
    assertTrustedSender(event);
    return saves.write(data);
  });
  ipcMain.handle(IPC.toggleFullscreen, (event) => {
    assertTrustedSender(event);
    const window = BrowserWindow.fromWebContents(event.sender);
    return window ? toggleFullscreen(window) : false;
  });
}

function toggleFullscreen(window: BrowserWindow): boolean {
  const next = !window.isFullScreen();
  window.setFullScreen(next);
  return next;
}

/** Rejects bridge calls from anything other than the game's own page. */
function assertTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent): void {
  const url = event.senderFrame?.url ?? "";
  if (!url.startsWith(trustedPagePrefix))
    throw new Error("Blocked a request from an unexpected page.");
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

  // F11 and Alt+Enter toggle fullscreen on every screen. Handled here, before the page or the
  // development menu sees the key, so it can't fire twice.
  window.webContents.on("before-input-event", (event, input) => {
    const fullscreenKey = input.key === "F11" || (input.alt && input.key === "Enter");
    if (input.type !== "keyDown" || !fullscreenKey || input.isAutoRepeat) return;
    event.preventDefault();
    toggleFullscreen(window);
  });

  // Smoke tests can open straight into the game; normal launches show the title screen.
  const hash = smokeScreenshotPath && smokeScene !== "title" ? `scene=${smokeScene}` : undefined;
  if (devServerUrl) void window.loadURL(hash ? `${devServerUrl}#${hash}` : devServerUrl);
  else void window.loadFile(rendererFile, hash ? { hash } : {});
  return window;
}

/** Waits for the expected screen's first frames, then records a screenshot and any console errors. */
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
    await saves.flush();
    const ok = !failure && errors.length === 0;
    const report = {
      ok,
      failure: failure ?? null,
      errors,
      renderer: details?.renderer ?? null,
      scene: details?.scene ?? null,
      size,
    };
    await writeFile(`${screenshotPath}.json`, JSON.stringify(report, null, 2));
    app.exit(ok ? 0 : 1);
  };

  timeout = setTimeout(
    () => void finish(null, `The ${smokeScene} screen did not report ready within 20 seconds.`),
    20_000,
  );
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    void finish(null, `The game window crashed: ${details.reason}`);
  });
  ipcMain.on(IPC.rendererReady, (event, details: ReadyDetails) => {
    assertTrustedSender(event);
    if (details?.scene !== smokeScene) return;
    // Let a few frames draw before capturing.
    setTimeout(() => void finish(details), 750);
  });
}
