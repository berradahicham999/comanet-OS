/** Questions suggérées selon la page courante (partagé client / serveur, aucune dépendance). */

const BY_PREFIX: [string, string[]][] = [
  ["/marketing/budgets", ["Où est-ce qu'on surconsomme le budget cette année ?", "Quelles marques ont dépensé plus de 90 % de leur enveloppe ?", "Combien reste-t-il sur le budget Gamarde ?"]],
  ["/marketing/ads", ["Quelles campagnes sont en STOP ou OPTIMIZE ce mois-ci et pourquoi ?", "Quel est le coût par conversation par marque sur 30 jours ?", "Les campagnes à scaler poussent-elles des produits en tension de stock ?"]],
  ["/marketing/analytics", ["Quel canal marche le mieux pour Gamarde ce trimestre ?", "Quels produits sont poussés sans effet sur le sell-in ?"]],
  ["/marketing", ["Résume l'état du marketing ce mois-ci : budget, campagnes, contenus en retard.", "Quelles marques sont sur-investies par rapport à leur part de CA ?"]],
  ["/terrain", ["Quelles animatrices sont sous l'objectif ce mois-ci et pourquoi ?", "Quels produits se vendent le mieux en animation sur 30 jours ?", "Quelles villes atteignent leur objectif d'unités ?"]],
  ["/stock", ["Quelles références risquent la rupture dans les 30 jours ?", "Combien de mois de stock sur Alphascience ?", "Quel est le surstock à écouler ?"]],
  ["/clients", ["Quels clients n'ont pas commandé depuis 90 jours ?", "Quels clients à fort potentiel sont en baisse ?", "Quels clients ont dépassé leur date de commande théorique ?"]],
  ["/ventes", ["CA Gamarde à Marrakech en août vs juillet ?", "Quelles marques sont en retard sur leur objectif du mois ?", "Top 10 des produits du mois en sell-in."]],
  ["/reglementaire", ["Quels dossiers expirent dans les 90 jours ?", "Quels dossiers sont bloqués ou non déposés ?"]],
  ["/actions", ["Quelles sont les trois actions critiques à traiter aujourd'hui ?", "Quelles recommandations touchent Gamarde ?"]],
  ["/taches", ["Quelles tâches sont en retard et à qui sont-elles assignées ?", "Quelles tâches le copilote a-t-il proposées ?"]],
  ["/produits", ["Quels produits ont la meilleure croissance sell-in ce trimestre ?", "Quels produits dormants ont du stock ?"]],
  ["/marques", ["Quelle marque a le plus progressé ce mois-ci en sell-in ?", "Quelle marque est la plus sous-investie ?"]],
];

const DEFAULT = ["Qu'est-ce qui a bougé cette semaine ?", "Qu'est-ce qui est à risque aujourd'hui : stock, réglementaire, clients, budget ?", "Quelles sont les trois actions du jour ?"];

export function suggestionsFor(pathname: string | null | undefined): string[] {
  if (!pathname) return DEFAULT;
  const hit = BY_PREFIX.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + "/") || (prefix !== "/marketing" && pathname.startsWith(prefix)));
  return hit ? hit[1] : DEFAULT;
}

/** Module de la matrice correspondant à une page, pour titrer la conversation. */
export function moduleForPath(pathname: string | null | undefined): string | null {
  if (!pathname || pathname === "/") return "cockpit";
  const seg = pathname.split("/")[1];
  return seg || null;
}
