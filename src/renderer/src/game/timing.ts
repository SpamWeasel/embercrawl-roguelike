/**
 * Walking pace. One step animates in STEP_MS; held keys and click-to-walk step at about the same
 * rate, so motion flows from tile to tile without stutter. Faster input still works: the
 * animation queue plays steps more quickly to catch up.
 */
export const STEP_MS = 115;
/** Holding a key: the first repeat waits this long, then one step per interval. */
export const KEY_REPEAT_DELAY_MS = 220;
export const KEY_REPEAT_INTERVAL_MS = 120;
/** Time between steps when walking to a clicked tile. */
export const AUTO_WALK_STEP_MS = 115;
