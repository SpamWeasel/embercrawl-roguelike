import { randomInt, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
  shell,
} from "electron";
import { type CharacterSave, newCharacter, summarizeCharacter } from "../engine/save";
import {
  type AppInfo,
  type ExportResult,
  type ImportResult,
  IPC,
  type ReadyDetails,
  type Scene,
} from "../shared/bridge";
import { SAVE_EXTENSION, SaveStore } from "./save-store";
import { SettingsStore } from "./settings-store";

/** When set, the app renders once, saves a screenshot and report to this path, then quits. */
const smokeScreenshotPath = process.env.EMBERCRAWL_SMOKE_SCREENSHOT;
const SMOKE_SCENES: readonly Scene[] = ["title", "settings", "records", "game", "pack", "shop"];
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

const saves = new SaveStore(join(app.getPath("userData"), "Saves"), {
  trash: (path) => shell.trashItem(path),
});
const settings = new SettingsStore(join(app.getPath("userData"), "settings.json"));
/** Imports waiting for the player to choose "replace" or "keep both", by token. */
const pendingImports = new Map<string, CharacterSave>();
const FILE_FILTERS = [{ name: "Embercrawl character", extensions: [SAVE_EXTENSION.slice(1)] }];

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
    // Opening a character to play takes a backup of it first.
    return saves.open(text(id, "A character id"));
  });
  ipcMain.handle(IPC.renameCharacter, async (event, id: unknown, name: unknown) => {
    assertTrustedSender(event);
    await saves.rename(text(id, "A character id"), text(name, "A character name"));
  });
  ipcMain.handle(IPC.deleteCharacter, (event, id: unknown) => {
    assertTrustedSender(event);
    return saves.remove(text(id, "A character id"));
  });
  ipcMain.handle(IPC.exportCharacter, async (event, id: unknown): Promise<ExportResult> => {
    assertTrustedSender(event);
    const save = await saves.load(text(id, "A character id"));
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Export character",
      defaultPath: join(app.getPath("documents"), `${fileSafe(save.name)}${SAVE_EXTENSION}`),
      filters: FILE_FILTERS,
    };
    const choice = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (choice.canceled || !choice.filePath) return { status: "cancelled" };
    await saves.exportTo(save.id, choice.filePath);
    return { status: "saved", path: choice.filePath };
  });
  ipcMain.handle(IPC.importCharacter, async (event): Promise<ImportResult> => {
    assertTrustedSender(event);
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: "Import character",
      filters: FILE_FILTERS,
      properties: ["openFile" as const],
    };
    const choice = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const path = choice.filePaths[0];
    if (choice.canceled || !path) return { status: "cancelled" };
    const { save, existing } = await saves.readImport(path);
    if (!existing) {
      await saves.accept(save, "replace", save.id);
      return { status: "imported", summary: summarizeCharacter(save) };
    }
    const token = randomUUID();
    pendingImports.set(token, save);
    return {
      status: "conflict",
      token,
      incoming: summarizeCharacter(save),
      existing: summarizeCharacter(existing),
    };
  });
  ipcMain.handle(IPC.resolveImport, async (event, token: unknown, choice: unknown) => {
    assertTrustedSender(event);
    const save = pendingImports.get(text(token, "An import token"));
    pendingImports.delete(String(token));
    if (!save || choice === "cancel") return;
    if (choice !== "replace" && choice !== "copy") throw new TypeError("Unknown import choice.");
    await saves.accept(save, choice, randomUUID());
  });
  ipcMain.handle(IPC.listBackups, (event, id: unknown) => {
    assertTrustedSender(event);
    return saves.backups(text(id, "A character id"));
  });
  ipcMain.handle(IPC.restoreBackup, async (event, id: unknown, name: unknown) => {
    assertTrustedSender(event);
    await saves.restore(text(id, "A character id"), text(name, "A backup name"));
  });
  ipcMain.handle(IPC.openSavesFolder, async (event) => {
    assertTrustedSender(event);
    await mkdir(saves.directory, { recursive: true });
    const problem = await shell.openPath(saves.directory);
    if (problem) throw new Error(problem);
  });
  ipcMain.handle(IPC.loadSettings, (event) => {
    assertTrustedSender(event);
    return settings.load();
  });
  ipcMain.handle(IPC.saveSettings, async (event, data: unknown) => {
    assertTrustedSender(event);
    const saved = await settings.save(data);
    event.sender.setZoomFactor(saved.uiScale);
    return saved;
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

/** Checks that a bridge argument is text (anything else is a bug or tampering). */
function text(value: unknown, what: string): string {
  if (typeof value !== "string") throw new TypeError(`${what} must be text.`);
  return value;
}

/** A character name made safe to use as a file name. */
function fileSafe(name: string): string {
  // Names never hold control characters (see normalizeCharacterName), only these symbols.
  return name.replace(/[<>:"/\\|?*]/g, "").trim() || "Character";
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
  // The interface size setting is Electron's page zoom, so the dungeon stays pixel-crisp.
  window.webContents.on("did-finish-load", () => {
    void settings.load().then((stored) => window.webContents.setZoomFactor(stored.uiScale));
  });

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
