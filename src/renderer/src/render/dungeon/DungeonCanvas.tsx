import { useEffect, useRef } from "react";
import type { Point } from "../../../../engine/geometry";
import type { ActionListener } from "../../game/useCharacterSession";
import { type DungeonModel, DungeonView } from "./DungeonView";

interface DungeonCanvasProps {
  model: DungeonModel;
  className?: string;
  /** Subscribes to every action result, so steps can be animated as they happen. */
  subscribe(listener: ActionListener): () => void;
  onTileClick(tile: Point): void;
  /** The tile under the mouse changed (null when it leaves the map). */
  onHover?(tile: Point | null): void;
  /** Called once the first frame of the dungeon has been drawn. */
  onReady?(rendererName: string): void;
}

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Hosts a DungeonView, feeds it each new model, and forwards game events for animation. */
export function DungeonCanvas({
  model,
  className,
  subscribe,
  onTileClick,
  onHover,
  onReady,
}: DungeonCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<DungeonView | null>(null);
  // The view is created once; these refs let it always call the latest props.
  const latest = useRef({ model, onTileClick, onHover, onReady });
  latest.current = { model, onTileClick, onHover, onReady };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    DungeonView.create(host, {
      onTileClick: (tile) => latest.current.onTileClick(tile),
      onHover: (tile) => latest.current.onHover?.(tile),
      reducedMotion: prefersReducedMotion(),
    })
      .then((view) => {
        // React may unmount (or StrictMode may remount) before PixiJS finishes starting.
        if (disposed) {
          view.destroy();
          return;
        }
        viewRef.current = view;
        view.render(latest.current.model);
        latest.current.onReady?.(view.rendererName);
      })
      .catch((error: unknown) => console.error("The dungeon renderer could not start.", error));
    return () => {
      disposed = true;
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => subscribe((result) => viewRef.current?.handleEvents(result.events)), [subscribe]);

  useEffect(() => {
    viewRef.current?.render(model);
  }, [model]);

  return <div ref={hostRef} className={className} />;
}
