import { useEffect, useState } from "react";
import type { ReadyDetails } from "../../shared/bridge";
import { EmberField } from "./render/EmberField";

function reportReady(details: ReadyDetails): void {
  window.embercrawl?.signalReady(details);
}

/** A short build label: version details in the desktop app, or a note that this is the browser preview. */
function useBuildLabel(): string {
  const [label, setLabel] = useState(window.embercrawl ? "Desktop build" : "Browser preview");
  useEffect(() => {
    let active = true;
    window.embercrawl?.getAppInfo().then((info) => {
      if (active) setLabel(`v${info.version} · Electron ${info.electron} · ${info.arch}`);
    });
    return () => {
      active = false;
    };
  }, []);
  return label;
}

export function App() {
  const buildLabel = useBuildLabel();
  return (
    <main className="relative h-dvh w-full select-none overflow-hidden">
      <EmberField className="absolute inset-0" onReady={reportReady} />
      <div className="vignette pointer-events-none absolute inset-0" />
      <section className="pointer-events-none relative z-10 flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
        <p className="text-xs uppercase tracking-[0.5em] text-ember/80">A descent awaits</p>
        <h1 className="title-ember font-display text-7xl font-bold tracking-[0.08em] sm:text-8xl">
          Embercrawl
        </h1>
        <p className="max-w-md text-sm text-bone/70">
          Foundation build. The dungeon is not open yet.
        </p>
      </section>
      <footer className="absolute right-4 bottom-3 z-10 font-mono text-[11px] text-bone/45">
        {buildLabel}
      </footer>
    </main>
  );
}
