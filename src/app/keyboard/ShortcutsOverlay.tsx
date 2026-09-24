import { useId } from "react";
import { useI18n } from "../../i18n";
import { Modal } from "../components/Modal";
import { ShortcutKeys } from "./ShortcutKeys";
import { SHORTCUT_GROUPS, SHORTCUTS, type ShortcutGroup } from "./shortcuts";

function Group({ group, tabs }: { group: ShortcutGroup; tabs: readonly string[] }) {
  const { t } = useI18n();
  const titleId = useId();
  return (
    <section className="shortcut-group" aria-labelledby={titleId}>
      <h3 id={titleId} className="shortcut-group-title">
        {t(`shortcuts.groups.${group}`)}
      </h3>
      <dl className="shortcut-list">
        {SHORTCUTS.filter((definition) => definition.group === group).map(({ id }) => (
          <div key={id} className="shortcut-row">
            <dt>
              {t(`shortcuts.actions.${id}`)}
              {id === "switchTab" && tabs.length > 0 && (
                // Lines break after a separator, never inside "4 Moves".
                <span className="shortcut-tabs">{tabs.map((label, index) => `${index + 1}\u00a0${label}`).join("\u00a0· ")}</span>
              )}
            </dt>
            <dd>
              <ShortcutKeys id={id} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Every shortcut of the director window, grouped, with the keys of this platform. */
export function ShortcutsOverlay({ open, onClose, tabs }: { open: boolean; onClose(): void; tabs: readonly string[] }) {
  const { t } = useI18n();
  return (
    <Modal open={open} onClose={onClose} title={t("shortcuts.title")} description={t("shortcuts.note")} size="md">
      <div className="shortcut-groups">
        {SHORTCUT_GROUPS.map((group) => (
          <Group key={group} group={group} tabs={tabs} />
        ))}
      </div>
    </Modal>
  );
}
