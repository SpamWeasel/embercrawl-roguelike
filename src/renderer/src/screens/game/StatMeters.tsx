import type { ReactNode } from "react";
import { LANTERN_MAX, xpToNextLevel } from "../../../../engine/rules";
import type { Hero, Lantern } from "../../../../engine/run";

interface MeterProps {
  label: ReactNode;
  value: number;
  max: number;
  color: string;
  /** Text after the bar, e.g. "24/30". */
  reading: ReactNode;
  title: string;
}

function Meter({ label, value, max, color, reading, title }: MeterProps) {
  const share = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2" title={title}>
      <span className="min-w-9 text-right text-[11px] uppercase tracking-wider text-bone/60">
        {label}
      </span>
      <div className="relative h-2.5 w-28 overflow-hidden rounded-full bg-black/70 ring-1 ring-white/10">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-200"
          style={{ width: `${share}%`, background: color }}
        />
      </div>
      <span className="min-w-14 font-mono text-xs text-bone/85">{reading}</span>
    </div>
  );
}

/** Health (with shield), level and experience, and lantern charge. */
export function StatMeters({ hero, lantern }: { hero: Hero; lantern: Lantern }) {
  const needed = xpToNextLevel(hero.level);
  const lowHealth = hero.hp <= hero.maxHp * 0.3;
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
      <Meter
        label="HP"
        value={hero.hp}
        max={hero.maxHp}
        color={
          lowHealth
            ? "linear-gradient(90deg,#ff3b2f,#ff7a5a)"
            : "linear-gradient(90deg,#c8323a,#e8604a)"
        }
        reading={
          <>
            {hero.hp}/{hero.maxHp}
            {hero.shield > 0 && <span className="ml-1 text-[#8fc8ff]">+{hero.shield}</span>}
          </>
        }
        title={`Health ${hero.hp} of ${hero.maxHp}${hero.shield > 0 ? `, shield ${hero.shield}` : ""}`}
      />
      <Meter
        label={`Lv ${hero.level}`}
        value={hero.xp}
        max={needed}
        color="linear-gradient(90deg,#b8862a,#ffd45a)"
        reading={`${hero.xp}/${needed}`}
        title={`Level ${hero.level}: ${hero.xp} of ${needed} experience to the next level`}
      />
      <Meter
        label={lantern.bright ? <span className="text-[#ffd45a]">Bright</span> : "Lamp"}
        value={lantern.charge}
        max={LANTERN_MAX}
        color={
          lantern.bright
            ? "linear-gradient(90deg,#ff9a3c,#ffe6a0)"
            : "linear-gradient(90deg,#9a5a1e,#e0902e)"
        }
        reading={`${lantern.charge}`}
        title={`Lantern charge ${lantern.charge} of ${LANTERN_MAX}${lantern.bright ? " (bright)" : ""}`}
      />
    </div>
  );
}
