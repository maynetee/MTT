import { useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { Button, ButtonLink } from "../components/Button";
import { Section } from "../components/Card";
import { Callout } from "../components/Callout";
import { EmptyState } from "../components/EmptyState";
import { Pill } from "../components/Pill";
import { useTournament } from "../TournamentContext";
import { useTableActions } from "./MovesActions";
import { AnnouncePanel, buttonToSet, useAnnounceContent, usePendingFocus } from "./MovesAnnouncement";
import { BreakTableDialog } from "./MovesDialogs";
import { openTables, tableAttention, todoList, type TodoItem } from "./MovesPlan";
import { TableCard } from "./SeatingTableCard";

/** The first thing to do, in one line, with a way to the Moves screen. */
function useTodoSummary(items: TodoItem[]): string | null {
  const { t } = useI18n();
  const [first] = items;
  if (!first) return null;
  switch (first.kind) {
    case "finalTable":
      return t("moves.finalTable", { count: first.alive, table: first.table });
    case "breakTable":
      return t("seating.breakSuggested", { table: first.table });
    case "button":
      return t("moves.setButton", { table: first.table });
    case "balance":
      return t("seating.balanceNeeded", { count: items.length });
  }
}

export default function SeatingScreen() {
  const { t } = useI18n();
  const { view } = useTournament();
  const actions = useTableActions();
  const [breaking, setBreaking] = useState<number | null>(null);
  const announceRef = useRef<HTMLHeadingElement | null>(null);
  const focusLater = usePendingFocus();
  const open = openTables(view);
  const others = view.tables.filter((table) => table.status !== "open");
  const idle = others.filter((table) => table.status === "idle");
  const closed = others.filter((table) => table.status === "closed");
  const attention = tableAttention(view);
  // Right after the final table draw, the list to announce asks for the button itself.
  const panelButton = buttonToSet(useAnnounceContent());
  const items = todoList(view).filter((item) => !(item.kind === "button" && item.table === panelButton));
  const summary = useTodoSummary(items);
  const editable = view.phase !== "finished";
  // A table never used comes before one that was broken.
  const nextToOpen = idle[0] ?? closed[0] ?? null;

  return (
    <div className="stack">
      <AnnouncePanel headingRef={announceRef} />
      {(summary || (editable && nextToOpen)) && (
        <div className="seating-toolbar">
          {summary && (
            <Callout
              tone="warning"
              className="seating-todo"
              action={
                <ButtonLink size="sm" to="../moves" relative="path" icon="arrowRight">
                  {t("seating.goToMoves")}
                </ButtonLink>
              }
            >
              {summary}
            </Callout>
          )}
          {editable && nextToOpen && (
            <Button icon="plus" className="seating-open" onClick={() => void actions.openTable(nextToOpen.table)}>
              {t("seating.openTableN", { table: nextToOpen.table })}
            </Button>
          )}
        </div>
      )}
      {open.length === 0 ? (
        <div className="card">
          <EmptyState icon="info" title={t("seating.noTable")} />
        </div>
      ) : (
        <div className="table-grid">
          {open.map((table) => (
            <TableCard key={table.table} table={table} attention={attention.get(table.table)} canBreak={open.length > 1} onBreak={setBreaking} />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <Section title={t("seating.otherTables")}>
          <ul className="plain-list">
            {closed.map((table) => (
              <li key={table.table} className="list-row">
                <span className="strong">{t("seating.tableTitle", { table: table.table })}</span>
                <Pill tone="muted">{t("seating.closed")}</Pill>
                {editable && (
                  <Button size="sm" className="list-row-action" onClick={() => void actions.openTable(table.table)}>
                    {t("seating.reopenTable")}
                  </Button>
                )}
              </li>
            ))}
            {idle.length > 0 && (
              <li className="list-row">
                <span className="strong">
                  {idle.length === 1 ? t("seating.tableTitle", { table: idle[0].table }) : t("seating.idleTables", { count: idle.length })}
                </span>
                <Pill tone="muted">{t("seating.idle")}</Pill>
              </li>
            )}
          </ul>
        </Section>
      )}
      <BreakTableDialog
        table={breaking}
        onCancel={() => setBreaking(null)}
        onConfirm={async (table) => {
          const next = await actions.breakTable(table);
          setBreaking(null);
          if (next) focusLater(() => announceRef.current);
        }}
      />
    </div>
  );
}
