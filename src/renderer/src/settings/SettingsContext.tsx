import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { DEFAULT_SETTINGS, type Settings } from "../../../shared/settings";
import { sound } from "../audio/player";
import { readableError, settingsService } from "../saves/saveService";

interface SettingsValue {
  readonly settings: Settings;
  /** Applies new settings at once and stores them (a moment later, so a dragged slider saves once). */
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

  // Sound follows the settings, and starts on the first key or click (browsers require one).
  useEffect(() => sound.configure(settings), [settings]);
  useEffect(() => {
    void sound.load();
    const unlock = () => sound.unlock();
    const away = () => sound.setBackground(true);
    const back = () => sound.setBackground(document.hidden);
    window.addEventListener("pointerdown", unlock, true);
    window.addEventListener("keydown", unlock, true);
    window.addEventListener("blur", away);
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
      window.removeEventListener("blur", away);
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, []);

  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const update = useCallback((next: Settings) => {
    setSettings(next);
    clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      settingsService.save(next).then(
        () => setError(null),
        (failure: unknown) => setError(readableError(failure)),
      );
    }, 250);
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
