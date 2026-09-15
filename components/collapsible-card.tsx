"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type CollapsibleCardProps = {
  title: string;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
};

export function CollapsibleCard({
  title,
  defaultOpen = false,
  className,
  children,
}: CollapsibleCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <section className={["summary-card", "no-print", "collapsible-card", className].filter(Boolean).join(" ")}>
      <button
        type="button"
        className="collapsible-card-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <h2>{title}</h2>
        <ChevronDown
          aria-hidden="true"
          className={open ? "collapsible-card-chevron is-open" : "collapsible-card-chevron"}
        />
      </button>
      {open ? (
        <div id={panelId} className="collapsible-card-body">
          {children}
        </div>
      ) : null}
    </section>
  );
}
