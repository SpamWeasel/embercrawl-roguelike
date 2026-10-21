import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { creatureKind } from "../../../engine/creatures";
import { type Point, samePoint } from "../../../engine/geometry";
import { GOLD } from "../../../engine/items";
import { FLOOR_COUNT } from "../../../engine/map";
import {
  type Action,
  availableInteraction,
  currentFloor,
  type Interaction,
  sightRadius,
  visibleTiles,
} from "../../../engine/run";
import type { CharacterSave } from "../../../engine/save";
import type { ReadyDetails, SaveBridge } from "../../../shared/bridge";
import { lootName } from "../game/itemText";
import { describeResult } from "../game/messages";
import { useCharacterSession } from "../game/useCharacterSession";
import { useGameKeys } from "../input/useGameKeys";
import { DungeonCanvas } from "../render/dungeon/DungeonCanvas";
import { paletteForFloor } from "../render/dungeon/palettes";
import { InventoryPanel } from "./game/InventoryPanel";
import { ItemIcon, TileTooltip } from "./game/ItemDetails";
import { type LogEntry, MessageLog } from "./game/MessageLog";
import {
  Minimap,
  type MinimapSize,
  nextMinimapSize,
  savedMinimapSize,
  saveMinimapSize,
} from "./game/Minimap";
import { DeathScreen, HelpCard, IntroCard, PauseMenu, VictoryScreen } from "./game/Overlays";
import { GearSlots, PackBar } from "./game/PackBar";
import { ShopPanel } from "./game/ShopPanel";
import { StatMeters } from "./game/StatMeters";

/** How many log lines stay on screen. */
const LOG_LINES = 4;
/** Lets the fall animation play before the death screen appears. */
const DEATH_SCREEN_DELAY_MS = 1300;
/** Lets the Beacon blaze for a moment before the victory screen appears. */
const VICTORY_SCREEN_DELAY_MS = 2600;

interface GameScreenProps {
  initial: CharacterSave;
  saves: SaveBridge;
  /** Opens with the pack or the merchant's panel showing (for the smoke test). */
  startWith?: "pack" | "shop";
  onExit(): void;
  onReady(details: ReadyDetails): void;
}

/** The big title shown when arriving on a floor. `key` restarts its animation. */
interface Banner {
  readonly key: number;
  readonly floor: number;
  readonly region: string;
}

function interactionLabel(interaction: Interaction): string {
  switch (interaction.kind) {
    case "rest":
      return "Rest by the fire";
    case "trade":
      return "Trade with the merchant";
    case "rekindle":
      return interaction.smotheredBy
        ? `The ${creatureKind(interaction.smotheredBy).name} smothers the Beacon`
        : "Rekindle the Beacon";
    case "descend":
      return interaction.sealedBy
        ? `Sealed until the ${creatureKind(interaction.sealedBy).name} falls`
        : `Descend to floor ${interaction.toDepth}`;
    case "ascend":
      return `Climb up to floor ${interaction.toDepth}`;
    case "pick-up":
      return `Pick up ${lootName(interaction.item)}`;
  }
}

export function GameScreen({ initial, saves, startWith, onExit, onReady }: GameScreenProps) {
  const session = useCharacterSession(initial, saves);
  const { character, act, walkTo, cancelWalk, flush, subscribe, beginNewDescent } = session;
  const run = character.run;
  const [menuOpen, setMenuOpen] = useState(false);
  const [packOpen, setPackOpen] = useState(startWith === "pack");
  const [shopOpen, setShopOpen] = useState(startWith === "shop");
  const [helpOpen, setHelpOpen] = useState(false);
  const [mapSize, setMapSize] = useState<MinimapSize>(savedMinimapSize);
  const [hoverTile, setHoverTile] = useState<Point | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const logCount = useRef(0);
  const bannerCount = useRef(0);
  const [banner, setBanner] = useState<Banner | null>(null);
  // The story card opens a brand-new descent; returning players go straight in.
  const [introOpen, setIntroOpen] = useState(
    () => initial.run?.turn === 0 && initial.run.depth === 1,
  );
  const [deathShown, setDeathShown] = useState(() => initial.run?.status === "dead");
  const [victoryShown, setVictoryShown] = useState(() => initial.run?.status === "won");

  const model = useMemo(
    () =>
      run
        ? {
            floor: currentFloor(run),
            palette: paletteForFloor(run.seed, run.depth),
            hero: run.hero,
            visible: visibleTiles(run),
            sightRadius: sightRadius(run.lantern),
            won: run.status === "won",
          }
        : null,
    [run],
  );
  const interaction = run ? availableInteraction(run) : null;
  const alive = run?.status === "active";

  const showBanner = useCallback((seed: number, floor: number) => {
    bannerCount.current += 1;
    setBanner({ key: bannerCount.current, floor, region: paletteForFloor(seed, floor).name });
  }, []);

  // Arriving in the game (without the story card) shows where you are.
  const firstBanner = useRef(false);
  useEffect(() => {
    if (firstBanner.current || introOpen || !initial.run || initial.run.status !== "active") return;
    firstBanner.current = true;
    showBanner(initial.run.seed, initial.run.depth);
  }, [introOpen, initial.run, showBanner]);

  useEffect(() => {
    if (run?.status !== "dead" || deathShown) return;
    const timer = setTimeout(() => setDeathShown(true), DEATH_SCREEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [run?.status, deathShown]);

  useEffect(() => {
    if (run?.status !== "won" || victoryShown) return;
    const timer = setTimeout(() => setVictoryShown(true), VICTORY_SCREEN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [run?.status, victoryShown]);

  const changeMapSize = useCallback((size: MinimapSize) => {
    setMapSize(size);
    saveMinimapSize(size);
  }, []);

  const perform = useCallback(
    (action: Action) => {
      const result = act(action);
      if (!result) return;
      const lines = describeResult(result);
      if (lines.length > 0) {
        setLog((previous) =>
          [...previous, ...lines.map((line) => ({ ...line, id: logCount.current++ }))].slice(
            -LOG_LINES,
          ),
        );
      }
      const arrival = result.events.find((event) => event.type === "changed-floor");
      if (arrival) showBanner(result.run.seed, arrival.to);
    },
    [act, showBanner],
  );

  const interact = useCallback(() => {
    const kind = run ? availableInteraction(run)?.kind : undefined;
    if (kind === "rest") perform({ type: "rest" });
    else if (kind === "pick-up") perform({ type: "pick-up" });
    else if (kind === "rekindle") perform({ type: "rekindle" });
    else if (kind === "trade") {
      cancelWalk();
      setShopOpen(true);
    } else perform({ type: "use-stairs" });
  }, [run, perform, cancelWalk]);

  const applySlot = useCallback((slot: number) => perform({ type: "use-item", slot }), [perform]);
  const dropSlot = useCallback((slot: number) => perform({ type: "drop-item", slot }), [perform]);
  const buyOffer = useCallback((offer: number) => perform({ type: "buy", offer }), [perform]);
  const sellSlot = useCallback((slot: number) => perform({ type: "sell", slot }), [perform]);
  const closeShop = useCallback(() => setShopOpen(false), []);
  const openHelp = useCallback(() => {
    cancelWalk();
    setHelpOpen(true);
  }, [cancelWalk]);

  const openMenu = useCallback(() => {
    cancelWalk();
    setMenuOpen(true);
  }, [cancelWalk]);

  const openPack = useCallback(() => {
    cancelWalk();
    setPackOpen(true);
  }, [cancelWalk]);
  const closePack = useCallback(() => setPackOpen(false), []);

  useGameKeys(
    {
      move: (direction) => perform({ type: "move", direction }),
      wait: () => perform({ type: "wait" }),
      interact,
      toggleLight: () => perform({ type: "toggle-light" }),
      pulse: () => perform({ type: "pulse" }),
      menu: openMenu,
      inventory: openPack,
      itemSlot: applySlot,
      map: () => changeMapSize(nextMinimapSize(mapSize)),
      help: openHelp,
    },
    alive && !menuOpen && !leaving && !introOpen && !packOpen && !shopOpen && !helpOpen,
  );

  const onTileClick = useCallback(
    (tile: Point) => {
      if (run?.status !== "active" || introOpen) return;
      // Clicking the tile you stand on uses it (stairs or camp).
      if (samePoint(tile, run.hero)) {
        if (availableInteraction(run)) interact();
        return;
      }
      walkTo(tile);
    },
    [run, introOpen, interact, walkTo],
  );

  const exitToTitle = async () => {
    setLeaving(true);
    await flush();
    onExit();
  };

  const startOver = () => {
    beginNewDescent();
    setDeathShown(false);
    setVictoryShown(false);
    setShopOpen(false);
    setLog([]);
    setIntroOpen(true);
  };

  if (!run || !model) {
    return (
      <main className="grid h-dvh place-items-center gap-4 text-bone/70">
        <p>{character.name} is between descents.</p>
        <button type="button" className="btn btn-primary" onClick={startOver}>
          Begin a new descent
        </button>
      </main>
    );
  }

  const lowHealth = alive && run.hero.hp <= run.hero.maxHp * 0.3;

  return (
    <main className="relative h-dvh w-full select-none overflow-hidden bg-abyss">
      <DungeonCanvas
        className="absolute inset-0"
        model={model}
        subscribe={subscribe}
        onTileClick={onTileClick}
        onHover={setHoverTile}
        onReady={(renderer) => onReady({ renderer, scene: startWith ?? "game" })}
      />
      {lowHealth && <div className="low-health pointer-events-none absolute inset-0 z-[5]" />}

      {banner && (
        <div key={banner.key} className="floor-banner" onAnimationEnd={() => setBanner(null)}>
          <p className="title-ember font-display text-5xl font-bold tracking-[0.06em]">
            Floor {banner.floor}
          </p>
          <p className="text-sm uppercase tracking-[0.45em] text-bone/75">{banner.region}</p>
        </div>
      )}

      <header className="hud-bar hud-top gap-6">
        <div className="flex shrink-0 flex-col leading-tight">
          <span className="font-display text-lg text-bone">{character.name}</span>
          <span className="text-xs text-ember">
            Floor {run.depth} <span className="text-bone/50">of {FLOOR_COUNT}</span>
            <span className="text-bone/55"> · {model.palette.name}</span>
          </span>
        </div>
        <StatMeters hero={run.hero} lantern={run.lantern} />
        <div className="flex shrink-0 items-center gap-4 text-sm text-bone/60">
          <span className="flex items-center gap-1.5 font-mono text-[#ffd45a]" title="Gold">
            <ItemIcon id={GOLD} size={18} /> {run.gold}
          </span>
          <span>Turn {run.turn}</span>
          <button type="button" className="btn btn-small" onClick={openMenu}>
            Menu <kbd className="kbd">Esc</kbd>
          </button>
        </div>
      </header>

      <footer className="hud-bar hud-bottom">
        <div className="justify-self-start">
          <GearSlots run={run} onOpen={openPack} />
        </div>
        <div className="flex min-w-0 flex-col items-center gap-2">
          {interaction && alive && (
            <button type="button" className="btn btn-primary" onClick={interact}>
              {interactionLabel(interaction)}
              <kbd className="kbd">Enter</kbd>
            </button>
          )}
          <MessageLog entries={log} />
          <p className="text-center text-xs text-bone/45">
            Move <kbd className="kbd">WASD</kbd> / arrows · diagonals{" "}
            <kbd className="kbd">Q E Z C</kbd> · wait <kbd className="kbd">Space</kbd> · lantern{" "}
            <kbd className="kbd">L</kbd> · pulse <kbd className="kbd">F</kbd> · pack{" "}
            <kbd className="kbd">I</kbd> · items <kbd className="kbd">1</kbd>–
            <kbd className="kbd">0</kbd> · use <kbd className="kbd">Enter</kbd>
          </p>
        </div>
        <div className="justify-self-end">
          <PackBar run={run} onUse={applySlot} onOpen={openPack} />
        </div>
      </footer>

      {packOpen && alive && (
        <InventoryPanel run={run} onUse={applySlot} onDrop={dropSlot} onClose={closePack} />
      )}

      {shopOpen && alive && !packOpen && (
        <ShopPanel run={run} onBuy={buyOffer} onSell={sellSlot} onClose={closeShop} />
      )}

      {!packOpen && !shopOpen && (
        <Minimap run={run} size={mapSize} onSize={changeMapSize} onTileClick={onTileClick} />
      )}

      {hoverTile && alive && !packOpen && !shopOpen && !menuOpen && !introOpen && (
        <TileTooltip run={run} tile={hoverTile} />
      )}

      {session.saveError && (
        <p role="alert" className="save-warning">
          Could not save: {session.saveError}
        </p>
      )}

      {introOpen && alive && (
        <IntroCard
          onBegin={() => {
            setIntroOpen(false);
            showBanner(run.seed, run.depth);
          }}
        />
      )}

      {deathShown && run.status === "dead" && (
        <DeathScreen
          run={run}
          deepestFloor={character.record.deepestFloor}
          onNewDescent={startOver}
          onTitle={() => void exitToTitle()}
        />
      )}

      {victoryShown && run.status === "won" && (
        <VictoryScreen
          run={run}
          wins={character.record.wins}
          onNewDescent={startOver}
          onTitle={() => void exitToTitle()}
        />
      )}

      {menuOpen && (
        <PauseMenu
          leaving={leaving}
          onResume={() => setMenuOpen(false)}
          onHelp={() => {
            setMenuOpen(false);
            setHelpOpen(true);
          }}
          onExit={() => void exitToTitle()}
        />
      )}

      {helpOpen && <HelpCard onClose={() => setHelpOpen(false)} />}
    </main>
  );
}
