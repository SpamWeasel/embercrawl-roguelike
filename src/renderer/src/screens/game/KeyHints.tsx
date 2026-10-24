import { type KeyAction, keyLabel, type Settings } from "../../../../shared/settings";

/** The first key bound to an action, as a player reads it ("W", "Space"), or "—" if none. */
export function keyHint(keys: Settings["keys"], action: KeyAction): string {
  const code = keys[action][0];
  return code ? keyLabel(code) : "—";
}

/** Every key bound to an action, joined: "W, Up, Num 8". */
export function keyList(keys: Settings["keys"], action: KeyAction): string {
  return keys[action].length > 0 ? keys[action].map(keyLabel).join(", ") : "not set";
}

/** The reminder line under the message log, from the player's own bindings. */
export function KeyHints({ keys }: { keys: Settings["keys"] }) {
  const k = (action: KeyAction) => <kbd className="kbd">{keyHint(keys, action)}</kbd>;
  const moves = (["move-n", "move-w", "move-s", "move-e"] as const).map((a) => keyHint(keys, a));
  const diagonals = (["move-nw", "move-ne", "move-sw", "move-se"] as const).map((a) =>
    keyHint(keys, a),
  );
  return (
    <p className="text-center text-xs text-bone/45">
      Move <kbd className="kbd">{moves.join(moves.every((m) => m.length === 1) ? "" : " ")}</kbd> ·
      diagonals <kbd className="kbd">{diagonals.join(" ")}</kbd> · wait {k("wait")} · lantern{" "}
      {k("lantern")} · pulse {k("pulse")} · pack {k("pack")} · items <kbd className="kbd">1</kbd>–
      <kbd className="kbd">0</kbd> · use {k("interact")}
    </p>
  );
}

/** A speaker, crossed out when the sound is off. */
export function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" className="fill-current">
      <path d="M3 7.5h3l4-3.5v12l-4-3.5H3z" />
      {muted ? (
        <path d="M13 7.5l5 5m0-5l-5 5" stroke="currentColor" strokeWidth="1.6" fill="none" />
      ) : (
        <path
          d="M13 7.2a4 4 0 0 1 0 5.6M15.2 5a7 7 0 0 1 0 10"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
