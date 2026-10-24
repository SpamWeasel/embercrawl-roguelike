import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { sound } from "./audio/player";
import { SettingsProvider } from "./settings/SettingsContext";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("The page is missing its #root element.");

// Automated runs (the smoke test opens a scene directly) stay silent.
if (new URLSearchParams(window.location.hash.slice(1)).has("scene")) sound.silence();

// Every button clicks softly; a button can opt out with data-sound="none".
document.addEventListener(
  "click",
  (event) => {
    const button = (event.target as Element | null)?.closest?.("button");
    if (button && !button.disabled && button.dataset.sound !== "none") sound.play("ui-click");
  },
  true,
);

createRoot(root).render(
  <StrictMode>
    <SettingsProvider>
      <App />
    </SettingsProvider>
  </StrictMode>,
);
