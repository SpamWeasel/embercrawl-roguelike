/**
 * Every sound effect, made in code: each recipe schedules tones and filtered noise on an offline
 * Web Audio context, which renders it once into a buffer when the game starts. Recipes are
 * seeded, so a sound is the same on every launch; sounds with several `variants` get slightly
 * different takes, picked at random when played.
 *
 * To change how something sounds, edit its recipe here (times are in seconds, frequencies in
 * hertz), or replace it with a file (see `sounds.ts`).
 */
import { hashText, type SoundId, seededRandom } from "./sounds";

export const SAMPLE_RATE = 44_100;

type FilterSpec = {
  readonly type: BiquadFilterType;
  readonly freq: number;
  /** Sweep the filter to this frequency over `sweep` seconds (default: the sound's length). */
  readonly to?: number;
  readonly sweep?: number;
  readonly q?: number;
};

/** A volume shape: rise over `attack`, stay for `hold`, fade over `decay`. */
type Envelope = {
  readonly at?: number;
  readonly attack?: number;
  readonly hold?: number;
  readonly decay: number;
  readonly gain?: number;
};

type ToneSpec = Envelope & {
  readonly type?: OscillatorType;
  readonly freq: number;
  /** Glide to this frequency over `glide` seconds (default: the whole tone). */
  readonly to?: number;
  readonly glide?: number;
  /** Frequency over time instead of `to`: [seconds after start, hertz] pairs. */
  readonly path?: ReadonlyArray<readonly [number, number]>;
  readonly filter?: FilterSpec;
  readonly vibrato?: { readonly rate: number; readonly depth: number };
};

type NoiseSpec = Envelope & {
  readonly color?: "white" | "brown";
  readonly filter?: FilterSpec;
};

/** What a recipe draws with: the offline context, its output and a seeded random source. */
export interface Kit {
  readonly ctx: BaseAudioContext;
  readonly out: AudioNode;
  random(): number;
}

export interface Recipe {
  /** Length of the rendered sound, in seconds. */
  readonly length: number;
  /** Loudness after rendering (peak, 0–1), so sounds sit well against each other. */
  readonly level: number;
  /** How many different takes to render. */
  readonly variants?: number;
  /** Rendered in stereo (only the looping air needs it; everything else is placed when played). */
  readonly stereo?: boolean;
  /** Seconds at the end blended into the start, so the sound loops without a seam. */
  readonly loopBlend?: number;
  draw(kit: Kit, variant: number): void;
}

const NOISE_SECONDS = 2;
let noiseBuffers: { white: AudioBuffer; brown: AudioBuffer } | null = null;

/** Two seconds of white and brown (deep, rumbling) noise, shared by every recipe. */
function noiseBuffer(color: "white" | "brown"): AudioBuffer {
  if (!noiseBuffers) {
    const random = seededRandom(7);
    const length = NOISE_SECONDS * SAMPLE_RATE;
    const white = new AudioBuffer({ length, sampleRate: SAMPLE_RATE, numberOfChannels: 1 });
    const brown = new AudioBuffer({ length, sampleRate: SAMPLE_RATE, numberOfChannels: 1 });
    const w = white.getChannelData(0);
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < length; i++) {
      w[i] = random() * 2 - 1;
      last = (last + 0.02 * (w[i] ?? 0)) / 1.02;
      b[i] = last * 3.5;
    }
    noiseBuffers = { white, brown };
  }
  return noiseBuffers[color];
}

/** Noise long enough not to repeat audibly in a loop, drawn from the recipe's own random source. */
function longNoise(kit: Kit, seconds: number, color: "white" | "brown"): AudioBuffer {
  const length = Math.ceil(seconds * SAMPLE_RATE);
  const buffer = new AudioBuffer({ length, sampleRate: SAMPLE_RATE, numberOfChannels: 1 });
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = kit.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = color === "white" ? white : last * 3.5;
  }
  return buffer;
}

function envelope(param: AudioParam, spec: Envelope): number {
  const start = spec.at ?? 0;
  const attack = Math.max(0.002, spec.attack ?? 0.004);
  const hold = spec.hold ?? 0;
  const peak = spec.gain ?? 1;
  const end = start + attack + hold + spec.decay;
  param.setValueAtTime(0, start);
  param.linearRampToValueAtTime(peak, start + attack);
  if (hold > 0) param.setValueAtTime(peak, start + attack + hold);
  param.exponentialRampToValueAtTime(0.0001, end);
  param.setValueAtTime(0, end + 0.001);
  return end;
}

function filterNode(kit: Kit, spec: FilterSpec, start: number, end: number): BiquadFilterNode {
  const filter = kit.ctx.createBiquadFilter();
  filter.type = spec.type;
  filter.Q.value = spec.q ?? 0.8;
  filter.frequency.setValueAtTime(spec.freq, start);
  if (spec.to !== undefined)
    filter.frequency.exponentialRampToValueAtTime(spec.to, start + (spec.sweep ?? end - start));
  return filter;
}

export function tone(kit: Kit, spec: ToneSpec): void {
  const start = spec.at ?? 0;
  const gain = kit.ctx.createGain();
  const end = envelope(gain.gain, spec);
  const osc = kit.ctx.createOscillator();
  osc.type = spec.type ?? "sine";
  osc.frequency.setValueAtTime(spec.freq, start);
  if (spec.path) {
    for (const [time, freq] of spec.path)
      osc.frequency.exponentialRampToValueAtTime(freq, start + time);
  } else if (spec.to !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(spec.to, start + (spec.glide ?? end - start));
  }
  if (spec.vibrato) {
    const lfo = kit.ctx.createOscillator();
    const depth = kit.ctx.createGain();
    lfo.frequency.value = spec.vibrato.rate;
    depth.gain.value = spec.vibrato.depth;
    lfo.connect(depth).connect(osc.frequency);
    lfo.start(start);
    lfo.stop(end + 0.01);
  }
  let node: AudioNode = osc;
  if (spec.filter) node = node.connect(filterNode(kit, spec.filter, start, end));
  node.connect(gain).connect(kit.out);
  osc.start(start);
  osc.stop(end + 0.01);
}

export function noise(kit: Kit, spec: NoiseSpec): void {
  const start = spec.at ?? 0;
  const gain = kit.ctx.createGain();
  const end = envelope(gain.gain, spec);
  const source = kit.ctx.createBufferSource();
  source.buffer = noiseBuffer(spec.color ?? "white");
  source.loop = true;
  let node: AudioNode = source;
  if (spec.filter) node = node.connect(filterNode(kit, spec.filter, start, end));
  node.connect(gain).connect(kit.out);
  source.start(start, kit.random() * (NOISE_SECONDS - 0.5));
  source.stop(end + 0.01);
}

/** A struck metal sound: a few out-of-tune partials that fade at different speeds. */
export function bell(kit: Kit, spec: { freq: number; at?: number; decay: number; gain?: number }) {
  const partials: ReadonlyArray<readonly [number, number, number]> = [
    [1, 1, 1],
    [2.0, 0.35, 0.6],
    [2.76, 0.5, 0.7],
    [4.07, 0.2, 0.4],
    [5.4, 0.15, 0.3],
  ];
  for (const [ratio, level, length] of partials) {
    tone(kit, {
      freq: spec.freq * ratio,
      at: spec.at,
      attack: 0.002,
      decay: spec.decay * length,
      gain: (spec.gain ?? 1) * level,
    });
  }
}

/** Tiny clicks scattered over a stretch of time: fire, gravel, coins settling. */
function crackles(kit: Kit, count: number, from: number, to: number, gain: number, freq = 3000) {
  for (let i = 0; i < count; i++) {
    noise(kit, {
      at: from + kit.random() * (to - from),
      decay: 0.004 + kit.random() * 0.008,
      gain: gain * (0.4 + kit.random() * 0.6),
      filter: { type: "highpass", freq },
    });
  }
}

function footstep(kit: Kit, at: number, pitch: number, gain = 1) {
  noise(kit, {
    at,
    decay: 0.07,
    gain: 0.6 * gain,
    filter: { type: "bandpass", freq: 520 * pitch, q: 0.9 },
  });
  tone(kit, { at, freq: 95 * pitch, to: 55 * pitch, decay: 0.06, gain: 0.5 * gain });
  noise(kit, {
    at: at + 0.005,
    decay: 0.025,
    gain: 0.15 * gain,
    filter: { type: "highpass", freq: 2500 },
  });
}

function chime(kit: Kit, at: number, gain = 1) {
  tone(kit, { at, freq: 1318.5, decay: 0.18, gain: 0.6 * gain });
  tone(kit, { at, freq: 2637, decay: 0.08, gain: 0.15 * gain });
  tone(kit, { at: at + 0.07, freq: 1760, decay: 0.25, gain: 0.6 * gain });
  tone(kit, { at: at + 0.07, freq: 3520, decay: 0.1, gain: 0.15 * gain });
}

function sparkle(kit: Kit, count: number, from: number, to: number, gain: number) {
  for (let i = 0; i < count; i++) {
    tone(kit, {
      at: from + kit.random() * (to - from),
      freq: 1800 + kit.random() * 2000,
      decay: 0.1 + kit.random() * 0.08,
      gain,
    });
  }
}

export const RECIPES: Readonly<Record<SoundId, Recipe>> = {
  step: {
    length: 0.15,
    level: 0.2,
    variants: 4,
    draw: (kit, v) => footstep(kit, 0, 0.85 + v * 0.1),
  },
  "heavy-step": {
    length: 0.4,
    level: 0.45,
    variants: 2,
    draw(kit, v) {
      tone(kit, { freq: 62 - v * 6, to: 34, decay: 0.28 });
      noise(kit, {
        color: "brown",
        decay: 0.25,
        gain: 0.8,
        filter: { type: "lowpass", freq: 180 },
      });
      noise(kit, { decay: 0.05, gain: 0.2, filter: { type: "bandpass", freq: 900 } });
    },
  },
  bump: {
    length: 0.2,
    level: 0.32,
    draw(kit) {
      tone(kit, { freq: 120, to: 60, decay: 0.12 });
      noise(kit, { decay: 0.08, gain: 0.6, filter: { type: "lowpass", freq: 500 } });
    },
  },
  swing: {
    length: 0.22,
    level: 0.28,
    variants: 2,
    draw(kit, v) {
      noise(kit, {
        attack: 0.05,
        decay: 0.12,
        filter: { type: "bandpass", freq: 500 + v * 120, to: 2200 + v * 400, sweep: 0.15, q: 1.2 },
      });
    },
  },
  hit: {
    length: 0.2,
    level: 0.8,
    variants: 3,
    draw(kit, v) {
      noise(kit, { decay: 0.02, gain: 0.6, filter: { type: "highpass", freq: 2000 } });
      noise(kit, {
        decay: 0.09,
        gain: 0.8,
        filter: { type: "bandpass", freq: 950 + v * 200, q: 0.8 },
      });
      tone(kit, { type: "triangle", freq: 190 + v * 25, to: 80, decay: 0.1, gain: 0.6 });
    },
  },
  "hero-hurt": {
    length: 0.3,
    level: 0.6,
    variants: 2,
    draw(kit, v) {
      noise(kit, { decay: 0.14, filter: { type: "lowpass", freq: 1400, to: 400 } });
      tone(kit, {
        type: "square",
        freq: 150 - v * 15,
        to: 70,
        decay: 0.18,
        gain: 0.5,
        filter: { type: "lowpass", freq: 700 },
      });
      tone(kit, { freq: 70, to: 45, decay: 0.2, gain: 0.7 });
    },
  },
  armor: {
    length: 0.4,
    level: 0.32,
    draw(kit) {
      bell(kit, { freq: 900, decay: 0.25, gain: 0.8 });
      noise(kit, { decay: 0.015, gain: 0.5, filter: { type: "highpass", freq: 3000 } });
    },
  },
  bolt: {
    length: 0.3,
    level: 0.36,
    draw(kit) {
      tone(kit, {
        type: "sawtooth",
        freq: 1100,
        to: 260,
        glide: 0.2,
        decay: 0.2,
        gain: 0.5,
        filter: { type: "lowpass", freq: 2400 },
      });
      noise(kit, { decay: 0.18, gain: 0.4, filter: { type: "bandpass", freq: 1800, to: 700 } });
      tone(kit, { freq: 600, to: 200, decay: 0.15, gain: 0.4 });
    },
  },
  "creature-notice": {
    length: 0.3,
    level: 0.22,
    draw(kit) {
      tone(kit, {
        type: "triangle",
        freq: 320,
        to: 480,
        glide: 0.07,
        attack: 0.01,
        hold: 0.03,
        decay: 0.1,
        filter: { type: "lowpass", freq: 1800 },
        vibrato: { rate: 30, depth: 15 },
      });
      tone(kit, {
        type: "triangle",
        at: 0.09,
        freq: 480,
        to: 420,
        decay: 0.08,
        gain: 0.6,
        filter: { type: "lowpass", freq: 1800 },
      });
    },
  },
  "creature-ready": {
    length: 0.4,
    level: 0.3,
    draw(kit) {
      tone(kit, {
        type: "sawtooth",
        freq: 180,
        to: 360,
        glide: 0.28,
        attack: 0.2,
        decay: 0.1,
        gain: 0.5,
        filter: { type: "lowpass", freq: 1200, q: 4 },
      });
      noise(kit, {
        attack: 0.22,
        decay: 0.08,
        gain: 0.5,
        filter: { type: "bandpass", freq: 400, to: 1600, sweep: 0.3 },
      });
    },
  },
  "creature-die": {
    length: 0.7,
    level: 0.5,
    variants: 2,
    draw(kit, v) {
      noise(kit, {
        attack: 0.01,
        decay: 0.45,
        gain: 0.9,
        filter: { type: "bandpass", freq: 2200, to: 280, q: 1.5 },
      });
      tone(kit, {
        type: "triangle",
        freq: 420 + v * 40,
        to: 110,
        glide: 0.4,
        decay: 0.42,
        gain: 0.5,
        vibrato: { rate: 9, depth: 20 },
      });
      sparkle(kit, 4, 0.15, 0.4, 0.15);
    },
  },
  "guardian-die": {
    length: 2,
    level: 0.85,
    draw(kit) {
      tone(kit, { freq: 75, to: 28, glide: 1.2, decay: 1.3 });
      noise(kit, {
        color: "brown",
        decay: 1.2,
        gain: 0.9,
        filter: { type: "lowpass", freq: 800, to: 120 },
      });
      bell(kit, { freq: 160, at: 0.05, decay: 1.6, gain: 0.35 });
      noise(kit, { decay: 0.9, gain: 0.4, filter: { type: "bandpass", freq: 1500, to: 200 } });
    },
  },
  death: {
    length: 2.4,
    level: 0.7,
    draw(kit) {
      tone(kit, {
        type: "sawtooth",
        freq: 220,
        to: 55,
        glide: 1.3,
        attack: 0.02,
        decay: 1.4,
        gain: 0.5,
        filter: { type: "lowpass", freq: 900, to: 300 },
      });
      tone(kit, { freq: 110, to: 40, decay: 1.4, gain: 0.6 });
      noise(kit, {
        color: "brown",
        attack: 0.3,
        decay: 1.2,
        gain: 0.5,
        filter: { type: "lowpass", freq: 400 },
      });
      bell(kit, { freq: 196, at: 0.1, decay: 2, gain: 0.25 });
    },
  },
  "level-up": {
    length: 1.3,
    level: 0.55,
    draw(kit) {
      [587.33, 739.99, 880, 1174.66].forEach((freq, i) => {
        const at = i * 0.085;
        tone(kit, { at, freq, decay: 0.7, gain: 0.6 });
        tone(kit, { at, freq: freq * 2, decay: 0.3, gain: 0.15 });
        tone(kit, { at, type: "triangle", freq: freq * 1.002, decay: 0.5, gain: 0.2 });
      });
      noise(kit, {
        attack: 0.25,
        decay: 0.5,
        gain: 0.12,
        filter: { type: "highpass", freq: 5000 },
      });
    },
  },
  stairs: {
    length: 1.3,
    level: 0.5,
    draw(kit) {
      footstep(kit, 0, 1);
      footstep(kit, 0.16, 0.9, 0.8);
      footstep(kit, 0.32, 0.8, 0.6);
      noise(kit, {
        color: "brown",
        at: 0.1,
        attack: 0.3,
        decay: 0.9,
        gain: 0.6,
        filter: { type: "lowpass", freq: 900, to: 150 },
      });
    },
  },
  "lantern-bright": {
    length: 0.5,
    level: 0.38,
    draw(kit) {
      noise(kit, {
        attack: 0.18,
        decay: 0.25,
        gain: 0.8,
        filter: { type: "bandpass", freq: 350, to: 1500, sweep: 0.3, q: 0.9 },
      });
      crackles(kit, 8, 0, 0.35, 0.4);
      tone(kit, { freq: 200, to: 320, attack: 0.15, decay: 0.2, gain: 0.2 });
    },
  },
  "lantern-dim": {
    length: 0.35,
    level: 0.28,
    draw(kit) {
      noise(kit, {
        attack: 0.02,
        decay: 0.28,
        gain: 0.8,
        filter: { type: "bandpass", freq: 1200, to: 300, q: 0.9 },
      });
      tone(kit, { freq: 300, to: 180, decay: 0.2, gain: 0.2 });
    },
  },
  pulse: {
    length: 1,
    level: 0.68,
    draw(kit) {
      tone(kit, { freq: 190, to: 48, glide: 0.5, decay: 0.55 });
      noise(kit, { decay: 0.45, gain: 0.6, filter: { type: "lowpass", freq: 3500, to: 180 } });
      tone(kit, {
        freq: 660,
        attack: 0.03,
        decay: 0.8,
        gain: 0.25,
        vibrato: { rate: 6, depth: 8 },
      });
      tone(kit, { freq: 990, attack: 0.03, decay: 0.6, gain: 0.12 });
    },
  },
  denied: {
    length: 0.25,
    level: 0.16,
    draw(kit) {
      for (const [at, freq] of [
        [0, 230],
        [0.1, 175],
      ] as const) {
        tone(kit, {
          type: "square",
          at,
          freq,
          hold: 0.05,
          decay: 0.04,
          gain: 0.5,
          filter: { type: "lowpass", freq: 900 },
        });
      }
    },
  },
  rest: {
    length: 1.8,
    level: 0.45,
    draw(kit) {
      for (const freq of [220, 277.18, 329.63, 440]) {
        tone(kit, {
          type: "triangle",
          freq,
          attack: 0.35,
          hold: 0.2,
          decay: 1.1,
          gain: 0.3,
          filter: { type: "lowpass", freq: 1500 },
          vibrato: { rate: 4.5, depth: 1.2 },
        });
      }
      crackles(kit, 12, 0.05, 1.4, 0.2, 2500);
      noise(kit, {
        color: "brown",
        attack: 0.3,
        decay: 1.2,
        gain: 0.2,
        filter: { type: "lowpass", freq: 300 },
      });
    },
  },
  pickup: {
    length: 0.4,
    level: 0.36,
    draw: (kit) => chime(kit, 0),
  },
  "cache-open": {
    length: 0.6,
    level: 0.48,
    draw(kit) {
      for (const at of [0, 0.035, 0.08]) {
        noise(kit, {
          at,
          decay: 0.04,
          gain: 0.8,
          filter: { type: "bandpass", freq: 700 + kit.random() * 500, q: 2.5 },
        });
      }
      tone(kit, { freq: 160, to: 110, decay: 0.09, gain: 0.6 });
      chime(kit, 0.14, 0.6);
    },
  },
  coins: {
    length: 0.5,
    level: 0.36,
    variants: 3,
    draw(kit, v) {
      for (let i = 0; i < 7 + v; i++) {
        const at = kit.random() * 0.22;
        const freq = 2600 + kit.random() * 2400;
        tone(kit, { at, freq, decay: 0.06 + kit.random() * 0.12, gain: 0.3 });
        tone(kit, { at, freq: freq * 1.53, decay: 0.05, gain: 0.15 });
        noise(kit, { at, decay: 0.004, gain: 0.15, filter: { type: "highpass", freq: 4000 } });
      }
    },
  },
  hoard: {
    length: 1.2,
    level: 0.55,
    draw(kit) {
      for (let i = 0; i < 28; i++) {
        const at = kit.random() ** 1.5 * 0.8;
        const freq = 2400 + kit.random() * 2800;
        tone(kit, { at, freq, decay: 0.06 + kit.random() * 0.14, gain: 0.25 });
        tone(kit, { at, freq: freq * 1.53, decay: 0.05, gain: 0.12 });
      }
      tone(kit, { freq: 90, to: 50, decay: 0.2, gain: 0.6 });
      noise(kit, { decay: 0.6, gain: 0.15, filter: { type: "lowpass", freq: 3000 } });
    },
  },
  "equip-weapon": {
    length: 0.6,
    level: 0.4,
    draw(kit) {
      noise(kit, {
        attack: 0.02,
        decay: 0.25,
        gain: 0.6,
        filter: { type: "bandpass", freq: 3500, to: 7000, q: 3 },
      });
      bell(kit, { freq: 1400, decay: 0.45, gain: 0.35 });
    },
  },
  "equip-armor": {
    length: 0.5,
    level: 0.36,
    draw(kit) {
      for (const at of [0, 0.07, 0.15]) {
        noise(kit, { at, decay: 0.05, gain: 0.5, filter: { type: "bandpass", freq: 900, q: 1 } });
      }
      bell(kit, { freq: 520, at: 0.17, decay: 0.25, gain: 0.3 });
    },
  },
  drop: {
    length: 0.25,
    level: 0.26,
    draw(kit) {
      tone(kit, { freq: 260, to: 150, decay: 0.07, gain: 0.6 });
      noise(kit, { decay: 0.03, gain: 0.3, filter: { type: "bandpass", freq: 1500 } });
      bell(kit, { freq: 1900, at: 0.04, decay: 0.12, gain: 0.12 });
    },
  },
  heal: {
    length: 0.8,
    level: 0.4,
    draw(kit) {
      tone(kit, {
        freq: 392,
        to: 784,
        glide: 0.45,
        attack: 0.05,
        decay: 0.5,
        gain: 0.5,
        vibrato: { rate: 7, depth: 6 },
      });
      sparkle(kit, 6, 0.1, 0.5, 0.15);
      noise(kit, { attack: 0.2, decay: 0.3, gain: 0.08, filter: { type: "highpass", freq: 4000 } });
    },
  },
  vigor: {
    length: 0.9,
    level: 0.48,
    draw(kit) {
      for (const at of [0, 0.18]) tone(kit, { at, freq: 70, to: 48, decay: 0.12, gain: 0.9 });
      tone(kit, {
        type: "triangle",
        at: 0.3,
        freq: 220,
        to: 440,
        glide: 0.4,
        attack: 0.05,
        decay: 0.35,
        gain: 0.35,
        filter: { type: "lowpass", freq: 1500 },
      });
    },
  },
  charge: {
    length: 1.1,
    level: 0.4,
    draw(kit) {
      bell(kit, { freq: 1046, decay: 0.9, gain: 0.5 });
      bell(kit, { freq: 1568, at: 0.09, decay: 0.7, gain: 0.35 });
      noise(kit, {
        attack: 0.3,
        decay: 0.2,
        gain: 0.2,
        filter: { type: "bandpass", freq: 1000, to: 5000, sweep: 0.5 },
      });
    },
  },
  shield: {
    length: 0.9,
    level: 0.4,
    draw(kit) {
      for (const [type, freq] of [
        ["triangle", 220],
        ["triangle", 222.5],
        ["sine", 330],
        ["sine", 331.6],
      ] as const) {
        tone(kit, {
          type,
          freq,
          attack: 0.12,
          hold: 0.15,
          decay: 0.5,
          gain: 0.3,
          filter: { type: "lowpass", freq: 1600 },
        });
      }
      noise(kit, {
        attack: 0.1,
        decay: 0.2,
        gain: 0.2,
        filter: { type: "bandpass", freq: 600, to: 1200, sweep: 0.3 },
      });
    },
  },
  flare: {
    length: 1,
    level: 0.72,
    draw(kit) {
      noise(kit, { decay: 0.7, filter: { type: "lowpass", freq: 6000, to: 250 } });
      tone(kit, { freq: 85, to: 38, decay: 0.4, gain: 0.9 });
      crackles(kit, 14, 0.1, 0.7, 0.3);
    },
  },
  survey: {
    length: 1.4,
    level: 0.36,
    draw(kit) {
      for (const [at, gain] of [
        [0, 1],
        [0.28, 0.5],
        [0.56, 0.2],
      ] as const) {
        tone(kit, { at, freq: 1050, decay: 0.9 * gain + 0.2, gain: 0.5 * gain });
        tone(kit, { at, freq: 2100, decay: 0.3, gain: 0.1 * gain });
      }
      noise(kit, {
        attack: 0.4,
        decay: 0.2,
        gain: 0.1,
        filter: { type: "bandpass", freq: 300, to: 3000, sweep: 0.6 },
      });
    },
  },
  waystone: {
    length: 0.9,
    level: 0.34,
    draw(kit) {
      tone(kit, {
        freq: 300,
        path: [
          [0.3, 1300],
          [0.7, 220],
        ],
        attack: 0.02,
        hold: 0.4,
        decay: 0.3,
        gain: 0.5,
        vibrato: { rate: 12, depth: 25 },
      });
      noise(kit, {
        attack: 0.3,
        decay: 0.4,
        gain: 0.4,
        filter: { type: "bandpass", freq: 500, to: 3000, sweep: 0.3, q: 2 },
      });
    },
  },
  "trap-found": {
    length: 0.5,
    level: 0.3,
    draw(kit) {
      bell(kit, { freq: 2400, decay: 0.35, gain: 0.4 });
      tone(kit, { at: 0.05, freq: 3600, decay: 0.2, gain: 0.2 });
    },
  },
  "trap-ember-vent": {
    length: 1,
    level: 0.6,
    draw(kit) {
      noise(kit, {
        attack: 0.02,
        decay: 0.7,
        filter: { type: "bandpass", freq: 900, to: 350, q: 0.7 },
      });
      noise(kit, {
        color: "brown",
        decay: 0.6,
        gain: 0.6,
        filter: { type: "lowpass", freq: 400 },
      });
      crackles(kit, 16, 0.05, 0.7, 0.35);
      tone(kit, { freq: 110, to: 60, decay: 0.3, gain: 0.5 });
    },
  },
  "trap-alarm-glyph": {
    length: 0.9,
    level: 0.5,
    draw(kit) {
      for (const at of [0, 0.14, 0.28]) bell(kit, { freq: 880, at, decay: 0.45, gain: 0.5 });
    },
  },
  "trap-gloom-rune": {
    length: 1.2,
    level: 0.4,
    draw(kit) {
      for (const freq of [55, 58.3]) {
        tone(kit, {
          type: "sawtooth",
          freq,
          attack: 0.4,
          hold: 0.1,
          decay: 0.5,
          gain: 0.4,
          filter: { type: "lowpass", freq: 380 },
        });
      }
      tone(kit, { freq: 220, to: 110, glide: 0.9, attack: 0.3, decay: 0.6, gain: 0.25 });
      noise(kit, {
        attack: 0.45,
        decay: 0.15,
        gain: 0.3,
        filter: { type: "bandpass", freq: 2000, to: 400, sweep: 0.6 },
      });
    },
  },
  sealed: {
    length: 1.1,
    level: 0.5,
    draw(kit) {
      tone(kit, { freq: 60, to: 40, attack: 0.01, decay: 0.9 });
      noise(kit, {
        color: "brown",
        attack: 0.02,
        decay: 0.8,
        gain: 0.8,
        filter: { type: "lowpass", freq: 160 },
      });
      noise(kit, { decay: 0.1, gain: 0.4, filter: { type: "bandpass", freq: 400 } });
    },
  },
  rekindle: {
    length: 3.8,
    level: 0.8,
    draw(kit) {
      for (const freq of [146.83, 220, 293.66, 369.99, 440, 587.33]) {
        for (const [type, detune] of [
          ["sine", 1],
          ["triangle", 1.003],
        ] as const) {
          tone(kit, {
            type,
            freq: freq * detune,
            attack: 1.2,
            hold: 0.6,
            decay: 1.6,
            gain: 0.18,
            vibrato: { rate: 5, depth: 1.5 },
          });
        }
      }
      noise(kit, {
        attack: 1.2,
        decay: 0.6,
        gain: 0.3,
        filter: { type: "bandpass", freq: 200, to: 3000, sweep: 1.2 },
      });
      bell(kit, { freq: 587.33, at: 1.2, decay: 2.2, gain: 0.35 });
      tone(kit, { at: 1.2, freq: 80, to: 40, decay: 0.8, gain: 0.5 });
    },
  },
  "ui-click": {
    length: 0.06,
    level: 0.16,
    draw(kit) {
      tone(kit, { freq: 1700, decay: 0.025, gain: 0.6 });
      noise(kit, { decay: 0.006, gain: 0.3, filter: { type: "highpass", freq: 4000 } });
    },
  },
  "ui-open": {
    length: 0.16,
    level: 0.2,
    draw(kit) {
      noise(kit, {
        attack: 0.04,
        decay: 0.08,
        gain: 0.6,
        filter: { type: "bandpass", freq: 500, to: 1600, sweep: 0.12, q: 1.2 },
      });
      tone(kit, { at: 0.03, freq: 900, decay: 0.04, gain: 0.2 });
    },
  },
  "ui-close": {
    length: 0.14,
    level: 0.17,
    draw(kit) {
      noise(kit, {
        attack: 0.02,
        decay: 0.09,
        gain: 0.6,
        filter: { type: "bandpass", freq: 1500, to: 450, q: 1.2 },
      });
    },
  },
  achievement: {
    length: 1.5,
    level: 0.48,
    draw(kit) {
      bell(kit, { freq: 659.25, decay: 1, gain: 0.5 });
      bell(kit, { freq: 987.77, at: 0.12, decay: 1.2, gain: 0.5 });
      noise(kit, { attack: 0.2, decay: 0.6, gain: 0.1, filter: { type: "highpass", freq: 6000 } });
    },
  },
  ambience: {
    length: 12,
    loopBlend: 1.5,
    level: 0.35,
    stereo: true,
    draw(kit) {
      const ctx = kit.ctx;
      const merger = ctx.createChannelMerger(2);
      merger.connect(kit.out);
      const end = 13.5;
      [0.07, 0.11].forEach((rate, channel) => {
        const source = ctx.createBufferSource();
        source.buffer = longNoise(kit, end, "brown");
        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 520;
        filter.Q.value = 0.5;
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = rate;
        depth.gain.value = 180;
        lfo.connect(depth).connect(filter.frequency);
        const gain = ctx.createGain();
        gain.gain.value = 0.8;
        source.connect(filter).connect(gain).connect(merger, 0, channel);
        // A faint whistle of air through cracks, rising and falling.
        const whistle = ctx.createBufferSource();
        whistle.buffer = longNoise(kit, end, "white");
        const band = ctx.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = 1300 + channel * 250;
        band.Q.value = 6;
        const swell = ctx.createGain();
        swell.gain.value = 0.025;
        const swellLfo = ctx.createOscillator();
        const swellDepth = ctx.createGain();
        swellLfo.frequency.value = rate * 1.7;
        swellDepth.gain.value = 0.02;
        swellLfo.connect(swellDepth).connect(swell.gain);
        whistle.connect(band).connect(swell).connect(merger, 0, channel);
        for (const node of [source, whistle, lfo, swellLfo]) {
          node.start(0);
          node.stop(end);
        }
      });
    },
  },
  drip: {
    length: 0.45,
    level: 0.32,
    variants: 3,
    draw(kit, v) {
      const freq = 900 + v * 260;
      for (const [at, gain] of [
        [0, 0.7],
        [0.18, 0.2],
      ] as const) {
        tone(kit, { at, freq, to: freq * 1.6, glide: 0.03, decay: 0.12, gain });
      }
    },
  },
  rumble: {
    length: 3.2,
    level: 0.4,
    draw(kit) {
      noise(kit, {
        color: "brown",
        attack: 0.8,
        hold: 0.5,
        decay: 1.5,
        filter: { type: "lowpass", freq: 120 },
      });
      tone(kit, { freq: 38, attack: 0.8, decay: 1.8, gain: 0.3 });
      crackles(kit, 6, 0.6, 1.8, 0.1, 300);
    },
  },
};

/**
 * Renders one take of a recipe into a buffer, scaled to its `level` with no clicks at either
 * end; looping sounds have their tail blended into their start.
 */
export async function renderRecipe(id: SoundId, variant: number): Promise<AudioBuffer> {
  const recipe = RECIPES[id];
  const blend = recipe.loopBlend ?? 0;
  const channels = recipe.stereo ? 2 : 1;
  const frames = Math.ceil((recipe.length + blend) * SAMPLE_RATE);
  const ctx = new OfflineAudioContext(channels, frames, SAMPLE_RATE);
  const out = ctx.createGain();
  out.connect(ctx.destination);
  recipe.draw({ ctx, out, random: seededRandom(hashText(`${id}:${variant}`)) }, variant);
  const rendered = await ctx.startRendering();

  const length = Math.ceil(recipe.length * SAMPLE_RATE);
  const result = new AudioBuffer({ length, sampleRate: SAMPLE_RATE, numberOfChannels: channels });
  let peak = 0;
  for (let c = 0; c < channels; c++) {
    const data = rendered.getChannelData(c);
    for (const sample of data) peak = Math.max(peak, Math.abs(sample));
  }
  const scale = peak > 0 ? recipe.level / peak : 0;
  const blendFrames = Math.floor(blend * SAMPLE_RATE);
  const edge = Math.floor(0.004 * SAMPLE_RATE);
  for (let c = 0; c < channels; c++) {
    const source = rendered.getChannelData(c);
    const target = result.getChannelData(c);
    for (let i = 0; i < length; i++) {
      let sample = source[i] ?? 0;
      if (i < blendFrames) {
        // Equal-power crossfade from the rendered tail into the start.
        const t = i / blendFrames;
        sample =
          sample * Math.sin((t * Math.PI) / 2) +
          (source[length + i] ?? 0) * Math.cos((t * Math.PI) / 2);
      }
      if (!blend) {
        if (i < edge) sample *= i / edge;
        if (i > length - edge) sample *= (length - i) / edge;
      }
      target[i] = sample * scale;
    }
  }
  return result;
}
