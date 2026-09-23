/** Characters invalid in file names on Windows (which also covers macOS's `:` and `/`), plus control characters. */
const INVALID_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const MAX_BASE_NAME_LENGTH = 100;

/**
 * Makes a string safe to use as a file name on Windows and macOS: removes invalid
 * characters, leading dots (hidden files) and trailing dots or spaces (dropped by
 * Windows), and avoids reserved device names such as CON or NUL.
 */
export function sanitizeFileName(name: string, fallback = "export"): string {
  const cleaned = name
    .replace(INVALID_CHARACTERS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");
  if (!cleaned) return fallback;
  return WINDOWS_RESERVED_NAME.test(cleaned) ? `_${cleaned}` : cleaned;
}

export function rankingFileName(tournamentName: string, extension: "csv" | "pdf"): string {
  // Truncate by code point so that no surrogate pair is split.
  const base = Array.from(sanitizeFileName(tournamentName, "MTT")).slice(0, MAX_BASE_NAME_LENGTH).join("").trim();
  return `${base}-ranking.${extension}`;
}
