/**
 * Champs cibles par type d'import + synonymes pour la détection automatique des colonnes.
 * (partagé client / serveur)
 */
import { normKey } from "./normalize";

export type ImportType = "SALES" | "CLIENTS" | "PRODUCTS" | "STOCK" | "OBJECTIVES" | "BUDGETS";

export type FieldDef = { key: string; label: string; required?: boolean; synonyms: string[]; hint?: string };

export const IMPORT_TYPES: { key: ImportType; label: string; description: string }[] = [
  { key: "SALES", label: "Ventes (lignes de facture Sage)", description: "Une ligne par article facturé : date, client, article, quantité, montant HT." },
  { key: "CLIENTS", label: "Clients / correspondances", description: "Référentiel clients ou table de correspondance raison sociale → client fonctionnel." },
  { key: "PRODUCTS", label: "Articles", description: "Référentiel articles : code, désignation, marque, prix." },
  { key: "STOCK", label: "Stock", description: "Photo du stock par article (quantité, prix)." },
  { key: "OBJECTIVES", label: "Objectifs de CA", description: "Objectifs annuels ou mensuels par marque et/ou produit." },
  { key: "BUDGETS", label: "Budgets marketing", description: "Budget annuel par marque, avec répartition par catégorie." },
];

export const FIELDS: Record<ImportType, FieldDef[]> = {
  SALES: [
    { key: "date", label: "Date", required: true, synonyms: ["date lvc", "date", "date facture", "date fac", "date piece", "dt"] },
    { key: "clientName", label: "Client (fonctionnel)", required: true, synonyms: ["client fonctionnel", "client", "nom client", "intitule client", "tiers"] },
    { key: "clientRaw", label: "Raison sociale (brute)", synonyms: ["raison sociale", "raison social", "nom", "client brut"] },
    { key: "clientCode", label: "Code client", synonyms: ["code client", "code tiers", "ct num", "no client", "n client"] },
    { key: "city", label: "Ville", synonyms: ["ville", "city", "localite"] },
    { key: "productName", label: "Désignation article", required: true, synonyms: ["designation", "designation article", "article", "produit", "libelle", "ar design", "nom produit"] },
    { key: "productCode", label: "Code article", synonyms: ["code article", "ar ref", "reference", "ref", "sku", "code produit"] },
    { key: "brand", label: "Marque / gamme", synonyms: ["gamme", "marque", "brand", "famille"] },
    { key: "quantity", label: "Quantité", required: true, synonyms: ["qte", "quantite", "qty", "dl qte", "quantity", "unites"] },
    { key: "amount", label: "Montant HT", required: true, synonyms: ["total ht", "montant ht", "ht", "dl montantht", "net ht total", "ca ht", "chiffre d affaires"] },
    { key: "unitPrice", label: "Prix unitaire net HT", synonyms: ["prix net ht", "prix unitaire ht", "pu ht", "prix unitaire", "dl prixunitaire"] },
    { key: "invoice", label: "N° facture", synonyms: ["facture n", "n facture", "facture", "no facture", "do piece", "piece"] },
    { key: "lvc", label: "N° BL / LVC", synonyms: ["lvc n", "lvc", "bl", "bon de livraison", "n bl"] },
    { key: "site", label: "Site / canal", synonyms: ["site", "canal", "depot", "channel", "societe"] },
    { key: "rep", label: "Représentant", synonyms: ["representant", "commercial", "vendeur", "rep", "co no"] },
    { key: "status", label: "Statut", synonyms: ["statut", "status", "etat"] },
  ],
  CLIENTS: [
    { key: "name", label: "Client fonctionnel", required: true, synonyms: ["client fonctionnel", "client", "nom", "intitule", "raison sociale"] },
    { key: "rawName", label: "Libellé brut (alias)", synonyms: ["clients", "libelle", "alias", "raison sociale brute", "nom brut"] },
    { key: "code", label: "Code client", synonyms: ["code client", "code", "ct num"] },
    { key: "city", label: "Ville", synonyms: ["ville", "city"] },
    { key: "type", label: "Type", synonyms: ["type", "categorie", "type client"] },
    { key: "channel", label: "Canal", synonyms: ["canal", "channel"] },
    { key: "rep", label: "Commercial", synonyms: ["commercial", "representant", "vendeur"] },
    { key: "phone", label: "Téléphone", synonyms: ["telephone", "tel", "phone", "gsm"] },
  ],
  PRODUCTS: [
    { key: "name", label: "Désignation", required: true, synonyms: ["designation", "nom produit", "produit", "article", "libelle", "nom"] },
    { key: "sku", label: "Code article", synonyms: ["code article", "sku", "reference", "ref", "code"] },
    { key: "brand", label: "Marque", synonyms: ["marque", "gamme", "brand"] },
    { key: "category", label: "Catégorie", synonyms: ["categorie", "famille", "category"] },
    { key: "priceRetail", label: "Prix public (PPV)", synonyms: ["ppv", "prix public", "pvc", "prix de vente public"] },
    { key: "priceWholesale", label: "Prix pharmacien (PPH)", synonyms: ["pph", "prix de vente pph", "prix pharmacien", "prix de vente", "prix ht"] },
    { key: "costPrice", label: "Prix d'achat / coût", synonyms: ["cr", "cout de revient", "prix d achat", "prix d achat exwork", "exwork", "val achats", "cout"] },
    { key: "leadTime", label: "Lead time (jours)", synonyms: ["lead time", "delai", "delai fournisseur"] },
    { key: "moq", label: "MOQ", synonyms: ["moq", "minimum de commande"] },
  ],
  STOCK: [
    { key: "productName", label: "Nom produit", required: true, synonyms: ["nom produit", "designation", "produit", "article", "libelle"] },
    { key: "sku", label: "Code article", synonyms: ["code article", "sku", "reference", "ref"] },
    { key: "brand", label: "Marque", synonyms: ["marque", "gamme", "brand"] },
    { key: "quantity", label: "Stock (unités)", required: true, synonyms: ["stock apres", "stock", "quantite", "qte", "stock reel", "stock disponible", "quantity"] },
    { key: "onOrder", label: "Commande fournisseur en cours", synonyms: ["en cours", "commande en cours", "on order", "attendu"] },
    { key: "priceWholesale", label: "Prix pharmacien (PPH)", synonyms: ["pph", "prix de vente"] },
    { key: "costPrice", label: "Coût de revient", synonyms: ["cr", "cout de revient", "val achats", "prix d achat"] },
    { key: "date", label: "Date de la photo", synonyms: ["date", "date stock"] },
  ],
  OBJECTIVES: [
    { key: "brand", label: "Marque", required: true, synonyms: ["marque", "brand", "gamme"] },
    { key: "productName", label: "Produit (facultatif)", synonyms: ["produit", "designation", "article", "nom produit"] },
    { key: "amount", label: "Objectif CA HT", required: true, synonyms: ["objectif ca 2026", "objectif ca", "objectif", "ca", "montant", "objectif ca ht"] },
    { key: "units", label: "Unités", synonyms: ["unites 2026", "unites", "quantite", "qte", "volume"] },
    { key: "priceWholesale", label: "Prix de vente (PPH)", synonyms: ["prix de vente pph", "pph", "prix de vente"] },
    { key: "costPrice", label: "Prix d'achat", synonyms: ["prix d achat exwork", "prix d achat", "exwork", "cr"] },
    { key: "month", label: "Mois (1-12, facultatif)", synonyms: ["mois", "month"] },
    { key: "year", label: "Année", synonyms: ["annee", "year", "exercice"] },
  ],
  BUDGETS: [
    { key: "brand", label: "Marque", required: true, synonyms: ["marque", "brand"] },
    { key: "label", label: "Catégorie / libellé", synonyms: ["categorie", "libelle", "poste", "category"] },
    { key: "amount", label: "Montant", required: true, synonyms: ["budget alloue", "total budget marketing", "montant", "budget", "amount"] },
    { key: "referenceRevenue", label: "CA de référence", synonyms: ["ca de reference", "ca de reference feuille m", "ca reference", "ca"] },
    { key: "pct", label: "% budget / CA", synonyms: ["budget marketing prevu", "pct", "%"] },
    { key: "year", label: "Année", synonyms: ["annee", "year", "exercice"] },
  ],
};

/** Détection automatique : header normalisé ↔ synonymes. */
export function autoMap(type: ImportType, headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const used = new Set<string>();
  const normHeaders = headers.map((h) => normKey(h));
  for (const f of FIELDS[type]) {
    let found: string | undefined;
    for (const syn of f.synonyms) {
      const s = normKey(syn);
      const idx = normHeaders.findIndex((h, i) => h === s && !used.has(headers[i]));
      if (idx >= 0) { found = headers[idx]; break; }
    }
    if (!found) {
      for (const syn of f.synonyms) {
        const s = normKey(syn);
        const idx = normHeaders.findIndex((h, i) => s.length >= 3 && (h.startsWith(s) || h.includes(" " + s)) && !used.has(headers[i]));
        if (idx >= 0) { found = headers[idx]; break; }
      }
    }
    if (found) { mapping[f.key] = found; used.add(found); }
  }
  return mapping;
}

export function missingRequired(type: ImportType, mapping: Record<string, string>) {
  return FIELDS[type].filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
}
