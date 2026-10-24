import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { FLOOR_COUNT } from "../../../engine/map";
import {
  CHARACTER_NAME_MAX,
  type CharacterSave,
  type CharacterSummary,
  normalizeCharacterName,
} from "../../../engine/save";
import type { CharacterListing, ReadyDetails, SaveBridge } from "../../../shared/bridge";
import { formatPlayTime, formatWhen } from "../format";
import { EmberField } from "../render/EmberField";
import { readableError, savesAreLocalToBrowser } from "../saves/saveService";
import { useSettings, wantsReducedMotion } from "../settings/SettingsContext";
import { useBuildLabel } from "../useBuildLabel";
import { Dialog } from "./Dialog";
import { HelpCard } from "./game/Overlays";
import { SettingsScreen } from "./SettingsScreen";
import { CharacterDialog } from "./title/CharacterDialog";

const FIRST_CHARACTER_NAME = "Wanderer";

/** "Level 3 · Floor 7 of 30", "Fell on floor 7", or "Between descents". */
function describeProgress(summary: CharacterSummary): string {
  if (summary.status === "none" || summary.depth === null) return "Between descents";
  if (summary.status === "dead") return `Fell on floor ${summary.depth}`;
  if (summary.status === "won") return "Rekindled the Beacon";
  return `Level ${summary.level ?? 1} · Floor ${summary.depth} of ${FLOOR_COUNT}`;
}

interface TitleScreenProps {
  saves: SaveBridge;
  /** Open the most recent character straight away (used by the smoke test). */
  autoContinue: boolean;
  /** Opens with Settings or the newest character's records showing (for the smoke test). */
  startWith?: "settings" | "records";
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

type Managing =
  | { readonly kind: "character"; readonly summary: CharacterSummary }
  | { readonly kind: "damaged"; readonly id: string };

interface Clash {
  readonly token: string;
  readonly incoming: CharacterSummary;
  readonly existing: CharacterSummary;
}

export function TitleScreen({ saves, autoContinue, startWith, onPlay, onReady }: TitleScreenProps) {
  const [listings, setListings] = useState<CharacterListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(startWith === "settings");
  const [managing, setManaging] = useState<Managing | null>(null);
  const [clash, setClash] = useState<Clash | null>(null);
  const { settings } = useSettings();
  const buildLabel = useBuildLabel();
  const rendererName = useRef<string | null>(null);
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

  const refresh = useCallback(async () => {
    try {
      setListings(await saves.list());
    } catch (failure) {
      setError(readableError(failure));
    }
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

  // For the smoke test: the newest character's records, once the list arrives.
  const shownRecords = useRef(false);
  const [recordsReady, setRecordsReady] = useState(startWith !== "records");
  useEffect(() => {
    const first = listings?.find((l) => l.status === "ok");
    if (startWith !== "records" || shownRecords.current || first?.status !== "ok") return;
    shownRecords.current = true;
    setManaging({ kind: "character", summary: first.summary });
    setRecordsReady(true);
  }, [startWith, listings]);

  // Whichever comes last (the canvas or the list), report the records scene ready then.
  useEffect(() => {
    if (startWith === "records" && recordsReady && rendererName.current)
      onReady({ renderer: rendererName.current, scene: "records" });
  }, [startWith, recordsReady, onReady]);

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

  const importCharacter = async () => {
    setError(null);
    setNotice(null);
    try {
      const result = await saves.importCharacter();
      if (result.status === "imported") setNotice(`Imported ${result.summary.name}.`);
      if (result.status === "conflict") setClash(result);
      await refresh();
    } catch (failure) {
      setError(readableError(failure));
    }
  };

  const resolveClash = async (choice: "replace" | "copy" | "cancel") => {
    if (!clash) return;
    try {
      await saves.resolveImport(clash.token, choice);
      if (choice === "replace")
        setNotice(`Replaced ${clash.existing.name} with the imported copy.`);
      if (choice === "copy") setNotice(`Imported ${clash.incoming.name} as a copy.`);
      await refresh();
    } catch (failure) {
      setError(readableError(failure));
    }
    setClash(null);
  };

  const openFolder = async () => {
    try {
      await saves.openFolder();
    } catch (failure) {
      setError(readableError(failure));
    }
  };

  return (
    <main className="relative h-dvh w-full select-none overflow-hidden">
      <EmberField
        key={`${settings.motion}-${settings.uiScale}`}
        className="absolute inset-0"
        reducedMotion={wantsReducedMotion(settings)}
        onReady={(renderer) => {
          rendererName.current = renderer;
          if (recordsReady) onReady({ renderer, scene: startWith ?? "title" });
        }}
      />
      <div className="vignette pointer-events-none absolute inset-0" />

      <div className="relative z-10 mx-auto flex h-full max-w-xl flex-col justify-center gap-8 px-6">
        <header className="text-center">
          <p className="text-xs tracking-[0.5em] text-ember/80 uppercase">A descent awaits</p>
          <h1 className="title-ember font-display text-7xl font-bold tracking-[0.08em]">
            Embercrawl
          </h1>
          <p className="mt-1 font-mono text-xs text-bone/50">Version {__APP_VERSION__}</p>
        </header>

        <section className="panel p-5" aria-labelledby="characters-heading">
          <h2
            id="characters-heading"
            className="mb-3 text-sm tracking-[0.2em] text-bone/60 uppercase"
          >
            Characters
          </h2>
          {listings === null && !error && (
            <p className="text-sm text-bone/60">Loading characters…</p>
          )}
          <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
            {listings?.map((listing) =>
              listing.status === "ok" ? (
                <li key={listing.summary.id} className="flex items-stretch gap-1.5">
                  <button
                    type="button"
                    className="character-row"
                    disabled={busy}
                    onClick={() => void continueWith(listing.summary.id)}
                  >
                    <span className="font-display text-lg text-bone">{listing.summary.name}</span>
                    <span className="text-xs text-bone/60">
                      {describeProgress(listing.summary)}
                      {" · "}deepest {listing.summary.deepestFloor}
                      {listing.summary.wins > 0 && ` · ${listing.summary.wins} won`}
                      {" · "}
                      {formatPlayTime(listing.summary.playTimeMs)} played
                      {" · "}
                      {formatWhen(listing.summary.updatedAt)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-small shrink-0"
                    aria-label={`Manage ${listing.summary.name}`}
                    onClick={() => setManaging({ kind: "character", summary: listing.summary })}
                  >
                    Manage
                  </button>
                </li>
              ) : (
                <li key={listing.id} className="flex items-stretch gap-1.5">
                  <div className="character-row character-row--damaged" title={listing.problem}>
                    <span className="text-bone/70">Damaged save</span>
                    <span className="text-xs text-bone/50">{listing.problem.split("\n")[0]}</span>
                    {listing.backups > 0 && (
                      <span className="text-xs text-ember/80">
                        {listing.backups} backup{listing.backups === 1 ? "" : "s"} can restore it.
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-small shrink-0"
                    onClick={() => setManaging({ kind: "damaged", id: listing.id })}
                  >
                    {listing.backups > 0 ? "Restore" : "Manage"}
                  </button>
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
          {notice && (
            <p role="status" className="mt-3 text-sm text-[#9ff0b0]">
              {notice}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm whitespace-pre-line text-[#ff9c8a]">
              {error}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn btn-small" onClick={() => void importCharacter()}>
              Import character…
            </button>
            {saves.features.folder && (
              <button type="button" className="btn btn-small" onClick={() => void openFolder()}>
                Open saves folder
              </button>
            )}
            <button type="button" className="btn btn-small" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
            <button type="button" className="btn btn-small" onClick={() => setHelpOpen(true)}>
              How to play
            </button>
          </div>
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

      {managing && (
        <CharacterDialog
          summary={managing.kind === "character" ? managing.summary : null}
          id={managing.kind === "damaged" ? managing.id : undefined}
          startIn={
            managing.kind === "damaged" ? "backups" : startWith === "records" ? "records" : "main"
          }
          saves={saves}
          onPlay={(id) => {
            setManaging(null);
            void continueWith(id);
          }}
          onClose={() => setManaging(null)}
          onChanged={(message) => {
            setManaging(null);
            setNotice(message);
            void refresh();
          }}
        />
      )}
      {clash && (
        <Dialog title="This character is already here" onClose={() => void resolveClash("cancel")}>
          <p className="text-bone/85">
            The file holds <strong>{clash.incoming.name}</strong> (
            {describeProgress(clash.incoming)}, saved {formatWhen(clash.incoming.updatedAt)}). This
            PC already has <strong>{clash.existing.name}</strong> (
            {describeProgress(clash.existing)}, saved {formatWhen(clash.existing.updatedAt)}).
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void resolveClash("copy")}
            >
              Keep both
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => void resolveClash("replace")}
            >
              Replace the one here
            </button>
            <button type="button" className="btn" onClick={() => void resolveClash("cancel")}>
              Cancel
            </button>
          </div>
          {saves.features.backups && (
            <p className="text-xs text-bone/50">Replacing keeps a backup of the one here first.</p>
          )}
        </Dialog>
      )}
      {settingsOpen && <SettingsScreen onClose={() => setSettingsOpen(false)} />}
      {helpOpen && <HelpCard onClose={() => setHelpOpen(false)} />}
    </main>
  );
}
