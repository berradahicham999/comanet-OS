/**
 * Champs cibles par type d'import + synonymes pour la détection automatique des colonnes.
 * (partagé client / serveur)
 */
import { normKey } from "./normalize";
import type { ModuleKey } from "@/lib/access-shared";

export type ImportType = "SALES" | "CLIENTS" | "PRODUCTS" | "STOCK" | "OBJECTIVES" | "BUDGETS" | "REGULATORY" | "ANIMATIONS" | "ANIM_OBJECTIVES" | "ADS" | "MEDECINS" | "INVENTORY" | "INFLUENCERS" | "STOCK_INITIAL";

/**
 * Module dont relève chaque type d'import : importer = droit « Créer » sur ce module,
 * annuler = droit « Valider ». La configuration du moteur reste en Administration.
 */
export const IMPORT_MODULE: Record<ImportType, ModuleKey> = {
  SALES: "ventes",
  CLIENTS: "clients",
  PRODUCTS: "produits",
  STOCK: "stock",
  OBJECTIVES: "ventes",
  BUDGETS: "budgets",
  REGULATORY: "reglementaire",
  ANIMATIONS: "terrain",
  ANIM_OBJECTIVES: "terrain",
  ADS: "marketing",
  MEDECINS: "medical",
  INVENTORY: "marketing",
  INFLUENCERS: "influence",
  STOCK_INITIAL: "stock",
};

export type FieldDef = { key: string; label: string; required?: boolean; synonyms: string[]; hint?: string };

export const IMPORT_TYPES: { key: ImportType; label: string; description: string }[] = [
  { key: "SALES", label: "Ventes (lignes de facture Sage)", description: "Une ligne par article facturé : date, client, article, quantité, montant HT." },
  { key: "CLIENTS", label: "Clients / correspondances", description: "Référentiel clients ou table de correspondance raison sociale → client fonctionnel." },
  { key: "PRODUCTS", label: "Articles", description: "Référentiel articles : code, désignation, marque, prix." },
  { key: "STOCK", label: "Stock (photo)", description: "Photo du stock par article (quantité, prix). Choisissez le dépôt photographié : Cospharma, Pharmafirst, ou photo globale." },
  { key: "STOCK_INITIAL", label: "Stock initial (journal)", description: "Point de départ du journal de stock COMANET : une ligne par article et par lot, avec quantité et coût unitaire. Recharger le même fichier ne double rien ; l'annulation passe par des contre-mouvements." },
  { key: "OBJECTIVES", label: "Objectifs de CA", description: "Objectifs annuels ou mensuels par marque et/ou produit." },
  { key: "BUDGETS", label: "Budgets marketing", description: "Budget annuel par marque, avec répartition par catégorie." },
  { key: "REGULATORY", label: "Dossiers réglementaires", description: "Enregistrements DMP : une ligne par variante déposée (marque, référence, type, contenance, ATD, validité)." },
  { key: "ANIMATIONS", label: "Animations POS (feuille quotidienne)", description: "Matrice « Données Journalières » : une ligne par jour × point de vente × animatrice, une colonne par produit. Les colonnes non identifiées sont lues comme des produits." },
  { key: "ANIM_OBJECTIVES", label: "Objectifs animation par ville", description: "Tableau croisé ville × marque (unités par an). Choisir la ligne d'en-tête du bloc YEARLY ; l'objectif mensuel est calculé automatiquement." },
  { key: "ADS", label: "Publicités (Meta / TikTok / Google)", description: "Export de la régie : une ligne par jour × campagne (ou par publicité). Dépense, impressions, clics, achats, CA." },
  { key: "MEDECINS", label: "Médecins (référentiel)", description: "Référentiel des médecins visités : identité, spécialité, ville, secteur, délégué responsable." },
  { key: "INVENTORY", label: "Inventaire matériel (PLV, échantillons, goodies)", description: "Inventaire initial du matériel marketing : une ligne par article avec catégorie, marque, quantité en stock, coût unitaire et seuil d'alerte." },
  { key: "INFLUENCERS", label: "Influenceuses (répertoire)", description: "Liste d'influenceuses déjà identifiées : réseaux, audience, catégorie, ville, tarif habituel, contact. Recharger le même fichier met à jour les fiches (rapprochées par nom), sans dupliquer." },
];

export const FIELDS: Record<ImportType, FieldDef[]> = {
  INFLUENCERS: [
    { key: "name", label: "Nom", required: true, synonyms: ["nom", "influenceuse", "influenceur", "name", "nom complet", "profil"] },
    { key: "instagram", label: "Instagram", synonyms: ["instagram", "insta", "compte instagram", "ig", "compte ig"] },
    { key: "tiktok", label: "TikTok", synonyms: ["tiktok", "tik tok", "compte tiktok"] },
    { key: "followers", label: "Abonnés", synonyms: ["abonnes", "followers", "nombre d abonnes", "audience", "communaute"] },
    { key: "engagementRate", label: "Taux d'engagement (%)", synonyms: ["taux d engagement", "engagement", "taux engagement", "er", "taux d engagement %"] },
    { key: "category", label: "Catégorie", synonyms: ["categorie", "niche", "domaine", "category", "thematique"] },
    { key: "city", label: "Ville", synonyms: ["ville", "city", "localite"] },
    { key: "usualRate", label: "Tarif habituel (MAD)", synonyms: ["tarif", "tarif habituel", "cachet", "prix", "rate", "tarif mad"] },
    { key: "contact", label: "Contact (téléphone / e-mail)", synonyms: ["contact", "telephone", "tel", "gsm", "email", "e mail", "whatsapp"] },
    { key: "notes", label: "Notes", synonyms: ["notes", "remarque", "remarques", "commentaire", "commentaires"] },
  ],
  INVENTORY: [
    { key: "name", label: "Article", required: true, synonyms: ["article", "designation", "nom", "libelle", "materiel", "item"] },
    { key: "category", label: "Catégorie (PLV / échantillon / goodie / print)", synonyms: ["categorie", "type", "famille", "category"], hint: "Vide : PLV." },
    { key: "brand", label: "Marque", synonyms: ["marque", "brand", "gamme"] },
    { key: "productName", label: "Produit lié (facultatif)", synonyms: ["produit", "produit lie", "product"] },
    { key: "sku", label: "Référence", synonyms: ["reference", "ref", "sku", "code"] },
    { key: "quantity", label: "Stock (unités)", required: true, synonyms: ["stock", "quantite", "qte", "quantity", "unites", "en stock"] },
    { key: "unitCost", label: "Coût unitaire (MAD)", synonyms: ["cout unitaire", "prix unitaire", "cout", "pu", "unit cost", "valeur unitaire"] },
    { key: "unit", label: "Unité", synonyms: ["unite", "unit", "conditionnement"], hint: "pièce, lot, carton…" },
    { key: "alertThreshold", label: "Seuil d'alerte", synonyms: ["seuil", "seuil d alerte", "stock mini", "minimum", "alerte"] },
    { key: "location", label: "Emplacement", synonyms: ["emplacement", "lieu", "depot", "stockage"] },
  ],
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
    { key: "accountCode", label: "Code client Sage COMANET", synonyms: ["code client sage", "code sage", "code tiers comanet", "numero client"], hint: "Ex. 056 — rapprochement prioritaire." },
    { key: "legalName", label: "Raison sociale (facturation)", synonyms: ["raison sociale facturation", "ct intitule", "denomination", "raison sociale legale"] },
    { key: "ice", label: "ICE", synonyms: ["ice", "identifiant commun", "ct identifiant", "n ice"] },
    { key: "ifNumber", label: "Identifiant fiscal (IF)", synonyms: ["if", "identifiant fiscal", "i f"] },
    { key: "rc", label: "RC", synonyms: ["rc", "registre de commerce", "registre du commerce"] },
    { key: "patente", label: "Patente / TP", synonyms: ["patente", "tp", "taxe professionnelle"] },
    { key: "address", label: "Adresse de facturation", synonyms: ["adresse", "adresse facturation", "ct adresse", "address"] },
    { key: "postalCode", label: "Code postal", synonyms: ["code postal", "cp", "ct codepostal"] },
    { key: "email", label: "E-mail", synonyms: ["email", "e mail", "mail", "courriel"] },
    { key: "contact", label: "Contact", synonyms: ["contact", "interlocuteur", "ct contact"] },
    { key: "paymentDays", label: "Délai de paiement (jours)", synonyms: ["delai de paiement", "delai paiement", "echeance jours", "jours"] },
    { key: "discountPct", label: "Remise par défaut (%)", synonyms: ["remise", "remise %", "taux de remise", "remise client"] },
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
    { key: "code", label: "Réf. COMANET (Sage)", synonyms: ["ref comanet", "reference comanet", "ar ref comanet", "ref sage"], hint: "Ex. CYG01 — la référence imprimée sur les factures COMANET." },
    { key: "ean", label: "Code-barres EAN", synonyms: ["ean", "code barre", "code barres", "gencod", "ean13", "code ean"] },
    { key: "taxRate", label: "Taux de TVA (%)", synonyms: ["tva", "taux tva", "taux de tva", "tva %"] },
    { key: "unit", label: "Unité", synonyms: ["unite", "unit", "unite de vente"] },
    { key: "packSize", label: "Colisage", synonyms: ["colisage", "pcb", "unites par carton", "conditionnement"] },
  ],
  STOCK_INITIAL: [
    { key: "productCode", label: "Réf. COMANET / EAN / code article", synonyms: ["ref comanet", "reference", "ref", "code article", "code", "ean", "code barre", "ar ref"], hint: "Rapprochement : réf. COMANET, puis EAN, puis code distributeur." },
    { key: "productName", label: "Désignation", synonyms: ["designation", "produit", "article", "libelle", "nom produit"], hint: "Utilisée si le code manque." },
    { key: "lot", label: "N° de lot", synonyms: ["lot", "n lot", "numero de lot", "batch"] },
    { key: "expiry", label: "Date de péremption", synonyms: ["peremption", "date de peremption", "dlu", "dluo", "expiration", "date d expiration", "exp"] },
    { key: "quantity", label: "Quantité", required: true, synonyms: ["quantite", "qte", "stock", "quantity", "unites"] },
    { key: "unitCost", label: "Coût unitaire HT (MAD)", required: true, synonyms: ["cout unitaire", "cout de revient", "cr", "prix d achat", "pa", "cmup", "cump", "valeur unitaire"] },
    { key: "warehouse", label: "Dépôt", synonyms: ["depot", "emplacement", "magasin", "entrepot"], hint: "Vide : dépôt choisi à l'import (Entrepôt COMANET par défaut)." },
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
  ADS: [
    { key: "date", label: "Date", required: true, synonyms: ["date", "jour", "day", "reporting starts", "date de debut des rapports", "date du rapport"] },
    { key: "campaign", label: "Campagne", required: true, synonyms: ["campaign name", "nom de la campagne", "campagne", "campaign"] },
    { key: "adset", label: "Ensemble de publicités", synonyms: ["ad set name", "nom de l ensemble de publicites", "adset", "ad set", "groupe d annonces"] },
    { key: "ad", label: "Publicité / créative", synonyms: ["ad name", "nom de la publicite", "publicite", "ad", "annonce", "creative"] },
    { key: "brand", label: "Marque", synonyms: ["marque", "brand"], hint: "Sinon déduite du nom de la campagne." },
    { key: "spend", label: "Dépense", required: true, synonyms: ["amount spent", "montant depense", "depense", "spend", "cost", "cout"] },
    { key: "impressions", label: "Impressions", synonyms: ["impressions", "impr"] },
    { key: "reach", label: "Couverture", synonyms: ["reach", "couverture", "portee"] },
    { key: "clicks", label: "Clics", synonyms: ["clicks all", "clics tous", "clicks", "clics"] },
    { key: "linkClicks", label: "Clics sur le lien", synonyms: ["link clicks", "clics sur un lien", "clics sur le lien"] },
    { key: "landingPageViews", label: "Vues de page de destination", synonyms: ["landing page views", "vues de page de destination"] },
    { key: "leads", label: "Leads", synonyms: ["leads", "prospects", "results", "resultats"] },
    { key: "purchases", label: "Achats / conversions", synonyms: ["purchases", "achats", "conversions", "website purchases"] },
    { key: "revenue", label: "CA attribué", synonyms: ["purchases conversion value", "valeur de conversion des achats", "revenue", "ca", "conversion value", "valeur de conversion"] },
    { key: "platform", label: "Plateforme", synonyms: ["platform", "plateforme", "source", "reseau"], hint: "META, TIKTOK ou GOOGLE — sinon choisie ci-dessous." },
    { key: "account", label: "Compte publicitaire", synonyms: ["account name", "nom du compte", "compte", "account"] },
  ],
  ANIMATIONS: [
    { key: "date", label: "Date", required: true, synonyms: ["date", "jour", "date animation"] },
    { key: "city", label: "Ville", required: true, synonyms: ["ville", "city", "localite"] },
    { key: "pos", label: "Point de vente", required: true, synonyms: ["nom du pos", "pos", "point de vente", "pharmacie", "parapharmacie", "client"] },
    { key: "animatrice", label: "Animatrice", required: true, synonyms: ["nom de l animatrice", "animatrice", "nom animatrice", "promotrice"] },
    { key: "days", label: "Nombre de jours d'animation", synonyms: ["nb jour animation", "nb jours", "jours", "nombre de jours"] },
    { key: "month", label: "Mois (colonne à ignorer)", synonyms: ["mois", "month"], hint: "Colonne de repère du classeur : mappez-la pour qu'elle ne soit pas lue comme un produit." },
    { key: "year", label: "Année (colonne à ignorer)", synonyms: ["annee", "year", "exercice"], hint: "Idem : simple repère, non traité comme un produit." },
    { key: "customers", label: "Clientes conseillées", synonyms: ["clientes conseillees", "clientes", "contacts", "passages"] },
    { key: "cost", label: "Coût de l'animation", synonyms: ["cout", "cout animation", "budget"] },
    { key: "comment", label: "Commentaire", synonyms: ["commentaire", "remarque", "observation"] },
  ],
  ANIM_OBJECTIVES: [
    { key: "city", label: "Ville", required: true, synonyms: ["ville", "city", "column1", "localite"] },
  ],
  REGULATORY: [
    { key: "brand", label: "Marque", required: true, synonyms: ["marque", "brand", "gamme"] },
    { key: "reference", label: "Référence / produit", required: true, synonyms: ["reference", "produit", "designation", "article", "nom produit", "libelle"] },
    { key: "variantType", label: "Type de dépôt", synonyms: ["type", "type de depot", "modele"], hint: "Modèle vente, Échantillon, Minidose, Travel size…" },
    { key: "size", label: "Contenance", synonyms: ["contenance", "volume", "poids", "format ml"] },
    { key: "packaging", label: "Format / conditionnement", synonyms: ["format", "conditionnement", "packaging"] },
    { key: "state", label: "État", synonyms: ["etat", "statut", "status", "enregistre"], hint: "Enregistré / Non" },
    { key: "documentType", label: "Document", synonyms: ["document", "piece", "type document"], hint: "ATD, attestation de dépôt, CE…" },
    { key: "filingDate", label: "Date de dépôt DMP", synonyms: ["date depot dmp", "date depot", "date de depot", "depot", "date"] },
    { key: "expiryDate", label: "Validité (expiration)", synonyms: ["validite", "date validite", "expiration", "date expiration", "fin de validite"] },
    { key: "authorizationNumber", label: "N° ATD / autorisation", synonyms: ["n atd", "atd", "numero", "n autorisation", "autorisation"] },
    { key: "physicalProduct", label: "Produit physique", synonyms: ["produit physique", "echantillon physique", "physique"] },
    { key: "observation", label: "Observation (étape CE)", synonyms: ["observation", "observations", "etape", "commentaire ce"] },
    { key: "notes", label: "Notes / remarques", synonyms: ["remarque", "remarques", "note", "notes", "commentaire", "commentaires"] },
  ],
  MEDECINS: [
    { key: "firstName", label: "Prénom", required: true, synonyms: ["prenom", "first name", "prenom medecin"] },
    { key: "lastName", label: "Nom", required: true, synonyms: ["nom", "last name", "nom medecin", "nom du medecin"] },
    { key: "phone", label: "Téléphone", synonyms: ["telephone", "tel", "gsm", "phone"] },
    { key: "email", label: "Email", synonyms: ["email", "mail", "e mail"] },
    { key: "specialty", label: "Spécialité", synonyms: ["specialite", "specialty"] },
    { key: "subSpecialty", label: "Sous-spécialité", synonyms: ["sous specialite", "sous-specialite"] },
    { key: "addressLine", label: "Adresse cabinet", synonyms: ["adresse", "adresse cabinet", "cabinet"] },
    { key: "city", label: "Ville", required: true, synonyms: ["ville", "city", "localite"] },
    { key: "sector", label: "Secteur", synonyms: ["secteur", "zone", "sector"] },
    { key: "delegate", label: "Délégué responsable", synonyms: ["delegue", "delegue medical", "delegue responsable", "representant"] },
    { key: "comments", label: "Commentaires", synonyms: ["commentaire", "commentaires", "remarque", "notes"] },
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
  // Feuilles réglementaires : la colonne sans en-tête en fin de tableau est la colonne de remarques libres
  // (elle porte les motifs de blocage) — on la rattache aux notes plutôt que de la perdre.
  if (type === "REGULATORY" && !mapping.notes) {
    const unnamed = headers.find((h) => /^col_\d+$/.test(h) && !used.has(h));
    if (unnamed) { mapping.notes = unnamed; used.add(unnamed); }
  }
  return mapping;
}

/**
 * Colonnes de la matrice « Données Journalières » qui ne sont PAS des produits :
 * totaux calculés par le classeur, à ignorer à l'import.
 */
export function isComputedColumn(header: string) {
  const k = normKey(header); // MAJUSCULES sans accents
  if (!k) return true;
  if (/^COL \d+$/.test(k)) return true;
  return (
    k.startsWith("TOTAL") ||
    k.startsWith("SOMME") ||
    k.startsWith("SUM OF") ||
    k === "VENTES DU JOUR" ||
    k === "CA" ||
    k.startsWith("CA TTC") ||
    k.startsWith("REMISE") ||
    k.startsWith("GRAND TOTAL") ||
    // repères de date présents dans les classeurs de suivi
    ["MOIS", "ANNEE", "SEMAINE", "TRIMESTRE", "JOUR", "DATE", "VILLE"].includes(k)
  );
}

export function missingRequired(type: ImportType, mapping: Record<string, string>) {
  return FIELDS[type].filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
}
