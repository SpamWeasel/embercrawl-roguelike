import { useEffect, useRef } from "react";
import type { ReadyDetails } from "../../../shared/bridge";
import { createEmberScene, type EmberScene } from "./emberScene";

interface EmberFieldProps {
  className?: string;
  /** Called once the scene has started rendering. */
  onReady?: (details: ReadyDetails) => void;
}

/** Hosts the PixiJS canvas and tears it down cleanly when React unmounts it. */
export function EmberField({ className, onReady }: EmberFieldProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let scene: EmberScene | undefined;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    createEmberScene(host, reducedMotion)
      .then((created) => {
        // React may unmount (or StrictMode may remount) before PixiJS finishes starting.
        if (disposed) {
          created.destroy();
          return;
        }
        scene = created;
        onReady?.({ renderer: created.renderer });
      })
      .catch((error: unknown) => {
        console.error("The renderer could not start.", error);
      });

    return () => {
      disposed = true;
      scene?.destroy();
    };
  }, [onReady]);

  return <div ref={hostRef} className={className} aria-hidden="true" />;
}
