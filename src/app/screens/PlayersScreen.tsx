import { useEffect, useMemo, useRef, useState } from "react";
import type { BustInput, RankingRow } from "../../engine/types";
import { useI18n } from "../../i18n";
import { useTournament } from "../TournamentContext";
import { formatPlace } from "../utils/labels";
import { freeSeatsAtOpenTables, seatKey } from "../utils/view";

/** Selected players of a same-hand elimination, with the starting stack typed for each. */
type Selection = Map<number, string>;

export default function PlayersScreen() {
  const i18n = useI18n();
  const { t } = i18n;
  const { view, run } = useTournament();
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [revivePlayer, setRevivePlayer] = useState<number | "">("");
  // null follows the first free seat, "" is an explicit empty choice.
  const [reviveSeatChoice, setReviveSeatChoice] = useState<string | null>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const list = [...view.ranking].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.player - b.player);
    return term ? list.filter((row) => row.name.toLowerCase().includes(term)) : list;
  }, [search, view.ranking]);

  const running = view.phase === "running";
  const canEliminate = running && view.counts.alive > 1;
  const eliminated = view.ranking.filter((row) => !row.alive);
  const availableSeats = freeSeatsAtOpenTables(view);
  // A chosen seat that is no longer free is dropped rather than submitted.
  const reviveSeatKey = reviveSeatChoice ?? (availableSeats[0] ? seatKey(availableSeats[0]) : "");
  const reviveSeat = availableSeats.find((seat) => seatKey(seat) === reviveSeatKey) ?? null;
  const winner = view.winner === null ? null : view.ranking.find((row) => row.player === view.winner);

  const eliminate = (player: number) => void run({ type: "bust_players", busts: [{ player }] });

  const toggle = (player: number, selected: boolean) => {
    const next = new Map(selection ?? []);
    if (selected) next.set(player, "");
    else next.delete(player);
    setSelection(next);
  };

  const eliminateSelected = async () => {
    if (!selection || selection.size === 0) return;
    const busts: BustInput[] = [...selection].map(([player, stack]) =>
      stack.trim() === "" ? { player } : { player, startStack: Math.trunc(Number(stack)) }
    );
    if (await run({ type: "bust_players", busts })) setSelection(null);
  };

  const handleRevive = async () => {
    if (revivePlayer === "" || !reviveSeat) return;
    if (await run({ type: "revive_player", player: revivePlayer, seat: reviveSeat })) {
      setRevivePlayer("");
      setReviveSeatChoice(null);
    }
  };

  const subtitle = (row: RankingRow) => {
    if (row.player === view.winner) return t("players.winner");
    if (row.alive) {
      return t("players.inPlay", { seat: row.seat ? t("common.tableSeat", { table: row.seat.table, seat: row.seat.seat }) : t("common.none") });
    }
    return t("players.eliminated", { place: formatPlace(row) });
  };

  return (
    <div className="card">
      <div className="card-header">
        <h2>{t("players.title")}</h2>
        {canEliminate && !selection && (
          <button className="btn" onClick={() => setSelection(new Map())}>
            {t("players.sameHand")}
          </button>
        )}
      </div>

      {winner && <div className="feedback-box">{t("players.won", { name: winner.name })}</div>}

      {selection && (
        <div className="card same-hand">
          <div className="muted">{t("players.sameHandHint")}</div>
          <div className="button-row">
            <button className="btn primary" onClick={() => void eliminateSelected()} disabled={selection.size === 0}>
              {t("players.eliminateSelected", { count: selection.size })}
            </button>
            <button className="btn" onClick={() => setSelection(null)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {running && eliminated.length > 0 && (
        <div className="card">
          <div className="card-header">
            <h3>{t("players.reviveTitle")}</h3>
          </div>
          <div className="muted">{t("players.reviveHint")}</div>
          <div className="grid-2">
            <label>
              {t("common.player")}
              <select value={revivePlayer} onChange={(event) => setRevivePlayer(event.target.value === "" ? "" : Number(event.target.value))}>
                <option value="">{t("players.selectEliminated")}</option>
                {eliminated.map((row) => (
                  <option key={row.player} value={row.player}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("common.seat")}
              <select value={reviveSeat ? seatKey(reviveSeat) : ""} onChange={(event) => setReviveSeatChoice(event.target.value)}>
                <option value="">{t("common.selectSeat")}</option>
                {availableSeats.map((seat) => (
                  <option key={seatKey(seat)} value={seatKey(seat)}>
                    {t("common.tableSeat", { table: seat.table, seat: seat.seat })}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="btn" onClick={() => void handleRevive()} disabled={revivePlayer === "" || !reviveSeat}>
            {t("players.revive")}
          </button>
        </div>
      )}

      <input ref={inputRef} placeholder={t("players.search")} aria-label={t("players.search")} value={search} onChange={(event) => setSearch(event.target.value)} />

      <div className="list">
        {filtered.map((row) => {
          const selected = selection?.has(row.player) ?? false;
          return (
            <div key={row.player} className={`list-row ${selected ? "selected" : ""}`}>
              <div className="player-cell">
                {selection && row.alive && (
                  <input
                    type="checkbox"
                    className="row-check"
                    aria-label={t("players.select", { name: row.name })}
                    checked={selected}
                    onChange={(event) => toggle(row.player, event.target.checked)}
                  />
                )}
                <div>
                  <div className="list-title">{row.name}</div>
                  <div className="list-subtitle">{subtitle(row)}</div>
                </div>
              </div>
              {selection && selected && (
                <input
                  type="number"
                  min={1}
                  className="stack-input"
                  placeholder={t("players.startStackOptional")}
                  aria-label={`${t("players.startStack")} ${row.name}`}
                  value={selection.get(row.player) ?? ""}
                  onChange={(event) => setSelection(new Map(selection).set(row.player, event.target.value))}
                />
              )}
              {!selection && canEliminate && row.alive && (
                <button className="btn" onClick={() => eliminate(row.player)} aria-label={`${t("players.eliminate")} ${row.name}`}>
                  {t("players.eliminate")}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
