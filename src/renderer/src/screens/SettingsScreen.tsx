import { useEffect, useState } from "react";
import {
  bindKey,
  DEFAULT_KEYS,
  KEY_ACTIONS,
  KEYS_PER_ACTION,
  type KeyAction,
  keyLabel,
  RESERVED_KEYS,
  type Settings,
  UI_SCALES,
  type UiScale,
  unbindKey,
} from "../../../shared/settings";
import { toggleFullscreen } from "../fullscreen";
import { savesAreLocalToBrowser } from "../saves/saveService";
import { useSettings } from "../settings/SettingsContext";
import { Dialog } from "./Dialog";

const ACTION_NAMES: Readonly<Record<KeyAction, string>> = {
  "move-n": "Move up",
  "move-s": "Move down",
  "move-w": "Move left",
  "move-e": "Move right",
  "move-nw": "Move up-left",
  "move-ne": "Move up-right",
  "move-sw": "Move down-left",
  "move-se": "Move down-right",
  wait: "Wait a turn",
  interact: "Stairs, rest, trade, pick up",
  lantern: "Lantern bright / dim",
  pulse: "Lantern pulse",
  pack: "Open the pack",
  map: "Map size",
  help: "How to play",
};

const SCALE_NAMES: Readonly<Record<UiScale, string>> = {
  0.9: "Smaller",
  1: "Normal",
  1.15: "Larger",
  1.3: "Largest",
};

/** The settings, opened from the title screen or the pause menu. Changes apply and save at once. */
export function SettingsScreen({ onClose }: { onClose(): void }) {
  const { settings, update, error } = useSettings();
  const [capturing, setCapturing] = useState<{ action: KeyAction; index: number } | null>(null);
  const set = (change: Partial<Settings>) => update({ ...settings, ...change });

  // While waiting for a key, take the next key press (Escape cancels) before anything else sees it.
  useEffect(() => {
    if (!capturing) return;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.code !== "Escape" && !RESERVED_KEYS.has(event.code)) {
        update({
          ...settings,
          keys: bindKey(settings.keys, capturing.action, capturing.index, event.code),
        });
      }
      setCapturing(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [capturing, settings, update]);

  const choice = <T,>(value: T, current: T, label: string, onPick: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={value === current}
      className={`btn btn-small ${value === current ? "btn-primary" : ""}`}
      onClick={onPick}
    >
      {label}
    </button>
  );

  return (
    <Dialog title="Settings" onClose={() => !capturing && onClose()} wide>
      <section className="flex flex-col gap-3">
        <SettingRow
          label="Interface size"
          note={savesAreLocalToBrowser ? "Applies in the desktop app." : undefined}
        >
          {UI_SCALES.map((scale) =>
            choice(scale, settings.uiScale, SCALE_NAMES[scale], () => set({ uiScale: scale })),
          )}
        </SettingRow>
        <SettingRow label="Animation">
          {choice("system", settings.motion, "Follow Windows", () => set({ motion: "system" }))}
          {choice("reduced", settings.motion, "Always calm", () => set({ motion: "reduced" }))}
        </SettingRow>
        <SettingRow label="Map in the corner">
          {choice("small", settings.minimap, "Small", () => set({ minimap: "small" }))}
          {choice("large", settings.minimap, "Large", () => set({ minimap: "large" }))}
          {choice("hidden", settings.minimap, "Hidden", () => set({ minimap: "hidden" }))}
        </SettingRow>
        {!savesAreLocalToBrowser && (
          <SettingRow label="Fullscreen">
            <button type="button" className="btn btn-small" onClick={() => void toggleFullscreen()}>
              Switch <kbd className="kbd">F11</kbd>
            </button>
          </SettingRow>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="controls-heading">
        <div className="flex items-center justify-between">
          <h3 id="controls-heading" className="text-sm tracking-[0.2em] text-bone/60 uppercase">
            Controls
          </h3>
          <button
            type="button"
            className="btn btn-small"
            onClick={() => set({ keys: DEFAULT_KEYS })}
          >
            Reset to defaults
          </button>
        </div>
        <p className="text-xs text-bone/55">
          Click a key to change it, then press the new key (Esc cancels). A key can only do one
          thing, so it moves from any action that had it. Esc (menu), 1–0 (items) and F11
          (fullscreen) are fixed.
        </p>
        <table className="w-full text-sm">
          <tbody>
            {KEY_ACTIONS.map((action) => (
              <tr key={action} className="border-t border-white/8">
                <td className="py-1.5 text-bone/80">{ACTION_NAMES[action]}</td>
                <td className="py-1.5">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {Array.from({ length: KEYS_PER_ACTION }, (_, index) => {
                      const code = settings.keys[action][index];
                      const waiting = capturing?.action === action && capturing.index === index;
                      if (!code && index > settings.keys[action].length) return null;
                      return (
                        // biome-ignore lint/suspicious/noArrayIndexKey: a binding slot is a fixed position.
                        <span key={`${action}-${index}`} className="flex items-center">
                          <button
                            type="button"
                            className={`key-slot ${waiting ? "key-slot--waiting" : ""} ${code ? "" : "key-slot--empty"}`}
                            onClick={() => setCapturing({ action, index })}
                          >
                            {waiting ? "Press a key…" : code ? keyLabel(code) : "+ Add"}
                          </button>
                          {code && !waiting && (
                            <button
                              type="button"
                              className="key-remove"
                              aria-label={`Remove ${keyLabel(code)} from ${ACTION_NAMES[action]}`}
                              onClick={() =>
                                update({
                                  ...settings,
                                  keys: unbindKey(settings.keys, action, index),
                                })
                              }
                            >
                              ×
                            </button>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {error && <p className="text-sm text-[#ff9c8a]">Could not save settings: {error}</p>}
    </Dialog>
  );
}

function SettingRow({
  label,
  note,
  children,
}: {
  label: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm text-bone/80">
        {label}
        {note && <span className="block text-xs text-bone/45">{note}</span>}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
