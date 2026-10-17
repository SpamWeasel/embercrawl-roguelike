import type { LogLine, Tone } from "../../game/messages";

export interface LogEntry extends LogLine {
  readonly id: number;
}

const TONE_CLASS: Readonly<Record<Tone, string>> = {
  info: "text-bone/75",
  combat: "text-bone",
  danger: "text-[#ff9c8a]",
  good: "text-[#9ff0b0]",
};

/** The last few messages, newest at the bottom and brightest. */
export function MessageLog({ entries }: { entries: readonly LogEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <ol className="flex flex-col items-center gap-0.5" aria-live="polite">
      {entries.map((entry, index) => {
        const age = entries.length - 1 - index;
        return (
          <li
            key={entry.id}
            className={`text-sm ${TONE_CLASS[entry.tone]}`}
            style={{ opacity: Math.max(0.3, 1 - age * 0.22) }}
          >
            {entry.text}
          </li>
        );
      })}
    </ol>
  );
}
