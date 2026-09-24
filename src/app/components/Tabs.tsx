import { Fragment } from "react";
import { NavLink } from "react-router-dom";

export interface TabItem {
  to: string;
  label: string;
}

/**
 * Navigation between the screens of a page, as router links (each tab has its own URL, so
 * the browser's back button and deep links work). Groups are separated by a gap.
 */
export function Tabs({ label, groups }: { label: string; groups: readonly (readonly TabItem[])[] }) {
  return (
    <nav className="tabs" aria-label={label}>
      {groups.map((group, index) => (
        <Fragment key={index}>
          {index > 0 && <span className="tabs-divider" aria-hidden="true" />}
          <ul className="tabs-group">
            {group.map((item) => (
              <li key={item.to}>
                <NavLink to={item.to} className={({ isActive }) => (isActive ? "tab is-active" : "tab")}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </Fragment>
      ))}
    </nav>
  );
}
