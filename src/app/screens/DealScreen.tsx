import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toEngineError, type DealQuote, type DealRequest, type EngineError } from "../../engine/types";
import { useI18n } from "../../i18n";
import { Button } from "../components/Button";
import { Section } from "../components/Card";
import { Callout } from "../components/Callout";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { Field } from "../components/Field";
import { Icon } from "../components/Icon";
import { MoneyInput } from "../components/MoneyInput";
import { NumberInput } from "../components/NumberInput";
import { SegmentedControl } from "../components/SegmentedControl";
import { Table } from "../components/Table";
import { useEngine } from "../EngineContext";
import { useTournament } from "../TournamentContext";
import { moneyFormatter, type MoneyFormatter } from "../utils/money";
import { MAX_DEAL_PLAYERS, dealAvailable } from "../utils/payouts";

/** The quote follows the chip counts once the director pauses typing. */
const QUOTE_DELAY_MS = 200;

type DealKind = "icm" | "chipChop";

/** `+€12.50`, `−€3.00`, or `€0.00`. */
function signed(format: MoneyFormatter, amount: number): string {
  if (amount === 0) return format(0);
  return `${amount > 0 ? "+" : "−"}${format(Math.abs(amount))}`;
}

/** The deal as recorded: what each player takes and what is left to play for. */
function RecordedDeal({ format }: { format: MoneyFormatter }) {
  const { t } = useI18n();
  const { view, playerName } = useTournament();
  const deal = view.money!.deal!;
  const total = deal.amounts.reduce((sum, share) => sum + share.amount, 0);
  return (
    <Section title={t("deal.recordedTitle")} description={t("deal.recordedHint")} flush>
      <Table caption={t("deal.recordedTitle")} density="compact">
        <thead>
          <tr>
            <th scope="col">{t("common.player")}</th>
            <th scope="col" className="num">
              {t("deal.agreed")}
            </th>
          </tr>
        </thead>
        <tbody>
          {deal.amounts.map((share) => (
            <tr key={share.player}>
              <th scope="row" className="strong">
                {playerName(share.player) ?? `#${share.player}`}
              </th>
              <td className="num">{format(share.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{t("deal.playFor")}</th>
            <td className="num">{format(deal.playFor)}</td>
          </tr>
          <tr>
            <th scope="row">{t("deal.total")}</th>
            <td className="num strong">{format(total + deal.playFor)}</td>
          </tr>
        </tfoot>
      </Table>
    </Section>
  );
}

/** One prerequisite of a deal: done, or a button that does it. */
function Step({ done, label, action }: { done: boolean; label: string; action?: ReactNode }) {
  return (
    <li className={done ? "deal-step is-done" : "deal-step"}>
      <Icon name={done ? "checkCircle" : "info"} size={18} className="deal-step-icon" />
      <span className="deal-step-label">{label}</span>
      {!done && action}
    </li>
  );
}

/**
 * The ICM deal calculator: chip counts of the players left, an optional amount kept to play
 * for, then the ICM and chip-chop shares side by side. Recording a deal needs registration
 * closed and the payouts locked; the screen walks the director through both.
 */
export default function DealScreen() {
  const i18n = useI18n();
  const { t } = i18n;
  const engine = useEngine();
  const { view, run } = useTournament();
  const money = view.money;
  const format = useMemo(() => (money ? moneyFormatter(i18n.locale, money.currency) : null), [money, i18n.locale]);
  // Around the table, as chip counts are read out.
  const alive = useMemo(
    () =>
      view.ranking
        .filter((row) => row.alive)
        .sort((a, b) => (a.seat?.table ?? 0) - (b.seat?.table ?? 0) || (a.seat?.seat ?? 0) - (b.seat?.seat ?? 0) || a.player - b.player),
    [view.ranking]
  );
  const [stacks, setStacks] = useState<Map<number, number | null>>(() => new Map());
  const [playFor, setPlayFor] = useState<number | null>(null);
  // The last quote, with the request it answers and the players in its order: amounts are
  // shown by player, and only a quote of the current request is recorded.
  const [quoted, setQuoted] = useState<{ request: DealRequest; players: number[]; quote: DealQuote } | null>(null);
  const [error, setError] = useState<EngineError | null>(null);
  const [kind, setKind] = useState<DealKind>("icm");
  const [confirming, setConfirming] = useState(false);

  // What the remaining places pay, first place first: the prizes a deal shares.
  const prizes = money ? money.payouts.slice(0, alive.length) : [];
  const prizeTotal = prizes.reduce((sum, prize) => sum + prize, 0);
  const counts = alive.map((row) => stacks.get(row.player) ?? null);
  const complete = counts.every((count) => count !== null && Number.isFinite(count));
  // Every refresh brings new view objects: the request only changes with what it holds, so a
  // quote stays recordable while nothing it depends on moved.
  const players = alive.map((row) => row.player).join(",");
  const prizesKey = prizes.join(",");
  const request = useMemo((): DealRequest | null => {
    const chips = alive.map((row) => stacks.get(row.player) ?? Number.NaN);
    if (alive.length > MAX_DEAL_PLAYERS || !chips.every(Number.isFinite)) return null;
    return { stacks: chips.map(Math.trunc), prizes, ...(playFor ? { playFor } : {}) };
    // `alive` and `prizes` are described by `players` and `prizesKey`.
  }, [players, prizesKey, stacks, playFor]);

  useEffect(() => {
    if (!request) {
      setQuoted(null);
      setError(null);
      return;
    }
    let current = true;
    // The request changes whenever the players do: these are its players, in its order.
    const ids = alive.map((row) => row.player);
    const timer = setTimeout(async () => {
      try {
        const next = await engine.quoteDeal(request);
        if (current) {
          setQuoted({ request, players: ids, quote: next });
          setError(null);
        }
      } catch (thrown) {
        if (current) {
          setQuoted(null);
          setError(toEngineError(thrown));
        }
      }
    }, QUOTE_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [engine, request]);

  if (!money || !format) {
    return <EmptyState icon="info" title={t("deal.noMoney")} />;
  }
  if (money.deal) {
    return (
      <div className="deal-layout">
        <RecordedDeal format={format} />
      </div>
    );
  }
  if (!dealAvailable(view)) {
    return <EmptyState icon="info" title={t("deal.unavailable", { max: MAX_DEAL_PLAYERS })} />;
  }

  const registrationClosed = !view.registration.open;
  const stale = view.warnings.some((warning) => warning.code === "PAYOUTS_STALE");
  const ready = registrationClosed && money.locked && !stale;
  const quote = quoted?.quote ?? null;
  const fresh = quoted !== null && quoted.request === request;
  /** The quoted amounts of a player, or null when the quote predates them. */
  const shares = (player: number) => {
    const index = quoted ? quoted.players.indexOf(player) : -1;
    return quoted && index >= 0 ? { icm: quoted.quote.icm[index], chipChop: quoted.quote.chipChop[index] } : null;
  };
  const amountOf = (player: number) => {
    const share = shares(player);
    return share && (kind === "icm" ? share.icm : share.chipChop);
  };
  const chipsEntered = counts.reduce<number>((sum, count) => sum + (count !== null && Number.isFinite(count) ? count : 0), 0);

  const record = async () => {
    if (!fresh || !quote) return;
    const next = await run({
      type: "record_deal",
      amounts: alive.map((row) => ({ player: row.player, amount: amountOf(row.player) ?? 0 })),
      ...(quote.playFor > 0 ? { playFor: quote.playFor } : {})
    });
    setConfirming(false);
    return next;
  };

  return (
    <div className="deal-layout">
      <div className="stack">
        <Section title={t("deal.calculator")} description={t("deal.calculatorHint", { total: format(prizeTotal), count: alive.length })} flush>
          <Table caption={t("deal.calculator")} density="compact" className="deal-table">
            <thead>
              <tr>
                <th scope="col">{t("common.player")}</th>
                <th scope="col" className="num">
                  {t("deal.chips")}
                </th>
                <th scope="col" className="num">
                  {t("deal.icm")}
                </th>
                <th scope="col" className="num">
                  {t("deal.chipChop")}
                </th>
                <th scope="col" className="num">
                  {t("deal.difference")}
                </th>
              </tr>
            </thead>
            <tbody>
              {alive.map((row) => {
                const share = shares(row.player);
                return (
                  <tr key={row.player}>
                    <th scope="row" className="strong">
                      {row.name}
                    </th>
                    <td className="num">
                      <NumberInput
                        digits={9}
                        min={0}
                        step={1000}
                        className="deal-chips"
                        aria-label={t("deal.chipsOf", { name: row.name })}
                        value={stacks.get(row.player) ?? null}
                        onChange={(value) => setStacks(new Map(stacks).set(row.player, value))}
                      />
                    </td>
                    <td className="num strong">{share ? format(share.icm) : t("common.none")}</td>
                    <td className="num">{share ? format(share.chipChop) : t("common.none")}</td>
                    <td className="num muted">{share ? signed(format, share.icm - share.chipChop) : t("common.none")}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">{t("deal.total")}</th>
                <td className="num muted">{t("deal.chipsInPlay", { entered: i18n.number(chipsEntered), inPlay: i18n.number(view.chips.inPlay) })}</td>
                <td className="num">{quote ? format(quote.icm.reduce((sum, amount) => sum + amount, 0)) : ""}</td>
                <td className="num">{quote ? format(quote.chipChop.reduce((sum, amount) => sum + amount, 0)) : ""}</td>
                <td />
              </tr>
            </tfoot>
          </Table>
          <div className="deal-options">
            <Field label={t("deal.playFor")} hint={t("deal.playForHint")}>
              <MoneyInput digits={9} currency={money.currency} value={playFor} placeholder={t("money.none")} onChange={setPlayFor} />
            </Field>
          </div>
          {error && (
            <Callout tone="danger" role="alert">
              {i18n.error(error)}
            </Callout>
          )}
          {!complete && <Callout>{t("deal.enterChips")}</Callout>}
        </Section>
      </div>

      <aside className="stack">
        <Section title={t("deal.prerequisites")} description={t("deal.prerequisitesHint")}>
          <ol className="deal-steps">
            <Step
              done={registrationClosed}
              label={registrationClosed ? t("deal.registrationClosed") : t("deal.registrationOpen")}
              action={
                <Button size="sm" onClick={() => void run({ type: "close_registration" })}>
                  {t("registration.close")}
                </Button>
              }
            />
            <Step
              done={money.locked && !stale}
              label={stale ? t("deal.payoutsStale") : money.locked ? t("deal.payoutsLocked") : t("deal.payoutsUnlocked")}
              action={
                <Button size="sm" icon="lock" onClick={() => void run({ type: "lock_payouts" })}>
                  {stale ? t("payouts.lockAgain") : t("payouts.lock")}
                </Button>
              }
            />
          </ol>
        </Section>

        <Section title={t("deal.record")}>
          <div className="stack">
            <SegmentedControl<DealKind>
              label={t("deal.kind")}
              value={kind}
              onChange={setKind}
              segments={[
                { value: "icm", label: t("deal.icm") },
                { value: "chipChop", label: t("deal.chipChop") }
              ]}
            />
            <Button variant="primary" icon="check" onClick={() => setConfirming(true)} disabled={!ready || !fresh}>
              {t("deal.recordAction")}
            </Button>
            {!ready && (
              <p className="field-hint">
                {!registrationClosed && !(money.locked && !stale) ? t("deal.notReady") : registrationClosed ? t("deal.notLocked") : t("deal.notClosed")}
              </p>
            )}
          </div>
        </Section>
      </aside>

      <ConfirmDialog
        open={confirming && fresh}
        title={t(kind === "icm" ? "deal.confirmIcm" : "deal.confirmChipChop")}
        message={
          quote && (
            <>
              <ul className="deal-confirm-list">
                {alive.map((row) => (
                  <li key={row.player}>
                    <span>{row.name}</span>
                    <strong>{format(amountOf(row.player) ?? 0)}</strong>
                  </li>
                ))}
              </ul>
              <p>{quote.playFor > 0 ? t("deal.confirmPlayFor", { amount: format(quote.playFor) }) : t("deal.confirmNoPlayFor")}</p>
            </>
          )
        }
        confirmLabel={t("deal.recordAction")}
        onCancel={() => setConfirming(false)}
        onConfirm={record}
      />
    </div>
  );
}
