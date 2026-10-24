import { useEffect, useRef } from "react";
import type { RunState } from "../../../../engine/run";
import { toggleFullscreen } from "../../fullscreen";
import { causeName } from "../../game/itemText";
import { INTRO_LINES, INTRO_TITLE } from "../../game/lore";

/** Calls `onKey` for the given key codes while mounted. */
export function useKeys(codes: readonly string[], onKey: (code: string) => void): void {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!codes.includes(event.code) || event.repeat) return;
      event.preventDefault();
      onKey(event.code);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [codes, onKey]);
}

/** Gives a dialog's main button keyboard focus when it appears. */
export function useFocusOnMount<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}

const DISMISS_KEYS = ["Enter", "NumpadEnter", "Space", "Escape"] as const;
const NEW_DESCENT_KEYS = ["Enter", "NumpadEnter"] as const;
const RESUME_KEYS = ["Escape"] as const;

/** The story, shown as a descent begins. */
export function IntroCard({ onBegin }: { onBegin(): void }) {
  const focusRef = useFocusOnMount<HTMLButtonElement>();
  useKeys(DISMISS_KEYS, onBegin);
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-black/70 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="intro-heading"
        className="panel intro-card flex max-w-lg flex-col gap-4 p-8"
      >
        <h2 id="intro-heading" className="title-ember text-center font-display text-3xl font-bold">
          {INTRO_TITLE}
        </h2>
        {INTRO_LINES.map((line) => (
          <p key={line} className="text-[15px] leading-relaxed text-bone/85">
            {line}
          </p>
        ))}
        <button
          type="button"
          className="btn btn-primary mt-2 self-center"
          onClick={onBegin}
          ref={focusRef}
        >
          Begin the descent <kbd className="kbd">Enter</kbd>
        </button>
      </div>
    </div>
  );
}

/** Shown after the hero falls: what happened, and a way to start again. */
export function DeathScreen({
  run,
  deepestFloor,
  onNewDescent,
  onTitle,
}: {
  run: RunState;
  deepestFloor: number;
  onNewDescent(): void;
  onTitle(): void;
}) {
  const focusRef = useFocusOnMount<HTMLButtonElement>();
  useKeys(NEW_DESCENT_KEYS, onNewDescent);
  const slayer = run.killedBy ? causeName(run.killedBy) : null;
  const stats: Array<[string, number]> = [
    ["Floor", run.depth],
    ["Level", run.hero.level],
    ["Creatures slain", run.kills],
    ["Turns", run.turn],
    ["Deepest ever", deepestFloor],
  ];
  return (
    <div className="death-screen absolute inset-0 z-20 grid place-items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="death-heading"
        className="flex max-w-md flex-col items-center gap-5 p-8 text-center"
      >
        <h2 id="death-heading" className="font-display text-5xl font-bold text-[#ff8a7a]">
          You have fallen
        </h2>
        <p className="text-bone/80">
          {slayer ? `Slain by ${slayer} on floor ${run.depth}.` : `Lost on floor ${run.depth}.`}
        </p>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          {stats.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-right text-bone/55">{label}</dt>
              <dd className="text-left font-mono text-bone">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex gap-3">
          <button type="button" className="btn btn-primary" onClick={onNewDescent} ref={focusRef}>
            Begin a new descent <kbd className="kbd">Enter</kbd>
          </button>
          <button type="button" className="btn" onClick={onTitle}>
            Return to title
          </button>
        </div>
      </div>
    </div>
  );
}

export function PauseMenu({
  leaving,
  onResume,
  onHelp,
  onSettings,
  onRecords,
  onReport,
  onExit,
}: {
  leaving: boolean;
  onResume(): void;
  onHelp(): void;
  onSettings(): void;
  onRecords(): void;
  onReport(): void;
  onExit(): void;
}) {
  const focusRef = useFocusOnMount<HTMLButtonElement>();
  useKeys(RESUME_KEYS, onResume);
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-black/60 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="menu-heading"
        className="panel flex w-72 flex-col gap-3 p-6"
      >
        <h2 id="menu-heading" className="mb-1 text-center font-display text-2xl text-bone">
          Paused
        </h2>
        <button type="button" className="btn btn-primary" onClick={onResume} ref={focusRef}>
          Resume
        </button>
        <button type="button" className="btn" onClick={onRecords}>
          Records and achievements
        </button>
        <button type="button" className="btn" onClick={onSettings}>
          Settings
        </button>
        <button type="button" className="btn" onClick={onHelp}>
          How to play <kbd className="kbd">H</kbd>
        </button>
        <button type="button" className="btn" onClick={() => void toggleFullscreen()}>
          Fullscreen <kbd className="kbd">F11</kbd>
        </button>
        <button type="button" className="btn" onClick={onExit} disabled={leaving}>
          {leaving ? "Saving…" : "Save and return to title"}
        </button>
        <button type="button" className="btn btn-small" onClick={onReport}>
          Copy a bug report
        </button>
        <p className="text-center text-xs text-bone/45">
          Your descent is saved after every turn. Version {__APP_VERSION__}.
        </p>
      </div>
    </div>
  );
}

/** Shown once the Beacon is rekindled: the descent is won. */
export function VictoryScreen({
  run,
  wins,
  onNewDescent,
  onTitle,
}: {
  run: RunState;
  wins: number;
  onNewDescent(): void;
  onTitle(): void;
}) {
  const focusRef = useFocusOnMount<HTMLButtonElement>();
  useKeys(NEW_DESCENT_KEYS, onNewDescent);
  const stats: Array<[string, number]> = [
    ["Level", run.hero.level],
    ["Creatures slain", run.kills],
    ["Gold carried", run.gold],
    ["Turns", run.turn],
    ["Beacons rekindled", wins],
  ];
  return (
    <div className="victory-screen absolute inset-0 z-20 grid place-items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="victory-heading"
        className="flex max-w-lg flex-col items-center gap-5 p-8 text-center"
      >
        <h2 id="victory-heading" className="title-ember font-display text-5xl font-bold">
          The Beacon burns
        </h2>
        <p className="text-bone/85">
          Thirty floors down, the Warden has fallen and the old fire roars back to life. Its light
          climbs the long shaft of the observatory, and the dark draws back before it.
        </p>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-1 text-sm">
          {stats.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-right text-bone/55">{label}</dt>
              <dd className="text-left font-mono text-bone">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex gap-3">
          <button type="button" className="btn btn-primary" onClick={onNewDescent} ref={focusRef}>
            Begin a new descent <kbd className="kbd">Enter</kbd>
          </button>
          <button type="button" className="btn" onClick={onTitle}>
            Return to title
          </button>
        </div>
      </div>
    </div>
  );
}

const HELP_KEYS = ["Escape", "KeyH", "Enter", "NumpadEnter"] as const;

/** The basics of play and every key, from the title screen or the pause menu. */
export function HelpCard({ onClose }: { onClose(): void }) {
  const focusRef = useFocusOnMount<HTMLButtonElement>();
  useKeys(HELP_KEYS, onClose);
  const keys: Array<[string, string]> = [
    ["Move", "WASD or arrows (two together for diagonals), Q E Z C, number pad"],
    ["Attack", "Move into a creature"],
    ["Wait", "Space"],
    ["Stairs, rest, trade, pick up", "Enter (or click the tile you stand on)"],
    ["Lantern bright / dim", "L"],
    ["Lantern pulse", "F"],
    ["Use or equip an item", "1–9, 0"],
    ["Pack", "I or Tab"],
    ["Map: show, enlarge, hide", "M"],
    ["Walk somewhere", "Click a tile you have seen"],
    ["Menu", "Esc"],
    ["Fullscreen", "F11 or Alt+Enter"],
  ];
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/70 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-heading"
        className="panel intro-card flex max-h-[90dvh] max-w-2xl flex-col gap-4 overflow-y-auto p-7"
      >
        <h2 id="help-heading" className="title-ember text-center font-display text-3xl font-bold">
          How to play
        </h2>
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-relaxed text-bone/85">
          <li>
            Descend thirty floors, defeat the Beacon Warden at the bottom, and rekindle the Beacon.
          </li>
          <li>
            Move into a creature to attack it. A <span className="text-[#ff8a7a]">red marker</span>{" "}
            means it will strike on its next turn: step out of reach to make it miss.
          </li>
          <li>
            Bright light shows more of the floor and reveals hidden traps within two tiles, but
            burns charge every turn. A pulse hits everything close by and shields you.
          </li>
          <li>
            Walk over items and gold to pick them up. Hover over anything to see what it is and how
            it compares with what you wear.
          </li>
          <li>
            Each floor has a warded camp: rest there once to recover. Every third floor has a
            merchant who sells supplies and gear for gold, and buys things back.
          </li>
          <li>Guardians on floors 10 and 20 keep the stairs down sealed until they fall.</li>
          <li>Falling ends the descent, not the character: your records and bestiary remain.</li>
        </ul>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-[13px]">
          {keys.map(([action, key]) => (
            <div key={action} className="contents">
              <dt className="text-bone/60">{action}</dt>
              <dd className="text-bone">{key}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          className="btn btn-primary self-center"
          onClick={onClose}
          ref={focusRef}
        >
          Got it <kbd className="kbd">Enter</kbd>
        </button>
      </div>
    </div>
  );
}
