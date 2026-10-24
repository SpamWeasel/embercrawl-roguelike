import { useEffect, useRef } from "react";
import { createEmberScene, type EmberScene } from "./emberScene";

interface EmberFieldProps {
  className?: string;
  /** Called once the scene has started rendering, with the PixiJS renderer's name. */
  onReady?: (rendererName: string) => void;
  /** Calmer animation (read once, when the scene starts). */
  reducedMotion: boolean;
}

/** Hosts the drifting-ember PixiJS background and tears it down cleanly when React unmounts it. */
export function EmberField({ className, onReady, reducedMotion }: EmberFieldProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const latestMotion = useRef(reducedMotion);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let scene: EmberScene | undefined;

    createEmberScene(host, latestMotion.current)
      .then((created) => {
        // React may unmount (or StrictMode may remount) before PixiJS finishes starting.
        if (disposed) {
          created.destroy();
          return;
        }
        scene = created;
        onReadyRef.current?.(created.renderer);
      })
      .catch((error: unknown) => {
        console.error("The renderer could not start.", error);
      });

    return () => {
      disposed = true;
      scene?.destroy();
    };
    // Motion is read once (latestMotion): the scene restarts via a React key when it changes.
  }, []);

  return <div ref={hostRef} className={className} aria-hidden="true" />;
}
