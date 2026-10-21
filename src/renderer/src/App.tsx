import { useState } from "react";
import type { CharacterSave } from "../../engine/save";
import type { ReadyDetails } from "../../shared/bridge";
import { saveService } from "./saves/saveService";
import { GameScreen } from "./screens/GameScreen";
import { TitleScreen } from "./screens/TitleScreen";

/**
 * `#scene=game` opens the most recent character on launch, and `#scene=pack` or `#scene=shop`
 * also opens its pack or the merchant's panel;
 * the smoke test uses them.
 */
const launchScene = new URLSearchParams(window.location.hash.slice(1)).get("scene");
let openGameOnLaunch = launchScene === "game" || launchScene === "pack" || launchScene === "shop";

function reportReady(details: ReadyDetails): void {
  window.embercrawl?.signalReady(details);
}

export function App() {
  const [playing, setPlaying] = useState<CharacterSave | null>(null);
  const [startWith, setStartWith] = useState<"pack" | "shop" | undefined>(undefined);

  if (playing) {
    return (
      <GameScreen
        key={playing.id}
        initial={playing}
        saves={saveService}
        startWith={startWith}
        onExit={() => setPlaying(null)}
        onReady={reportReady}
      />
    );
  }

  const autoContinue = openGameOnLaunch;
  return (
    <TitleScreen
      saves={saveService}
      autoContinue={autoContinue}
      onPlay={(save) => {
        if (autoContinue && (launchScene === "pack" || launchScene === "shop"))
          setStartWith(launchScene);
        openGameOnLaunch = false;
        setPlaying(save);
      }}
      onReady={reportReady}
    />
  );
}
