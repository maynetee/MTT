import { useRef, useState } from "react";
import type { SeatRef, View } from "../../engine/types";
import { useI18n } from "../../i18n";
import { Button, IconButton } from "../components/Button";
import { Section, Stat, StatGroup } from "../components/Card";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Checkbox, Field, TextInput } from "../components/Field";
import { Icon } from "../components/Icon";
import { NumberInput } from "../components/NumberInput";
import { Pill } from "../components/Pill";
import { Table } from "../components/Table";
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

/** Where the new player sits, large enough to read out across the desk. */
function SeatTicket({ name, seat, onDismiss }: { name: string; seat: SeatRef; onDismiss(): void }) {
  const { t } = useI18n();
  return (
    <div className="seat-ticket" role="status">
      <div className="seat-ticket-head">
        <Icon name="checkCircle" size={18} />
        <span>{t("registration.registered")}</span>
        <IconButton icon="close" size="sm" label={t("common.dismiss")} hint={false} onClick={onDismiss} className="seat-ticket-close" />
      </div>
      <p className="seat-ticket-name">{name}</p>
      <p className="visually-hidden">{t("registration.seatTicket", { table: seat.table, seat: seat.seat })}</p>
      <div className="seat-ticket-seat" aria-hidden="true">
        <span>
          <small>{t("common.table")}</small>
          <strong>{seat.table}</strong>
        </span>
        <span>
          <small>{t("common.seat")}</small>
          <strong>{seat.seat}</strong>
        </span>
      </div>
    </div>
  );
}

export default function RegistrationScreen() {
  const i18n = useI18n();
  const { t } = i18n;
  const { view, offsetMs, run } = useTournament();
  const [name, setName] = useState("");
  const [feedback, setFeedback] = useState<{ name: string; seat: SeatRef } | null>(null);
  const [forceSeat, setForceSeat] = useState(false);
  const [tableNo, setTableNo] = useState<number | null>(1);
  const [seatNo, setSeatNo] = useState<number | null>(1);
  const [confirmingClose, setConfirmingClose] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { registration, phase } = view;

  const closeRegistration = () => {
    setConfirmingClose(false);
    return run({ type: "close_registration" });
  };
  // Closing by hand is the plan with a manual deadline; otherwise it closes before its time.
  const requestClose = () => (registration.deadline.type === "manual" ? void closeRegistration() : setConfirmingClose(true));

  const handleAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = await run({
      type: "register",
      name: trimmed,
      ...(forceSeat ? { seat: { table: tableNo ?? 0, seat: seatNo ?? 0 } } : {})
    });
    if (!next) return;
    const player = newestPlayer(next);
    if (player?.seat) setFeedback({ name: player.name, seat: player.seat });
    setName("");
    inputRef.current?.focus();
  };

  const alive = view.ranking.filter((row) => row.alive);

  return (
    <div className="registration-layout">
      <div className="registration-main">
        <Section title={t("registration.title")}>
          <form
            className="register-form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleAdd();
            }}
          >
            <div className="register-row">
              <TextInput
                ref={inputRef}
                inputSize="lg"
                placeholder={t("registration.placeholder")}
                aria-label={t("registration.placeholder")}
                autoComplete="off"
                spellCheck={false}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (feedback) setFeedback(null);
                }}
                autoFocus
              />
              <Button type="submit" variant="primary" size="lg">
                {t("registration.register")}
              </Button>
            </div>
            <Checkbox label={t("registration.forceSeat")} checked={forceSeat} onChange={(event) => setForceSeat(event.target.checked)} />
            {forceSeat && (
              <div className="seat-picker">
                <Field label={t("common.table")}>
                  <NumberInput digits={3} min={1} value={tableNo} onChange={setTableNo} />
                </Field>
                <Field label={t("common.seat")}>
                  <NumberInput digits={3} min={1} max={12} value={seatNo} onChange={setSeatNo} />
                </Field>
                <p className="field-hint seat-picker-hint">{t("registration.forceSeatHint")}</p>
              </div>
            )}
          </form>
          {feedback && <SeatTicket name={feedback.name} seat={feedback.seat} onDismiss={() => setFeedback(null)} />}
        </Section>
      </div>

      <div className="registration-side">
        <Section
          title={t("registration.status")}
          actions={
            phase === "running" &&
            (registration.open ? (
              <Button onClick={requestClose}>{t("registration.close")}</Button>
            ) : (
              <Button onClick={() => void run({ type: "reopen_registration" })}>{t("registration.reopen")}</Button>
            ))
          }
        >
          <div className="registration-status">
            <Pill tone={registration.open ? "success" : "muted"} dot={registration.open}>
              {registration.open ? t("registration.open") : t("registration.closed")}
            </Pill>
            <span className="registration-deadline">
              <RegistrationDeadline view={view} offsetMs={offsetMs} />
            </span>
            {registration.overrideOpen !== null && <Pill tone="neutral">{t("registration.overridden")}</Pill>}
          </div>
          <StatGroup>
            <Stat label={t("registration.registeredCount")} value={i18n.number(view.counts.unique)} />
            <Stat label={t("registration.seatsLeft")} value={i18n.number(seatsLeft(view))} />
          </StatGroup>
        </Section>

        <Section title={t("registration.players")} flush>
          {alive.length === 0 ? (
            <p className="muted">{t("registration.empty")}</p>
          ) : (
            <Table caption={t("registration.players")} density="compact">
              <thead>
                <tr>
                  <th scope="col">{t("common.player")}</th>
                  <th scope="col" className="num">
                    {t("common.seat")}
                  </th>
                  {phase === "setup" && (
                    <th scope="col" className="actions">
                      <span className="visually-hidden">{t("registration.remove")}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {alive.map((row) => (
                  <tr key={row.player}>
                    <td className="strong">{row.name}</td>
                    <td className="num muted">{row.seat ? t("common.tableSeatShort", { table: row.seat.table, seat: row.seat.seat }) : t("common.none")}</td>
                    {phase === "setup" && (
                      <td className="actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={t("registration.removeNamed", { name: row.name })}
                          onClick={() => void run({ type: "unregister", player: row.player })}
                        >
                          {t("registration.remove")}
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>
      </div>
      <ConfirmDialog
        open={confirmingClose}
        title={t("registration.closeTitle")}
        message={t("registration.closeMessage")}
        confirmLabel={t("registration.close")}
        onCancel={() => setConfirmingClose(false)}
        onConfirm={closeRegistration}
      />
    </div>
  );
}
