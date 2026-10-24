import { useEffect, useRef, useState } from "react";
import { GOLD, type ItemId, itemKind } from "../../../../engine/items";
import { packHasRoom } from "../../../../engine/pack";
import { sellPrice } from "../../../../engine/rules";
import { currentFloor, type RunState } from "../../../../engine/run";
import { MERCHANT_TEXT } from "../../game/itemText";
import { ItemDetails, ItemIcon } from "./ItemDetails";

type Row =
  | {
      readonly side: "buy";
      readonly offer: number;
      readonly item: ItemId;
      readonly count: number;
      readonly price: number;
    }
  | {
      readonly side: "sell";
      readonly slot: number;
      readonly item: ItemId;
      readonly count: number;
      readonly price: number;
    };

const UP = new Set(["ArrowUp", "KeyW"]);
const DOWN = new Set(["ArrowDown", "KeyS"]);
const ACT_KEYS = new Set(["Enter", "NumpadEnter", "Space", "KeyE"]);
const CLOSE_KEYS = new Set(["Escape", "Tab", "KeyI"]);

/**
 * Trading with a merchant, opened beside the dungeon: what's for sale (with prices and how many
 * are left) and what the merchant will pay for things in the pack. Up/down or W/S select, Enter
 * buys or sells, Esc closes. Each trade takes a turn, but the stall is warded, so it's safe.
 */
export function ShopPanel({
  run,
  onBuy,
  onSell,
  onClose,
}: {
  run: RunState;
  onBuy(offer: number): void;
  onSell(slot: number): void;
  onClose(): void;
}) {
  const stock = currentFloor(run).stock;
  const rows: Row[] = [
    ...stock.map((offer, index) => ({ side: "buy" as const, offer: index, ...offer })),
    ...run.pack.flatMap((entry, slot) =>
      entry
        ? [
            {
              side: "sell" as const,
              slot,
              item: entry.item,
              count: entry.count,
              price: sellPrice(entry.item),
            },
          ]
        : [],
    ),
  ];
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, Math.max(0, rows.length - 1));
  const row = rows[index];

  const act = (target: Row | undefined) => {
    if (!target) return;
    if (target.side === "buy") onBuy(target.offer);
    else onSell(target.slot);
  };
  const latest = useRef({ act, row, count: rows.length, onClose });
  latest.current = { act, row, count: rows.length, onClose };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const { code } = event;
      const current = latest.current;
      if (UP.has(code)) setSelected((s) => Math.max(0, Math.min(s, current.count - 1) - 1));
      else if (DOWN.has(code)) setSelected((s) => Math.min(current.count - 1, s + 1));
      else if (ACT_KEYS.has(code)) {
        if (!event.repeat) current.act(current.row);
      } else if (CLOSE_KEYS.has(code)) {
        if (!event.repeat) current.onClose();
      } else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const buyable = (r: Row) =>
    r.side === "buy" && r.count > 0 && r.price <= run.gold && packHasRoom(run.pack, r.item);

  const renderRow = (r: Row, i: number) => {
    const soldOut = r.side === "buy" && r.count === 0;
    const tooDear = r.side === "buy" && !soldOut && r.price > run.gold;
    return (
      <button
        key={r.side === "buy" ? `b${r.offer}` : `s${r.slot}`}
        type="button"
        role="option"
        aria-selected={i === index}
        className={`shop-row ${i === index ? "shop-row--selected" : ""} ${soldOut ? "opacity-40" : ""}`}
        onClick={() => setSelected(i)}
        onDoubleClick={() => act(r)}
      >
        <ItemIcon id={r.item} size={30} />
        <span className="min-w-0 flex-1 truncate text-left text-sm text-bone">
          {itemKind(r.item).name}
          {r.count > 1 && <span className="text-bone/50"> ×{r.count}</span>}
        </span>
        <span className={`font-mono text-sm ${tooDear ? "text-[#ff9c8a]" : "text-[#ffd45a]"}`}>
          {soldOut ? "sold out" : `${r.side === "sell" ? "+" : ""}${r.price}`}
        </span>
      </button>
    );
  };

  const buyRows = rows.filter((r) => r.side === "buy");
  const sellRows = rows.filter((r) => r.side === "sell");

  return (
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="shop-heading"
      className="inventory-panel panel"
    >
      <header className="flex items-center justify-between">
        <h2 id="shop-heading" className="font-display text-xl text-bone">
          Merchant
        </h2>
        <span className="flex items-center gap-1.5 font-mono text-[#ffd45a]">
          <ItemIcon id={GOLD} size={20} /> {run.gold}
        </span>
        <button type="button" className="btn btn-small" onClick={onClose}>
          Close <kbd className="kbd">Esc</kbd>
        </button>
      </header>
      <p className="tooltip-text">{MERCHANT_TEXT}</p>

      <div aria-label="For sale" className="flex flex-col gap-1" role="listbox">
        <h3 className="text-[11px] tracking-wider text-bone/55 uppercase">For sale</h3>
        {buyRows.map((r) => renderRow(r, rows.indexOf(r)))}
      </div>
      <div aria-label="Sell" className="flex flex-col gap-1" role="listbox">
        <h3 className="text-[11px] tracking-wider text-bone/55 uppercase">Sell from your pack</h3>
        {sellRows.length === 0 ? (
          <p className="text-sm text-bone/45">Your pack is empty.</p>
        ) : (
          sellRows.map((r) => renderRow(r, rows.indexOf(r)))
        )}
      </div>

      {row && (
        // Pinned to the bottom of the panel, so the button is always in reach without scrolling.
        <div className="shop-footer">
          <section
            aria-live="polite"
            className="max-h-44 overflow-y-auto rounded-md bg-black/25 p-3"
          >
            <ItemDetails id={row.item} run={run} />
          </section>
          <button
            type="button"
            className="btn btn-primary"
            disabled={row.side === "buy" && !buyable(row)}
            onClick={() => act(row)}
          >
            {row.side === "buy"
              ? row.count === 0
                ? "Sold out"
                : row.price > run.gold
                  ? `Costs ${row.price} gold`
                  : !packHasRoom(run.pack, row.item)
                    ? "No room in your pack"
                    : `Buy for ${row.price} gold`
              : `Sell for ${row.price} gold`}
            <kbd className="kbd">Enter</kbd>
          </button>
        </div>
      )}
      <p className="text-center text-[11px] text-bone/45">
        Up/down select · Enter buys or sells · each trade takes a turn
      </p>
    </aside>
  );
}
