import type { Engine, PhaseName, TournamentSummary } from "../../engine/types";

/** The core's limit on tournament names, in characters. */
export const MAX_TOURNAMENT_NAME = 100;

/** Copy name templates, with `{name}` and (second one) `{n}` placeholders. */
export interface CopyNameTemplates {
  /** e.g. `{name} (copy)` */
  first: string;
  /** e.g. `{name} (copy {n})` */
  nth: string;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches a name built from `template`, capturing the original name. */
function templatePattern(template: string): RegExp {
  const pattern = escape(template).replace(escape("{name}"), "(.+?)").replace(escape("{n}"), "\\d+");
  return new RegExp(`^${pattern}$`, "u");
}

function fill(template: string, name: string, n: number): string {
  return template.replace("{name}", name).replace("{n}", String(n));
}

/** Cuts a name to `max` characters (code points, as the core counts them). */
function truncate(name: string, max: number): string {
  const chars = [...name];
  return chars.length <= max ? name : chars.slice(0, max).join("").trimEnd();
}

/**
 * The name of a copy of `name`: "Friday (copy)", then "Friday (copy 2)" and so on when taken.
 * A copy of a copy counts on from the original ("Friday (copy 2)", not "Friday (copy) (copy)"),
 * and the original is shortened if needed to stay within the core's limit.
 */
export function copyName(name: string, taken: Iterable<string>, templates: CopyNameTemplates): string {
  const trimmed = name.trim();
  const original = [templates.first, templates.nth].map((template) => templatePattern(template).exec(trimmed)?.[1]).find(Boolean) ?? trimmed;
  const used = new Set([...taken].map((existing) => existing.trim().toLocaleLowerCase()));
  for (let n = 1; ; n++) {
    const template = n === 1 ? templates.first : templates.nth;
    const room = MAX_TOURNAMENT_NAME - [...fill(template, "", n)].length;
    const candidate = fill(template, truncate(original, room), n);
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
}

/**
 * Creates a tournament with the configuration and structure of `sourceId`, under `name`,
 * through the engine: no players, no history, clock at the first level.
 */
export async function duplicateTournament(engine: Engine, sourceId: string, name: string): Promise<string> {
  const view = await engine.getView(sourceId);
  return engine.createTournament({ config: { ...view.config, name }, structure: view.levels.map((row) => row.level) });
}

/** Most recently changed first. */
export function byLastChange(summaries: readonly TournamentSummary[]): TournamentSummary[] {
  return [...summaries].sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

/** Lower case without accents, so that "zoe" finds "Zoë". */
export function searchKey(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

export type PhaseFilter = "all" | PhaseName;

/** The tournaments whose name contains `search` (accents and case ignored) in `phase`. */
export function filterTournaments(summaries: readonly TournamentSummary[], search: string, phase: PhaseFilter): TournamentSummary[] {
  const term = searchKey(search.trim());
  return summaries.filter((summary) => (phase === "all" || summary.phase === phase) && searchKey(summary.name).includes(term));
}
