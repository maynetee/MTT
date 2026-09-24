import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type MutableRefObject } from "react";
import { createPortal } from "react-dom";
import type { TableView, View } from "../../engine/types";
import { useI18n, type I18n } from "../../i18n";
import { Button } from "../components/Button";
import { Table } from "../components/Table";
import { useToast } from "../components/Toast";
import { useTournament } from "../TournamentContext";
import { seatKey, type SeatChange } from "../utils/view";
import { ButtonSeatPicker } from "./SeatingButtonPicker";

export type AnnouncementKind = "break" | "final" | "balance";

/** Seat changes the floor still has to announce, kept while the director switches tabs. */
export interface Announcement {
  kind: AnnouncementKind;
  /** The broken table, or the final table. */
  table: number | null;
  changes: SeatChange[];
  atMs: number;
}

const announcements = new Map<string, Announcement>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of [...listeners]) listener();
}

/** Replaces the list to announce for a tournament (`null` clears it). */
export function announce(id: string, announcement: Announcement | null): void {
  if (announcement && announcement.changes.length > 0) announcements.set(id, announcement);
  else announcements.delete(id);
  notify();
}

/**
 * Adds balancing moves to the balancing list being announced, or starts one. A player moved
 * twice is announced once, from the first seat to the last.
 */
export function announceBalance(id: string, changes: SeatChange[], atMs: number): void {
  if (changes.length === 0) return;
  const current = announcements.get(id);
  const merged = current?.kind === "balance" ? [...current.changes] : [];
  for (const change of changes) {
    const index = merged.findIndex((existing) => existing.player === change.player);
    if (index === -1) merged.push(change);
    else merged[index] = { ...merged[index], to: change.to };
  }
  announce(id, { kind: "balance", table: null, changes: merged, atMs });
}

export function useAnnouncement(id: string): Announcement | null {
  return useSyncExternalStore(subscribe, () => announcements.get(id) ?? null);
}

type FocusTarget = () => HTMLElement | null | undefined;

/**
 * Moves focus once the next renders show the target: after a break the button that opened the
 * dialog is gone, so focus goes to what comes next (the list to announce, the next step).
 */
export function usePendingFocus(): (target: FocusTarget) => void {
  const pending = useRef<{ target: FocusTarget; renders: number } | null>(null);
  // Asking renders again, so the target is looked for once the updates made before are on screen.
  const [, rerender] = useState(0);
  useEffect(() => {
    const current = pending.current;
    if (!current) return;
    const element = current.target();
    if (element) {
      element.focus();
      pending.current = null;
    } else if (++current.renders >= 3) {
      pending.current = null;
    }
  });
  return useCallback((target: FocusTarget) => {
    pending.current = { target, renders: 0 };
    rerender((count) => count + 1);
  }, []);
}

/** One line to announce: a player and the seat to go to (`from` is null when the seat stayed). */
export interface AnnounceRow {
  player: number;
  name: string;
  from: SeatChange["from"] | null;
  to: SeatChange["to"];
}

export interface AnnounceContent {
  kind: AnnouncementKind;
  title: string;
  meta: string;
  rows: AnnounceRow[];
  /** The final table, listed in seat order with its button and blinds once known. */
  table: TableView | null;
}

/**
 * What is left to announce in the current view: moves undone or overtaken by a later move drop
 * out; the final table is listed seat by seat. Null when nothing is left.
 */
export function announceContent(i18n: I18n, view: View, announcement: Announcement | null): AnnounceContent | null {
  if (!announcement) return null;
  const { t } = i18n;
  const seats = new Map(view.ranking.filter((row) => row.seat).map((row) => [row.player, row.seat!]));
  const live = announcement.changes.filter((change) => {
    const seat = seats.get(change.player);
    return seat !== undefined && seatKey(seat) === seatKey(change.to);
  });
  if (live.length === 0) return null;
  const time = i18n.timeOfDay(announcement.atMs);

  if (announcement.kind === "final") {
    const table = view.tables.find((candidate) => candidate.table === announcement.table && candidate.status === "open");
    if (!table) return null;
    const from = new Map(live.map((change) => [change.player, change.from]));
    const rows = table.seats
      .filter((seat) => seat.player !== null)
      .map((seat) => ({
        player: seat.player!,
        name: seat.name ?? `#${seat.player}`,
        from: from.get(seat.player!) ?? null,
        to: { table: table.table, seat: seat.seat }
      }));
    return {
      kind: "final",
      title: t("moves.announce.finalTitle", { table: table.table }),
      meta: t("moves.announce.finalMeta", { count: rows.length, time }),
      rows,
      table
    };
  }

  const rows = [...live].sort((a, b) => a.name.localeCompare(b.name, i18n.locale, { sensitivity: "base" }) || a.player - b.player);
  return {
    kind: announcement.kind,
    title: announcement.kind === "break" ? t("moves.announce.breakTitle", { table: announcement.table ?? "" }) : t("moves.announce.balanceTitle"),
    meta: t("moves.announce.movedMeta", { count: rows.length, time }),
    rows,
    table: null
  };
}

/** The list as plain text, to paste in a message or a public-address script. */
export function announceText(i18n: I18n, eventName: string, content: AnnounceContent): string {
  const { t } = i18n;
  const seat = (ref: SeatChange["to"]) => t("common.tableSeat", { table: ref.table, seat: ref.seat });
  const lines = content.rows.map((row) =>
    content.kind === "final"
      ? row.from
        ? t("moves.announce.finalLine", { seat: row.to.seat, name: row.name, from: seat(row.from) })
        : t("moves.announce.finalLineStays", { seat: row.to.seat, name: row.name })
      : t("moves.announce.moveLine", { name: row.name, from: row.from ? seat(row.from) : "", to: seat(row.to) })
  );
  return [`${eventName} — ${content.title}`, content.meta, "", ...lines].join("\n");
}

function SeatMarkers({ table, seat }: { table: TableView | null; seat: number }) {
  const { t } = useI18n();
  if (!table) return null;
  const dealer = table.button === seat;
  const blind = seat === table.nextSb ? t("seating.smallBlind") : seat === table.nextBb ? t("seating.bigBlind") : null;
  if (!dealer && !blind) return null;
  return (
    <span className="seat-markers">
      {blind && <span className="seat-blind">{blind}</span>}
      {dealer && (
        <span className="dealer-puck" title={t("seating.dealerName")}>
          {t("seating.dealer")}
        </span>
      )}
    </span>
  );
}

function AnnounceTable({ content, caption }: { content: AnnounceContent; caption: string }) {
  const { t } = useI18n();
  const seat = (ref: SeatChange["to"]) => t("common.tableSeat", { table: ref.table, seat: ref.seat });
  if (content.kind === "final") {
    return (
      <Table caption={caption} className="announce-table">
        <thead>
          <tr>
            <th scope="col" className="announce-seat-col">
              {t("common.seat")}
            </th>
            <th scope="col">{t("common.player")}</th>
            <th scope="col">{t("seating.from")}</th>
          </tr>
        </thead>
        <tbody>
          {content.rows.map((row) => (
            <tr key={row.player}>
              <td className="announce-seat">{row.to.seat}</td>
              <th scope="row" className="announce-name">
                <span className="announce-name-text">{row.name}</span>
                <SeatMarkers table={content.table} seat={row.to.seat} />
              </th>
              <td className="announce-from">{row.from ? seat(row.from) : t("moves.announce.stays")}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    );
  }
  return (
    <Table caption={caption} className="announce-table">
      <thead>
        <tr>
          <th scope="col">{t("common.player")}</th>
          <th scope="col">{t("seating.from")}</th>
          <th scope="col">{t("seating.to")}</th>
        </tr>
      </thead>
      <tbody>
        {content.rows.map((row) => (
          <tr key={row.player}>
            <th scope="row" className="announce-name">
              {row.name}
            </th>
            <td className="announce-from">{row.from ? seat(row.from) : t("common.none")}</td>
            <td className="announce-to">{seat(row.to)}</td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/**
 * The moves to announce after a table break, a final table draw or balancing: large enough to
 * read out, copyable as text, and printable on a sheet of its own (see the print stylesheet).
 */
export function useAnnounceContent(): AnnounceContent | null {
  const i18n = useI18n();
  const { id, view } = useTournament();
  return announceContent(i18n, view, useAnnouncement(id));
}

/** The final table just drawn still needs its button: the panel asks for it under its title. */
export function buttonToSet(content: AnnounceContent | null): number | null {
  return content?.kind === "final" && content.table?.button === null ? content.table.table : null;
}

export function AnnouncePanel({ headingRef }: { headingRef?: MutableRefObject<HTMLHeadingElement | null> }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { id, view } = useTournament();
  const toast = useToast();
  const titleId = useId();
  const ownHeading = useRef<HTMLHeadingElement | null>(null);
  const content = useAnnounceContent();
  if (!content) return null;

  const setHeading = (element: HTMLHeadingElement | null) => {
    ownHeading.current = element;
    if (headingRef) headingRef.current = element;
  };

  const copy = async () => {
    const text = announceText(i18n, view.config.name, content);
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(text);
      toast.success(t("moves.announce.copied"));
    } catch {
      toast.error(t("moves.announce.copyFailed"));
    }
  };

  return (
    <section className="card announce" aria-labelledby={titleId}>
      <header className="announce-header">
        <div className="announce-heading">
          <p className="announce-kicker">{t("moves.announce.kicker")}</p>
          <h2 ref={setHeading} id={titleId} className="announce-title" tabIndex={-1}>
            {content.title}
          </h2>
          <p className="announce-meta">{content.meta}</p>
        </div>
        <div className="announce-actions">
          <Button icon="copy" onClick={() => void copy()}>
            {t("moves.announce.copy")}
          </Button>
          <Button icon="printer" onClick={() => window.print()}>
            {t("moves.announce.print")}
          </Button>
          <Button variant="ghost" icon="check" onClick={() => announce(id, null)}>
            {t("moves.announce.done")}
          </Button>
        </div>
      </header>
      {buttonToSet(content) && (
        <div className="announce-button">
          <p className="announce-note">{t("moves.announce.finalButtonNote")}</p>
          {/* The picker goes away once the button is set: focus stays on the list. */}
          <ButtonSeatPicker table={content.table!} label={t("moves.buttonPickerLabel")} onSet={() => ownHeading.current?.focus()} />
        </div>
      )}
      <AnnounceTable content={content} caption={content.title} />
      {createPortal(
        <div className="print-sheet" aria-hidden="true">
          <p className="print-sheet-event">{view.config.name}</p>
          <h1 className="print-sheet-title">{content.title}</h1>
          <p className="print-sheet-meta">{content.meta}</p>
          <AnnounceTable content={content} caption={content.title} />
        </div>,
        document.body
      )}
    </section>
  );
}
