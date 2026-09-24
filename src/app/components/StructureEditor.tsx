import { useI18n } from "../../i18n";
import { playNumbers, type AnteType, type LevelDraft } from "../utils/structure";

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

/** Play and break rows: blinds, ante type and amount, minutes. */
export function StructureEditor({ rows, onChange, lockedBefore = 0, currentIndex = null, invalidRows }: Props) {
  const { t } = useI18n();
  const numbers = playNumbers(rows);

  const update = (index: number, changes: Partial<LevelDraft>) =>
    onChange(rows.map((row, i) => (i === index ? { ...row, ...changes } : row)));
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));
  const numeric = (value: string) => (value === "" ? Number.NaN : Number(value));
  const shown = (value: number) => (Number.isNaN(value) ? "" : value);

  return (
    <>
      <div className="levels-header structure">
        <div>{t("structure.level")}</div>
        <div>{t("structure.minutes")}</div>
        <div>{t("structure.sb")}</div>
        <div>{t("structure.bb")}</div>
        <div>{t("structure.anteType")}</div>
        <div>{t("structure.ante")}</div>
        <div>{t("structure.isBreak")}</div>
        <div></div>
      </div>
      <div className="levels">
        {rows.map((row, index) => {
          const locked = index < lockedBefore;
          const current = index === currentIndex;
          const name = row.isBreak ? t("structure.breakRow") : t("structure.levelN", { n: numbers[index] ?? 0 });
          const label = (column: string) => `${name} ${column}`;
          const classes = ["level-row", "structure", current ? "active-level" : "", invalidRows?.has(index) ? "invalid" : ""];
          return (
            <div key={row.rowId} className={classes.filter(Boolean).join(" ")} aria-current={current ? "step" : undefined}>
              <div className={`pill ${row.isBreak ? "muted" : ""}`} title={current ? t("structure.current") : locked ? t("structure.played") : undefined}>
                {name}
              </div>
              <input
                type="number"
                min={1}
                aria-label={label(t("structure.minutes"))}
                value={shown(row.minutes)}
                onChange={(event) => update(index, { minutes: numeric(event.target.value) })}
                disabled={locked}
              />
              {row.isBreak ? (
                <>
                  <div className="pill muted">-</div>
                  <div className="pill muted">-</div>
                  <div className="pill muted">-</div>
                  <div className="pill muted">-</div>
                </>
              ) : (
                <>
                  <input
                    type="number"
                    min={1}
                    aria-label={label(t("structure.sb"))}
                    value={shown(row.sb)}
                    onChange={(event) => update(index, { sb: numeric(event.target.value) })}
                    disabled={locked}
                  />
                  <input
                    type="number"
                    min={1}
                    aria-label={label(t("structure.bb"))}
                    value={shown(row.bb)}
                    onChange={(event) => update(index, { bb: numeric(event.target.value) })}
                    disabled={locked}
                  />
                  <select
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
                  </select>
                  <input
                    type="number"
                    min={0}
                    aria-label={label(t("structure.ante"))}
                    value={row.anteType === "none" ? "" : shown(row.ante)}
                    onChange={(event) => update(index, { ante: numeric(event.target.value) })}
                    disabled={locked || row.anteType === "none"}
                  />
                </>
              )}
              <label className="toggle small">
                <input
                  type="checkbox"
                  aria-label={label(t("structure.isBreak"))}
                  checked={row.isBreak}
                  onChange={(event) => update(index, { isBreak: event.target.checked })}
                  disabled={locked || current}
                />
              </label>
              <button
                className="btn small remove-level"
                onClick={() => remove(index)}
                title={locked ? t("structure.removeLocked") : t("structure.remove")}
                aria-label={`${t("structure.remove")} ${name}`}
                disabled={locked || current}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
