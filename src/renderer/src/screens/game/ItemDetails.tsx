import type { ReactNode } from "react";
import { creatureKind, type Monster } from "../../../../engine/creatures";
import type { Point } from "../../../../engine/geometry";
import {
  CACHE,
  isSupply,
  itemKind,
  type LootId,
  type Trap,
  type TrapKind,
  trapKind,
} from "../../../../engine/items";
import { FLOOR_COUNT, indexOf, Tile, tileAt } from "../../../../engine/map";
import { CAMP_CHARGE, CAMP_HEAL_SHARE } from "../../../../engine/rules";
import {
  currentFloor,
  itemAt,
  knownTrapAt,
  type RunState,
  visibleTiles,
} from "../../../../engine/run";
import {
  BEHAVIOR_TEXT,
  CACHE_NAME,
  categoryLabel,
  creatureOutlook,
  effectLine,
  type GearComparison,
  gearComparison,
  lootDescription,
  range,
  supplyOutlook,
  trapEffect,
} from "../../game/itemText";
import { itemArt, trapArt } from "../../render/itemArt";
import { CursorTooltip } from "./Tooltip";

export function ItemIcon({
  id,
  size = 32,
  className = "",
}: {
  id: LootId;
  size?: number;
  className?: string;
}) {
  const art = itemArt(id);
  return (
    <img
      src={art.url}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`${art.placeholder ? "pixelated" : ""} ${className}`}
    />
  );
}

function TrapIcon({ kind, size = 32 }: { kind: TrapKind; size?: number }) {
  const art = trapArt(kind);
  return (
    <img
      src={art.url}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className={`item-frame ${art.placeholder ? "pixelated" : ""}`}
    />
  );
}

function Heading({ title, kind, icon }: { title: string; kind: string; icon?: ReactNode }) {
  return (
    <header className="flex items-center gap-3">
      {icon}
      <div className="min-w-0">
        <p className="font-display text-base leading-tight text-bone">{title}</p>
        <p className="text-[11px] uppercase tracking-wider text-ember/85">{kind}</p>
      </div>
    </header>
  );
}

/** An item's name, what it does and, for gear, how it compares with what's worn. */
export function ItemDetails({ id, run, count }: { id: LootId; run: RunState; count?: number }) {
  if (id === CACHE) {
    return (
      <div className="flex flex-col gap-1.5">
        <Heading
          title={CACHE_NAME}
          kind="Cache"
          icon={<ItemIcon id={id} size={40} className="item-frame" />}
        />
        <p className="tooltip-text">{lootDescription(id)}</p>
      </div>
    );
  }
  const kind = itemKind(id);
  const title = count && count > 1 ? `${kind.name} ×${count}` : kind.name;
  const detail = isSupply(kind)
    ? categoryLabel(kind)
    : `${categoryLabel(kind)} · ${kind.category === "weapon" ? "Attack" : "Defense"} +${kind.power}`;
  const outlook = isSupply(kind) ? supplyOutlook(run, kind) : null;
  return (
    <div className="flex flex-col gap-1.5">
      <Heading
        title={title}
        kind={detail}
        icon={<ItemIcon id={id} size={40} className="item-frame" />}
      />
      <p className="tooltip-text">{kind.description}</p>
      {isSupply(kind) ? (
        <>
          <p className="text-[13px] text-bone">{effectLine(kind)}</p>
          {outlook && (
            <p
              className={`text-[13px] ${outlook.tone === "good" ? "text-[#9ff0b0]" : "text-bone/45"}`}
            >
              {outlook.text}
            </p>
          )}
        </>
      ) : (
        <Comparison comparison={gearComparison(run, kind)} />
      )}
    </div>
  );
}

/** "Attack 5 → 7 (+2)", green when better and red when worse; or "Equipped". */
export function Comparison({ comparison }: { comparison: GearComparison }) {
  const { label, current, next, equipped } = comparison;
  if (equipped) {
    return (
      <p className="text-[13px] text-ember">
        Equipped · {label} {current}
      </p>
    );
  }
  const delta = next - current;
  const tone = delta > 0 ? "text-[#9ff0b0]" : delta < 0 ? "text-[#ff9c8a]" : "text-bone/60";
  return (
    <p className="text-[13px] text-bone">
      {label} {current} →{" "}
      <span className={`font-semibold ${tone}`}>
        {next} ({delta > 0 ? "+" : ""}
        {delta})
      </span>
    </p>
  );
}

/** A creature's health, how it behaves, and how a fight with it would go. */
export function CreatureDetails({ monster, run }: { monster: Monster; run: RunState }) {
  const kind = creatureKind(monster.kind);
  const outlook = creatureOutlook(run, monster);
  const health = Math.max(0, Math.min(100, (monster.hp / monster.maxHp) * 100));
  const [fewest, most] = outlook.blows;
  return (
    <div className="flex flex-col gap-1.5">
      <Heading title={kind.name} kind={kind.guardian ? "Guardian" : "Creature"} />
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-28 overflow-hidden rounded-full bg-black/70 ring-1 ring-white/10">
          <div className="h-full rounded-full bg-[#e8604a]" style={{ width: `${health}%` }} />
        </div>
        <span className="font-mono text-xs text-bone/75">
          {monster.hp}/{monster.maxHp}
        </span>
      </div>
      <p className="text-[13px] text-bone">{BEHAVIOR_TEXT[kind.behavior]}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-[13px]">
        <dt className="text-bone/55">Hits you for</dt>
        <dd className="text-[#ff9c8a]">{range(outlook.hitsYou)}</dd>
        <dt className="text-bone/55">You hit for</dt>
        <dd className="text-bone">
          {range(outlook.youHit)}{" "}
          <span className="text-bone/55">
            ({fewest === most ? fewest : `${fewest}–${most}`} blow{most === 1 ? "" : "s"} to fell)
          </span>
        </dd>
      </dl>
      {monster.ready && (
        <p className="text-[13px] font-semibold text-[#ff8a7a]">About to strike!</p>
      )}
      {!monster.alert && <p className="text-[13px] text-bone/50">Hasn't noticed you.</p>}
      <p className="tooltip-text">{kind.description}</p>
    </div>
  );
}

function TrapDetails({ trap }: { trap: Trap }) {
  const kind = trapKind(trap.kind);
  return (
    <div className="flex flex-col gap-1.5">
      <Heading title={kind.name} kind="Trap" icon={<TrapIcon kind={trap.kind} size={40} />} />
      <p className="text-[13px] text-[#ff9c8a]">{trapEffect(trap)}</p>
      <p className="tooltip-text">{kind.description}</p>
    </div>
  );
}

/**
 * A tooltip for the tile under the mouse: a creature in view, an item or found trap the hero has
 * seen, the camp, or stairs. Nothing shows when there's nothing to say.
 */
export function TileTooltip({ run, tile }: { run: RunState; tile: Point }) {
  const floor = currentFloor(run);
  const index = indexOf(tile);
  if (!floor.explored[index]) return null;
  const parts: ReactNode[] = [];
  const monster = visibleTiles(run).has(index)
    ? floor.monsters.find((m) => m.x === tile.x && m.y === tile.y)
    : undefined;
  if (monster) parts.push(<CreatureDetails key="creature" monster={monster} run={run} />);
  const item = itemAt(run, tile);
  if (item) parts.push(<ItemDetails key="item" id={item.item} run={run} />);
  const trap = knownTrapAt(run, tile);
  if (trap) parts.push(<TrapDetails key="trap" trap={trap} />);
  if (floor.camp && floor.camp.x === tile.x && floor.camp.y === tile.y) {
    parts.push(
      <div key="camp" className="flex flex-col gap-1">
        <Heading title="Camp" kind={floor.campUsed ? "Burned out" : "Warded"} />
        <p className="tooltip-text">
          {floor.campUsed
            ? "The fire is spent, but the wards still hold: creatures can't reach you here."
            : `Creatures can't reach you here. Rest once to restore ${Math.round(CAMP_HEAL_SHARE * 100)}% of your health and ${CAMP_CHARGE} charge.`}
        </p>
      </div>,
    );
  }
  const ground = tileAt(floor.tiles, tile);
  if (ground === Tile.StairsDown && run.depth < FLOOR_COUNT) {
    parts.push(<Heading key="down" title="Stairs down" kind={`To floor ${run.depth + 1}`} />);
  } else if (ground === Tile.StairsUp && run.depth > 1) {
    parts.push(<Heading key="up" title="Stairs up" kind={`To floor ${run.depth - 1}`} />);
  }
  if (parts.length === 0) return null;
  return (
    <CursorTooltip>
      <div className="flex flex-col gap-3 [&>*+*]:border-t [&>*+*]:border-white/10 [&>*+*]:pt-3">
        {parts}
      </div>
    </CursorTooltip>
  );
}
