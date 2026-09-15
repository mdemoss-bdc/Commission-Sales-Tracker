import type { Sale } from "./types.ts";

export const DUPLICATE_SALE_WARNING = "Sale already exists elsewhere for this month.";
export const DUPLICATE_CONFIRM_LABEL = "Confirm (Sale is correct)";
export const DUPLICATE_DELETE_LABEL = "Delete";

export function normalizeSaleKey(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function isDuplicateConfirmed(sale: Pick<Sale, "duplicateConfirmed"> | null | undefined): boolean {
  return sale?.duplicateConfirmed === true;
}

export function markDuplicateConfirmed(sale: Sale): Sale {
  return {
    ...sale,
    duplicateConfirmed: true,
    duplicate_confirmed: true,
  } as Sale;
}

export function salesAreDuplicates(left: Sale, right: Sale): boolean {
  if (!left || !right || left.id === right.id) return false;
  const stock = normalizeSaleKey(left.stockNumber);
  const otherStock = normalizeSaleKey(right.stockNumber);
  if (!stock || stock !== otherStock) return false;
  const customer = normalizeSaleKey(left.customerName);
  const otherCustomer = normalizeSaleKey(right.customerName);
  if (customer && customer === otherCustomer) return true;
  return (
    customer === otherCustomer &&
    left.dealType === right.dealType &&
    left.gross === right.gross &&
    (Boolean(customer) || left.gross !== 0)
  );
}

export function duplicateSaleIds(sales: Sale[] | null | undefined): Set<string> {
  const rows = Array.isArray(sales) ? sales : [];
  const flagged = new Set<string>();
  for (const sale of rows) {
    if (isDuplicateConfirmed(sale)) continue;
    const match = rows.some((other) => salesAreDuplicates(sale, other));
    if (match) flagged.add(sale.id);
  }
  return flagged;
}
