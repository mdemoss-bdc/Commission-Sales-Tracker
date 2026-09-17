"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type CollapsibleCardProps = {
  title: string;
  /** Count or short status shown beside the title (e.g. "3" or "2 waiting"). */
  summary?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  headerActions?: ReactNode;
  children: ReactNode;
};

export function CollapsibleCard({
  title,
  summary,
  defaultOpen = false,
  className,
  headerActions,
  children,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  const toggle = (
    <button
      type="button"
      className="collapsible-card-toggle"
      aria-expanded={open}
      aria-controls={panelId}
      onClick={() => setOpen((current) => !current)}
    >
      <span className="collapsible-card-title-row">
        <h2>{title}</h2>
        {summary != null && summary !== "" ? (
          <span className="collapsible-card-summary">{summary}</span>
        ) : null}
      </span>
      <ChevronDown
        aria-hidden="true"
        className={open ? "collapsible-card-chevron is-open" : "collapsible-card-chevron"}
      />
    </button>
  );

  return (
    <section className={["summary-card", "no-print", "collapsible-card", className].filter(Boolean).join(" ")}>
      {headerActions ? (
        <div className="collapsible-card-head">
          {toggle}
          <div className="collapsible-card-actions">{headerActions}</div>
        </div>
      ) : (
        toggle
      )}
      <div id={panelId} className="collapsible-card-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
