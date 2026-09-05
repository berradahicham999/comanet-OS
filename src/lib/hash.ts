import { createHash } from "crypto";

/** Clé de dédoublonnage d'une ligne de vente Sage. */
export function saleLineHash(parts: {
  date: string; // YYYY-MM-DD
  clientCode: string;
  sku: string;
  quantity: number;
  amount: number;
  invoiceRef?: string | null;
}) {
  const raw = [
    parts.date,
    parts.clientCode.trim().toUpperCase(),
    parts.sku.trim().toUpperCase(),
    Number(parts.quantity).toFixed(2),
    Number(parts.amount).toFixed(2),
    (parts.invoiceRef ?? "").trim().toUpperCase(),
  ].join("|");
  return createHash("sha1").update(raw).digest("hex");
}
