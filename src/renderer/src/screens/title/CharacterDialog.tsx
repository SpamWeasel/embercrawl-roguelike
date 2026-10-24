import { type FormEvent, useEffect, useState } from "react";
import { CHARACTER_NAME_MAX, type CharacterSummary } from "../../../../engine/save";
import type { BackupListing, SaveBridge } from "../../../../shared/bridge";
import { formatWhen } from "../../format";
import { readableError } from "../../saves/saveService";
import { Dialog } from "../Dialog";
import { Records } from "../Records";

type View = "main" | "records" | "rename" | "delete" | "backups";

/**
 * Everything to do with one character: play, records and achievements, rename, export, backups
 * and delete. `onChanged` refreshes the character list after a change.
 */
export function CharacterDialog({
  summary,
  id: givenId,
  saves,
  onPlay,
  onClose,
  onChanged,
  startIn = "main",
}: {
  /** Null for a damaged save, which can only be restored or deleted. */
  summary: CharacterSummary | null;
  /** The character's id (for a damaged save, the only thing known about it). */
  id?: string;
  saves: SaveBridge;
  onPlay(id: string): void;
  onClose(): void;
  onChanged(message: string): void;
  startIn?: View;
}) {
  const [view, setView] = useState<View>(startIn);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = summary?.name ?? "Damaged save";
  const id = summary?.id ?? givenId ?? "";

  const run = async (task: () => Promise<string | null>) => {
    setBusy(true);
    setError(null);
    try {
      const message = await task();
      if (message !== null) onChanged(message);
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={name} onClose={onClose} wide={view === "records"}>
      {view === "main" && summary && (
        <div className="flex flex-col gap-2">
          <button type="button" className="btn btn-primary" onClick={() => onPlay(summary.id)}>
            Play
          </button>
          <button type="button" className="btn" onClick={() => setView("records")}>
            Records and achievements
          </button>
          <button type="button" className="btn" onClick={() => setView("rename")}>
            Rename
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await saves.exportCharacter(summary.id);
                return result.status === "saved" ? `Exported ${name} to ${result.path}.` : null;
              })
            }
          >
            Export to a file…
          </button>
          {saves.features.backups && (
            <button type="button" className="btn" onClick={() => setView("backups")}>
              Backups
            </button>
          )}
          <button type="button" className="btn btn-danger" onClick={() => setView("delete")}>
            Delete…
          </button>
          <p className="text-xs text-bone/45">
            Export saves this character as one <code>.embercrawl</code> file you can back up, or
            import on another PC.
          </p>
        </div>
      )}

      {view === "records" && summary && <Records summary={summary} />}

      {view === "rename" && summary && (
        <RenameForm
          current={summary.name}
          busy={busy}
          onCancel={() => setView("main")}
          onRename={(next) =>
            void run(async () => {
              await saves.rename(summary.id, next);
              return `Renamed ${summary.name} to ${next.trim()}.`;
            })
          }
        />
      )}

      {view === "delete" && (
        <div className="flex flex-col gap-3">
          <p className="text-bone/85">
            {saves.features.recycleBin
              ? `Move ${name} to the Recycle Bin? You can restore it from there if you change your mind.`
              : `Delete ${name}? In the browser preview this can't be undone.`}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await saves.remove(id);
                  return saves.features.recycleBin
                    ? `${name} was moved to the Recycle Bin.`
                    : `${name} was deleted.`;
                })
              }
            >
              {saves.features.recycleBin ? "Move to Recycle Bin" : "Delete"}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setView(summary ? "main" : "backups")}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {view === "backups" && (
        <BackupList
          id={id}
          saves={saves}
          busy={busy}
          onRestore={(backupOf, backup, when) =>
            void run(async () => {
              await saves.restore(backupOf, backup);
              return `Restored ${name} from the backup of ${when}.`;
            })
          }
        />
      )}

      {view !== "main" && view !== "delete" && summary && (
        <button type="button" className="btn btn-small self-start" onClick={() => setView("main")}>
          ← Back
        </button>
      )}
      {error && (
        <p role="alert" className="text-sm whitespace-pre-line text-[#ff9c8a]">
          {error}
        </p>
      )}
    </Dialog>
  );
}

function RenameForm({
  current,
  busy,
  onCancel,
  onRename,
}: {
  current: string;
  busy: boolean;
  onCancel(): void;
  onRename(name: string): void;
}) {
  const [value, setValue] = useState(current);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onRename(value);
  };
  return (
    <form className="flex flex-col gap-3" onSubmit={submit}>
      <label className="flex flex-col gap-1 text-sm text-bone/70">
        New name
        <input
          className="field"
          value={value}
          maxLength={CHARACTER_NAME_MAX}
          onChange={(event) => setValue(event.target.value)}
          // biome-ignore lint/a11y/noAutofocus: the field is the only thing in this view.
          autoFocus
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary" disabled={busy || value.trim() === ""}>
          Rename
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A character's backups, newest first; any one can replace the current save. */
export function BackupList({
  id,
  saves,
  busy,
  onRestore,
}: {
  id: string | undefined;
  saves: SaveBridge;
  busy: boolean;
  onRestore(id: string, backup: string, when: string): void;
}) {
  const [backups, setBackups] = useState<BackupListing[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    saves.backups(id).then(
      (found) => active && setBackups(found),
      (failure: unknown) => active && setProblem(readableError(failure)),
    );
    return () => {
      active = false;
    };
  }, [id, saves]);

  if (!id) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-bone/70">
        The game keeps a backup each time you open a character, and every ten minutes while you play
        (the newest five). Restoring puts a backup in place of the current save; the current one is
        kept as a backup too.
      </p>
      {problem && <p className="text-sm text-[#ff9c8a]">{problem}</p>}
      {backups === null && !problem && <p className="text-sm text-bone/50">Looking for backups…</p>}
      {backups?.length === 0 && <p className="text-sm text-bone/50">No backups yet.</p>}
      <ul className="flex flex-col gap-1.5">
        {backups?.map((backup) => {
          const when = formatWhen(backupTime(backup.name));
          return (
            <li
              key={backup.name}
              className="flex items-center justify-between gap-3 rounded-md bg-black/25 px-3 py-2"
            >
              <span className="text-sm">
                <span className="text-bone">{when}</span>
                <span className="block text-xs text-bone/55">
                  {backup.status === "ok"
                    ? `Level ${backup.summary.level ?? 1} · floor ${backup.summary.depth ?? "–"}`
                    : "Damaged"}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-small"
                disabled={busy || backup.status !== "ok"}
                onClick={() => onRestore(id, backup.name, when)}
              >
                Restore
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Backup files are named after the time they were taken: "2026-10-24T10-00-00-000Z.embercrawl". */
function backupTime(name: string): string {
  const stamp = name.replace(".embercrawl", "");
  const match = stamp.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  return match ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z` : stamp;
}
