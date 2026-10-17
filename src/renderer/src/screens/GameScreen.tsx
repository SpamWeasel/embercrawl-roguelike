import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Point, samePoint } from "../../../engine/geometry";
import { FLOOR_COUNT } from "../../../engine/map";
import {
  type Action,
  availableInteraction,
  currentFloor,
  type GameEvent,
  visibleTiles,
} from "../../../engine/run";
import type { CharacterSave } from "../../../engine/save";
import type { ReadyDetails, SaveBridge } from "../../../shared/bridge";
import { toggleFullscreen } from "../fullscreen";
import { useCharacterSession } from "../game/useCharacterSession";
import { useGameKeys } from "../input/useGameKeys";
import { DungeonCanvas } from "../render/dungeon/DungeonCanvas";
import { paletteForFloor } from "../render/dungeon/palettes";

/** How long a message stays at the bottom of the screen. */
const MESSAGE_MS = 4000;

interface GameScreenProps {
  initial: CharacterSave;
  saves: SaveBridge;
  onExit(): void;
  onReady(details: ReadyDetails): void;
}

/** The big title shown when arriving on a floor. `key` restarts its animation. */
interface Banner {
  readonly key: number;
  readonly floor: number;
  readonly region: string;
}

function describe(events: readonly GameEvent[]): string | null {
  for (const event of events) {
    if (event.type === "no-stairs") return "There are no stairs here.";
  }
  return null;
}

export function GameScreen({ initial, saves, onExit, onReady }: GameScreenProps) {
  const session = useCharacterSession(initial, saves);
  const { character, act, walkTo, cancelWalk, flush, subscribe } = session;
  const run = character.run;
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const bannerCount = useRef(0);
  const [banner, setBanner] = useState<Banner | null>(() =>
    initial.run
      ? {
          key: 0,
          floor: initial.run.depth,
          region: paletteForFloor(initial.run.seed, initial.run.depth).name,
        }
      : null,
  );

  const model = useMemo(
    () =>
      run
        ? {
            floor: currentFloor(run),
            palette: paletteForFloor(run.seed, run.depth),
            hero: run.hero,
            visible: visibleTiles(run),
          }
        : null,
    [run],
  );
  const interaction = run ? availableInteraction(run) : null;

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), MESSAGE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  const perform = useCallback(
    (action: Action) => {
      const result = act(action);
      if (!result) return;
      const text = describe(result.events);
      if (text) setMessage(text);
      const arrival = result.events.find((event) => event.type === "changed-floor");
      if (arrival) {
        bannerCount.current += 1;
        setBanner({
          key: bannerCount.current,
          floor: arrival.to,
          region: paletteForFloor(result.run.seed, arrival.to).name,
        });
      }
    },
    [act],
  );

  const openMenu = useCallback(() => {
    cancelWalk();
    setMenuOpen(true);
  }, [cancelWalk]);

  useGameKeys(
    {
      move: (direction) => perform({ type: "move", direction }),
      wait: () => perform({ type: "wait" }),
      interact: () => perform({ type: "use-stairs" }),
      menu: openMenu,
    },
    !menuOpen && !leaving,
  );

  const onTileClick = useCallback(
    (tile: Point) => {
      if (!run) return;
      // Clicking the stairs you stand on uses them.
      if (samePoint(tile, run.hero)) {
        if (availableInteraction(run)) perform({ type: "use-stairs" });
        return;
      }
      walkTo(tile);
    },
    [run, perform, walkTo],
  );

  const exitToTitle = async () => {
    setLeaving(true);
    await flush();
    onExit();
  };

  if (!run || !model) {
    return (
      <main className="grid h-dvh place-items-center text-bone/70">
        <p>
          {character.name} is between descents. Starting a new descent arrives in a later milestone.
        </p>
      </main>
    );
  }

  return (
    <main className="relative h-dvh w-full select-none overflow-hidden bg-abyss">
      <DungeonCanvas
        className="absolute inset-0"
        model={model}
        subscribe={subscribe}
        onTileClick={onTileClick}
        onReady={(renderer) => onReady({ renderer, scene: "game" })}
      />

      {banner && (
        <div key={banner.key} className="floor-banner" onAnimationEnd={() => setBanner(null)}>
          <p className="title-ember font-display text-5xl font-bold tracking-[0.06em]">
            Floor {banner.floor}
          </p>
          <p className="text-sm uppercase tracking-[0.45em] text-bone/75">{banner.region}</p>
        </div>
      )}

      <header className="hud-bar hud-top">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-lg text-bone">{character.name}</span>
          <span className="text-sm text-ember">
            Floor {run.depth} <span className="text-bone/50">of {FLOOR_COUNT}</span>
          </span>
          <span className="text-sm text-bone/55">{model.palette.name}</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-bone/60">
          <span>Turn {run.turn}</span>
          <button type="button" className="btn btn-small" onClick={openMenu}>
            Menu <kbd className="kbd">Esc</kbd>
          </button>
        </div>
      </header>

      <footer className="hud-bar hud-bottom">
        {interaction && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => perform({ type: "use-stairs" })}
          >
            {interaction.kind === "descend"
              ? `Descend to floor ${interaction.toDepth}`
              : `Climb up to floor ${interaction.toDepth}`}
            <kbd className="kbd">Enter</kbd>
          </button>
        )}
        {message && (
          <p className="text-sm text-bone" role="status">
            {message}
          </p>
        )}
        <p className="text-xs text-bone/45">
          Move <kbd className="kbd">WASD</kbd> or arrows · diagonals{" "}
          <kbd className="kbd">Q E Z C</kbd>, number pad or two keys together · wait{" "}
          <kbd className="kbd">Space</kbd> · click a tile to walk there
        </p>
      </footer>

      {session.saveError && (
        <p role="alert" className="save-warning">
          Could not save: {session.saveError}
        </p>
      )}

      {menuOpen && (
        <PauseMenu
          leaving={leaving}
          onResume={() => setMenuOpen(false)}
          onExit={() => void exitToTitle()}
        />
      )}
    </main>
  );
}

function PauseMenu({
  leaving,
  onResume,
  onExit,
}: {
  leaving: boolean;
  onResume(): void;
  onExit(): void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "Escape") {
        event.preventDefault();
        onResume();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onResume]);

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
        {/* biome-ignore lint/a11y/noAutofocus: the menu should take keyboard focus as it opens. */}
        <button type="button" className="btn btn-primary" onClick={onResume} autoFocus>
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
