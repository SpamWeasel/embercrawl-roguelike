import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AchievementId, achievement } from "../../../engine/achievements";
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
import { type CharacterSave, summarizeCharacter } from "../../../engine/save";
import type { ReadyDetails, SaveBridge } from "../../../shared/bridge";
import { sound } from "../audio/player";
import { bugReport } from "../game/bugReport";
import { lootName } from "../game/itemText";
import { describeResult } from "../game/messages";
import { useCharacterSession } from "../game/useCharacterSession";
import { useGameKeys } from "../input/useGameKeys";
import { DungeonCanvas } from "../render/dungeon/DungeonCanvas";
import { paletteForFloor } from "../render/dungeon/palettes";
import { useSettings, wantsReducedMotion } from "../settings/SettingsContext";
import { Dialog } from "./Dialog";
import { InventoryPanel } from "./game/InventoryPanel";
import { ItemIcon, TileTooltip } from "./game/ItemDetails";
import { KeyHints, keyHint, SpeakerIcon } from "./game/KeyHints";
import { type LogEntry, MessageLog } from "./game/MessageLog";
import { Minimap, type MinimapSize, nextMinimapSize } from "./game/Minimap";
import { DeathScreen, HelpCard, IntroCard, PauseMenu, VictoryScreen } from "./game/Overlays";
import { GearSlots, PackBar } from "./game/PackBar";
import { ShopPanel } from "./game/ShopPanel";
import { StatMeters } from "./game/StatMeters";
import { Records } from "./Records";
import { SettingsScreen } from "./SettingsScreen";

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
  const { settings, update: updateSettings } = useSettings();
  const mapSize = settings.minimap;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [report, setReport] = useState<{ text: string; copied: boolean } | null>(null);
  const [toasts, setToasts] = useState<Array<{ key: number; id: AchievementId }>>([]);
  const knownAchievements = useRef(new Set(initial.record.achievements.map((a) => a.id)));
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

  // The background air follows the hero down, and fades when the game is left.
  const depth = run?.depth;
  useEffect(() => {
    if (depth !== undefined) sound.startAmbience(depth);
  }, [depth]);
  useEffect(() => () => sound.stopAmbience(), []);

  // A soft whoosh as panels and menus open and close.
  const panels = [menuOpen, packOpen, shopOpen, helpOpen, settingsOpen, recordsOpen, report].filter(
    Boolean,
  ).length;
  const lastPanels = useRef(panels);
  useEffect(() => {
    if (panels > lastPanels.current) sound.play("ui-open");
    else if (panels < lastPanels.current) sound.play("ui-close");
    lastPanels.current = panels;
  }, [panels]);

  const changeMapSize = useCallback(
    (size: MinimapSize) => updateSettings({ ...settings, minimap: size }),
    [settings, updateSettings],
  );

  // A notice (and a log line) for each achievement as it's earned.
  useEffect(() => {
    const fresh = character.record.achievements.filter((a) => !knownAchievements.current.has(a.id));
    if (fresh.length === 0) return;
    for (const a of fresh) knownAchievements.current.add(a.id);
    sound.play("achievement", { delay: 0.25 });
    setToasts((previous) => [
      ...previous,
      ...fresh.map((a) => ({ key: logCount.current++, id: a.id })),
    ]);
    setLog((previous) =>
      [
        ...previous,
        ...fresh.map((a) => ({
          text: `Achievement: ${achievement(a.id).name}!`,
          tone: "good" as const,
          id: logCount.current++,
        })),
      ].slice(-LOG_LINES),
    );
  }, [character.record.achievements]);

  const copyReport = useCallback(() => {
    const text = bugReport(
      character,
      log,
      window.embercrawl ? "Windows desktop" : "browser preview",
    );
    setMenuOpen(false);
    setReport({ text, copied: false });
    navigator.clipboard.writeText(text).then(
      () => setReport({ text, copied: true }),
      () => setReport({ text, copied: false }),
    );
  }, [character, log]);

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

  const toggleMute = useCallback(() => {
    const muted = !settings.muted;
    updateSettings({ ...settings, muted });
    setLog((previous) =>
      [
        ...previous,
        { text: muted ? "Sound off." : "Sound on.", tone: "info" as const, id: logCount.current++ },
      ].slice(-LOG_LINES),
    );
  }, [settings, updateSettings]);

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
      mute: toggleMute,
    },
    alive &&
      !menuOpen &&
      !leaving &&
      !introOpen &&
      !packOpen &&
      !shopOpen &&
      !helpOpen &&
      !settingsOpen &&
      !recordsOpen &&
      !report,
    settings.keys,
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
        // Restarts the view when motion or the interface size changes (it reads them once).
        key={`${settings.motion}-${settings.uiScale}`}
        reducedMotion={wantsReducedMotion(settings)}
        className="absolute inset-0"
        model={model}
        subscribe={subscribe}
        onTileClick={onTileClick}
        onHover={setHoverTile}
        onReady={(renderer) =>
          void sound
            .load()
            .then((sounds) => onReady({ renderer, scene: startWith ?? "game", sounds }))
        }
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
          <button
            type="button"
            className="btn btn-small"
            onClick={toggleMute}
            aria-pressed={settings.muted}
            aria-label={settings.muted ? "Sound is off: turn it on" : "Sound is on: turn it off"}
            title={`Sound on/off (${keyHint(settings.keys, "mute")})`}
          >
            <SpeakerIcon muted={settings.muted} />
          </button>
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
              <kbd className="kbd">{keyHint(settings.keys, "interact")}</kbd>
            </button>
          )}
          <MessageLog entries={log} />
          <KeyHints keys={settings.keys} />
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
          onSettings={() => {
            setMenuOpen(false);
            setSettingsOpen(true);
          }}
          onRecords={() => {
            setMenuOpen(false);
            setRecordsOpen(true);
          }}
          onReport={copyReport}
          onExit={() => void exitToTitle()}
        />
      )}

      {helpOpen && <HelpCard onClose={() => setHelpOpen(false)} />}
      {settingsOpen && <SettingsScreen onClose={() => setSettingsOpen(false)} />}
      {recordsOpen && (
        <Dialog title={`${character.name}: records`} wide onClose={() => setRecordsOpen(false)}>
          <Records summary={summarizeCharacter(character)} />
        </Dialog>
      )}
      {report && (
        <Dialog title="Bug report" onClose={() => setReport(null)}>
          <p className="text-sm text-bone/80">
            {report.copied
              ? "Copied! Paste it into an email or message to the developer, and add what happened."
              : "Select the text below and copy it (Ctrl+C), then paste it into an email or message."}
          </p>
          <textarea
            readOnly
            className="field h-64 font-mono text-xs"
            value={report.text}
            onFocus={(event) => event.currentTarget.select()}
          />
        </Dialog>
      )}

      <div className="achievement-toasts" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.key}
            className="achievement-toast"
            onAnimationEnd={() => setToasts((all) => all.filter((t) => t.key !== toast.key))}
          >
            <p className="text-[11px] tracking-[0.25em] text-ember/80 uppercase">Achievement</p>
            <p className="font-display text-lg text-[#ffe2a8]">{achievement(toast.id).name}</p>
            <p className="text-xs text-bone/70">{achievement(toast.id).description}</p>
          </div>
        ))}
      </div>
    </main>
  );
}
