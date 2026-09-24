import { useRef, useState, type ReactNode } from "react";
import type { BalanceStep, View } from "../../engine/types";
import { useI18n } from "../../i18n";
import { Button } from "../components/Button";
import { Section } from "../components/Card";
import { Callout } from "../components/Callout";
import { Field, Select } from "../components/Field";
import { Pill } from "../components/Pill";
import { useTournament } from "../TournamentContext";
import { freeSeats, seatKey } from "../utils/view";
import { useTableActions } from "./MovesActions";
import { AnnouncePanel, buttonToSet, useAnnounceContent, usePendingFocus } from "./MovesAnnouncement";
import { BreakTableDialog, FinalTableDialog } from "./MovesDialogs";
import { isResolved, openTables, tableAttention, todoList, type TodoItem } from "./MovesPlan";
import { ButtonSeatPicker } from "./SeatingButtonPicker";

function Todo({
  index,
  kind,
  title,
  reason,
  action,
  children
}: {
  index: number;
  kind: string;
  title: string;
  reason?: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const current = index === 0;
  return (
    <li className={current ? "todo is-current" : "todo"} tabIndex={-1} data-todo={index}>
      <span className="todo-index" aria-hidden="true">
        {index + 1}
      </span>
      <div className="todo-body">
        <p className="todo-kind">
          <span>{kind}</span>
          {current && (
            <Pill tone="accent" className="todo-now">
              {t("moves.now")}
            </Pill>
          )}
        </p>
        <p className="todo-title">{title}</p>
        {reason && <p className="todo-reason">{reason}</p>}
        {children}
      </div>
      {action && <div className="todo-action">{action}</div>}
    </li>
  );
}

/** "Move Ann from table 1 seat 3 to table 2 seat 4", with whatever the buttons tell so far. */
function stepTitle(t: ReturnType<typeof useI18n>["t"], step: BalanceStep, name: (player: number) => string): string {
  const { fromTable, toTable, fromSeat, toSeat, player } = step;
  if (player !== null && fromSeat !== null) {
    return toSeat !== null
      ? t("moves.step", { name: name(player), fromTable, fromSeat, toTable, toSeat })
      : t("moves.stepToTable", { name: name(player), fromTable, fromSeat, toTable });
  }
  return toSeat !== null ? t("moves.stepToSeat", { fromTable, toTable, toSeat }) : t("moves.stepUnknown", { fromTable, toTable });
}

function TableCounts({ view }: { view: View }) {
  const { t } = useI18n();
  const attention = tableAttention(view);
  const seats = view.config.seatsPerTable;
  return (
    <Section title={t("moves.tables")}>
      <ul className="plain-list table-counts">
        {openTables(view).map((table) => {
          const marks = attention.get(table.table);
          const change = (marks?.incoming ?? 0) - (marks?.outgoing ?? 0);
          return (
            <li key={table.table} className="table-count">
              <span className="table-count-name">{t("seating.tableTitle", { table: table.table })}</span>
              <span className="table-count-bar" aria-hidden="true">
                <span style={{ width: `${Math.min(100, (table.players / seats) * 100)}%` }} />
              </span>
              <span className="table-count-value">{t("moves.seatsTaken", { players: table.players, seats })}</span>
              <span className="table-count-change">
                {change !== 0 && <Pill tone="accent">{change > 0 ? t("moves.incoming", { count: change }) : t("moves.outgoing", { count: -change })}</Pill>}
                {marks?.breakNext && <Pill tone="danger">{t("seating.breakNext")}</Pill>}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export default function MovesScreen() {
  const i18n = useI18n();
  const { t, list } = i18n;
  const { view, run, playerName } = useTournament();
  const actions = useTableActions();
  const [selectedPlayer, setSelectedPlayer] = useState<number | "">("");
  const [selectedSeat, setSelectedSeat] = useState("");
  const [breaking, setBreaking] = useState<number | null>(null);
  const [drawing, setDrawing] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const announceRef = useRef<HTMLHeadingElement | null>(null);
  const todoRef = useRef<HTMLOListElement | null>(null);
  const focusLater = usePendingFocus();
  const announcement = useAnnounceContent();
  const seats = freeSeats(view);
  const target = seats.find((seat) => seatKey(seat) === selectedSeat) ?? null;
  const editable = view.phase !== "finished";
  const items = todoList(view);
  const balance = items.filter((item): item is Extract<TodoItem, { kind: "balance" }> => item.kind === "balance");
  const canApplyAll = balance.length >= 2 && balance.every((item) => isResolved(item.step));
  const name = (player: number) => playerName(player) ?? `#${player}`;

  /** After an action, focus the next thing to do, else the list to announce. */
  const focusNext = () => focusLater(() => todoRef.current?.querySelector<HTMLElement>("[data-todo='0']") ?? announceRef.current);

  const handleMove = async () => {
    if (selectedPlayer === "" || !target) return;
    if (await run({ type: "move_player", player: selectedPlayer, to: target })) {
      setSelectedPlayer("");
      setSelectedSeat("");
    }
  };

  const apply = async (step: BalanceStep) => {
    setApplying(true);
    const next = await actions.applyStep(step);
    setApplying(false);
    if (next) focusNext();
  };

  const applyAll = async () => {
    setApplying(true);
    const next = await actions.applyAll();
    setApplying(false);
    if (next) focusNext();
  };

  // A button asked by an earlier step is not asked again.
  const asked = new Set<number>();
  const pickersFor = (tables: number[]) => {
    const pickers: ReactNode[] = [];
    for (const no of tables) {
      const table = view.tables.find((candidate) => candidate.table === no);
      if (!table || asked.has(no)) continue;
      asked.add(no);
      pickers.push(<ButtonSeatPicker key={no} table={table} onSet={focusNext} />);
    }
    return pickers;
  };

  const renderItem = (item: TodoItem, index: number) => {
    switch (item.kind) {
      case "finalTable":
        return (
          <Todo
            key="final"
            index={index}
            kind={t("moves.kind.finalTable")}
            title={t("moves.finalTable", { count: item.alive, table: item.table })}
            reason={t("moves.finalReason", { count: item.alive, size: item.size })}
            action={
              editable && (
                <Button variant="primary" icon="shuffle" onClick={() => setDrawing(item.table)}>
                  {t("moves.drawFinalTable")}
                </Button>
              )
            }
          />
        );
      case "breakTable":
        return (
          <Todo
            key="break"
            index={index}
            kind={t("moves.kind.breakTable")}
            title={t("moves.breakTable", { table: item.table })}
            reason={t("moves.breakReason", {
              table: item.table,
              players: t("moves.playerCount", { count: item.players }),
              alive: t("moves.playerCount", { count: item.alive }),
              count: item.remaining,
              seats: item.remaining * item.seats
            })}
            action={
              <Button variant="primary" icon="shuffle" onClick={() => setBreaking(item.table)}>
                {t("moves.breakTableAction", { table: item.table })}
              </Button>
            }
          />
        );
      case "button": {
        const table = view.tables.find((candidate) => candidate.table === item.table)!;
        // Right after the final table draw, the list to announce asks for it.
        const inPanel = buttonToSet(announcement) === item.table;
        return (
          <Todo
            key="button"
            index={index}
            kind={t("moves.kind.button")}
            title={t("moves.setButton", { table: item.table })}
            reason={inPanel ? t("moves.setButtonAbove") : t("moves.setButtonReason")}
          >
            {!inPanel && <ButtonSeatPicker table={table} label={t("moves.buttonPickerLabel")} onSet={focusNext} />}
          </Todo>
        );
      }
      case "balance": {
        const { step } = item;
        const resolved = isResolved(step);
        const first = balance[0] === item;
        return (
          <Todo
            key={`balance-${index}`}
            index={index}
            kind={t("moves.kind.balance")}
            title={stepTitle(t, step, name)}
            reason={t("moves.balanceReason", {
              fromTable: step.fromTable,
              toTable: step.toTable,
              fromPlayers: t("moves.playerCount", { count: item.fromCount }),
              toPlayers: t("moves.playerCount", { count: item.toCount }),
              trigger: item.trigger
            })}
            action={
              first &&
              resolved && (
                <Button variant="primary" icon="arrowRight" loading={applying} onClick={() => void apply(step)}>
                  {t("moves.apply")}
                </Button>
              )
            }
          >
            {step.waitsForBb && <p className="todo-note">{t("moves.waitsForBb")}</p>}
            {step.needsButton.length > 0 && (
              <>
                <p className="todo-note warning-text">{t("moves.needsButton", { count: step.needsButton.length, tables: list(step.needsButton.map(String)) })}</p>
                {pickersFor(step.needsButton)}
              </>
            )}
            {!first && resolved && <p className="todo-note">{t("moves.afterPrevious")}</p>}
          </Todo>
        );
      }
    }
  };

  return (
    <div className="stack">
      <AnnouncePanel headingRef={announceRef} />
      <div className="moves-layout">
        <Section
          title={t("moves.todo")}
          description={items.length > 0 ? t("moves.todoHint") : undefined}
          actions={
            canApplyAll && (
              <Button icon="check" loading={applying} onClick={() => void applyAll()}>
                {t("moves.applyAll", { count: balance.length })}
              </Button>
            )
          }
        >
          {items.length === 0 ? (
            <Callout tone="success">{t("moves.balanced")}</Callout>
          ) : (
            <ol ref={todoRef} className="plain-list todo-list">
              {items.map(renderItem)}
            </ol>
          )}
        </Section>

        <div className="stack">
          {openTables(view).length > 1 && <TableCounts view={view} />}
          {editable && (
            <Section title={t("moves.manual")} description={t("moves.manualHint")}>
              <Field label={t("common.player")}>
                <Select value={selectedPlayer} onChange={(event) => setSelectedPlayer(event.target.value === "" ? "" : Number(event.target.value))}>
                  <option value="">{t("common.selectPlayer")}</option>
                  {view.ranking
                    .filter((row) => row.alive)
                    .map((row) => (
                      <option key={row.player} value={row.player}>
                        {row.name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label={t("common.seat")}>
                <Select value={target ? selectedSeat : ""} onChange={(event) => setSelectedSeat(event.target.value)}>
                  <option value="">{t("common.selectSeat")}</option>
                  {seats.map((seat) => (
                    <option key={seatKey(seat)} value={seatKey(seat)}>
                      {t("common.tableSeat", { table: seat.table, seat: seat.seat })}
                    </option>
                  ))}
                </Select>
              </Field>
              <div>
                <Button variant="primary" icon="arrowRight" onClick={() => void handleMove()} disabled={selectedPlayer === "" || !target}>
                  {t("moves.move")}
                </Button>
              </div>
            </Section>
          )}
        </div>
      </div>
      <BreakTableDialog
        table={breaking}
        onCancel={() => setBreaking(null)}
        onConfirm={async (table) => {
          const next = await actions.breakTable(table);
          setBreaking(null);
          if (next) focusLater(() => announceRef.current);
        }}
      />
      <FinalTableDialog
        table={drawing}
        onCancel={() => setDrawing(null)}
        onConfirm={async (table) => {
          const next = await actions.drawFinalTable(table);
          setDrawing(null);
          if (next) focusLater(() => announceRef.current);
        }}
      />
    </div>
  );
}
