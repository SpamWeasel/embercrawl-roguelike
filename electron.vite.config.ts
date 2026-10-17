import { defineConfig } from "electron-vite";
import { RENDERER_PORT, rendererPlugins } from "./vite.renderer";

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: rendererPlugins(),
    server: { port: RENDERER_PORT, strictPort: true },
  },
});
