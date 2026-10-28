import { DIFFICULTIES, type Difficulty } from "../../../engine/rules";

export const DIFFICULTY_NAMES: Readonly<Record<Difficulty, string>> = {
  easy: "Easy",
  normal: "Normal",
  hard: "Hard",
};

const DIFFICULTY_NOTES: Readonly<Record<Difficulty, string>> = {
  easy: "Creatures have less health. A gentler descent for learning the deep.",
  normal: "The descent as it's meant to be played.",
  hard: "Creatures have more health. Few keepers reach the bottom.",
};

/** Easy, Normal or Hard, with a line saying what the choice means. */
export function DifficultyPicker({
  value,
  onChange,
  disabled = false,
  center = false,
}: {
  value: Difficulty;
  onChange(difficulty: Difficulty): void;
  disabled?: boolean;
  center?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1 ${center ? "items-center" : ""}`}>
      <fieldset aria-label="Difficulty" className="flex items-center gap-1.5">
        <span className="mr-1 text-xs tracking-wider text-bone/55 uppercase">Difficulty</span>
        {DIFFICULTIES.map((difficulty) => (
          <button
            key={difficulty}
            type="button"
            aria-pressed={difficulty === value}
            className={`btn btn-small ${difficulty === value ? "btn-primary" : ""}`}
            disabled={disabled}
            onClick={() => onChange(difficulty)}
          >
            {DIFFICULTY_NAMES[difficulty]}
          </button>
        ))}
      </fieldset>
      <p className="text-xs text-bone/55">{DIFFICULTY_NOTES[value]}</p>
    </div>
  );
}
