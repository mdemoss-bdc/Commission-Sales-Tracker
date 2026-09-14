"use client";

import { useState } from "react";
import { formatMoney, parseMoney } from "@/lib/format";

type MoneyCellProps = {
  id?: string;
  value: number;
  ariaLabel: string;
  onChange: (value: number) => void;
  className?: string;
  placeholder?: string;
};

export function MoneyCell({
  id,
  value,
  ariaLabel,
  onChange,
  className = "",
  placeholder,
}: MoneyCellProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? (value === 0 ? "" : formatMoney(value));

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={display}
      placeholder={placeholder}
      onFocus={(event) => {
        setDraft(value === 0 ? "" : String(value));
        event.target.select();
      }}
      onChange={(event) => {
        setDraft(event.target.value);
        onChange(parseMoney(event.target.value));
      }}
      onBlur={() => {
        onChange(parseMoney(draft ?? ""));
        setDraft(null);
      }}
      className={`sheet-input text-right tabular-nums ${className}`}
    />
  );
}
