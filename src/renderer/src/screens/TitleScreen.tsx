import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { FLOOR_COUNT } from "../../../engine/map";
import {
  CHARACTER_NAME_MAX,
  type CharacterSave,
  normalizeCharacterName,
} from "../../../engine/save";
import type { CharacterListing, ReadyDetails, SaveBridge } from "../../../shared/bridge";
import { formatPlayTime, formatWhen } from "../format";
import { EmberField } from "../render/EmberField";
import { readableError, savesAreLocalToBrowser } from "../saves/saveService";
import { useBuildLabel } from "../useBuildLabel";

const FIRST_CHARACTER_NAME = "Wanderer";

interface TitleScreenProps {
  saves: SaveBridge;
  /** Open the most recent character straight away (used by the smoke test). */
  autoContinue: boolean;
  onPlay(save: CharacterSave): void;
  onReady(details: ReadyDetails): void;
}

/** Lists the characters on this PC and starts new ones. The very first launch creates one. */
async function loadListings(saves: SaveBridge): Promise<CharacterListing[]> {
  const listings = await saves.list();
  if (listings.length > 0) return listings;
  await saves.create(FIRST_CHARACTER_NAME);
  return saves.list();
}

export function TitleScreen({ saves, autoContinue, onPlay, onReady }: TitleScreenProps) {
  const [listings, setListings] = useState<CharacterListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const buildLabel = useBuildLabel();
  // Shared across StrictMode's double effect run, so the first character is only created once.
  const loading = useRef<Promise<CharacterListing[]> | null>(null);

  useEffect(() => {
    let active = true;
    loading.current ??= loadListings(saves);
    loading.current.then(
      (loaded) => active && setListings(loaded),
      (failure: unknown) => active && setError(readableError(failure)),
    );
    return () => {
      active = false;
    };
  }, [saves]);

  const continueWith = useCallback(
    async (id: string) => {
      setBusy(true);
      setError(null);
      try {
        onPlay(await saves.load(id));
      } catch (failure) {
        setError(readableError(failure));
        setBusy(false);
      }
    },
    [saves, onPlay],
  );

  // Opens the newest character once, as soon as the list arrives.
  const autoContinued = useRef(false);
  useEffect(() => {
    const first = listings?.find((l) => l.status === "ok");
    if (!autoContinue || autoContinued.current || first?.status !== "ok") return;
    autoContinued.current = true;
    void continueWith(first.summary.id);
  }, [autoContinue, listings, continueWith]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    let cleanName: string;
    try {
      cleanName = normalizeCharacterName(name);
    } catch (failure) {
      setError(readableError(failure));
      return;
    }
    setBusy(true);
    try {
      onPlay(await saves.create(cleanName));
    } catch (failure) {
      setError(readableError(failure));
      setBusy(false);
    }
  };

  return (
    <main className="relative h-dvh w-full select-none overflow-hidden">
      <EmberField
        className="absolute inset-0"
        onReady={(renderer) => onReady({ renderer, scene: "title" })}
      />
      <div className="vignette pointer-events-none absolute inset-0" />

      <div className="relative z-10 mx-auto flex h-full max-w-xl flex-col justify-center gap-8 px-6">
        <header className="text-center">
          <p className="text-xs uppercase tracking-[0.5em] text-ember/80">A descent awaits</p>
          <h1 className="title-ember font-display text-7xl font-bold tracking-[0.08em]">
            Embercrawl
          </h1>
        </header>

        <section className="panel p-5" aria-labelledby="characters-heading">
          <h2
            id="characters-heading"
            className="mb-3 text-sm uppercase tracking-[0.2em] text-bone/60"
          >
            Characters
          </h2>
          {listings === null && !error && (
            <p className="text-sm text-bone/60">Loading characters…</p>
          )}
          <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {listings?.map((listing) =>
              listing.status === "ok" ? (
                <li key={listing.summary.id}>
                  <button
                    type="button"
                    className="character-row"
                    disabled={busy}
                    onClick={() => void continueWith(listing.summary.id)}
                  >
                    <span className="font-display text-lg text-bone">{listing.summary.name}</span>
                    <span className="text-xs text-bone/60">
                      {listing.summary.depth === null
                        ? "Between descents"
                        : `Floor ${listing.summary.depth} of ${FLOOR_COUNT}`}
                      {" · "}deepest {listing.summary.deepestFloor}
                      {" · "}
                      {formatPlayTime(listing.summary.playTimeMs)} played
                      {" · "}
                      {formatWhen(listing.summary.updatedAt)}
                    </span>
                  </button>
                </li>
              ) : (
                <li
                  key={listing.id}
                  className="character-row character-row--damaged"
                  title={listing.problem}
                >
                  <span className="text-bone/70">Damaged save</span>
                  <span className="text-xs text-bone/50">{listing.problem.split("\n")[0]}</span>
                </li>
              ),
            )}
          </ul>

          <form className="mt-4 flex gap-2" onSubmit={(event) => void create(event)}>
            <label htmlFor="new-character" className="sr-only">
              New character name
            </label>
            <input
              id="new-character"
              className="field flex-1"
              placeholder="New character name"
              maxLength={CHARACTER_NAME_MAX}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
            <button type="submit" className="btn btn-primary" disabled={busy || name.trim() === ""}>
              Begin descent
            </button>
          </form>
          {error && (
            <p role="alert" className="mt-3 whitespace-pre-line text-sm text-[#ff9c8a]">
              {error}
            </p>
          )}
          {savesAreLocalToBrowser && (
            <p className="mt-3 text-xs text-bone/45">
              Browser preview: characters are saved in this browser only.
            </p>
          )}
        </section>
      </div>

      <footer className="absolute right-4 bottom-3 z-10 font-mono text-[11px] text-bone/45">
        {buildLabel}
      </footer>
    </main>
  );
}
