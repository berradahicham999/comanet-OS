import * as XLSX from "xlsx";
import { requireAccess, requireFlag, clientFilter } from "@/lib/access";
import { getSettings } from "@/lib/settings";
import { today } from "@/lib/format";
import { AGING_META, CHANNEL_LABELS, stockClientsSummary, type Aging, type ClientStockChannel } from "@/lib/client-stock";

export const dynamic = "force-dynamic";

/** Export Excel de la vue transversale « Stock chez les clients », mêmes filtres que la page. */
export async function GET(req: Request) {
  await requireAccess("clients");
  await requireFlag("exportData");
  const u = new URL(req.url).searchParams;
  const s = await getSettings();
  const t = today();
  const channel = u.get("channel") as ClientStockChannel | null;
  const aging = u.get("aging") as Aging | null;
  const rows = await stockClientsSummary({
    brandId: u.get("brand") || null, city: u.get("city") || null, authorId: u.get("author") || null, commercialId: u.get("commercial") || null,
    channel: channel && channel in CHANNEL_LABELS ? channel : null, aging: aging && aging in AGING_META ? aging : null, clientIds: await clientFilter(),
  }, t, s.clientStock);
  const data = rows.map((r) => ({
    "Point de vente": r.name,
    Type: r.type,
    Ville: r.city ?? "",
    "Dernier relevé": r.lastReadAt ?? "",
    "Ancienneté (jours)": r.ageDays ?? "",
    Situation: AGING_META[r.aging].label,
    "Produits relevés": r.productsRead,
    "En rupture (stock = 0)": r.lastReadAt ? r.stockouts : "",
    "Dernier auteur": r.lastAuthor ?? "",
    Canal: r.lastChannel ? CHANNEL_LABELS[r.lastChannel] : "",
    Commercial: r.commercials.join(", "),
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [{ wch: 36 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 22 }, { wch: 10 }, { wch: 26 }];
  XLSX.utils.book_append_sheet(wb, ws, "Stock clients");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="COMANET-stock-clients-${t.toISOString().slice(0, 10)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
