import { useCallback, useEffect, useRef, useState } from "react";
import type { Point } from "../../../engine/geometry";
import { findPath } from "../../../engine/path";
import { type Action, type ActionResult, applyAction, currentFloor } from "../../../engine/run";
import { type CharacterSave, updateCharacter } from "../../../engine/save";
import type { SaveBridge } from "../../../shared/bridge";
import { readableError } from "../saves/saveService";

/** Time between steps when walking to a clicked tile. */
const AUTO_WALK_STEP_MS = 95;

export interface CharacterSession {
  readonly character: CharacterSave;
  /** Plays one action; returns what happened, or null when there is no descent to act in. */
  act(action: Action): ActionResult | null;
  /** Walks to a tile over explored ground, one step at a time. Any other action cancels it. */
  walkTo(target: Point): void;
  cancelWalk(): void;
  /** Resolves once the latest save has been written. */
  flush(): Promise<void>;
  readonly saveError: string | null;
}

/** Owns one character while it is being played: applies actions, autosaves, and tracks play time. */
export function useCharacterSession(initial: CharacterSave, saves: SaveBridge): CharacterSession {
  const [character, setCharacter] = useState(initial);
  const [saveError, setSaveError] = useState<string | null>(null);
  const current = useRef(initial);
  const lastWrite = useRef<Promise<void>>(Promise.resolve());
  const sessionStart = useRef(performance.now());
  const walkTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const play = useCallback(
    (action: Action): ActionResult | null => {
      const save = current.current;
      if (!save.run) return null;
      const result = applyAction(save.run, action);
      if (!result.tookTurn) return result;
      const next = updateCharacter(save, result.run, {
        now: new Date().toISOString(),
        playTimeMs: initial.playTimeMs + Math.round(performance.now() - sessionStart.current),
      });
      current.current = next;
      setCharacter(next);
      // Every turn is saved. The desktop shell writes only the newest if saves pile up.
      lastWrite.current = saves.write(next).then(
        () => setSaveError(null),
        (error: unknown) => setSaveError(readableError(error)),
      );
      return result;
    },
    [initial.playTimeMs, saves],
  );

  const cancelWalk = useCallback(() => {
    clearInterval(walkTimer.current);
    walkTimer.current = undefined;
  }, []);

  const act = useCallback(
    (action: Action) => {
      cancelWalk();
      return play(action);
    },
    [cancelWalk, play],
  );

  const walkTo = useCallback(
    (target: Point) => {
      cancelWalk();
      const run = current.current.run;
      if (!run) return;
      const floor = currentFloor(run);
      const route = findPath(floor.tiles, run.hero, target, (i) => floor.explored[i] === true);
      if (!route || route.length === 0) return;
      let next = 0;
      const advance = (): boolean => {
        const direction = route[next++];
        const result = direction ? play({ type: "move", direction }) : null;
        return !!result?.tookTurn && next < route.length && result.run.depth === run.depth;
      };
      if (advance()) {
        walkTimer.current = setInterval(() => {
          if (!advance()) cancelWalk();
        }, AUTO_WALK_STEP_MS);
      }
    },
    [cancelWalk, play],
  );

  useEffect(() => cancelWalk, [cancelWalk]);

  const flush = useCallback(() => lastWrite.current, []);

  return { character, act, walkTo, cancelWalk, flush, saveError };
}
