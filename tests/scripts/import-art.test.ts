import { describe, expect, it } from "vitest";
import { idForFile } from "../../scripts/import-art.mjs";

describe("art import", () => {
  it("matches the owner's file names to game ids", () => {
    expect(idForFile("emberdepths_monster_gear_hound_icon.jpg")).toBe("gear-hound");
    expect(idForFile("emberdepths_monster_beacon_warden_final_boss_icon.jpg")).toBe(
      "beacon-warden",
    );
    expect(idForFile("emberdepths_mossjaw_monster_icon.jpg")).toBe("moss-jaw");
    expect(idForFile("emberdepths_item_restorative_salve_icon.jpg")).toBe("salve");
    expect(idForFile("emberdepths_icon_item_weathered_knife.jpg")).toBe("weathered-knife");
    expect(idForFile("emberdepths_map_loot_cache_icon.jpg")).toBe("cache");
    expect(idForFile("emberdepths_map_gold_icon.jpg")).toBe("gold");
    expect(idForFile("emberdepths_map_camp_icon.jpg")).toBe("camp");
    expect(idForFile("emberdepths_stairs_down_icon.jpg")).toBe("stairs-down");
    expect(idForFile("emberdepths_playericon_2.jpg")).toBe("hero");
    expect(idForFile("ember-vent.png")).toBe("ember-vent");
  });

  it("leaves pictures that match nothing alone", () => {
    expect(idForFile("emberdepths_logo.jpg")).toBeNull();
    expect(idForFile("emberdepths_horizontal_banner.jpg")).toBeNull();
    expect(idForFile("emberdepths_spike_trap_icon.jpg")).toBeNull();
    expect(idForFile("emberdepths_item_void_hauberk_icon.jpg")).toBeNull();
  });
});
