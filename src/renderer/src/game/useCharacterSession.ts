import { useCallback, useEffect, useRef, useState } from "react";
import type { Point } from "../../../engine/geometry";
import {
  type Action,
  type ActionResult,
  applyAction,
  currentFloor,
  type GameEvent,
  walkRoute,
} from "../../../engine/run";
import { beginDescent, type CharacterSave, updateCharacter } from "../../../engine/save";
import type { SaveBridge } from "../../../shared/bridge";
import { readableError } from "../saves/saveService";
import { AUTO_WALK_STEP_MS } from "./timing";

export interface CharacterSession {
  readonly character: CharacterSave;
  /** Plays one action; returns what happened, or null when there is no descent to act in. */
  act(action: Action): ActionResult | null;
  /** Walks to a tile over explored ground, one step at a time. Any other action cancels it. */
  walkTo(target: Point): void;
  cancelWalk(): void;
  /** Resolves once the latest save has been written. */
  flush(): Promise<void>;
  /**
   * Calls `listener` with the result of every action as it happens (including bumps into walls),
   * before React re-renders, so the view can animate each step. Returns an unsubscribe function.
   */
  subscribe(listener: ActionListener): () => void;
  /** Starts a fresh descent for this character (after death). */
  beginNewDescent(): void;
  readonly saveError: string | null;
}

export type ActionListener = (result: ActionResult) => void;

/** Anything that should stop a click-to-walk in its tracks. */
const DANGER: ReadonlySet<GameEvent["type"]> = new Set([
  "monster-noticed",
  "monster-readied",
  "monster-struck",
  "spotted",
  "attacked",
  "trap-found",
  "trap-sprung",
  "died",
]);

/** Owns one character while it is being played: applies actions, autosaves, and tracks play time. */
export function useCharacterSession(initial: CharacterSave, saves: SaveBridge): CharacterSession {
  const [character, setCharacter] = useState(initial);
  const [saveError, setSaveError] = useState<string | null>(null);
  const current = useRef(initial);
  const lastWrite = useRef<Promise<void>>(Promise.resolve());
  const sessionStart = useRef(performance.now());
  const walkTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const listeners = useRef(new Set<ActionListener>());

  const subscribe = useCallback((listener: ActionListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const commit = useCallback(
    (next: CharacterSave) => {
      current.current = next;
      setCharacter(next);
      // Every turn is saved. The desktop shell writes only the newest if saves pile up.
      lastWrite.current = saves.write(next).then(
        () => setSaveError(null),
        (error: unknown) => setSaveError(readableError(error)),
      );
    },
    [saves],
  );

  const play = useCallback(
    (action: Action): ActionResult | null => {
      const save = current.current;
      if (!save.run) return null;
      const result = applyAction(save.run, action);
      for (const listener of listeners.current) listener(result);
      if (!result.tookTurn) return result;
      commit(
        updateCharacter(save, result.run, {
          now: new Date().toISOString(),
          playTimeMs: initial.playTimeMs + Math.round(performance.now() - sessionStart.current),
        }),
      );
      return result;
    },
    [commit, initial.playTimeMs],
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
      // Walks around creatures and known traps; clicking one walks up to it (attacking a creature).
      const route = walkRoute(currentFloor(run), run.hero, target);
      if (!route || route.length === 0) return;
      let next = 0;
      const advance = (): boolean => {
        const direction = route[next++];
        const result = direction ? play({ type: "move", direction }) : null;
        if (!result?.tookTurn || result.run.depth !== run.depth) return false;
        if (result.events.some((event) => DANGER.has(event.type))) return false;
        return next < route.length;
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

  const beginNewDescent = useCallback(() => {
    cancelWalk();
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
    commit(beginDescent(current.current, seed, new Date().toISOString()));
  }, [cancelWalk, commit]);

  return { character, act, walkTo, cancelWalk, flush, subscribe, beginNewDescent, saveError };
}
