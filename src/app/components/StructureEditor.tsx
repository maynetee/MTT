import { useI18n } from "../../i18n";
import { playNumbers, type AnteType, type LevelDraft } from "../utils/structure";
import { IconButton } from "./Button";
import { Checkbox, Select } from "./Field";
import { Icon } from "./Icon";
import { NumberInput } from "./NumberInput";
import { Pill } from "./Pill";

const ANTE_TYPES: AnteType[] = ["none", "classic", "big_blind"];

interface Props {
  rows: LevelDraft[];
  onChange(rows: LevelDraft[]): void;
  /** Rows before this index are read-only (levels already played). */
  lockedBefore?: number;
  /** Row of the level in progress, highlighted and not removable. */
  currentIndex?: number | null;
  /** Rows the core rejected or warned about. */
  invalidRows?: ReadonlySet<number>;
}

/** Play and break rows as a table: minutes, blinds, ante type and amount. */
export function StructureEditor({ rows, onChange, lockedBefore = 0, currentIndex = null, invalidRows }: Props) {
  const { t } = useI18n();
  const numbers = playNumbers(rows);

  const update = (index: number, changes: Partial<LevelDraft>) => onChange(rows.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));
  /** Drafts keep NaN for an empty field, so the core rejects it with a message. */
  const numeric = (value: number | null) => (value === null ? Number.NaN : value);

  return (
    <div className="table-wrap">
      <table className="table table--compact structure-table">
        <caption className="visually-hidden">{t("structure.title")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("structure.level")}</th>
            <th scope="col" className="num">
              {t("structure.minutes")}
            </th>
            <th scope="col" className="num">
              {t("structure.sb")}
            </th>
            <th scope="col" className="num">
              {t("structure.bb")}
            </th>
            <th scope="col">{t("structure.anteType")}</th>
            <th scope="col" className="num">
              {t("structure.ante")}
            </th>
            <th scope="col" className="center">
              {t("structure.isBreak")}
            </th>
            <th scope="col" className="actions">
              <span className="visually-hidden">{t("structure.remove")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const locked = index < lockedBefore;
            const current = index === currentIndex;
            const name = row.isBreak ? t("structure.breakRow") : t("structure.levelN", { n: numbers[index] ?? 0 });
            const label = (column: string) => t("structure.cellLabel", { row: name, column });
            const classes = [
              "level-row",
              row.isBreak ? "is-break" : "",
              current ? "is-current" : "",
              locked && !current ? "is-played" : "",
              invalidRows?.has(index) ? "invalid" : ""
            ];
            return (
              <tr key={row.rowId} className={classes.filter(Boolean).join(" ")} aria-current={current ? "step" : undefined}>
                <th scope="row" className="level-name">
                  <span className="level-name-text">
                    {row.isBreak && <Icon name="coffee" size={16} />}
                    {name}
                  </span>
                  {current ? (
                    <Pill tone="accent" className="level-tag">
                      {t("structure.current")}
                    </Pill>
                  ) : (
                    locked && <span className="level-tag level-tag--played">{t("structure.played")}</span>
                  )}
                </th>
                <td className="num">
                  <NumberInput
                    allowDecimal
                    min={1}
                    digits={4}
                    aria-label={label(t("structure.minutes"))}
                    value={row.minutes}
                    onChange={(value) => update(index, { minutes: numeric(value) })}
                    disabled={locked}
                  />
                </td>
                {row.isBreak ? (
                  <td colSpan={4} className="break-cell" />
                ) : (
                  <>
                    <td className="num">
                      <NumberInput
                        min={1}
                        digits={7}
                        aria-label={label(t("structure.sb"))}
                        value={row.sb}
                        onChange={(value) => update(index, { sb: numeric(value) })}
                        disabled={locked}
                      />
                    </td>
                    <td className="num">
                      <NumberInput
                        min={1}
                        digits={7}
                        aria-label={label(t("structure.bb"))}
                        value={row.bb}
                        onChange={(value) => update(index, { bb: numeric(value) })}
                        disabled={locked}
                      />
                    </td>
                    <td>
                      <Select
                        className="ante-select"
                        aria-label={label(t("structure.anteType"))}
                        value={row.anteType}
                        onChange={(event) => {
                          const anteType = event.target.value as AnteType;
                          // A big blind ante usually equals the big blind.
                          const ante = anteType === "big_blind" && !row.ante ? row.bb : row.ante;
                          update(index, { anteType, ante });
                        }}
                        disabled={locked}
                      >
                        {ANTE_TYPES.map((type) => (
                          <option key={type} value={type}>
                            {t(`structure.ante_${type}`)}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="num">
                      <NumberInput
                        min={0}
                        digits={7}
                        aria-label={label(t("structure.ante"))}
                        value={row.anteType === "none" ? null : row.ante}
                        onChange={(value) => update(index, { ante: numeric(value) })}
                        disabled={locked || row.anteType === "none"}
                      />
                    </td>
                  </>
                )}
                <td className="center">
                  <Checkbox
                    hideLabel
                    className="checkbox--solo"
                    label={label(t("structure.isBreak"))}
                    checked={row.isBreak}
                    onChange={(event) => update(index, { isBreak: event.target.checked })}
                    disabled={locked || current}
                  />
                </td>
                <td className="actions">
                  <IconButton
                    icon="trash"
                    size="sm"
                    label={t("structure.removeRow", { row: name })}
                    hint={locked ? t("structure.removeLocked") : undefined}
                    tooltipAlign="end"
                    onClick={() => remove(index)}
                    disabled={locked || current}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
