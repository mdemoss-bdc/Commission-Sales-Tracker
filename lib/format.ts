const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const percent = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
});

export function formatMoney(value: number): string {
  return currency.format(value || 0);
}

export function formatPercent(rate: number): string {
  return percent.format(rate);
}

export function parseMoney(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const negative = trimmed.startsWith("(") && trimmed.endsWith(")");
  const cleaned = trimmed.replace(/[^0-9.-]/g, "");
  const amount = Number(cleaned);
  if (!Number.isFinite(amount)) return 0;
  return negative ? -Math.abs(amount) : amount;
}
