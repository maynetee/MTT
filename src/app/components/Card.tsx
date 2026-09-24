import { useId, type HTMLAttributes, type ReactNode } from "react";

/** A flat panel on the page background. */
export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={["card", className ?? ""].filter(Boolean).join(" ")} {...rest}>
      {children}
    </div>
  );
}

export interface SectionProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  /** `h1` for the page's own title; `h2` by default. */
  level?: 1 | 2 | 3;
  description?: ReactNode;
  /** Buttons at the right of the title. */
  actions?: ReactNode;
  /** Content that runs edge to edge (tables). */
  flush?: boolean;
}

/** A titled panel: title, optional description and actions, then its content. */
export function Section({ title, level = 2, description, actions, flush = false, className, children, ...rest }: SectionProps) {
  const id = useId();
  const Heading = `h${level}` as const;
  return (
    <section aria-labelledby={id} className={["card", "section", flush ? "section--flush" : "", className ?? ""].filter(Boolean).join(" ")} {...rest}>
      <header className="section-header">
        <div className="section-heading">
          <Heading id={id} className="section-title">
            {title}
          </Heading>
          {description && <p className="section-description">{description}</p>}
        </div>
        {actions && <div className="section-actions">{actions}</div>}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}

/** A labelled number: the label under a large tabular value. */
export function Stat({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: "accent" | "success" | "danger" }) {
  return (
    <div className={["stat", tone ? `stat--${tone}` : ""].filter(Boolean).join(" ")}>
      <dt className="stat-label">{label}</dt>
      <dd className="stat-value">{value}</dd>
    </div>
  );
}

/** Stats side by side, as a description list. */
export function StatGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={["stat-group", className ?? ""].filter(Boolean).join(" ")}>{children}</dl>;
}
