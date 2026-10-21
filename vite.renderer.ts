import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { Plugin, PluginOption } from "vite";

/**
 * Renderer (game window) build settings shared by the desktop build (electron.vite.config.ts)
 * and the browser-only preview (vite.web.config.mts), so the two can never drift apart.
 */
export const RENDERER_ROOT = "src/renderer";
export const RENDERER_PORT = 5173;

/**
 * Content security policy for the packaged game: only its own files may load, and nothing may be
 * fetched from the internet. Dev servers skip it so hot reload can inject its scripts.
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function productionCsp(): Plugin {
  return {
    name: "embercrawl-production-csp",
    apply: "build",
    transformIndexHtml: (html) =>
      html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${PRODUCTION_CSP}" />`,
      ),
  };
}

/** Makes the game's version (from package.json) available to the UI as __APP_VERSION__. */
function appVersion(): Plugin {
  const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
  return {
    name: "embercrawl-app-version",
    config: () => ({ define: { __APP_VERSION__: JSON.stringify(version) } }),
  };
}

export function rendererPlugins(): PluginOption[] {
  return [react(), tailwindcss(), productionCsp(), appVersion()];
}
