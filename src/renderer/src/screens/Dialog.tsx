import { type ReactNode, useId } from "react";
import { useKeys } from "./game/Overlays";

const CLOSE_KEYS = ["Escape"] as const;

/** A centered panel over the screen, closed with its button or Escape. */
export function Dialog({
  title,
  onClose,
  wide = false,
  children,
}: {
  title: string;
  onClose(): void;
  wide?: boolean;
  children: ReactNode;
}) {
  const headingId = useId();
  useKeys(CLOSE_KEYS, onClose);
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-black/70 p-4 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className={`panel intro-card flex max-h-[90dvh] w-full flex-col gap-4 overflow-y-auto p-6 ${wide ? "max-w-3xl" : "max-w-md"}`}
      >
        <header className="flex items-center justify-between gap-4">
          <h2 id={headingId} className="font-display text-2xl text-bone">
            {title}
          </h2>
          <button type="button" className="btn btn-small" onClick={onClose}>
            Close <kbd className="kbd">Esc</kbd>
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}
