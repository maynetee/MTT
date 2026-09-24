import type { View } from "../../engine/types";
import { useLevelSounds } from "./useLevelSounds";

/** The level sounds of the director's window; renders nothing. */
export function LevelSounds({ view, offsetMs }: { view: View; offsetMs: number }) {
  useLevelSounds(view, offsetMs, "control");
  return null;
}
