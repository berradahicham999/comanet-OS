import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { importFiles } from "@/db/schema";
import { requirePermission } from "@/lib/access";
import { listSheets, parseSheet } from "@/lib/import/parse";
import { autoMap, FIELDS, IMPORT_TYPES, IMPORT_MODULE, type ImportType } from "@/lib/import/fields";
import { PageHeader, Card, Badge } from "@/components/ui";
import { runImportAction } from "../actions";
import { iso } from "@/lib/format";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const metadata = { title: "Mapping des colonnes" };

export default async function NewImportPage(props: { searchParams: Promise<{ file?: string; type?: string; sheet?: string; header?: string; error?: string }> }) {
  const sp = await props.searchParams;
  const type = (IMPORT_TYPES.some((t) => t.key === sp.type) ? sp.type : "SALES") as ImportType;
  await requirePermission(IMPORT_MODULE[type], "create");
  if (!sp.file) redirect("/imports");
  const file = await db.query.importFiles.findFirst({ where: eq(importFiles.id, sp.file) });
  if (!file) redirect("/imports?error=expire");
  const sheets = listSheets(file.data);
  const sheet = sp.sheet && sheets.includes(sp.sheet) ? sp.sheet : sheets[0];
  const headerRow = sp.header !== undefined && sp.header !== "" ? Number(sp.header) : undefined;
  const parsed = parseSheet(file.data, sheet, { headerRow, maxRows: 5 });
  const full = parseSheet(file.data, sheet, { headerRow });
  const mapping = autoMap(type, parsed.headers);
  const typeDef = IMPORT_TYPES.find((t) => t.key === type)!;
  const base = `/imports/nouveau?file=${file.id}&type=${type}`;

  return (
    <>
      <PageHeader eyebrow={<Link href="/imports" className="hover:underline">Imports</Link>} title={`Mapping — ${typeDef.label}`} subtitle={<>{file.name} · feuille « {sheet} » · {full.totalRows} lignes détectées (en-tête ligne {parsed.headerRow + 1})</>} />
      {sp.error && <div className="mb-4 rounded-2xl bg-red-soft border border-red/30 px-4 py-3 text-[13px] text-red">{sp.error}</div>}
      <div className="grid lg:grid-cols-[1fr_380px] gap-4">
        <div className="space-y-4">
          <Card title="Feuille et en-tête">
            <form action={base} method="get" className="flex flex-wrap gap-2 items-end text-[13px]">
              <input type="hidden" name="file" value={file.id} /><input type="hidden" name="type" value={type} />
              <label className="block"><span className="label block mb-1">Feuille</span><select name="sheet" defaultValue={sheet} className="select h-9 w-auto">{sheets.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              <label className="block"><span className="label block mb-1">Ligne d&apos;en-tête (auto si vide)</span><input name="header" defaultValue={sp.header ?? ""} placeholder={String(parsed.headerRow)} className="input h-9 w-28" /></label>
              <label className="block"><span className="label block mb-1">Type</span><select name="type" defaultValue={type} className="select h-9 w-auto">{IMPORT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
              <button className="btn-secondary h-9" type="submit">Relire</button>
            </form>
          </Card>
          <Card title="Aperçu (5 premières lignes)" pad={false}>
            <div className="overflow-x-auto"><table className="tbl text-[12px]"><thead><tr>{parsed.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{parsed.rows.map((r, i) => <tr key={i}>{parsed.headers.map((h) => <td key={h} className="whitespace-nowrap max-w-[220px] truncate">{r[h] instanceof Date ? iso(r[h] as Date) : String(r[h] ?? "")}</td>)}</tr>)}</tbody></table></div>
          </Card>
        </div>
        <Card title="Correspondance des colonnes">
          <form action={runImportAction} className="space-y-2 text-[13px]">
            <input type="hidden" name="fileId" value={file.id} /><input type="hidden" name="type" value={type} /><input type="hidden" name="sheet" value={sheet} /><input type="hidden" name="headerRow" value={headerRow ?? -1} />
            {FIELDS[type].map((f) => (
              <label key={f.key} className="block">
                <span className="label block mb-1">{f.label}{f.required && <span className="text-red"> *</span>}</span>
                <select name={`map_${f.key}`} defaultValue={mapping[f.key] ?? ""} className="select h-9"><option value="">— ignorer —</option>{parsed.headers.map((h) => <option key={h} value={h}>{h}</option>)}</select>
              </label>
            ))}
            {(type === "OBJECTIVES" || type === "BUDGETS" || type === "ANIM_OBJECTIVES") && <label className="block"><span className="label block mb-1">Année</span><input name="year" defaultValue={new Date().getUTCFullYear()} className="input h-9" /></label>}
            {type === "ANIMATIONS" && <div className="rounded-xl bg-accent-soft/50 px-3 py-2 text-[11.5px] text-ink-2">Toutes les colonnes non mappées ci-dessus sont lues comme des <b>produits</b> (une colonne = un produit, la valeur = la quantité vendue). La ligne de prix sous l&apos;en-tête et la marque indiquée au-dessus des colonnes sont reprises automatiquement ; les colonnes de totaux du classeur sont ignorées.</div>}
            {type === "ANIM_OBJECTIVES" && <div className="rounded-xl bg-accent-soft/50 px-3 py-2 text-[11.5px] text-ink-2">Choisissez la ligne d&apos;en-tête du bloc <b>YEARLY</b>. Chaque colonne portant un nom de marque devient un objectif annuel en <b>unités</b> pour la ville de la ligne ; l&apos;objectif mensuel est calculé automatiquement.</div>}
            {type === "STOCK" && <label className="block"><span className="label block mb-1">Date de la photo de stock</span><input type="date" name="stockDate" defaultValue={iso(new Date())} className="input h-9" /></label>}
            {type === "ADS" && <><label className="block"><span className="label block mb-1">Régie (si le fichier n&apos;a pas de colonne plateforme)</span><select name="adPlatform" className="select h-9"><option value="META">Meta Ads</option><option value="TIKTOK">TikTok Ads</option><option value="GOOGLE">Google Ads</option><option value="AUTRE">Autre régie</option></select></label><div className="rounded-xl bg-accent-soft/50 px-3 py-2 text-[11.5px] text-ink-2">Réimporter le même export <b>met à jour</b> les lignes existantes (clé : plateforme + jour + campagne + ensemble + publicité) — aucun doublon. La marque est déduite du nom de la campagne quand le fichier n&apos;a pas de colonne dédiée.</div></>}
            {(type === "SALES" || type === "STOCK") && <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" name="createUnknown" value="on" defaultChecked /> Créer automatiquement les clients / produits inconnus (sinon : ligne en erreur)</label>}
            <div className="text-[11.5px] text-faint">Doublons : une ligne identique (date, client, article, quantité, montant, n° de pièce) déjà importée est ignorée. Les désignations proches d&apos;un produit existant sont rapprochées automatiquement et listées dans le rapport.</div>
            <button className="btn-primary w-full" type="submit">Lancer l&apos;import ({full.totalRows} lignes)</button>
            <div className="flex flex-wrap gap-1 pt-1">{Object.keys(mapping).length ? <Badge tone="green">{Object.keys(mapping).length} colonnes reconnues automatiquement</Badge> : <Badge tone="yellow">Aucune colonne reconnue — vérifiez la ligne d&apos;en-tête</Badge>}</div>
          </form>
        </Card>
      </div>
    </>
  );
}
