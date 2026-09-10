import Link from "next/link";
import { requireAccess } from "@/lib/access";
import { listBrands } from "@/lib/users";
import { PageHeader, Card, Empty } from "@/components/ui";
import { buildCommandCenter } from "@/lib/ads-intel/command-center";
import { AdsCommandCenter } from "@/components/ads/command-center";
import { loadEntityDetail, searchAdsHistory, syncMetaNow } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Digital Ads" };

/**
 * ADS COMMAND CENTER — une seule page. Toute l'analyse est faite par `buildCommandCenter()` ;
 * cette page ne fait que vérifier l'accès, résoudre les filtres et rendre.
 */
export default async function AdsPage(props: { searchParams: Promise<{ brand?: string; period?: string; start?: string; end?: string }> }) {
  await requireAccess("marketing");
  const sp = await props.searchParams;
  const brands = (await listBrands()).filter((b) => b.active);
  const brandId = sp.brand && brands.some((b) => b.id === sp.brand) ? sp.brand : null;
  const custom = sp.period === "custom" ? { start: sp.start, end: sp.end } : undefined;
  const data = await buildCommandCenter({ periodKey: sp.period, brandId, custom });

  if (data.data.closedRows === 0 && !data.data.connected) {
    return (
      <>
        <PageHeader eyebrow="Marketing Command Center" title="Digital Ads" subtitle="Où mettre l'argent, quoi pousser, quoi arrêter, quoi tester, quoi publier — à partir de la donnée Meta et de l'historique depuis 2023." actions={<><Link href="/marketing/ads/comptes" className="btn-primary btn-sm">Connecter Meta</Link><Link href="/imports?type=ADS" className="btn-secondary btn-sm">Importer un export</Link></>} />
        <Card>
          <Empty
            title="Aucune donnée publicitaire"
            hint={<span className="block max-w-2xl"><b>Le plus simple : connecter le compte Meta.</b> Ajoutez le jeton (<code className="text-[12px]">META_ACCESS_TOKEN</code>) sur Vercel, découvrez les comptes sur l&apos;écran <i>Comptes publicitaires</i>, activez-les, puis lancez le rattrapage historique (2023 →). Le diagnostic vérifie chaque étape avec de vrais appels.<br /><br /><b>Sinon, par fichier :</b> Gestionnaire de publicités → Rapports → ventilation par jour → Exporter, puis Imports → Publicité.</span>}
            action={<Link href="/marketing/ads/comptes" className="btn-primary btn-sm">Connecter Meta</Link>}
          />
        </Card>
      </>
    );
  }

  return <AdsCommandCenter data={data} custom={custom} actions={{ loadDetail: loadEntityDetail, search: searchAdsHistory, syncNow: syncMetaNow }} />;
}
