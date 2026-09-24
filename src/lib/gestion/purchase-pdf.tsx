import "server-only";
/* eslint-disable jsx-a11y/alt-text -- @react-pdf/renderer : Image n'a pas d'attribut alt */
import { Document, Image, Page, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { getSettings, type CompanyIdentity } from "@/lib/settings";
import { readAsset, storeAsset } from "@/lib/content/assets";
import { PDF_LINE_COLOR as LINE, PDF_STYLES as s, TotalRow, companyAssetIds, fileData, type Img } from "./pdf";
import { fmtDateFr, fmtSage } from "./pdf-model";
import { SCALE, formatScaled, parseDecimal } from "./money";
import { paginate } from "./documents-shared";
import { attachPurchasePdf, getPurchase, type PurchaseView } from "./purchases";
import { PURCHASE_TYPE_LABELS, type PurchaseType } from "./purchases-shared";

/**
 * PDF des pièces d'achat, au style des pièces de vente (modèle Sage) : bon de commande à envoyer au
 * fournisseur (prix dans sa devise), bon de réception interne (lots, péremptions, coût de revient
 * en dirhams). Pas de cachet : ce ne sont pas des pièces fiscales de COMANET.
 */

type Col = { key: string; label: string; width: number; align?: "left" | "right" };

function columns(type: PurchaseType, currency: string): Col[] {
  if (type === "RECEPTION" || type === "RETOUR") return [
    { key: "ref", label: "REF", width: 62 }, { key: "designation", label: "Désignation", width: 0 }, { key: "lot", label: "Lot", width: 60 },
    { key: "expiry", label: "Péremption", width: 55 }, { key: "quantity", label: "Qté", width: 42, align: "right" },
    { key: "unitCost", label: "Revient MAD/u", width: 62, align: "right" }, { key: "amount", label: "Total MAD", width: 66, align: "right" },
  ];
  return [
    { key: "ref", label: "REF", width: 55 }, { key: "designation", label: "Désignation", width: 0 }, { key: "quantity", label: "Qté", width: 45, align: "right" },
    { key: "unitPrice", label: `P.U. HT ${currency}`, width: 70, align: "right" }, { key: "discount", label: "REMISE", width: 45, align: "right" },
    { key: "amount", label: `Montant HT ${currency}`, width: 80, align: "right" },
  ];
}

function PurchasePdf({ d, company, logo }: { d: PurchaseView; company: CompanyIdentity; logo: Img | null }) {
  const type = d.type as PurchaseType;
  const base = columns(type, d.currency);
  const rest = 547 - base.reduce((a, c) => a + c.width, 0);
  const cols = base.map((c) => (c.key === "designation" ? { ...c, width: rest } : c));
  const rows = d.lines.map((l) => ({
    ref: l.ref ?? "", designation: l.designation, lot: l.lotNumber ?? "", expiry: fmtDateFr(l.expiryDate), quantity: fmtSage(l.quantity),
    unitPrice: fmtSage(l.unitPrice, 4), discount: Number(l.discountPct) ? fmtSage(l.discountPct) : "",
    unitCost: l.unitCostMad ? fmtSage(l.unitCostMad, 4) : "",
    amount: type === "RECEPTION" || type === "RETOUR" ? fmtSage(addMoney(l.netHtMad, l.landedMad)) : fmtSage(l.netHtCurrency),
  }));
  const pages = paginate(rows.length, 30, 38, 22);
  const sup = (d.supplierSnapshot ?? {}) as Record<string, string | null>;
  const title = type === "COMMANDE" ? "Bon de commande N°" : type === "RECEPTION" ? "Bon de réception N°" : type === "RETOUR" ? "Retour fournisseur N°" : "Facture fourn. N°";
  const stamp = d.status === "BROUILLON" ? "Provisoire" : null;
  return (
    <Document title={`${PURCHASE_TYPE_LABELS[type].one} ${d.number ?? "provisoire"}`} author={company.legalName || "COMANET"}>
      {pages.map((p, pi) => (
        <Page key={pi} size="A4" style={s.page}>
          <View style={s.row}>
            <View style={{ width: 250 }}>
              {logo ? <Image src={logo} style={{ width: 150, height: 21, objectFit: "contain" }} /> : <Text style={[s.bold, { fontSize: 20 }]}>{company.legalName || "COMANET"}</Text>}
            </View>
            <View style={{ marginLeft: "auto" }}>
              <View style={s.row}>
                <View style={s.cartouche}><Text style={s.cartoucheHead}>{title}</Text><Text style={s.cartoucheVal}>{d.number ?? "—"}</Text></View>
                <View style={s.cartouche}><Text style={s.cartoucheHead}>Date</Text><Text style={s.cartoucheVal}>{fmtDateFr(d.date)}</Text></View>
                <View style={s.cartouche}><Text style={s.cartoucheHead}>Fournisseur</Text><Text style={s.cartoucheVal}>{d.supplier.code ?? ""}</Text></View>
              </View>
              {stamp && <View style={{ marginTop: 4, marginLeft: 6, width: 104, height: 16, backgroundColor: "#8c8c8c", justifyContent: "center" }}><Text style={{ textAlign: "center", color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8.5 }}>{stamp}</Text></View>}
            </View>
          </View>
          <View style={s.row}>
            <View style={s.company}>
              <Text style={s.bold}>{company.legalName}</Text>
              <Text style={s.bold}>{company.address}</Text>
              <Text style={[s.bold, { marginBottom: 2 }]}>{[company.postalCode, company.city].filter(Boolean).join(" ")}</Text>
              {[["Tél", company.phone], ["E-mail", company.email], ["ICE", company.ice]].filter(([, v]) => v).map(([k, v]) => (
                <View key={k} style={s.row}><Text style={{ width: 42 }}>{k}</Text><Text>: {v}</Text></View>
              ))}
            </View>
            <View style={s.clientBox}>
              <Text style={[s.bold, { marginBottom: 4 }]}>{sup.legal_name ?? d.supplier.legalName}</Text>
              {sup.address && <Text style={{ marginBottom: 2 }}>{sup.address}</Text>}
              {(sup.city || sup.country) && <Text style={{ marginBottom: 2 }}>{[sup.city, sup.country].filter(Boolean).join(" — ")}</Text>}
              {sup.ice && <Text>ICE : {sup.ice}</Text>}
              {d.supplierRef && <Text style={{ marginTop: 6 }}>Votre réf. : {d.supplierRef}</Text>}
              {type === "COMMANDE" && d.expectedDate && <Text style={[s.bold, { marginTop: 6 }]}>Livraison souhaitée le {fmtDateFr(d.expectedDate)}</Text>}
            </View>
          </View>
          <View style={[s.table, { width: 547 }]}>
            <View style={s.row}>{cols.map((c) => <Text key={c.key} style={[s.th, { width: c.width, borderRightWidth: 0.4, borderColor: LINE }]}>{c.label}</Text>)}</View>
            <View style={{ minHeight: pi === pages.length - 1 ? 360 : 560 }}>
              {rows.slice(p.from, p.to).map((r, i) => (
                <View key={i} style={s.row} wrap={false}>
                  {cols.map((c) => <Text key={c.key} style={[s.td, { width: c.width, textAlign: c.align ?? "left" }]}>{(r as Record<string, string>)[c.key] ?? ""}</Text>)}
                </View>
              ))}
            </View>
          </View>
          {pi === pages.length - 1 && (
            <View style={[s.row, { marginTop: 4 }]}>
              <View style={{ width: 270 }}>
                {d.currency !== "MAD" && <Text>Taux appliqué : 1 {d.currency} = {fmtSage(d.exchangeRate, 4)} MAD</Text>}
                {d.notes && <Text style={{ marginTop: 6 }}>{d.notes}</Text>}
              </View>
              <View style={[s.totals, { marginLeft: "auto" }]}>
                {type === "COMMANDE" ? (
                  <>
                    <TotalRow label={`Total HT ${d.currency}`} value={fmtSage(d.netHtCurrency)} bold grey={d.currency !== "MAD"} />
                    {d.currency === "MAD" && <TotalRow label="Total TVA" value={fmtSage(d.vatMad)} />}
                    {d.currency === "MAD" && <TotalRow label="Total TTC" value={fmtSage(d.ttcMad)} bold grey />}
                  </>
                ) : (
                  <>
                    {d.currency !== "MAD" && <TotalRow label={`Total HT ${d.currency}`} value={fmtSage(d.netHtCurrency)} />}
                    <TotalRow label="Total HT MAD" value={fmtSage(d.netHtMad)} />
                    {Number(d.landedMad) > 0 && <TotalRow label="Frais d'approche" value={fmtSage(d.landedMad)} />}
                    <TotalRow label="Coût de revient total MAD" value={fmtSage(addMoney(d.netHtMad, d.landedMad))} bold grey />
                  </>
                )}
              </View>
            </View>
          )}
          <View style={{ position: "absolute", bottom: 14, left: 24, right: 24, flexDirection: "row" }} fixed>
            <Text>{company.legalName}</Text>
            <Text style={{ marginLeft: "auto" }}>Page {pi + 1} / {pages.length}</Text>
          </View>
        </Page>
      ))}
    </Document>
  );
}

/** Coût de revient total = HT en dirhams + frais d'approche, au centime exact. */
function addMoney(a: string, b: string): string {
  return formatScaled((parseDecimal(a, SCALE.money) ?? 0n) + (parseDecimal(b, SCALE.money) ?? 0n), SCALE.money);
}

export async function renderPurchasePdf(d: PurchaseView): Promise<Buffer> {
  const company = (await getSettings()).gestion.company;
  const { logoId } = await companyAssetIds();
  return renderToBuffer(<PurchasePdf d={d} company={company} logo={await fileData(logoId)} />);
}

/** PDF d'une commande ou d'une réception : brouillon rendu à la volée, pièce validée rendue une fois puis relue. */
export async function storedPurchasePdf(id: string, userId: string | null): Promise<{ data: Buffer; name: string } | null> {
  const d = await getPurchase(id);
  if (!d) return null;
  const name = `${d.number ?? `${d.type}-provisoire`}.pdf`;
  if (d.status === "BROUILLON" || d.type === "FACTURE") return { data: await renderPurchasePdf(d), name };
  if (d.pdfAssetId) {
    const f = await readAsset(d.pdfAssetId);
    if (f) return { data: f.data, name };
  }
  const data = await renderPurchasePdf(d);
  const row = await storeAsset({ owner: { purchaseDocumentId: id }, kind: "PIECE", name, mime: "application/pdf", data, uploadedById: userId });
  await attachPurchasePdf(id, row.id);
  return { data, name };
}
