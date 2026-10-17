import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";

/** Where the mouse last was, so a tooltip that opens under it can start in the right place. */
const pointer = { x: 0, y: 0 };
window.addEventListener(
  "pointermove",
  (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  },
  { passive: true },
);

/** Tooltips keep this far from the window's edges. */
const MARGIN = 8;

/** Places a tooltip beside the cursor or above an anchor point, flipped to stay on screen. */
function place(element: HTMLElement, x: number, y: number, mode: "cursor" | "above"): void {
  const { width, height } = element.getBoundingClientRect();
  let left: number;
  let top: number;
  if (mode === "above") {
    left = x - width / 2;
    top = y - height - 10;
    if (top < MARGIN) top = y + 10;
  } else {
    left = x + 18;
    top = y + 18;
    if (left + width > window.innerWidth - MARGIN) left = x - width - 14;
    if (top + height > window.innerHeight - MARGIN) top = y - height - 14;
  }
  left = Math.min(Math.max(MARGIN, left), window.innerWidth - width - MARGIN);
  top = Math.min(Math.max(MARGIN, top), window.innerHeight - height - MARGIN);
  element.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
}

/** A tooltip that follows the mouse, for things in the dungeon. */
export function CursorTooltip({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) place(ref.current, pointer.x, pointer.y, "cursor");
  });
  useEffect(() => {
    // Moves the tooltip directly rather than re-rendering on every mouse movement.
    const move = (event: PointerEvent) => {
      if (ref.current) place(ref.current, event.clientX, event.clientY, "cursor");
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, []);
  return (
    <div ref={ref} role="tooltip" className="tooltip">
      {children}
    </div>
  );
}

/** A tooltip above a HUD element (`anchor` is its on-screen box). */
export function AnchoredTooltip({ anchor, children }: { anchor: DOMRect; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) place(ref.current, anchor.left + anchor.width / 2, anchor.top, "above");
  });
  return (
    <div ref={ref} role="tooltip" className="tooltip">
      {children}
    </div>
  );
}
