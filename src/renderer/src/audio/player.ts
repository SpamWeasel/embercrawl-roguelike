/**
 * Plays the game's sounds through Web Audio. One shared player (`sound`) serves every screen:
 *
 *   each sound → its own volume and left/right placement → its group's slider (effects,
 *   interface, ambience) → master volume → a limiter (so a pile-up never distorts) → speakers.
 *
 * Effects also feed a soft echo, so the dungeon sounds like stone halls. The rules never wait on
 * sound: anything that can't play yet (still loading, muted) is simply skipped.
 */
import {
  ambienceMood,
  isSoundId,
  SOUND_IDS,
  SOUNDS,
  type SoundGroup,
  type SoundId,
  seededRandom,
  soundForFile,
  volumeGain,
} from "./sounds";
import { RECIPES, renderRecipe, SAMPLE_RATE } from "./synth";

/** The player's own files, picked up by name (inlined, so they load the same in every build). */
const FILES = import.meta.glob<string>("../assets/sounds/*.{ogg,mp3,wav}", {
  eager: true,
  query: "?inline",
  import: "default",
});

export interface SoundSettings {
  readonly masterVolume: number;
  readonly effectsVolume: number;
  readonly interfaceVolume: number;
  readonly ambienceVolume: number;
  readonly muted: boolean;
  readonly muteInBackground: boolean;
}

export interface PlayOptions {
  /** −1 (left) to 1 (right). */
  readonly pan?: number;
  /** 0 to 1, on top of the sliders. */
  readonly gain?: number;
  /** Playback speed: above 1 is higher and shorter. */
  readonly rate?: number;
  /** Seconds from now. */
  readonly delay?: number;
}

/** The same sound twice within this many seconds plays once (no doubled, phasing hits). */
const REPEAT_GAP = 0.035;
const MAX_VOICES = 32;
const ECHO_LEVEL = 0.16;

function decodeDataUrl(url: string): ArrayBuffer {
  const base64 = url.slice(url.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** A stone-hall echo: a second and a half of fading noise, a little different in each ear. */
function echoResponse(ctx: BaseAudioContext): AudioBuffer {
  const length = Math.floor(1.6 * ctx.sampleRate);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const random = seededRandom(11);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    const preDelay = Math.floor(0.012 * ctx.sampleRate);
    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / ctx.sampleRate;
      data[i] = (random() * 2 - 1) * Math.exp(-t * 4.2);
    }
  }
  return buffer;
}

interface Ambience {
  readonly source: AudioBufferSourceNode;
  readonly filter: BiquadFilterNode;
  readonly gain: GainNode;
  depth: number;
  timers: ReturnType<typeof setTimeout>[];
}

export class SoundPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private groups: Record<SoundGroup, GainNode> | null = null;
  private readonly bank = new Map<SoundId, AudioBuffer[]>();
  private loading: Promise<number> | null = null;
  private readonly lastPlayed = new Map<SoundId, number>();
  private voices = 0;
  private settings: SoundSettings = {
    masterVolume: 80,
    effectsVolume: 100,
    interfaceVolume: 60,
    ambienceVolume: 60,
    muted: false,
    muteInBackground: true,
  };
  private background = false;
  /** Silent for automated runs (the smoke test). */
  private silent = false;
  private ambience: Ambience | null = null;
  /** Sounds the player replaced with their own files. */
  readonly replaced = new Set<SoundId>();

  /** Renders (or loads) every sound once. Resolves to how many sounds are ready. */
  load(): Promise<number> {
    this.loading ??= this.loadBank();
    return this.loading;
  }

  /** Sounds stay silent: used by automated test runs. */
  silence(): void {
    this.silent = true;
    this.applyVolumes();
  }

  configure(settings: SoundSettings): void {
    this.settings = settings;
    this.applyVolumes();
  }

  /** The game window lost or regained focus. */
  setBackground(background: boolean): void {
    this.background = background;
    this.applyVolumes();
  }

  /** Browsers start audio paused until the player presses something; call on any key or click. */
  unlock(): void {
    const ctx = this.context();
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  }

  play(id: SoundId, options: PlayOptions = {}): void {
    const takes = this.bank.get(id);
    if (!takes?.length || this.voices >= MAX_VOICES) return;
    const ctx = this.context();
    const groups = this.groups;
    if (!groups || ctx.state !== "running") return;
    const at = ctx.currentTime + Math.max(0, options.delay ?? 0);
    const last = this.lastPlayed.get(id) ?? -1;
    if (Math.abs(at - last) < REPEAT_GAP) return;
    this.lastPlayed.set(id, at);

    const source = ctx.createBufferSource();
    source.buffer = takes[Math.floor(Math.random() * takes.length)] ?? null;
    const group = SOUNDS[id].group;
    // A touch of random pitch keeps repeated effects from sounding mechanical (cosmetic only).
    const vary =
      group === "effects" && !this.replaced.has(id) ? 1 + (Math.random() - 0.5) * 0.06 : 1;
    source.playbackRate.value = (options.rate ?? 1) * vary;
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, Math.min(1, options.gain ?? 1));
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, options.pan ?? 0));
    source.connect(gain).connect(panner).connect(groups[group]);
    this.voices++;
    source.onended = () => {
      this.voices--;
      source.disconnect();
      panner.disconnect();
    };
    source.start(at);
  }

  /** Starts the background air for a floor (or changes it, if already playing). */
  startAmbience(depth: number): void {
    const buffer = this.bank.get("ambience")?.[0];
    const groups = this.groups;
    if (!buffer || !groups) {
      // Not loaded yet: start once it is.
      void this.load().then(() => {
        if (!this.ambience) this.startAmbienceNow(depth);
      });
      return;
    }
    if (this.ambience) this.setAmbienceDepth(depth);
    else this.startAmbienceNow(depth);
  }

  stopAmbience(): void {
    const ambience = this.ambience;
    if (!ambience || !this.ctx) return;
    this.ambience = null;
    for (const timer of ambience.timers) clearTimeout(timer);
    const now = this.ctx.currentTime;
    ambience.gain.gain.cancelScheduledValues(now);
    ambience.gain.gain.setTargetAtTime(0, now, 0.25);
    ambience.source.stop(now + 1.5);
  }

  private startAmbienceNow(depth: number): void {
    const buffer = this.bank.get("ambience")?.[0];
    const ctx = this.context();
    if (!buffer || !this.groups) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
    source.connect(filter).connect(gain).connect(this.groups.ambience);
    source.start();
    this.ambience = { source, filter, gain, depth, timers: [] };
    this.setAmbienceDepth(depth);
  }

  private setAmbienceDepth(depth: number): void {
    const ambience = this.ambience;
    if (!ambience || !this.ctx) return;
    ambience.depth = depth;
    const mood = ambienceMood(depth);
    const now = this.ctx.currentTime;
    ambience.source.playbackRate.setTargetAtTime(mood.rate, now, 0.6);
    ambience.filter.frequency.setTargetAtTime(mood.cutoff, now, 0.6);
    for (const timer of ambience.timers) clearTimeout(timer);
    ambience.timers = [];
    this.scheduleNoise(ambience, "drip", mood.dripEvery);
    this.scheduleNoise(ambience, "rumble", mood.rumbleEvery);
  }

  /** Drips and rumbles at random moments from random directions (cosmetic randomness). */
  private scheduleNoise(ambience: Ambience, id: "drip" | "rumble", every: number): void {
    if (every <= 0) return;
    const wait = every * (0.5 + Math.random()) * 1000;
    const timer = setTimeout(() => {
      if (this.ambience !== ambience) return;
      ambience.timers = ambience.timers.filter((t) => t !== timer);
      this.play(id, {
        pan: (Math.random() * 2 - 1) * 0.8,
        gain: id === "drip" ? 0.35 + Math.random() * 0.45 : 0.6 + Math.random() * 0.4,
        rate: id === "drip" ? 0.85 + Math.random() * 0.4 : 0.9 + Math.random() * 0.2,
      });
      this.scheduleNoise(ambience, id, every);
    }, wait);
    ambience.timers.push(timer);
  }

  private context(): AudioContext {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext({ latencyHint: "interactive" });
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    limiter.connect(ctx.destination);
    const master = ctx.createGain();
    master.connect(limiter);
    const echo = ctx.createConvolver();
    echo.buffer = echoResponse(ctx);
    const echoLevel = ctx.createGain();
    echoLevel.gain.value = ECHO_LEVEL;
    echo.connect(echoLevel).connect(master);
    const group = () => {
      const node = ctx.createGain();
      node.connect(master);
      return node;
    };
    this.groups = { effects: group(), interface: group(), ambience: group() };
    this.groups.effects.connect(echo);
    this.ctx = ctx;
    this.master = master;
    this.applyVolumes();
    return ctx;
  }

  private applyVolumes(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.groups) return;
    const s = this.settings;
    const quiet = this.silent || s.muted || (s.muteInBackground && this.background);
    const now = ctx.currentTime;
    this.master.gain.setTargetAtTime(quiet ? 0 : volumeGain(s.masterVolume), now, 0.05);
    this.groups.effects.gain.setTargetAtTime(volumeGain(s.effectsVolume), now, 0.05);
    this.groups.interface.gain.setTargetAtTime(volumeGain(s.interfaceVolume), now, 0.05);
    this.groups.ambience.gain.setTargetAtTime(volumeGain(s.ambienceVolume), now, 0.05);
  }

  private async loadBank(): Promise<number> {
    const files = new Map<SoundId, string[]>();
    for (const [path, url] of Object.entries(FILES)) {
      const id = soundForFile(path);
      if (id) files.set(id, [...(files.get(id) ?? []), url]);
      else console.warn(`Sound file ${path} matches no sound id; it is ignored.`);
    }
    const decoder = new OfflineAudioContext(1, 1, SAMPLE_RATE);
    await Promise.all(
      SOUND_IDS.map(async (id) => {
        const urls = files.get(id);
        if (urls) {
          try {
            const takes = await Promise.all(
              urls.map((url) => decoder.decodeAudioData(decodeDataUrl(url))),
            );
            this.bank.set(id, takes);
            this.replaced.add(id);
            return;
          } catch (error) {
            console.warn(
              `Could not read the sound file for "${id}"; using the built-in one.`,
              error,
            );
          }
        }
        const variants = RECIPES[id].variants ?? 1;
        this.bank.set(
          id,
          await Promise.all(Array.from({ length: variants }, (_, v) => renderRecipe(id, v))),
        );
      }),
    );
    // Start the live context now too, so the first sound plays without a hitch.
    this.context();
    return [...this.bank.keys()].filter(isSoundId).length;
  }
}

/** The one player every screen shares. */
export const sound = new SoundPlayer();
