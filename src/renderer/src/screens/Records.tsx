import { ACHIEVEMENTS } from "../../../engine/achievements";
import { CREATURE_IDS } from "../../../engine/creatures";
import type { CharacterSummary } from "../../../engine/save";
import { formatPlayTime, formatWhen } from "../format";
import { causeName } from "../game/itemText";
import { DIFFICULTY_NAMES } from "./DifficultyPicker";

/** A character's record: totals, achievements and the history of finished descents. */
export function Records({ summary }: { summary: CharacterSummary }) {
  const { record } = summary;
  const earned = new Map(record.achievements.map((a) => [a.id, a.earnedAt]));
  const totals: Array<[string, string]> = [
    ["Descents", String(record.descents)],
    ["Beacons rekindled", String(record.wins)],
    ["Falls", String(record.deaths)],
    ["Deepest floor", String(record.deepestFloor)],
    ["Time played", formatPlayTime(summary.playTimeMs)],
    ["Bestiary", `${record.discovered.length} of ${CREATURE_IDS.length}`],
  ];

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-3 gap-2">
        {totals.map(([label, value]) => (
          <div key={label} className="rounded-md bg-black/30 px-3 py-2">
            <dt className="text-[11px] tracking-wider text-bone/50 uppercase">{label}</dt>
            <dd className="font-mono text-lg text-bone">{value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="achievements-heading" className="flex flex-col gap-2">
        <h3 id="achievements-heading" className="text-sm tracking-[0.2em] text-bone/60 uppercase">
          Achievements · {earned.size} of {ACHIEVEMENTS.length}
        </h3>
        <ul className="grid grid-cols-2 gap-1.5">
          {ACHIEVEMENTS.map((a) => {
            const when = earned.get(a.id);
            return (
              <li
                key={a.id}
                className={`rounded-md border px-3 py-2 ${when ? "border-ember/50 bg-ember/10" : "border-white/8 bg-black/25 opacity-60"}`}
              >
                <p className={`text-sm ${when ? "text-[#ffe2a8]" : "text-bone/70"}`}>
                  {when ? "★ " : ""}
                  {a.name}
                </p>
                <p className="text-xs text-bone/60">{a.description}</p>
                {when && <p className="text-[11px] text-bone/40">{formatWhen(when)}</p>}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="history-heading" className="flex flex-col gap-2">
        <h3 id="history-heading" className="text-sm tracking-[0.2em] text-bone/60 uppercase">
          Past descents
        </h3>
        {record.history.length === 0 ? (
          <p className="text-sm text-bone/50">No finished descents yet.</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead className="text-[11px] tracking-wider text-bone/50 uppercase">
              <tr>
                <th className="py-1 font-normal">Ended</th>
                <th className="font-normal">Result</th>
                <th className="font-normal">Difficulty</th>
                <th className="font-normal">Floor</th>
                <th className="font-normal">Level</th>
                <th className="font-normal">Slain</th>
                <th className="font-normal">Turns</th>
              </tr>
            </thead>
            <tbody>
              {record.history.map((entry) => (
                <tr key={`${entry.endedAt}-${entry.seed}`} className="border-t border-white/8">
                  <td className="py-1 text-bone/60">{formatWhen(entry.endedAt)}</td>
                  <td className={entry.result === "won" ? "text-[#ffd45a]" : "text-bone/80"}>
                    {entry.result === "won"
                      ? "Rekindled the Beacon"
                      : entry.killedBy
                        ? `Slain by ${causeName(entry.killedBy)}`
                        : "Fell"}
                  </td>
                  <td className="text-bone/70">{DIFFICULTY_NAMES[entry.difficulty]}</td>
                  <td className="font-mono text-bone">{entry.depth}</td>
                  <td className="font-mono text-bone">{entry.level}</td>
                  <td className="font-mono text-bone">{entry.kills}</td>
                  <td className="font-mono text-bone/70">{entry.turns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
