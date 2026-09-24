import { useEffect, useMemo, useRef, useState } from "react";
import type { BustInput, RankingRow, SeatRef } from "../../engine/types";
import type { PurchaseKind } from "../../bindings/PurchaseKind";
import { useI18n } from "../../i18n";
import { Button } from "../components/Button";
import { Section, Stat, StatGroup } from "../components/Card";
import { Callout } from "../components/Callout";
import { Checkbox, Field, Select, TextInput } from "../components/Field";
import { Icon } from "../components/Icon";
import { NumberInput } from "../components/NumberInput";
import { Pill } from "../components/Pill";
import { ReEnterDialog } from "../components/ReEnterDialog";
import { SegmentedControl } from "../components/SegmentedControl";
import { Table } from "../components/Table";
import { useToast } from "../components/Toast";
import { useTournament } from "../TournamentContext";
import { isMac } from "../utils/keyboard";
import { formatPlace } from "../utils/labels";
import { freeSeatsAtOpenTables, seatKey } from "../utils/view";

/** Rebuys and add-ons: bought by a player still in. */
type Buy = Exclude<PurchaseKind, "reentry">;

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
  const [reentering, setReentering] = useState<RankingRow | null>(null);

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
      .sort((a, b) => a.name.localeCompare(b.name, i18n.locale, { sensitivity: "base" }) || a.player - b.player);
    return term ? list.filter((row) => row.name.toLowerCase().includes(term)) : list;
  }, [search, filter, view.ranking, i18n.locale]);

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

  // Purchases, offered while the view says their window is open; a player at the limit gets
  // a disabled button saying so.
  const { registration, config } = view;
  const open: Record<PurchaseKind, boolean> = {
    reentry: registration.reentryOpen === true,
    rebuy: registration.rebuyOpen === true,
    addon: registration.addonOpen === true
  };
  const used = (kind: PurchaseKind, row: RankingRow) => (kind === "reentry" ? row.entries - 1 : kind === "rebuy" ? (row.rebuys ?? 0) : (row.addons ?? 0));
  const atLimit = (kind: PurchaseKind, row: RankingRow) => {
    const max = config[kind]?.max;
    return max !== undefined && used(kind, row) >= max;
  };

  /** Records the purchase, then offers to take it back like an elimination. */
  const undoToast = (message: string, seq: number | undefined) =>
    toast.show({
      message,
      tone: "success",
      action: seq === undefined ? undefined : { label: t("toast.undo"), onAction: () => void undoIfLast(seq) }
    });

  const buy = async (kind: Buy, row: RankingRow) => {
    const next = await run({ type: kind, player: row.player });
    if (!next) return;
    const purchase = t(`purchases.${kind}.action`);
    undoToast(t("purchases.bought", { purchase, name: row.name, chips: i18n.number(config[kind]?.stack ?? 0) }), next.history.undo?.seq);
  };

  const reenter = async (seat: SeatRef | undefined) => {
    if (!reentering) return;
    const next = await run({ type: "reenter", player: reentering.player, ...(seat ? { seat } : {}) });
    if (!next) return;
    const back = next.ranking.find((candidate) => candidate.player === reentering.player);
    setReentering(null);
    if (back?.seat) undoToast(t("purchases.reentered", { name: back.name, table: back.seat.table, seat: back.seat.seat }), next.history.undo?.seq);
  };

  const purchaseButton = (kind: PurchaseKind, row: RankingRow) => {
    const limited = atLimit(kind, row);
    const label = t(`purchases.${kind}.action`);
    return (
      <Button
        key={kind}
        size="sm"
        variant="ghost"
        icon={kind === "reentry" ? "userCheck" : "plus"}
        aria-label={t("purchases.actionNamed", { action: label, name: row.name })}
        title={limited ? t("purchases.limitReached") : undefined}
        disabled={limited}
        onClick={() => (kind === "reentry" ? setReentering(row) : void buy(kind, row))}
      >
        {label}
      </Button>
    );
  };

  const buys = (row: RankingRow) =>
    [
      row.entries > 1 ? t("purchases.entries", { count: row.entries }) : null,
      row.rebuys ? t("purchases.rebuys", { count: row.rebuys }) : null,
      row.addons ? t("purchases.addons", { count: row.addons }) : null
    ].filter(Boolean);

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
                  {selection ? t("players.startStack") : <span className="visually-hidden">{t("players.eliminate")}</span>}
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
                      {buys(row).length > 0 && <span className="player-buys">{buys(row).join(" · ")}</span>}
                    </th>
                    <td className="muted">{row.seat ? t("common.tableSeat", { table: row.seat.table, seat: row.seat.seat }) : t("common.none")}</td>
                    <td>{status(row)}</td>
                    <td className="num place">{formatPlace(i18n, row)}</td>
                    <td className="actions">
                      {selection && selected && (
                        <NumberInput
                          digits={10}
                          min={1}
                          className="stack-input"
                          placeholder={t("players.startStackOptional")}
                          aria-label={t("players.startStackOf", { name: row.name })}
                          value={selection.get(row.player) ?? null}
                          onChange={(value) => setSelection(new Map(selection).set(row.player, value))}
                        />
                      )}
                      {!selection && (
                        <span className="row-actions">
                          {row.alive
                            ? (["rebuy", "addon"] as const).filter((kind) => open[kind]).map((kind) => purchaseButton(kind, row))
                            : open.reentry && purchaseButton("reentry", row)}
                          {canEliminate && row.alive && (
                            <Button size="sm" icon="userX" onClick={() => eliminate(row.player)} aria-label={t("players.eliminateNamed", { name: row.name })}>
                              {t("players.eliminate")}
                            </Button>
                          )}
                        </span>
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
            <Stat label={t("players.filterAlive")} value={i18n.number(view.counts.alive)} tone="success" />
            <Stat label={t("players.filterOut")} value={i18n.number(view.counts.busted)} />
            <Stat label={t("players.entries")} value={i18n.number(view.counts.entries)} />
            {view.counts.reentries !== undefined && <Stat label={t("purchases.reentry.title")} value={i18n.number(view.counts.reentries)} />}
            {view.counts.rebuys !== undefined && <Stat label={t("purchases.rebuy.title")} value={i18n.number(view.counts.rebuys)} />}
            {view.counts.addons !== undefined && <Stat label={t("purchases.addon.title")} value={i18n.number(view.counts.addons)} />}
          </StatGroup>
          {running && (
            <div className="purchase-status">
              {(["reentry", "rebuy", "addon"] as const)
                .filter((kind) => config[kind] !== undefined)
                .map((kind) => (
                  <Pill key={kind} tone={open[kind] ? "success" : "muted"} dot={open[kind]}>
                    {t(open[kind] ? `purchases.${kind}.open` : `purchases.${kind}.closed`)}
                  </Pill>
                ))}
            </div>
          )}
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
      <ReEnterDialog view={view} row={reentering} onCancel={() => setReentering(null)} onConfirm={reenter} />
    </div>
  );
}
