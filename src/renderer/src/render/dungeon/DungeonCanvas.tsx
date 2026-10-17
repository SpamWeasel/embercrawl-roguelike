import { useEffect, useRef } from "react";
import type { Point } from "../../../../engine/geometry";
import { type DungeonModel, DungeonView } from "./DungeonView";

interface DungeonCanvasProps {
  model: DungeonModel;
  className?: string;
  onTileClick(tile: Point): void;
  /** Called once the first frame of the dungeon has been drawn. */
  onReady?(rendererName: string): void;
}

/** Hosts a DungeonView and feeds it each new model. */
export function DungeonCanvas({ model, className, onTileClick, onReady }: DungeonCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<DungeonView | null>(null);
  // The view is created once; these refs let it always call the latest props.
  const latest = useRef({ model, onTileClick, onReady });
  latest.current = { model, onTileClick, onReady };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    DungeonView.create(host, { onTileClick: (tile) => latest.current.onTileClick(tile) })
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

  useEffect(() => {
    viewRef.current?.render(model);
  }, [model]);

  return <div ref={hostRef} className={className} />;
}
