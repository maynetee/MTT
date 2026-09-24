import { useEffect, useMemo, useRef, useState } from "react";
import type { BustInput, RankingRow } from "../../engine/types";
import { useI18n } from "../../i18n";
import { Button } from "../components/Button";
import { Section, Stat, StatGroup } from "../components/Card";
import { Callout } from "../components/Callout";
import { Checkbox, Field, Select, TextInput } from "../components/Field";
import { Icon } from "../components/Icon";
import { NumberInput } from "../components/NumberInput";
import { Pill } from "../components/Pill";
import { SegmentedControl } from "../components/SegmentedControl";
import { Table } from "../components/Table";
import { useToast } from "../components/Toast";
import { useTournament } from "../TournamentContext";
import { isMac } from "../utils/keyboard";
import { formatPlace } from "../utils/labels";
import { freeSeatsAtOpenTables, seatKey } from "../utils/view";

/** Selected players of a same-hand elimination, with the starting stack typed for each. */
type Selection = Map<number, number | null>;
type Filter = "all" | "alive" | "out";

export default function PlayersScreen() {
  const i18n = useI18n();
  const { t, list } = i18n;
  const { view, run, undoIfLast } = useTournament();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
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
    const list = [...view.ranking]
      .filter((row) => (filter === "alive" ? row.alive : filter === "out" ? !row.alive : true))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.player - b.player);
    return term ? list.filter((row) => row.name.toLowerCase().includes(term)) : list;
  }, [search, filter, view.ranking]);

  const running = view.phase === "running";
  const canEliminate = running && view.counts.alive > 1;
  const eliminated = view.ranking.filter((row) => !row.alive);
  const availableSeats = freeSeatsAtOpenTables(view);
  // A chosen seat that is no longer free is dropped rather than submitted.
  const reviveSeatKey = reviveSeatChoice ?? (availableSeats[0] ? seatKey(availableSeats[0]) : "");
  const reviveSeat = availableSeats.find((seat) => seatKey(seat) === reviveSeatKey) ?? null;
  const winner = view.winner === null ? null : view.ranking.find((row) => row.player === view.winner);

  /** Eliminates, then offers to take it back: a wrong row clicked in a hurry is one click away. */
  const bust = async (busts: BustInput[]) => {
    const next = await run({ type: "bust_players", busts });
    if (!next) return null;
    const seq = next.history.undo?.seq;
    const names = busts.map(({ player }) => next.ranking.find((row) => row.player === player)?.name ?? `#${player}`);
    toast.show({
      message: t("toast.eliminated", { names: list(names) }),
      action: seq === undefined ? undefined : { label: t("toast.undo"), onAction: () => void undoIfLast(seq) }
    });
    return next;
  };

  const eliminate = (player: number) => void bust([{ player }]);

  const toggle = (player: number, selected: boolean) => {
    const next = new Map(selection ?? []);
    if (selected) next.set(player, null);
    else next.delete(player);
    setSelection(next);
  };

  const eliminateSelected = async () => {
    if (!selection || selection.size === 0) return;
    const busts: BustInput[] = [...selection].map(([player, stack]) => (stack === null ? { player } : { player, startStack: Math.trunc(stack) }));
    if (await bust(busts)) setSelection(null);
  };

  const handleRevive = async () => {
    if (revivePlayer === "" || !reviveSeat) return;
    if (await run({ type: "revive_player", player: revivePlayer, seat: reviveSeat })) {
      setRevivePlayer("");
      setReviveSeatChoice(null);
    }
  };

  const status = (row: RankingRow) => {
    if (row.player === view.winner) return <Pill tone="accent">{t("players.winner")}</Pill>;
    if (row.alive) return <Pill tone="success">{t("players.inPlay")}</Pill>;
    return <Pill tone="muted">{t("players.eliminated")}</Pill>;
  };

  return (
    <div className="players-layout">
      <Section
        title={t("players.title")}
        flush
        actions={
          canEliminate &&
          !selection && (
            <Button icon="userX" onClick={() => setSelection(new Map())}>
              {t("players.sameHand")}
            </Button>
          )
        }
      >
        <div className="players-toolbar">
          <span className="search-field">
            <Icon name="search" size={16} className="search-field-icon" />
            <TextInput
              ref={inputRef}
              type="search"
              placeholder={t("players.search")}
              aria-label={t("players.search")}
              aria-keyshortcuts="Meta+F Control+F"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <kbd className="search-field-key" aria-hidden="true">
              {isMac() ? t("players.searchKeysMac") : t("players.searchKeys")}
            </kbd>
          </span>
          <SegmentedControl<Filter>
            label={t("players.filter")}
            value={filter}
            onChange={setFilter}
            segments={[
              { value: "all", label: t("players.filterAll"), count: view.ranking.length },
              { value: "alive", label: t("players.filterAlive"), count: view.counts.alive },
              { value: "out", label: t("players.filterOut"), count: eliminated.length }
            ]}
          />
        </div>

        {winner && <Callout tone="success">{t("players.won", { name: winner.name })}</Callout>}

        {selection && (
          <Callout
            tone="warning"
            className="same-hand"
            action={
              <span className="row-actions">
                <Button onClick={() => setSelection(null)}>{t("common.cancel")}</Button>
                <Button variant="danger" icon="userX" onClick={() => void eliminateSelected()} disabled={selection.size === 0}>
                  {t("players.eliminateSelected", { count: selection.size })}
                </Button>
              </span>
            }
          >
            {t("players.sameHandHint")}
          </Callout>
        )}

        {filtered.length === 0 ? (
          <p className="muted">{search.trim() ? t("players.noMatch", { search: search.trim() }) : t("players.noneInFilter")}</p>
        ) : (
          <Table caption={t("players.title")} className="players-table">
            <thead>
              <tr>
                {selection && <th scope="col" className="check-cell" />}
                <th scope="col">{t("common.player")}</th>
                <th scope="col">{t("common.seat")}</th>
                <th scope="col">{t("players.status")}</th>
                <th scope="col" className="num">
                  {t("players.place")}
                </th>
                <th scope="col" className="actions">
                  <span className="visually-hidden">{selection ? t("players.startStack") : t("players.eliminate")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const selected = selection?.has(row.player) ?? false;
                return (
                  <tr key={row.player} className={[selected ? "is-selected" : "", row.alive ? "" : "is-dimmed"].filter(Boolean).join(" ")}>
                    {selection && (
                      <td className="check-cell">
                        {row.alive && (
                          <Checkbox
                            hideLabel
                            className="checkbox--solo"
                            label={t("players.select", { name: row.name })}
                            checked={selected}
                            onChange={(event) => toggle(row.player, event.target.checked)}
                          />
                        )}
                      </td>
                    )}
                    <th scope="row" className="player-name">
                      {row.name}
                    </th>
                    <td className="muted">{row.seat ? t("common.tableSeat", { table: row.seat.table, seat: row.seat.seat }) : t("common.none")}</td>
                    <td>{status(row)}</td>
                    <td className="num place">{formatPlace(row)}</td>
                    <td className="actions">
                      {selection && selected && (
                        <NumberInput
                          digits={10}
                          min={1}
                          className="stack-input"
                          placeholder={t("players.startStackOptional")}
                          aria-label={`${t("players.startStack")} ${row.name}`}
                          value={selection.get(row.player) ?? null}
                          onChange={(value) => setSelection(new Map(selection).set(row.player, value))}
                        />
                      )}
                      {!selection && canEliminate && row.alive && (
                        <Button size="sm" icon="userX" onClick={() => eliminate(row.player)} aria-label={`${t("players.eliminate")} ${row.name}`}>
                          {t("players.eliminate")}
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Section>

      <aside className="players-aside">
        <Section title={t("players.summary")}>
          <StatGroup>
            <Stat label={t("players.filterAlive")} value={view.counts.alive} tone="success" />
            <Stat label={t("players.filterOut")} value={view.counts.busted} />
            <Stat label={t("players.entries")} value={view.counts.entries} />
          </StatGroup>
        </Section>

        {running && eliminated.length > 0 && (
          <Section title={t("players.reviveTitle")} description={t("players.reviveHint")}>
            <Field label={t("common.player")}>
              <Select value={revivePlayer} onChange={(event) => setRevivePlayer(event.target.value === "" ? "" : Number(event.target.value))}>
                <option value="">{t("players.selectEliminated")}</option>
                {eliminated.map((row) => (
                  <option key={row.player} value={row.player}>
                    {row.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("common.seat")}>
              <Select value={reviveSeat ? seatKey(reviveSeat) : ""} onChange={(event) => setReviveSeatChoice(event.target.value)}>
                <option value="">{t("common.selectSeat")}</option>
                {availableSeats.map((seat) => (
                  <option key={seatKey(seat)} value={seatKey(seat)}>
                    {t("common.tableSeat", { table: seat.table, seat: seat.seat })}
                  </option>
                ))}
              </Select>
            </Field>
            <Button icon="userCheck" onClick={() => void handleRevive()} disabled={revivePlayer === "" || !reviveSeat}>
              {t("players.revive")}
            </Button>
          </Section>
        )}
      </aside>
    </div>
  );
}
