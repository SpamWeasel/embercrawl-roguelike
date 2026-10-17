import { useEffect, useRef } from "react";
import { creatureKind } from "../../../../engine/creatures";
import type { RunState } from "../../../../engine/run";
import { toggleFullscreen } from "../../fullscreen";
import { INTRO_LINES, INTRO_TITLE } from "../../game/lore";

/** Calls `onKey` for the given key codes while mounted. */
function useKeys(codes: readonly string[], onKey: (code: string) => void): void {
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
function useFocusOnMount<T extends HTMLElement>() {
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
  const slayer = run.killedBy ? creatureKind(run.killedBy).name : null;
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
          {slayer ? `Slain by a ${slayer} on floor ${run.depth}.` : `Lost on floor ${run.depth}.`}
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
  onExit,
}: {
  leaving: boolean;
  onResume(): void;
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
        <button type="button" className="btn" onClick={() => void toggleFullscreen()}>
          Fullscreen <kbd className="kbd">F11</kbd>
        </button>
        <button type="button" className="btn" onClick={onExit} disabled={leaving}>
          {leaving ? "Saving…" : "Save and return to title"}
        </button>
        <p className="text-center text-xs text-bone/45">Your descent is saved after every turn.</p>
      </div>
    </div>
  );
}
