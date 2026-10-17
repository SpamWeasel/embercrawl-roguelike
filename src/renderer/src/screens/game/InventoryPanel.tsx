import { useEffect, useRef, useState } from "react";
import { itemKind } from "../../../../engine/items";
import { PACK_SLOTS } from "../../../../engine/rules";
import { attackPower, defensePower, type RunState } from "../../../../engine/run";
import { ItemDetails, ItemIcon } from "./ItemDetails";
import { SLOT_KEYS, slotVerb } from "./PackBar";

const COLUMNS = 5;
const DIGITS = [
  "Digit1",
  "Digit2",
  "Digit3",
  "Digit4",
  "Digit5",
  "Digit6",
  "Digit7",
  "Digit8",
  "Digit9",
  "Digit0",
];
/** Moving the selection around the slot grid. */
const NAVIGATE: Readonly<Record<string, number>> = {
  ArrowLeft: -1,
  KeyA: -1,
  ArrowRight: 1,
  KeyD: 1,
  ArrowUp: -COLUMNS,
  KeyW: -COLUMNS,
  ArrowDown: COLUMNS,
  KeyS: COLUMNS,
};
const USE_KEYS = new Set(["Enter", "NumpadEnter", "Space", "KeyE"]);
const DROP_KEYS = new Set(["KeyX", "Delete", "Backspace"]);
const CLOSE_KEYS = new Set(["Escape", "KeyI", "Tab"]);

/**
 * The pack, opened beside the dungeon: what's worn, every slot, and the selected item's details
 * with a comparison. Keyboard: arrows or WASD select, Enter uses or equips, X drops, 1–0 use a
 * slot directly, Esc / I / Tab close. Each use or drop takes a turn, as in the dungeon.
 */
export function InventoryPanel({
  run,
  onUse,
  onDrop,
  onClose,
}: {
  run: RunState;
  onUse(slot: number): void;
  onDrop(slot: number): void;
  onClose(): void;
}) {
  const [selected, setSelected] = useState(() => Math.max(0, run.pack.findIndex(Boolean)));
  const latest = useRef({ selected, onUse, onDrop, onClose });
  latest.current = { selected, onUse, onDrop, onClose };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const { code } = event;
      const handlers = latest.current;
      const digit = DIGITS.indexOf(code);
      const step = NAVIGATE[code];
      if (digit >= 0) {
        setSelected(digit);
        if (!event.repeat) handlers.onUse(digit);
      } else if (step !== undefined) {
        setSelected((slot) => (slot + step + PACK_SLOTS) % PACK_SLOTS);
      } else if (USE_KEYS.has(code)) {
        if (!event.repeat) handlers.onUse(handlers.selected);
      } else if (DROP_KEYS.has(code)) {
        if (!event.repeat) handlers.onDrop(handlers.selected);
      } else if (CLOSE_KEYS.has(code)) {
        if (!event.repeat) handlers.onClose();
      } else {
        return;
      }
      // Also stops a focused button from acting on the same key press.
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const entry = run.pack[selected];
  const verb = slotVerb(run, selected);
  const worn = [
    { id: run.equipment.weapon, label: "Attack", value: attackPower(run) },
    { id: run.equipment.armor, label: "Defense", value: defensePower(run) },
  ];

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="pack-heading"
      className="inventory-panel panel"
    >
      <header className="flex items-center justify-between">
        <h2 id="pack-heading" className="font-display text-xl text-bone">
          Pack
        </h2>
        <button type="button" className="btn btn-small" onClick={onClose}>
          Close <kbd className="kbd">Esc</kbd>
        </button>
      </header>

      <section aria-label="Worn" className="flex flex-col gap-1.5">
        {worn.map((piece) => (
          <div
            key={piece.label}
            className="flex items-center gap-3 rounded-md bg-black/25 px-2 py-1.5"
          >
            <ItemIcon id={piece.id} size={36} className="item-frame" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-bone">{itemKind(piece.id).name}</p>
              <p className="text-[11px] uppercase tracking-wider text-bone/50">{piece.label}</p>
            </div>
            <span className="font-mono text-lg text-ember">{piece.value}</span>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-5 gap-1.5" role="listbox" aria-label="Pack slots">
        {run.pack.map((slotEntry, slot) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: slots are fixed positions, not a list.
            key={slot}
            type="button"
            role="option"
            aria-selected={slot === selected}
            aria-label={slotEntry ? itemKind(slotEntry.item).name : `Empty slot ${SLOT_KEYS[slot]}`}
            className={`slot slot--large ${slot === selected ? "slot--selected" : ""}`}
            onClick={() => setSelected(slot)}
            onDoubleClick={() => slotEntry && onUse(slot)}
          >
            {slotEntry && <ItemIcon id={slotEntry.item} size={38} />}
            <span className="slot-key">{SLOT_KEYS[slot]}</span>
            {slotEntry && slotEntry.count > 1 && (
              <span className="slot-count">{slotEntry.count}</span>
            )}
          </button>
        ))}
      </div>

      <section aria-live="polite" className="min-h-36 rounded-md bg-black/25 p-3">
        {entry ? (
          <ItemDetails id={entry.item} run={run} count={entry.count} />
        ) : (
          <p className="text-sm text-bone/45">
            Slot {SLOT_KEYS[selected]} is empty. Walk over items to pick them up.
          </p>
        )}
      </section>

      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-primary flex-1"
          disabled={!entry}
          onClick={() => onUse(selected)}
        >
          {verb === "equip" ? "Equip" : "Use"} <kbd className="kbd">Enter</kbd>
        </button>
        <button type="button" className="btn" disabled={!entry} onClick={() => onDrop(selected)}>
          Drop <kbd className="kbd">X</kbd>
        </button>
      </div>
      <p className="text-center text-[11px] text-bone/45">
        Arrows select · <kbd className="kbd">1</kbd>–<kbd className="kbd">0</kbd> use a slot · each
        use takes a turn
      </p>
    </aside>
  );
}
