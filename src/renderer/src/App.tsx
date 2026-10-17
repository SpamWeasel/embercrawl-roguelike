import { useState } from "react";
import type { CharacterSave } from "../../engine/save";
import type { ReadyDetails } from "../../shared/bridge";
import { saveService } from "./saves/saveService";
import { GameScreen } from "./screens/GameScreen";
import { TitleScreen } from "./screens/TitleScreen";

/**
 * `#scene=game` opens the most recent character on launch, and `#scene=pack` also opens its pack;
 * the smoke test uses them.
 */
const launchScene = new URLSearchParams(window.location.hash.slice(1)).get("scene");
let openGameOnLaunch = launchScene === "game" || launchScene === "pack";

function reportReady(details: ReadyDetails): void {
  window.embercrawl?.signalReady(details);
}

export function App() {
  const [playing, setPlaying] = useState<CharacterSave | null>(null);
  const [startWithPack, setStartWithPack] = useState(false);

  if (playing) {
    return (
      <GameScreen
        key={playing.id}
        initial={playing}
        saves={saveService}
        startWithPack={startWithPack}
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
        setStartWithPack(autoContinue && launchScene === "pack");
        openGameOnLaunch = false;
        setPlaying(save);
      }}
      onReady={reportReady}
    />
  );
}
