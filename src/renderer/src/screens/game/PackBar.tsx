import { useState } from "react";
import { type GearId, isSupply, itemKind } from "../../../../engine/items";
import { attackPower, defensePower, type RunState } from "../../../../engine/run";
import { ItemDetails, ItemIcon } from "./ItemDetails";
import { AnchoredTooltip } from "./Tooltip";

/** The key that uses each pack slot: 1–9, then 0 for the tenth. */
export const SLOT_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

interface Hovered {
  readonly slot: number;
  readonly anchor: DOMRect;
}

/** What using a slot does, for hints: "use" a supply, "equip" gear. */
export function slotVerb(run: RunState, slot: number): "use" | "equip" | null {
  const entry = run.pack[slot];
  if (!entry) return null;
  return isSupply(itemKind(entry.item)) ? "use" : "equip";
}

/** The pack's slots along the bottom of the screen: click one (or press its number) to use it. */
export function PackBar({
  run,
  onUse,
  onOpen,
}: {
  run: RunState;
  onUse(slot: number): void;
  onOpen(): void;
}) {
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const entry = hovered ? run.pack[hovered.slot] : null;
  const verb = hovered ? slotVerb(run, hovered.slot) : null;
  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className="hud-link" onClick={onOpen}>
        Pack <kbd className="kbd">I</kbd>
      </button>
      <div className="grid grid-cols-5 gap-1">
        {run.pack.map((slotEntry, slot) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: slots are fixed positions, not a list.
            key={slot}
            type="button"
            className="slot"
            aria-label={
              slotEntry
                ? `${itemKind(slotEntry.item).name}${slotEntry.count > 1 ? ` ×${slotEntry.count}` : ""} (key ${SLOT_KEYS[slot]})`
                : `Empty slot ${SLOT_KEYS[slot]}`
            }
            aria-disabled={!slotEntry}
            onClick={() => slotEntry && onUse(slot)}
            onPointerEnter={(event) =>
              setHovered({ slot, anchor: event.currentTarget.getBoundingClientRect() })
            }
            onPointerLeave={() => setHovered(null)}
          >
            {slotEntry && <ItemIcon id={slotEntry.item} size={30} />}
            <span className="slot-key">{SLOT_KEYS[slot]}</span>
            {slotEntry && slotEntry.count > 1 && (
              <span className="slot-count">{slotEntry.count}</span>
            )}
          </button>
        ))}
      </div>
      {hovered && entry && (
        <AnchoredTooltip anchor={hovered.anchor}>
          <ItemDetails id={entry.item} run={run} count={entry.count} />
          <p className="tooltip-hint">
            Click or press <kbd className="kbd">{SLOT_KEYS[hovered.slot]}</kbd> to {verb}
          </p>
        </AnchoredTooltip>
      )}
    </div>
  );
}

/** The weapon and armor being worn, with the attack and defense they give. */
export function GearSlots({ run, onOpen }: { run: RunState; onOpen(): void }) {
  const [hovered, setHovered] = useState<{ id: GearId; anchor: DOMRect } | null>(null);
  const slots = [
    { id: run.equipment.weapon, stat: "ATK", value: attackPower(run), name: "Attack" },
    { id: run.equipment.armor, stat: "DEF", value: defensePower(run), name: "Defense" },
  ] as const;
  return (
    <div className="flex items-end gap-1.5">
      {slots.map((slot) => (
        <button
          key={slot.stat}
          type="button"
          className="slot slot--worn"
          aria-label={`${itemKind(slot.id).name}: ${slot.name} ${slot.value}`}
          onClick={onOpen}
          onPointerEnter={(event) =>
            setHovered({ id: slot.id, anchor: event.currentTarget.getBoundingClientRect() })
          }
          onPointerLeave={() => setHovered(null)}
        >
          <ItemIcon id={slot.id} size={34} />
          <span className="slot-stat">
            {slot.stat} <span className="text-bone">{slot.value}</span>
          </span>
        </button>
      ))}
      {hovered && (
        <AnchoredTooltip anchor={hovered.anchor}>
          <ItemDetails id={hovered.id} run={run} />
        </AnchoredTooltip>
      )}
    </div>
  );
}
