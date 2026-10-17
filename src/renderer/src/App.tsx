import { useState } from "react";
import type { CharacterSave } from "../../engine/save";
import type { ReadyDetails } from "../../shared/bridge";
import { saveService } from "./saves/saveService";
import { GameScreen } from "./screens/GameScreen";
import { TitleScreen } from "./screens/TitleScreen";

/** `#scene=game` opens the most recent character on launch; the smoke test uses it. */
let openGameOnLaunch = new URLSearchParams(window.location.hash.slice(1)).get("scene") === "game";

function reportReady(details: ReadyDetails): void {
  window.embercrawl?.signalReady(details);
}

export function App() {
  const [playing, setPlaying] = useState<CharacterSave | null>(null);

  if (playing) {
    return (
      <GameScreen
        key={playing.id}
        initial={playing}
        saves={saveService}
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
        openGameOnLaunch = false;
        setPlaying(save);
      }}
      onReady={reportReady}
    />
  );
}
