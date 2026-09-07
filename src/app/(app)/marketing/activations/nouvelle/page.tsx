import Link from "next/link";
import { requireActivationAccess, requireActivationPermission, activationScope } from "@/lib/activations/access";
import { activationRefs, listActivationTemplates } from "@/lib/activations/refs";
import { pickerOptions, knownCities } from "@/lib/activations/queries";
import { getAccess } from "@/lib/permissions";
import { listBrands, listUsers } from "@/lib/users";
import { PageHeader, Card } from "@/components/ui";
import { EntityPicker } from "@/components/entity-picker";
import { iso, today } from "@/lib/format";
import { createActivation } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Nouvelle activation" };

/**
 * Création d'une activation. `?rapide=1` : formulaire court pensé pour un téléphone en
 * pharmacie (type, marque, client, date) — la photo se prend sur la fiche juste après.
 */
export default async function NouvelleActivationPage(props: { searchParams: Promise<{ rapide?: string; type?: string; modele?: string }> }) {
  await requireActivationAccess();
  await requireActivationPermission("create");
  const sp = await props.searchParams;
  const rapide = !!sp.rapide;
  const [refs, templates, options, cities, brands, users, scope, access] = await Promise.all([
    activationRefs(), listActivationTemplates(), pickerOptions(), knownCities(), listBrands(), listUsers(), activationScope(), getAccess(),
  ]);
  const visibleBrands = brands.filter((b) => b.active && (!scope.brandIds || scope.brandIds.includes(b.id)));
  const visibleClients = options.clients.filter((c) => !scope.clientIds || scope.clientIds.includes(c.id));
  const types = refs.types.filter((t) => t.active);
  const defaultType = types.find((t) => t.key === sp.type)?.key ?? (rapide ? types.find((t) => t.defaultModule === "clients")?.key : undefined) ?? types[0]?.key ?? "AUTRE";
  const tpls = templates.filter((t) => t.active);
  const todayIso = iso(today());

  return (
    <>
      <PageHeader eyebrow={<Link href="/marketing/activations" className="hover:underline">Activations</Link>} title={rapide ? "Créer depuis la pharmacie" : "Nouvelle activation"}
        subtitle={rapide ? "Quatre champs, puis la photo sur la fiche. Le reste peut attendre le bureau." : "Un modèle pré-remplit objectif, budget prévu et checklist. Tout reste modifiable sur la fiche."}
        actions={rapide ? <Link href="/marketing/activations/nouvelle" className="btn-ghost btn-sm">Formulaire complet</Link> : <Link href="/marketing/activations/nouvelle?rapide=1" className="btn-ghost btn-sm sm:hidden">Version rapide</Link>} />

      <form action={createActivation} className="max-w-3xl space-y-4 text-[13px]">
        {rapide && <input type="hidden" name="rapide" value="1" />}
        <Card title="Identité">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block sm:col-span-2"><span className="label block mb-1">Nom</span><input name="name" className="input h-10" required placeholder={rapide ? "ex : Vitrine Gamarde — Pharmacie Al Amal" : "ex : Soirée de lancement Alphascience — Casablanca"} autoFocus /></label>
            <label className="block"><span className="label block mb-1">Type</span>
              <select name="type" defaultValue={defaultType} className="select h-10">{types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
            </label>
            {!rapide && (
              <label className="block"><span className="label block mb-1">Modèle (facultatif)</span>
                <select name="templateId" defaultValue={sp.modele ?? ""} className="select h-10"><option value="">Sans modèle</option>{tpls.map((t) => <option key={t.id} value={t.id}>{t.name}{t.typeKey ? ` · ${refs.types.find((x) => x.key === t.typeKey)?.label ?? t.typeKey}` : ""}</option>)}</select>
              </label>
            )}
            <div className="block sm:col-span-2"><span className="label block mb-1">Marque(s)</span>
              <EntityPicker name="brandIds" options={visibleBrands.map((b) => ({ id: b.id, label: b.name }))} initial={visibleBrands.length === 1 ? [visibleBrands[0].id] : []} placeholder="Choisir une marque…" />
              <span className="text-[11px] text-muted">La première marque porte le budget par défaut.</span>
            </div>
            <label className="block"><span className="label block mb-1">Date de début</span><input type="date" name="date" defaultValue={todayIso} className="input h-10" required /></label>
            {!rapide && <label className="block"><span className="label block mb-1">Date de fin</span><input type="date" name="endDate" className="input h-10" /></label>}
            {!rapide && <label className="block"><span className="label block mb-1">Début de préparation</span><input type="date" name="prepDate" className="input h-10" /><span className="text-[11px] text-muted">Vide : calculé par le modèle.</span></label>}
            {!rapide && (
              <>
                <label className="block"><span className="label block mb-1">Objectif</span><select name="objectiveKey" defaultValue="" className="select h-10"><option value="">Selon le modèle</option>{refs.objectives.filter((o) => o.active).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
                <label className="block"><span className="label block mb-1">Cible</span><select name="targetKey" defaultValue="" className="select h-10"><option value="">Selon le modèle</option>{refs.targets.filter((o) => o.active).map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}</select></label>
              </>
            )}
          </div>
        </Card>

        <Card title="Lieu et cible">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="block sm:col-span-2"><span className="label block mb-1">{rapide ? "Pharmacie" : "Points de vente / clients concernés"}</span>
              <EntityPicker name="clientIds" options={visibleClients.map((c) => ({ id: c.id, label: c.name, hint: c.city }))} placeholder="Rechercher une pharmacie, une ville…" single={rapide} />
            </div>
            <label className="block"><span className="label block mb-1">Ville</span><input name="city" list="villes" className="input h-10" placeholder="Casablanca" /><datalist id="villes">{cities.map((c) => <option key={c} value={c} />)}</datalist></label>
            {!rapide && <label className="block"><span className="label block mb-1">Lieu libre (événement, salle…)</span><input name="place" className="input h-10" placeholder="Hôtel, salle, stand…" /></label>}
          </div>
        </Card>

        {!rapide && (
          <Card title="Produits, campagne et équipe">
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="block sm:col-span-2"><span className="label block mb-1">Produits concernés</span>
                <EntityPicker name="productIds" options={options.products.map((p) => ({ id: p.id, label: p.name, hint: brands.find((b) => b.id === p.brandId)?.name ?? null }))} placeholder="Rechercher un produit…" />
              </div>
              <label className="block"><span className="label block mb-1">Campagne parente</span><select name="campaignId" defaultValue="" className="select h-10"><option value="">—</option>{options.campaigns.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}</select></label>
              <label className="block"><span className="label block mb-1">Animation Terrain liée</span><select name="linkedAnimationId" defaultValue="" className="select h-10"><option value="">—</option>{options.animations.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
              <label className="block"><span className="label block mb-1">Pilote</span><select name="responsibleId" defaultValue={access?.user.id ?? ""} className="select h-10">{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
              <label className="block"><span className="label block mb-1">Validateur</span><select name="validatorId" defaultValue="" className="select h-10"><option value="">Validateurs de la marque / Direction</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
              <div className="block sm:col-span-2"><span className="label block mb-1">Contributeurs</span>
                <EntityPicker name="contributorIds" options={users.map((u) => ({ id: u.id, label: u.name }))} placeholder="Ajouter une personne…" />
              </div>
              <label className="block sm:col-span-2"><span className="label block mb-1">Description</span><textarea name="description" className="textarea min-h-[80px]" placeholder="Ce qu'on fait, pour qui, pourquoi. Vide : la description du modèle." /></label>
            </div>
          </Card>
        )}

        <div className="flex items-center gap-2 pb-6">
          <button className="btn-primary" type="submit">{rapide ? "Créer et prendre la photo" : "Créer l'activation"}</button>
          <Link href="/marketing/activations" className="btn-ghost">Annuler</Link>
          <span className="text-[11.5px] text-muted basis-full sm:basis-auto">Créée au statut « {refs.statuses.find((s) => s.active)?.label ?? "Idée"} » : elle n&apos;engage aucun budget tant qu&apos;elle n&apos;est pas validée.</span>
        </div>
      </form>
    </>
  );
}
