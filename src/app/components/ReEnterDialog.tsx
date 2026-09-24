import { useEffect, useState } from "react";
import type { RankingRow, SeatRef, View } from "../../engine/types";
import { useI18n } from "../../i18n";
import { moneyFormatter } from "../utils/money";
import { freeSeats, seatKey } from "../utils/view";
import { Button } from "./Button";
import { Field, RadioGroup, Select } from "./Field";
import { Modal } from "./Modal";

type SeatMode = "draw" | "choose";

/**
 * Re-entry of an eliminated player: the price and chips of the new entry, then a seat drawn
 * like a registration or chosen by the director (an idle table opens).
 */
export function ReEnterDialog({
  view,
  row,
  onCancel,
  onConfirm
}: {
  view: View;
  /** The player re-entering; the dialog is closed without one. */
  row: RankingRow | null;
  onCancel(): void;
  onConfirm(seat: SeatRef | undefined): Promise<unknown>;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const [mode, setMode] = useState<SeatMode>("draw");
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const seats = freeSeats(view);
  const seat = seats.find((candidate) => seatKey(candidate) === choice) ?? seats[0] ?? null;

  useEffect(() => {
    if (row) {
      setMode("draw");
      setChoice("");
      setBusy(false);
    }
  }, [row]);

  const purchase = view.config.reentry;
  const money = view.money;
  const entry = (row?.entries ?? 0) + 1;
  const chips = i18n.number(purchase?.stack ?? 0);
  const summary =
    money && purchase
      ? t("purchases.reenterEntryPrice", { entry, chips, price: moneyFormatter(i18n.locale, money.currency)(purchase.prize + purchase.fee, { whole: true }) })
      : t("purchases.reenterEntry", { entry, chips });

  const confirm = async () => {
    if (busy || (mode === "choose" && !seat)) return;
    setBusy(true);
    try {
      await onConfirm(mode === "choose" && seat ? seat : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={row !== null}
      onClose={onCancel}
      title={t("purchases.reenterTitle", { name: row?.name ?? "" })}
      description={summary}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" icon="userCheck" onClick={() => void confirm()} loading={busy} disabled={mode === "choose" && !seat}>
            {t("purchases.reentry.action")}
          </Button>
        </>
      }
    >
      <RadioGroup<SeatMode>
        legend={t("common.seat")}
        hideLegend
        name="reentry-seat"
        value={mode}
        onChange={setMode}
        options={[
          { value: "draw", label: t("purchases.drawSeat"), nested: <p className="field-hint">{t("purchases.drawSeatHint")}</p> },
          {
            value: "choose",
            label: t("purchases.chooseSeat"),
            nested: mode === "choose" && (
              <Field label={t("common.seat")}>
                <Select value={seat ? seatKey(seat) : ""} onChange={(event) => setChoice(event.target.value)}>
                  {seats.length === 0 && <option value="">{t("common.selectSeat")}</option>}
                  {seats.map((candidate) => (
                    <option key={seatKey(candidate)} value={seatKey(candidate)}>
                      {t("common.tableSeat", { table: candidate.table, seat: candidate.seat })}
                    </option>
                  ))}
                </Select>
              </Field>
            )
          }
        ]}
      />
    </Modal>
  );
}
