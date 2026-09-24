import "server-only";
import { sql } from "drizzle-orm";
/* eslint-disable jsx-a11y/alt-text -- @react-pdf/renderer : Image n'a pas d'attribut alt */
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { db } from "@/db";
import { getSettings, type CompanyIdentity } from "@/lib/settings";
import { readAsset, storeAsset } from "@/lib/content/assets";
import { DOC_TYPE_LABELS, type DocType } from "./documents-shared";
import { attachPdf, getDocument, type DocumentView } from "./documents";
import { fmtDateFr, fmtSage, globalDiscountAmount, pdfPages, pdfRows, type PdfLine } from "./pdf-model";

/**
 * PDF d'une pièce, sur le modèle Sage fourni par Hicham (FA202600198) : logo, cartouches N° /
 * Date / Client, bloc société grisé, bloc client entre équerres, tableau à colonnes, bloc des
 * totaux, montant en lettres, cachet, RIB. Ajouts demandés par le brief : taux de TVA, échéance,
 * mode de règlement, pages numérotées et reports. Une pièce validée est rendue depuis ses
 * identités figées et son PDF est stocké : changer un paramètre ne la modifie jamais.
 */

const GREY = "#e9e9e9";
const LINE = "#9a9a9a";
const s = StyleSheet.create({
  page: { paddingTop: 22, paddingBottom: 30, paddingHorizontal: 24, fontSize: 8.5, fontFamily: "Helvetica", color: "#111" },
  row: { flexDirection: "row" },
  bold: { fontFamily: "Helvetica-Bold" },
  cartouche: { borderWidth: 0.8, borderColor: "#555", borderRadius: 5, width: 104, marginLeft: 6 },
  cartoucheHead: { textAlign: "center", paddingVertical: 3, borderBottomWidth: 0.8, borderColor: "#555", fontFamily: "Helvetica-Bold", fontSize: 8 },
  cartoucheVal: { textAlign: "center", paddingVertical: 4, fontFamily: "Helvetica-Bold", fontSize: 8.5 },
  company: { backgroundColor: "#f3f3f3", padding: 8, width: 250, marginTop: 6 },
  clientBox: { marginLeft: 30, marginTop: 14, flex: 1, padding: 10, position: "relative" },
  table: { marginTop: 18, borderWidth: 0.8, borderColor: LINE, borderRadius: 5 },
  th: { backgroundColor: "#fff", borderBottomWidth: 0.8, borderColor: LINE, fontFamily: "Helvetica-Bold", fontSize: 8, paddingVertical: 4, textAlign: "center" },
  td: { paddingVertical: 2.2, paddingHorizontal: 3, fontSize: 8 },
  totals: { width: 270, borderWidth: 0.6, borderColor: LINE },
  totalRow: { flexDirection: "row", borderBottomWidth: 0.4, borderColor: LINE },
});

/** Styles du modèle Sage, partagés avec les PDF d'achat (`purchase-pdf.tsx`). */
export const PDF_STYLES = s;
export const PDF_LINE_COLOR = LINE;
export const PDF_GREY = GREY;

type Col = { key: string; label: string; width: number; align?: "left" | "right" | "center" };
function columns(type: DocType, model: "PPH_REMISE" | "NET"): Col[] {
  if (type === "BL") return [
    { key: "ref", label: "REF", width: 48 }, { key: "designation", label: "Désignation", width: 150 }, { key: "lot", label: "Lot (péremption)", width: 82 },
    { key: "quantity", label: "Qté", width: 38, align: "right" }, { key: "free", label: "UG", width: 30, align: "right" }, { key: "unitPriceHt", label: "P.U. HT", width: 46, align: "right" },
    { key: "discount", label: "REMISE", width: 38, align: "right" }, { key: "netHt", label: "Montant HT", width: 60, align: "right" },
  ];
  if (model === "NET") return [
    { key: "ref", label: "REF", width: 50 }, { key: "designation", label: "Désignation", width: 180 }, { key: "quantity", label: "Qté", width: 44, align: "right" },
    { key: "netUnit", label: "Px Uni. HT", width: 56, align: "right" }, { key: "netHt", label: "Total HT", width: 60, align: "right" }, { key: "vat", label: "TVA", width: 50, align: "right" }, { key: "ttc", label: "Mt TTC", width: 52, align: "right" },
  ];
  return [
    { key: "ref", label: "REF", width: 50 }, { key: "designation", label: "Désignation", width: 120 }, { key: "quantity", label: "Qté", width: 36, align: "right" },
    { key: "unitPriceHt", label: "P.U. HT", width: 46, align: "right" }, { key: "publicPriceTtc", label: "PPH TTC", width: 46, align: "right" }, { key: "discount", label: "REMISE", width: 36, align: "right" },
    { key: "netHt", label: "Montant HT", width: 54, align: "right" }, { key: "vat", label: "TVA", width: 46, align: "right" }, { key: "ttc", label: "Mt TTC", width: 52, align: "right" },
  ];
}

export type PdfInput = {
  type: DocType; number: string | null; status: string; isSimulation: boolean; date: string; dueDate: string | null; paymentMode: string | null;
  company: CompanyIdentity; client: { accountCode: string | null; legalName: string; address: string | null; ice: string | null; city: string | null; postalCode: string | null };
  lines: PdfLine[]; grossHt: string; globalDiscountPct: string; netHt: string; vatTotal: string; ttc: string; vatBreakdown: { rate: string; base: string; vat: string }[];
  amountInWords: string | null; originNumber: string | null; notes: string | null; model: "PPH_REMISE" | "NET";
  logo: Img | null; cachet: Img | null;
};

function Header({ d }: { d: PdfInput }) {
  const title = d.type === "FACTURE" ? "Facture N°" : d.type === "AVOIR" ? "Avoir N°" : "Bon de livraison N°";
  const stamp = d.status === "BROUILLON" ? "Provisoire" : d.isSimulation ? "Simulation" : null;
  const c = d.company;
  return (
    <View>
      <View style={s.row}>
        <View style={{ width: 250 }}>
          {d.logo ? <Image src={d.logo} style={{ width: 150, height: 21, objectFit: "contain" }} /> : <Text style={[s.bold, { fontSize: 20 }]}>{c.legalName || "COMANET"}</Text>}
        </View>
        <View style={{ marginLeft: "auto" }}>
          <View style={s.row}>
            <View style={s.cartouche}><Text style={s.cartoucheHead}>{title}</Text><Text style={s.cartoucheVal}>{d.number ?? "—"}</Text></View>
            <View style={s.cartouche}><Text style={s.cartoucheHead}>Date</Text><Text style={s.cartoucheVal}>{fmtDateFr(d.date)}</Text></View>
            <View style={s.cartouche}><Text style={s.cartoucheHead}>Client</Text><Text style={s.cartoucheVal}>{d.client.accountCode ?? ""}</Text></View>
          </View>
          {stamp && <View style={{ marginTop: 4, marginLeft: 6, width: 104, height: 16, backgroundColor: "#8c8c8c", justifyContent: "center" }}><Text style={{ textAlign: "center", color: "#fff", fontFamily: "Helvetica-Bold", fontSize: 8.5 }}>{stamp}</Text></View>}
        </View>
      </View>
      <View style={s.row}>
        <View style={s.company}>
          <Text style={s.bold}>{c.legalName}</Text>
          <Text style={s.bold}>{c.address}</Text>
          <Text style={[s.bold, { marginBottom: 2 }]}>{[c.postalCode, c.city].filter(Boolean).join(" ")}</Text>
          {[["Tél", c.phone], ["Capital", c.capital], ["RC", c.rc], ["ICE", c.ice], ["I.F", c.ifNumber], ["CNSS", c.cnss], ["TP", c.tp]].filter(([, v]) => v).map(([k, v]) => (
            <View key={k} style={s.row}><Text style={{ width: 42 }}>{k}</Text><Text>: {v}</Text></View>
          ))}
        </View>
        <View style={s.clientBox}>
          <View style={{ position: "absolute", top: 0, left: 0, width: 10, height: 10, borderTopWidth: 0.8, borderLeftWidth: 0.8 }} />
          <View style={{ position: "absolute", top: 0, right: 0, width: 10, height: 10, borderTopWidth: 0.8, borderRightWidth: 0.8 }} />
          <View style={{ position: "absolute", bottom: 0, left: 0, width: 10, height: 10, borderBottomWidth: 0.8, borderLeftWidth: 0.8 }} />
          <View style={{ position: "absolute", bottom: 0, right: 0, width: 10, height: 10, borderBottomWidth: 0.8, borderRightWidth: 0.8 }} />
          <Text style={[s.bold, { marginBottom: 4 }]}>{d.client.legalName}</Text>
          {d.client.address && <Text style={[s.bold, { marginBottom: 4 }]}>{d.client.address}</Text>}
          {d.client.ice && <Text style={[s.bold, { marginBottom: 4 }]}>ICE:{d.client.ice}</Text>}
          <Text style={s.bold}>{[d.client.postalCode, d.client.city].filter(Boolean).join(" ")}</Text>
        </View>
      </View>
      {d.originNumber && <Text style={{ marginTop: 8 }}>Avoir sur la facture n° {d.originNumber}</Text>}
    </View>
  );
}

function cell(row: Record<string, string>, col: Col, bold = false) {
  return <Text key={col.key} style={[s.td, { width: col.width, textAlign: col.align ?? "left" }, bold ? s.bold : {}]}>{row[col.key] ?? ""}</Text>;
}

export function DocumentPdf({ d }: { d: PdfInput }) {
  // La désignation prend toute la largeur restante de la page (A4 moins les marges).
  const base = columns(d.type, d.model);
  const rest = 547 - base.filter((c) => c.key !== "designation").reduce((a, c) => a + c.width, 0);
  const cols = base.map((c) => (c.key === "designation" ? { ...c, width: rest } : c));
  const rows = pdfRows(d.type, d.lines);
  const pages = pdfPages(rows);
  const tableWidth = cols.reduce((a, c) => a + c.width, 0);
  return (
    <Document title={`${DOC_TYPE_LABELS[d.type].one} ${d.number ?? "provisoire"}`} author={d.company.legalName || "COMANET"}>
      {pages.map((p) => (
        <Page key={p.index} size="A4" style={s.page}>
          <Header d={d} />
          <View style={[s.table, { width: tableWidth }]}>
            <View style={s.row}>{cols.map((c) => <Text key={c.key} style={[s.th, { width: c.width, borderRightWidth: 0.4, borderColor: LINE }]}>{c.label}</Text>)}</View>
            <View style={{ minHeight: p.index === p.count ? 330 : 560 }}>
              {p.report && <View style={s.row}><Text style={[s.td, s.bold, { width: tableWidth - 60 }]}>Report</Text><Text style={[s.td, s.bold, { width: 60, textAlign: "right" }]}>{p.report.ht}</Text></View>}
              {p.rows.map((r, i) => {
                if (r.kind === "group") return <Text key={i} style={[s.td, s.bold, { marginTop: 3 }]}>{r.label}</Text>;
                return <View key={i} style={s.row} wrap={false}>{cols.map((c) => cell(r as unknown as Record<string, string>, c))}</View>;
              })}
            </View>
            {p.toCarry && <View style={[s.row, { borderTopWidth: 0.6, borderColor: LINE }]}><Text style={[s.td, s.bold, { width: tableWidth - 60 }]}>À reporter</Text><Text style={[s.td, s.bold, { width: 60, textAlign: "right" }]}>{p.toCarry.ht}</Text></View>}
          </View>

          {p.index === p.count && (
            <View style={[s.row, { marginTop: 4 }]}>
              <View style={{ width: 250, paddingTop: 6 }}>
                {d.cachet && d.status !== "BROUILLON" && <Image src={d.cachet} style={{ width: 150, height: 110, objectFit: "contain" }} />}
              </View>
              <View style={{ marginLeft: "auto" }}>
                <View style={s.totals}>
                  <TotalRow label="Total HT" value={fmtSage(d.grossHt)} />
                  {Number(d.globalDiscountPct) > 0 && <TotalRow label={`Remise ${fmtSage(d.globalDiscountPct)} %`} value={`-${globalDiscountAmount(d.grossHt, d.netHt)}`} />}
                  <TotalRow label="Net HT" value={fmtSage(d.netHt)} bold />
                  {d.vatBreakdown.map((v) => <TotalRow key={v.rate} label={`TVA ${fmtSage(v.rate)} % sur ${fmtSage(v.base)}`} value={fmtSage(v.vat)} />)}
                  <TotalRow label="Total TVA" value={fmtSage(d.vatTotal)} />
                  {d.type !== "BL" && <TotalRow label="Total TTC" value={fmtSage(d.ttc)} />}
                  {d.type !== "BL" && <TotalRow label={d.type === "AVOIR" ? "NET À DÉDUIRE" : "NET A PAYER"} value={fmtSage(d.ttc)} bold grey />}
                  {d.type === "BL" && <TotalRow label="Total TTC" value={fmtSage(d.ttc)} bold grey />}
                </View>
                {d.amountInWords && <Text style={{ marginTop: 4, textAlign: "right", maxWidth: 300 }}>{d.amountInWords}</Text>}
                {d.type === "FACTURE" && (d.dueDate || d.paymentMode) && (
                  <Text style={{ marginTop: 6, textAlign: "right" }}>{[d.dueDate ? `Échéance : ${fmtDateFr(d.dueDate)}` : null, d.paymentMode ? `Règlement : ${d.paymentMode}` : null].filter(Boolean).join("   ·   ")}</Text>
                )}
              </View>
            </View>
          )}
          {p.index === p.count && d.notes && <Text style={{ marginTop: 6 }}>{d.notes}</Text>}
          <View style={{ position: "absolute", bottom: 14, left: 24, right: 24, flexDirection: "row" }} fixed>
            <Text>{d.company.rib ? `RIB ${d.company.bankName} : ${d.company.rib}` : ""}</Text>
            <Text style={{ marginLeft: "auto" }}>Page {p.index} / {p.count}</Text>
          </View>
        </Page>
      ))}
    </Document>
  );
}

export function TotalRow({ label, value, bold, grey }: { label: string; value: string; bold?: boolean; grey?: boolean }) {
  return (
    <View style={[s.totalRow, grey ? { backgroundColor: GREY } : {}]}>
      <Text style={[{ width: 170, padding: 3 }, bold ? s.bold : {}]}>{label}</Text>
      <Text style={[{ width: 100, padding: 3, textAlign: "right" }, bold ? s.bold : {}]}>{value}</Text>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Données et stockage                                                 */
/* ------------------------------------------------------------------ */

export type Img = { data: Buffer; format: "png" | "jpg" };
/** Logo et cachet : PNG ou JPEG seulement (formats lus par le moteur PDF). */
export async function fileData(id: string | null | undefined): Promise<Img | null> {
  if (!id) return null;
  const f = await readAsset(id);
  if (!f) return null;
  if (f.mime === "image/png") return { data: f.data, format: "png" };
  if (f.mime === "image/jpeg" || f.mime === "image/jpg") return { data: f.data, format: "jpg" };
  return null;
}

/** Dernières versions du logo et du cachet de la société (identifiants d'actifs). */
export async function companyAssetIds(): Promise<{ logoId: string | null; cachetId: string | null }> {
  const files = (await db.execute<{ slot: string; id: string }>(sql`select distinct on (company_slot) company_slot as slot, id from content_assets where company_slot is not null order by company_slot, version desc`)).rows;
  return { logoId: files.find((f) => f.slot === "LOGO")?.id ?? null, cachetId: files.find((f) => f.slot === "CACHET")?.id ?? null };
}

/** Données d'impression : identités figées pour une pièce validée, fiches actuelles pour un brouillon. */
export async function pdfInput(doc: DocumentView): Promise<PdfInput> {
  const g = (await getSettings()).gestion;
  const validated = doc.status !== "BROUILLON";
  const company = (validated ? doc.companySnapshot : null) as (CompanyIdentity & { logoAssetId?: string | null; cachetAssetId?: string | null }) | null;
  let client = validated ? (doc.clientSnapshot as Record<string, string | null>) : null;
  let logoId = company?.logoAssetId ?? null, cachetId = company?.cachetAssetId ?? null;
  if (!validated) {
    const c = (await db.execute<Record<string, string | null>>(sql`select name, legal_name as "legalName", coalesce(account_code, code) as "accountCode", ice, billing_address as address, city, postal_code as "postalCode" from clients where id = ${doc.clientId}::uuid`)).rows[0];
    client = { ...c, legalName: c.legalName ?? c.name };
    const files = (await db.execute<{ slot: string; id: string }>(sql`select distinct on (company_slot) company_slot as slot, id from content_assets where company_slot is not null order by company_slot, version desc`)).rows;
    logoId = files.find((f) => f.slot === "LOGO")?.id ?? null;
    cachetId = files.find((f) => f.slot === "CACHET")?.id ?? null;
  }
  const mode = doc.paymentModeKey ? (await db.execute<{ label: string }>(sql`select label from payment_modes where key = ${doc.paymentModeKey}`)).rows[0]?.label ?? null : null;
  const [logo, cachet] = await Promise.all([fileData(logoId), fileData(cachetId)]);
  return {
    type: doc.type as DocType, number: doc.number, status: doc.status, isSimulation: doc.isSimulation, date: doc.date, dueDate: doc.dueDate, paymentMode: mode,
    company: company ?? g.company,
    client: { accountCode: client?.accountCode ?? null, legalName: client?.legalName ?? doc.client.name, address: client?.address ?? null, ice: client?.ice ?? null, city: client?.city ?? null, postalCode: client?.postalCode ?? null },
    lines: doc.lines.map((l) => ({
      ref: l.ref, designation: l.designation, quantity: l.quantity, freeQuantity: l.freeQuantity, unitPriceHt: l.unitPriceHt, publicPriceTtc: l.publicPriceTtc,
      discountPct: l.discountPct, grossHt: l.grossHt, netHt: l.netHt, vatAmount: l.vatAmount, ttc: l.ttc, sourceNumber: l.sourceNumber, sourceDate: l.sourceDate,
      lotAllocations: l.lotAllocations ?? [],
    })),
    grossHt: doc.grossHt, globalDiscountPct: doc.globalDiscountPct, netHt: doc.netHt, vatTotal: doc.vatTotal, ttc: doc.ttc, vatBreakdown: doc.vatBreakdown,
    amountInWords: doc.amountInWords, originNumber: doc.origin?.number ?? null, notes: doc.notes, model: g.invoiceModel, logo, cachet,
  };
}

export async function renderDocumentPdf(doc: DocumentView): Promise<Buffer> {
  return renderToBuffer(<DocumentPdf d={await pdfInput(doc)} />);
}

/** PDF figé d'une pièce validée : rendu une fois depuis ses identités figées, stocké, puis toujours relu tel quel. */
export async function storedPdf(docId: string, userId: string | null): Promise<{ data: Buffer; name: string } | null> {
  const doc = await getDocument(docId);
  if (!doc) return null;
  const name = `${doc.number ?? `${doc.type}-provisoire`}.pdf`;
  if (doc.status === "BROUILLON") return { data: await renderDocumentPdf(doc), name };
  if (doc.pdfAssetId) {
    const f = await readAsset(doc.pdfAssetId);
    if (f) return { data: f.data, name };
  }
  const data = await renderDocumentPdf(doc);
  const row = await storeAsset({ owner: { salesDocumentId: docId }, kind: "PIECE", name, mime: "application/pdf", data, uploadedById: userId });
  await attachPdf(docId, row.id);
  return { data, name };
}
