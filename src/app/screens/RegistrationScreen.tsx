import { useRef, useState } from "react";
import type { SeatRef, View } from "../../engine/types";
import { useI18n } from "../../i18n";
import { useClock } from "../hooks/useClock";
import { useTournament } from "../TournamentContext";
import { seatsLeft } from "../utils/view";

/** The player registered last: ids are allocated in order and never reused. */
function newestPlayer(view: View) {
  return view.ranking.reduce<View["ranking"][number] | null>((newest, row) => (!newest || row.player > newest.player ? row : newest), null);
}

/** When registration closes; its own component so the countdown does not re-render the page. */
function RegistrationDeadline({ view, offsetMs }: { view: View; offsetMs: number }) {
  return <>{useDeadlineText(view, offsetMs)}</>;
}

function useDeadlineText(view: View, offsetMs: number): string {
  const i18n = useI18n();
  const { t } = i18n;
  const clock = useClock(view, offsetMs);
  const { registration } = view;
  if (registration.closesAtMs !== null) {
    const hostNow = view.generatedAtMs + clock.elapsedMs;
    return t("registration.closesAt", {
      time: i18n.timeOfDay(registration.closesAtMs - offsetMs),
      duration: i18n.duration(registration.closesAtMs - hostNow)
    });
  }
  if (view.phase === "running" && registration.open && registration.closesInMs !== null) {
    return t("registration.closesIn", { duration: i18n.duration(registration.closesInMs) });
  }
  const deadline = registration.deadline;
  switch (deadline.type) {
    case "end_of_play_level":
      return t(deadline.throughBreak ? "registration.deadlineLevelBreak" : "registration.deadlineLevel", { n: deadline.n });
    case "elapsed":
      return t("registration.deadlineElapsed", { duration: i18n.durationWords(deadline.ms) });
    case "manual":
      return t("registration.deadlineManual");
  }
}

export default function RegistrationScreen() {
  const { t } = useI18n();
  const { view, offsetMs, run } = useTournament();
  const [name, setName] = useState("");
  const [feedback, setFeedback] = useState<{ name: string; seat: SeatRef } | null>(null);
  const [forceSeat, setForceSeat] = useState(false);
  const [tableNo, setTableNo] = useState(1);
  const [seatNo, setSeatNo] = useState(1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { registration, phase } = view;

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = await run({
      type: "register",
      name: trimmed,
      ...(forceSeat ? { seat: { table: tableNo, seat: seatNo } } : {})
    });
    if (!next) return;
    const player = newestPlayer(next);
    if (player?.seat) setFeedback({ name: player.name, seat: player.seat });
    setName("");
    inputRef.current?.focus();
  };

  const alive = view.ranking.filter((row) => row.alive);

  return (
    <div className="grid-2">
      <div className="card">
        <h2>{t("registration.title")}</h2>

        {feedback && (
          <div className="feedback-box" role="status">
            <div className="feedback-title">{t("registration.registered")}</div>
            <div className="feedback-player">{feedback.name}</div>
            <div className="feedback-seat">{t("registration.seatFeedback", { table: feedback.seat.table, seat: feedback.seat.seat })}</div>
            <button className="btn small" onClick={() => setFeedback(null)}>
              {t("common.dismiss")}
            </button>
          </div>
        )}

        <input
          ref={inputRef}
          placeholder={t("registration.placeholder")}
          aria-label={t("registration.placeholder")}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            if (feedback) setFeedback(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleAdd();
            }
          }}
          autoFocus
        />
        <div className="card">
          <div className="card-header">
            <h3>{t("registration.forceSeat")}</h3>
            <label className="toggle">
              <input type="checkbox" checked={forceSeat} onChange={(event) => setForceSeat(event.target.checked)} />
              {t("registration.enabled")}
            </label>
          </div>
          <div className="grid-2">
            <label>
              {t("common.table")}
              <input
                type="number"
                min={1}
                value={tableNo}
                onChange={(event) => setTableNo(Number(event.target.value))}
                disabled={!forceSeat}
              />
            </label>
            <label>
              {t("common.seat")}
              <input type="number" min={1} value={seatNo} onChange={(event) => setSeatNo(Number(event.target.value))} disabled={!forceSeat} />
            </label>
          </div>
          <div className="muted">{t("registration.forceSeatHint")}</div>
        </div>
        <button className="btn primary" onClick={() => void handleAdd()}>
          {t("registration.register")}
        </button>
      </div>

      <div className="card">
        <h3>{t("registration.capacity")}</h3>
        <div className="stats-grid">
          <div>
            <div className="stat-value">{view.counts.unique}</div>
            <div className="stat-label">{t("registration.registeredCount")}</div>
          </div>
          <div>
            <div className="stat-value">{seatsLeft(view)}</div>
            <div className="stat-label">{t("registration.seatsLeft")}</div>
          </div>
          <div>
            <div className={`pill ${registration.open ? "" : "muted"}`}>
              {registration.open ? t("registration.open") : t("registration.closed")}
            </div>
          </div>
        </div>
        <div className="muted">
          <RegistrationDeadline view={view} offsetMs={offsetMs} />
          {registration.overrideOpen !== null && ` · ${t("registration.overridden")}`}
        </div>
        {phase === "running" && (
          <div className="button-row">
            {registration.open ? (
              <button className="btn" onClick={() => void run({ type: "close_registration" })}>
                {t("registration.close")}
              </button>
            ) : (
              <button className="btn" onClick={() => void run({ type: "reopen_registration" })}>
                {t("registration.reopen")}
              </button>
            )}
          </div>
        )}
        <h4>{t("registration.players")}</h4>
        <div className="list">
          {alive.map((row) => (
            <div key={row.player} className="list-row">
              <span>{row.name}</span>
              <span className="button-row">
                {row.seat && <span className="muted">{t("common.tableSeatShort", { table: row.seat.table, seat: row.seat.seat })}</span>}
                {phase === "setup" && (
                  <button className="btn small" onClick={() => void run({ type: "unregister", player: row.player })}>
                    {t("registration.remove")}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
