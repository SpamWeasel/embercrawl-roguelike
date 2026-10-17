import { Texture } from "pixi.js";
import { CACHE, ITEM_IDS, type LootId, TRAP_IDS, type TrapKind } from "../../../../engine/items";
import { type ArtImage, itemArt, trapArt } from "../itemArt";
import { loadImageTexture } from "./textures";

export interface LootTextures {
  item(id: LootId): Texture;
  trap(kind: TrapKind): Texture;
  destroy(): void;
}

/** Textures for every item, the supply cache and each kind of trap. */
export async function loadLootTextures(): Promise<LootTextures> {
  const load = async (art: ArtImage) => {
    const texture = await loadImageTexture(art.url);
    // Drawn placeholders are tiny pixel art; keep their pixels square when scaled up.
    if (art.placeholder) texture.source.scaleMode = "nearest";
    return texture;
  };
  const items = new Map<string, Texture>(
    await Promise.all(
      [...ITEM_IDS, CACHE].map(async (id) => [id, await load(itemArt(id))] as const),
    ),
  );
  const traps = new Map<string, Texture>(
    await Promise.all(TRAP_IDS.map(async (id) => [id, await load(trapArt(id))] as const)),
  );
  return {
    item: (id) => items.get(id) ?? Texture.WHITE,
    trap: (kind) => traps.get(kind) ?? Texture.WHITE,
    destroy: () => {
      for (const texture of [...items.values(), ...traps.values()]) texture.destroy(true);
    },
  };
}
