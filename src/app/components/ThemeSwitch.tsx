import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n";
import { THEME_PREFERENCES, setThemePreference, useTheme, type ThemePreference } from "../theme";
import { IconButton } from "./Button";
import { Icon, type IconName } from "./Icon";

const ICONS: Record<ThemePreference, IconName> = { system: "monitor", light: "sun", dark: "moon" };

/** Header control for the light and dark themes: a menu button (system, light, dark). */
export function ThemeSwitch() {
  const { t } = useI18n();
  const { preference } = useTheme();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const items = () => [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];

  useEffect(() => {
    if (!open) return;
    items().find((item) => item.getAttribute("aria-checked") === "true")?.focus();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) buttonRef.current?.focus();
  };

  const choose = (next: ThemePreference) => {
    setThemePreference(next);
    close(true);
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      event.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(list.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") close(false);
  };

  return (
    <span className="menu-anchor">
      <IconButton
        ref={buttonRef}
        icon={ICONS[preference]}
        label={t("theme.label", { theme: t(`theme.${preference}`) })}
        tooltipAlign="end"
        tooltipSuppressed={open}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      />
      {open && (
        <div ref={menuRef} id={menuId} role="menu" aria-label={t("theme.menu")} className="menu" onKeyDown={onMenuKeyDown}>
          {THEME_PREFERENCES.map((option) => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === preference}
              tabIndex={-1}
              className="menu-item"
              onClick={() => choose(option)}
            >
              <Icon name={ICONS[option]} size={16} />
              <span className="menu-item-label">{t(`theme.${option}`)}</span>
              {option === preference && <Icon name="check" size={16} className="menu-item-check" />}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
