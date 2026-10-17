/**
 * Switches fullscreen: through the desktop shell in the app, or the browser's own fullscreen in
 * the browser preview. (In the app, F11 and Alt+Enter are handled by the shell directly.)
 */
export async function toggleFullscreen(): Promise<boolean> {
  if (window.embercrawl) return window.embercrawl.toggleFullscreen();
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return false;
  }
  await document.documentElement.requestFullscreen();
  return true;
}
