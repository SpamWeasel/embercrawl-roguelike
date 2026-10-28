// Plays many whole descents with the balance bot and reports how often it wins, how deep it gets
// and what kills it. The target is a 25–35% win rate (docs/PLAN.md).
//
// Usage: pnpm exec tsx scripts/balance.mts [runs] [first seed] [easy|normal|hard]
//   pnpm exec tsx scripts/balance.mts 200 1        tuning seeds
//   pnpm exec tsx scripts/balance.mts 200 100001   check seeds, kept apart from tuning
//   pnpm exec tsx scripts/balance.mts 200 1 hard   another difficulty (targets in docs/PLAN.md)
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import { type BotOutcome, playRun } from "../src/bot/bot";
import { DIFFICULTIES, type Difficulty } from "../src/engine/rules";
import { newRun } from "../src/engine/run";

/** The bot's win rate each difficulty is tuned to (docs/PLAN.md). */
const WIN_TARGETS: Readonly<Record<Difficulty, string>> = {
  easy: "55–65%",
  normal: "25–35%",
  hard: "10–15%",
};

interface Job {
  readonly seeds: readonly number[];
  readonly difficulty: Difficulty;
}

if (!isMainThread) {
  const { seeds, difficulty } = workerData as Job;
  for (const seed of seeds) parentPort?.postMessage(playRun(seed, newRun(seed, difficulty)));
} else {
  const runs = Number(process.argv[2] ?? 100);
  const first = Number(process.argv[3] ?? 1);
  const difficulty = (process.argv[4] ?? "normal") as Difficulty;
  if (!DIFFICULTIES.includes(difficulty)) throw new Error(`Unknown difficulty: ${difficulty}`);
  const seeds = Array.from({ length: runs }, (_, i) => first + i);
  const workers = Math.max(1, Math.min(availableParallelism() - 1, runs));
  const started = Date.now();
  const outcomes: BotOutcome[] = [];

  await Promise.all(
    Array.from({ length: workers }, (_, w) => {
      const job: Job = { seeds: seeds.filter((_, i) => i % workers === w), difficulty };
      const worker = new Worker(fileURLToPath(import.meta.url), {
        workerData: job,
        execArgv: process.execArgv,
      });
      worker.on("message", (outcome: BotOutcome) => {
        outcomes.push(outcome);
        if (outcomes.length % 25 === 0) process.stderr.write(`  ${outcomes.length}/${runs}\n`);
      });
      return new Promise<void>((resolve, reject) => {
        worker.on("error", reject);
        worker.on("exit", () => resolve());
      });
    }),
  );

  report(outcomes, runs, first, difficulty, Date.now() - started);
}

function report(
  outcomes: readonly BotOutcome[],
  runs: number,
  first: number,
  difficulty: Difficulty,
  ms: number,
): void {
  const count = (test: (o: BotOutcome) => boolean) => outcomes.filter(test).length;
  const share = (n: number) => `${((n / outcomes.length) * 100).toFixed(1)}%`;
  const wins = count((o) => o.result === "won");
  console.log(
    `\nBalance report (${difficulty}): ${runs} runs, seeds ${first}–${first + runs - 1}, ${(ms / 1000).toFixed(0)} s`,
  );
  console.log(`  Won:     ${wins} (${share(wins)})   target ${WIN_TARGETS[difficulty]}`);
  console.log(`  Died:    ${count((o) => o.result === "died")}`);
  console.log(`  Stalled: ${count((o) => o.result === "stalled")}`);

  const bands = [
    [1, 5],
    [6, 10],
    [11, 15],
    [16, 20],
    [21, 25],
    [26, 30],
  ] as const;
  console.log("\n  Where descents ended (not won):");
  for (const [low, high] of bands) {
    const n = count((o) => o.result !== "won" && o.depth >= low && o.depth <= high);
    console.log(
      `    floors ${String(low).padStart(2)}–${String(high).padEnd(2)}  ${"#".repeat(Math.round((n / outcomes.length) * 100))} ${n}`,
    );
  }
  const reached = (depth: number) => count((o) => o.depth >= depth || o.result === "won");
  console.log(
    "\n  Reached floor 10: " +
      share(reached(10)) +
      "   20: " +
      share(reached(20)) +
      "   30: " +
      share(reached(30)),
  );

  const causes = new Map<string, number>();
  for (const o of outcomes)
    if (o.killedBy) causes.set(o.killedBy, (causes.get(o.killedBy) ?? 0) + 1);
  console.log("\n  Most common killers:");
  for (const [cause, n] of [...causes].sort((a, b) => b[1] - a[1]).slice(0, 8))
    console.log(`    ${cause.padEnd(16)} ${n}`);

  const average = (values: number[]) =>
    values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const won = outcomes.filter((o) => o.result === "won");
  console.log(
    `\n  Winners: average level ${average(won.map((o) => o.level)).toFixed(1)}, ` +
      `${average(won.map((o) => o.turns)).toFixed(0)} turns, ${average(won.map((o) => o.gold)).toFixed(0)} gold left`,
  );
}
