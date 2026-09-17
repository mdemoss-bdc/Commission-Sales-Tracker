import { formatMoney } from "@/lib/format";
import { hideHeaderStatOnPrint } from "@/lib/summaries";
import type { Totals } from "@/lib/types";

type StatStripProps = {
  totals: Totals;
  extra?: { label: string; value: string }[];
  hideOnPrint?: boolean;
};

export function StatStrip({ totals, extra = [], hideOnPrint = true }: StatStripProps) {
  const items = [
    { label: "Units", value: String(totals.units) },
    { label: "Trades", value: String(totals.trades) },
    { label: "Gross", value: formatMoney(totals.gross) },
    { label: "Total pay", value: formatMoney(totals.pay) },
    ...extra,
  ];

  return (
    <div className={hideOnPrint ? "header-stats print:hidden no-print" : "header-stats"}>
      {items.map((item) => (
        <div
          key={item.label}
          className={hideHeaderStatOnPrint(item.label) ? "print-hide-stat print:hidden" : undefined}
        >
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </div>
      ))}
    </div>
  );
}
