import { Texture } from "pixi.js";
import {
  CACHE,
  GOLD,
  ITEM_IDS,
  type LootId,
  TRAP_IDS,
  type TrapKind,
} from "../../../../engine/items";
import { type ArtImage, type Feature, featureArt, itemArt, trapArt } from "../itemArt";
import { loadImageTexture } from "./textures";

const FEATURES: readonly Feature[] = ["merchant", "beacon", "beacon-lit"];

export interface LootTextures {
  item(id: LootId): Texture;
  trap(kind: TrapKind): Texture;
  /** The merchant's stall and the Beacon (unlit and lit). */
  feature(feature: Feature): Texture;
  destroy(): void;
}

/** Textures for every item, the supply cache, gold, each kind of trap and the floor fixtures. */
export async function loadLootTextures(): Promise<LootTextures> {
  const load = async (art: ArtImage) => {
    const texture = await loadImageTexture(art.url);
    // Drawn placeholders are tiny pixel art; keep their pixels square when scaled up.
    if (art.placeholder) texture.source.scaleMode = "nearest";
    return texture;
  };
  const items = new Map<string, Texture>(
    await Promise.all(
      [...ITEM_IDS, CACHE, GOLD].map(async (id) => [id, await load(itemArt(id))] as const),
    ),
  );
  const traps = new Map<string, Texture>(
    await Promise.all(TRAP_IDS.map(async (id) => [id, await load(trapArt(id))] as const)),
  );
  const features = new Map<string, Texture>(
    await Promise.all(
      FEATURES.map(async (feature) => [feature, await load(featureArt(feature))] as const),
    ),
  );
  return {
    item: (id) => items.get(id) ?? Texture.WHITE,
    trap: (kind) => traps.get(kind) ?? Texture.WHITE,
    feature: (feature) => features.get(feature) ?? Texture.WHITE,
    destroy: () => {
      for (const texture of [...items.values(), ...traps.values(), ...features.values()])
        texture.destroy(true);
    },
  };
}
