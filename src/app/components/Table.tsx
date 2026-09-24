import type { ReactNode, TableHTMLAttributes } from "react";

/**
 * A data table: tabular numbers, rows tall enough to hit, a header that stays in view while
 * the page scrolls. Use `className="num"` on numeric cells to right-align them.
 */
export function Table({
  caption,
  className,
  density = "regular",
  children,
  ...rest
}: TableHTMLAttributes<HTMLTableElement> & { caption: ReactNode; density?: "regular" | "compact" }) {
  return (
    <div className="table-wrap">
      <table className={["table", `table--${density}`, className ?? ""].filter(Boolean).join(" ")} {...rest}>
        <caption className="visually-hidden">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
