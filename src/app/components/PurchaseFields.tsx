import type { Config } from "../../engine/types";
import type { Purchase } from "../../bindings/Purchase";
import type { PurchaseKind } from "../../bindings/PurchaseKind";
import type { PurchaseWindow } from "../../bindings/PurchaseWindow";
import { useI18n } from "../../i18n";
import { moneyFormatter } from "../utils/money";
import { DeadlineFields, type WindowChoice } from "./ConfigForm";
import { Checkbox, Field } from "./Field";
import { MoneyInput } from "./MoneyInput";
import { NumberInput } from "./NumberInput";

export const PURCHASE_KINDS: readonly PurchaseKind[] = ["reentry", "rebuy", "addon"];

/** The window as the radio buttons show it: no window follows registration ("manual"). */
export function windowChoice(window: PurchaseWindow | undefined): WindowChoice {
  if (!window) return { type: "manual" };
  return window.type === "break_after" ? window : window.deadline;
}

export function purchaseWindow(choice: WindowChoice): PurchaseWindow | undefined {
  if (choice.type === "manual") return undefined;
  if (choice.type === "break_after") return choice;
  return { type: "until", deadline: choice };
}

/**
 * A new purchase at the buy-in price for a starting stack. An add-on comes once, during the
 * first break (`firstBreakAfter`: the play level before it), when the structure has one.
 */
export function defaultPurchase(kind: PurchaseKind, config: Config, firstBreakAfter: number | null): Purchase {
  const price = config.money?.buyIn ?? { prize: 0, fee: 0 };
  const stack = Number.isFinite(config.startingStack) && config.startingStack > 0 ? config.startingStack : 10_000;
  if (kind === "addon") {
    return { ...price, stack, max: 1, ...(firstBreakAfter !== null ? { window: { type: "break_after", n: firstBreakAfter } } : {}) };
  }
  return { ...price, stack };
}

/** NaN while empty, so the core rejects it with a clear message. */
const number = (value: number | null) => (value === null ? Number.NaN : Math.trunc(value));

interface Props {
  config: Config;
  onChange(config: Config): void;
  /** Play level followed by the first break of the structure, for the add-on's default window. */
  firstBreakAfter: number | null;
}

function PurchaseBlock({ kind, config, onChange, firstBreakAfter }: Props & { kind: PurchaseKind }) {
  const { t, locale } = useI18n();
  const purchase = config[kind];
  const money = config.money;
  const set = (next: Purchase | undefined) => onChange({ ...config, [kind]: next });
  const edit = (changes: Partial<Purchase>) => purchase && set({ ...purchase, ...changes });
  const title = t(`purchases.${kind}.title`);
  const format = money ? moneyFormatter(locale, money.currency) : null;
  const total =
    purchase && format && Number.isFinite(purchase.prize) && Number.isFinite(purchase.fee) ? format(purchase.prize + purchase.fee, { whole: true }) : null;

  return (
    <div className="purchase-block">
      <Checkbox
        label={t(`purchases.${kind}.offer`)}
        description={t(`purchases.${kind}.hint`)}
        checked={purchase !== undefined}
        onChange={(event) => set(event.target.checked ? defaultPurchase(kind, config, firstBreakAfter) : undefined)}
      />
      {purchase && (
        <div className="purchase-body">
          <div className="form-grid form-grid--compact">
            {money && (
              <>
                <Field label={t("purchases.price")} hint={t("money.buyInHint")}>
                  <MoneyInput
                    currency={money.currency}
                    aria-label={t("common.labelled", { prefix: title, label: t("purchases.price") })}
                    value={purchase.prize}
                    onChange={(value) => edit({ prize: value === null ? Number.NaN : value })}
                  />
                </Field>
                <Field label={t("money.fee")} hint={total ? t("purchases.playerPays", { amount: total }) : t("money.feeHint")}>
                  <MoneyInput
                    currency={money.currency}
                    aria-label={t("common.labelled", { prefix: title, label: t("money.fee") })}
                    value={purchase.fee}
                    onChange={(value) => edit({ fee: value === null ? Number.NaN : value })}
                  />
                </Field>
              </>
            )}
            <Field label={t("purchases.chips")}>
              <NumberInput
                min={1}
                step={1000}
                aria-label={t("common.labelled", { prefix: title, label: t("purchases.chips") })}
                value={purchase.stack}
                onChange={(value) => edit({ stack: number(value) })}
              />
            </Field>
            <Field label={t(`purchases.${kind}.max`)} hint={t("purchases.maxHint")}>
              <NumberInput
                min={1}
                max={255}
                aria-label={t("common.labelled", { prefix: title, label: t(`purchases.${kind}.max`) })}
                placeholder={t("purchases.unlimited")}
                value={purchase.max ?? null}
                onChange={(value) => edit({ max: value === null ? undefined : number(value) })}
              />
            </Field>
          </div>
          <div className="purchase-window">
            <span className="field-label">{t("purchases.window")}</span>
            <DeadlineFields
              legend={t("common.labelled", { prefix: title, label: t("purchases.window") })}
              labelPrefix={title}
              value={windowChoice(purchase.window)}
              onChange={(choice) => edit({ window: purchaseWindow(choice) })}
              manualLabel={t("purchases.whileRegistrationOpen")}
              breakAfter
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Re-entries, rebuys and add-ons: each can be offered with its price, chips, limit and window. */
export function PurchaseFields(props: Props) {
  return (
    <div className="purchase-list">
      {PURCHASE_KINDS.map((kind) => (
        <PurchaseBlock key={kind} kind={kind} {...props} />
      ))}
    </div>
  );
}
