import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { DEFAULT_SETTINGS, type Settings } from "../../../shared/settings";
import { readableError, settingsService } from "../saves/saveService";

interface SettingsValue {
  readonly settings: Settings;
  /** Applies and stores new settings. */
  update(next: Settings): void;
  /** True once the stored settings have been read. */
  readonly loaded: boolean;
  readonly error: string | null;
}

const SettingsContext = createContext<SettingsValue>({
  settings: DEFAULT_SETTINGS,
  update: () => undefined,
  loaded: false,
  error: null,
});

/** Whether animation should be calm: the player's choice, or Windows' own setting. */
export function wantsReducedMotion(settings: Settings): boolean {
  return (
    settings.motion === "reduced" || window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Loads the player's settings once, applies them to the page, and shares them with every screen. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    settingsService.load().then(
      (stored) => {
        if (!active) return;
        setSettings(stored);
        setLoaded(true);
      },
      () => active && setLoaded(true),
    );
    return () => {
      active = false;
    };
  }, []);

  // Calm animation for CSS too (the dungeon reads it when it starts).
  useEffect(() => {
    document.documentElement.classList.toggle("reduce-motion", settings.motion === "reduced");
  }, [settings.motion]);

  const update = useCallback((next: Settings) => {
    setSettings(next);
    settingsService.save(next).then(
      (stored) => {
        setSettings(stored);
        setError(null);
      },
      (failure: unknown) => setError(readableError(failure)),
    );
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, update, loaded, error }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsValue {
  return useContext(SettingsContext);
}
