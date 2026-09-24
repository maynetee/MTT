import { useEffect, useRef, useState, type ReactNode } from "react";
import { toEngineError, type EngineError } from "../../engine/types";
import { useI18n } from "../../i18n";
import { Button, IconButton } from "../components/Button";
import { Section, Stat, StatGroup } from "../components/Card";
import { Callout } from "../components/Callout";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Field, RadioGroup } from "../components/Field";
import { MoneyInput, PercentInput } from "../components/MoneyInput";
import { NumberInput } from "../components/NumberInput";
import { Pill } from "../components/Pill";
import { SegmentedControl } from "../components/SegmentedControl";
import { Table } from "../components/Table";
import { useEngine } from "../EngineContext";
import { useTournament } from "../TournamentContext";
import { formatPlace } from "../utils/labels";
import { formatBps, moneyFormatter, type MoneyFormatter } from "../utils/money";
import { BPS, applyDraft, draftOf, firstShareOf, ladder, sharesOf, type PayoutDraft, type PlacesMode, type SplitMode } from "../utils/payouts";

/** Changes apply once the director pauses, so the ladder follows the controls. */
export const APPLY_DELAY_MS = 300;
const SHARE_STEP_BPS = 50;

type Confirm = "lock" | "unlock" | null;

/** Custom shares or amounts, one row per place, with a row added or removed at the end. */
function PlaceTable({
  values,
  onChange,
  input,
  total,
  disabled
}: {
  values: number[];
  onChange(values: number[]): void;
  input(value: number, onValue: (value: number) => void, label: string): ReactNode;
  total: string;
  disabled: boolean;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const set = (index: number, value: number) => onChange(values.map((current, i) => (i === index ? value : current)));
  return (
    <div className="place-table">
      <ol className="place-table-rows">
        {values.map((value, index) => {
          const label = t("payouts.placeN", { place: index + 1 });
          return (
            <li key={index} className="place-table-row">
              <span className="place-table-place">{formatPlace(i18n, { place: index + 1, placeTo: null })}</span>
              {input(value, (next) => set(index, next), label)}
            </li>
          );
        })}
      </ol>
      <div className="place-table-footer">
        <span className="place-table-actions">
          <Button size="sm" icon="plus" onClick={() => onChange([...values, values.at(-1) ?? 0])} disabled={disabled}>
            {t("payouts.addPlace")}
          </Button>
          <IconButton
            icon="minus"
            size="sm"
            label={t("payouts.removePlace")}
            onClick={() => onChange(values.slice(0, -1))}
            disabled={disabled || values.length <= 1}
          />
        </span>
        <span className="place-table-total">{total}</span>
      </div>
    </div>
  );
}

/** Pool, fees, guarantee and overlay. */
function PoolSummary({ format }: { format: MoneyFormatter }) {
  const i18n = useI18n();
  const { t } = i18n;
  const { view } = useTournament();
  const money = view.money!;
  return (
    <StatGroup className="pool-stats">
      <Stat label={t("payouts.toDistribute")} value={format(money.effectivePool, { whole: true })} tone="accent" />
      <Stat label={t("payouts.pool")} value={format(money.pool, { whole: true })} />
      {money.guarantee !== null && <Stat label={t("payouts.guarantee")} value={format(money.guarantee, { whole: true })} />}
      {money.overlay > 0 && <Stat label={t("payouts.overlay")} value={format(money.overlay, { whole: true })} tone="danger" />}
      <Stat label={t("payouts.fees")} value={format(money.fees, { whole: true })} />
      <Stat label={t("players.entries")} value={i18n.number(view.counts.entries)} />
    </StatGroup>
  );
}

/**
 * Places paid and how the prize pool is split, with the resulting ladder from the view.
 * Changes apply as the director makes them (each one can be undone from the header); the
 * payouts can be locked once the field is known.
 */
export default function PayoutsScreen() {
  const i18n = useI18n();
  const { t } = i18n;
  const engine = useEngine();
  const { id, view, run } = useTournament();
  const money = view.money;
  const format = money ? moneyFormatter(i18n.locale, money.currency) : null;
  const locked = money?.locked ?? false;
  const deal = money?.deal ?? null;
  const finished = view.phase === "finished";
  const readOnly = locked || finished;

  const [draft, setDraft] = useState<PayoutDraft>(() => draftOf(view.config));
  const [pending, setPendingState] = useState(false);
  const [error, setError] = useState<EngineError | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  // Set with the state, not at render: an effect of an earlier render can run between an edit
  // and its render, and must already see the edit.
  const pendingRef = useRef(false);
  const setPending = (value: boolean) => {
    pendingRef.current = value;
    setPendingState(value);
  };

  // Follow the saved settings (undo, another window) unless a change is on its way.
  useEffect(() => {
    if (!pendingRef.current) setDraft(draftOf(view.config));
  }, [view.config]);

  const configRef = useRef(view.config);
  configRef.current = view.config;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // A change still waiting when the director leaves the tab is applied at once.
  useEffect(
    () => () => {
      if (pendingRef.current) engine.dispatch(id, { type: "update_config", config: applyDraft(configRef.current, draftRef.current) }).catch(() => undefined);
    },
    [engine, id]
  );
  // Counts the edits: an answer only settles the draft it was sent for, not a later edit.
  const generation = useRef(0);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(async () => {
      const sent = generation.current;
      let failure: EngineError | null = null;
      try {
        await engine.dispatch(id, { type: "update_config", config: applyDraft(configRef.current, draft) });
      } catch (thrown) {
        const engineError = toEngineError(thrown);
        if (engineError.code !== "NO_CHANGE") failure = engineError;
      }
      if (generation.current !== sent) return;
      setError(failure);
      // After a rejection the draft stays pending: the next edit tries again.
      if (!failure) setPending(false);
    }, APPLY_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pending, draft, engine, id]);

  const edit = (changes: Partial<PayoutDraft>) => {
    generation.current += 1;
    setDraft((current) => ({ ...current, ...changes }));
    setPending(true);
  };

  const chooseSplit = (split: SplitMode) => {
    if (split === "custom_bps" && draft.split !== "custom_bps" && view.config.payout.amounts?.type !== "custom_bps") {
      edit({ split, bps: sharesOf(money?.payouts ?? [], money?.effectivePool ?? 0) });
    } else if (split === "custom_amounts" && draft.amounts.length === 0) {
      edit({ split, amounts: money?.payouts.length ? [...money.payouts] : [money ? 100 * 10 ** money.currency.exponent : 0] });
    } else {
      edit({ split });
    }
  };

  const lockPayouts = async () => {
    setConfirm(null);
    await run({ type: "lock_payouts" });
  };
  const unlockPayouts = async () => {
    setConfirm(null);
    await run({ type: "unlock_payouts" });
  };

  const rows = ladder(view);
  const stale = view.warnings.find((warning) => warning.code === "PAYOUTS_STALE");
  const reduced = view.warnings.find((warning) => warning.code === "PLACES_REDUCED");
  const mismatch = view.warnings.find((warning) => warning.code === "PAYOUTS_MISMATCH");
  const viewShare = firstShareOf(view);
  // The flat split is the least first place can get; before any entry, any share from 5 %.
  const shareMin = view.placesPaid > 0 ? Math.min(BPS, Math.ceil(BPS / view.placesPaid / SHARE_STEP_BPS) * SHARE_STEP_BPS) : 500;
  const share = draft.firstShareBps ?? viewShare ?? shareMin;
  const customBpsTotal = draft.bps.reduce((sum, bps) => sum + (Number.isFinite(bps) ? bps : 0), 0);
  const customAmountsTotal = draft.amounts.reduce((sum, amount) => sum + (Number.isFinite(amount) ? amount : 0), 0);
  const customTable = draft.split !== "curve";

  const placesControls = readOnly ? (
    <p className="readout-value">
      {draft.places === "percent"
        ? t("payouts.percentReadout", { percent: formatBps(draft.percentBps, i18n.locale) })
        : t("payouts.placesCount", { count: draft.fixed })}
    </p>
  ) : (
    <div className="stack">
      <SegmentedControl<PlacesMode>
        label={t("payouts.placesRule")}
        value={draft.places}
        onChange={(places) => edit({ places })}
        segments={[
          { value: "percent", label: t("payouts.percentOfEntries") },
          { value: "fixed", label: t("payouts.fixedCount") }
        ]}
      />
      {draft.places === "percent" ? (
        <Field label={t("payouts.percentField")} hint={t("payouts.percentHint")}>
          <PercentInput digits={5} value={draft.percentBps} disabled={readOnly} onChange={(value) => edit({ percentBps: value ?? Number.NaN })} />
        </Field>
      ) : (
        <Field label={t("config.placesPaid")}>
          <NumberInput digits={5} min={1} value={draft.fixed} disabled={readOnly} onChange={(value) => edit({ fixed: value ?? Number.NaN })} />
        </Field>
      )}
    </div>
  );

  return (
    <div className="payouts-layout">
      <div className="stack">
        {money && format && (
          <Section title={t("payouts.poolTitle")} description={t("payouts.poolHint")}>
            <PoolSummary format={format} />
          </Section>
        )}

        {deal && format && (
          <Callout tone="success" role="status">
            {t("payouts.dealRecorded", {
              count: deal.amounts.length,
              total: format(
                deal.amounts.reduce((sum, share) => sum + share.amount, 0),
                { whole: true }
              ),
              playFor: format(deal.playFor, { whole: true })
            })}
          </Callout>
        )}
        {stale && stale.code === "PAYOUTS_STALE" && format && (
          <Callout
            tone="warning"
            role="status"
            action={
              !deal &&
              !finished && (
                <Button variant="primary" size="sm" icon="lock" onClick={() => void run({ type: "lock_payouts" })}>
                  {t("payouts.lockAgain")}
                </Button>
              )
            }
          >
            {t("payouts.stale", { lockedPool: format(stale.params.lockedPool, { whole: true }), pool: format(stale.params.pool, { whole: true }) })}
          </Callout>
        )}
        {reduced && reduced.code === "PLACES_REDUCED" && <Callout role="status">{i18n.warning(reduced)}</Callout>}
        {mismatch && mismatch.code === "PAYOUTS_MISMATCH" && format && (
          <Callout tone="warning" role="status">
            {t("payouts.mismatch", { total: format(mismatch.params.total, { whole: true }), pool: format(mismatch.params.pool, { whole: true }) })}
          </Callout>
        )}

        <Section
          title={t("payouts.ladder")}
          description={money ? t("payouts.placesPaidCount", { count: view.placesPaid }) : t("payouts.noMoney", { count: view.placesPaid })}
          flush
          actions={
            money && (
              <>
                {locked && (
                  <Pill tone="accent" dot>
                    {t("payouts.locked")}
                  </Pill>
                )}
                {/* Nothing left to lock once the tournament is over. */}
                {!finished &&
                  (locked ? (
                    <Button icon="lock" onClick={() => setConfirm("unlock")} disabled={deal !== null} title={deal ? t("payouts.dealBlocksLock") : undefined}>
                      {t("payouts.unlock")}
                    </Button>
                  ) : (
                    <Button variant="primary" icon="lock" onClick={() => setConfirm("lock")} disabled={view.counts.unique === 0 || deal !== null}>
                      {t("payouts.lock")}
                    </Button>
                  ))}
              </>
            )
          }
        >
          {!money ? null : rows.length === 0 ? (
            <p className="muted">{t("payouts.empty")}</p>
          ) : (
            <Table caption={t("payouts.ladder")} density="compact" className="ladder-table">
              <thead>
                <tr>
                  <th scope="col" className="num place-col">
                    {t("exports.place")}
                  </th>
                  <th scope="col" className="num">
                    {t("payouts.amount")}
                  </th>
                  <th scope="col" className="num">
                    {t("payouts.share")}
                  </th>
                  <th scope="col">{t("payouts.wonBy")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.place}>
                    <th scope="row" className="num place">
                      {formatPlace(i18n, { place: row.place, placeTo: null })}
                    </th>
                    <td className="num strong">{format!(row.amount)}</td>
                    <td className="num muted">{formatBps(row.share, i18n.locale)}</td>
                    <td>
                      {row.players.length === 0 ? (
                        <span className="muted">{row.deal ? t("payouts.inDeal") : t("common.none")}</span>
                      ) : (
                        row.players.map((player) => (
                          <span key={player.player} className="ladder-player">
                            {player.name}
                            {(player.placeTo !== null || row.deal) && player.prize !== undefined && (
                              <span className="muted">
                                {" "}
                                {player.placeTo !== null
                                  ? t("payouts.tieShare", { from: player.place ?? row.place, to: player.placeTo, amount: format!(player.prize) })
                                  : t("payouts.dealShare", { amount: format!(player.prize) })}
                              </span>
                            )}
                          </span>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          {!money && <Callout>{t("payouts.trackMoney")}</Callout>}
        </Section>
      </div>

      <aside className="stack payouts-aside">
        {locked && <Callout>{t("payouts.lockedHint")}</Callout>}
        {error && (
          <Callout tone="danger" role="alert">
            {i18n.error(error)}
          </Callout>
        )}
        <Section title={t("payouts.placesTitle")} description={customTable ? t("payouts.placesFromTable") : undefined}>
          {customTable ? (
            <p className="readout-value">{t("payouts.placesCount", { count: draft.split === "custom_bps" ? draft.bps.length : draft.amounts.length })}</p>
          ) : (
            placesControls
          )}
        </Section>

        {money && format && (
          <Section title={t("payouts.splitTitle")}>
            <RadioGroup<SplitMode>
              legend={t("payouts.splitTitle")}
              hideLegend
              name="payout-split"
              value={draft.split}
              onChange={(split) => !readOnly && chooseSplit(split)}
              options={[
                {
                  value: "curve",
                  label: t("payouts.curve"),
                  disabled: readOnly,
                  nested: draft.split === "curve" && (
                    <div className="share-slider">
                      <label className="share-slider-label">
                        <span>{t("payouts.firstShare")}</span>
                        <output className="share-slider-value">
                          {formatBps(share, i18n.locale)}
                          {draft.firstShareBps === null && <span className="muted"> · {t("payouts.default")}</span>}
                        </output>
                      </label>
                      <input
                        type="range"
                        className="range"
                        aria-label={t("payouts.firstShare")}
                        min={shareMin}
                        max={BPS}
                        step={SHARE_STEP_BPS}
                        value={Math.max(shareMin, share)}
                        disabled={readOnly || shareMin >= BPS}
                        aria-valuetext={formatBps(share, i18n.locale)}
                        onChange={(event) => edit({ firstShareBps: Number(event.target.value) })}
                      />
                      {draft.firstShareBps !== null && (
                        <Button size="sm" variant="ghost" onClick={() => edit({ firstShareBps: null })} disabled={readOnly}>
                          {t("payouts.useDefault")}
                        </Button>
                      )}
                    </div>
                  )
                },
                {
                  value: "custom_bps",
                  label: t("payouts.customBps"),
                  disabled: readOnly,
                  nested: draft.split === "custom_bps" && (
                    <PlaceTable
                      values={draft.bps}
                      onChange={(bps) => edit({ bps })}
                      disabled={readOnly}
                      total={t("payouts.total", { total: formatBps(customBpsTotal, i18n.locale) })}
                      input={(value, onValue, label) => (
                        <PercentInput digits={5} aria-label={label} value={value} disabled={readOnly} onChange={(next) => onValue(next ?? Number.NaN)} />
                      )}
                    />
                  )
                },
                {
                  value: "custom_amounts",
                  label: t("payouts.customAmounts"),
                  disabled: readOnly,
                  nested: draft.split === "custom_amounts" && (
                    <PlaceTable
                      values={draft.amounts}
                      onChange={(amounts) => edit({ amounts })}
                      disabled={readOnly}
                      total={t("payouts.totalOf", { total: format(customAmountsTotal, { whole: true }), pool: format(money.effectivePool, { whole: true }) })}
                      input={(value, onValue, label) => (
                        <MoneyInput
                          digits={9}
                          currency={money.currency}
                          aria-label={label}
                          value={value}
                          disabled={readOnly}
                          onChange={(next) => onValue(next ?? Number.NaN)}
                        />
                      )}
                    />
                  )
                }
              ]}
            />
          </Section>
        )}

        {money && (
          <Section title={t("payouts.roundingTitle")}>
            <div className="form-grid form-grid--compact">
              <Field label={t("money.roundingUnit")} hint={t("money.roundingUnitHint")}>
                <MoneyInput
                  currency={money.currency}
                  value={draft.roundingUnit}
                  disabled={readOnly}
                  onChange={(value) => edit({ roundingUnit: value ?? Number.NaN })}
                />
              </Field>
              <Field label={t("money.minCash")} hint={t("money.minCashHint")}>
                <MoneyInput
                  currency={money.currency}
                  value={draft.minCash}
                  placeholder={t("money.none")}
                  disabled={readOnly}
                  onChange={(value) => edit({ minCash: value })}
                />
              </Field>
            </div>
          </Section>
        )}
      </aside>

      <ConfirmDialog
        open={confirm === "lock"}
        title={t("payouts.lockTitle")}
        message={t("payouts.lockMessage")}
        confirmLabel={t("payouts.lock")}
        onCancel={() => setConfirm(null)}
        onConfirm={lockPayouts}
      />
      <ConfirmDialog
        open={confirm === "unlock"}
        title={t("payouts.unlockTitle")}
        message={t("payouts.unlockMessage")}
        confirmLabel={t("payouts.unlock")}
        onCancel={() => setConfirm(null)}
        onConfirm={unlockPayouts}
      />
    </div>
  );
}
