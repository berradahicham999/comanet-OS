/**
 * COMANET OS — modèle de données central.
 *
 * Principes :
 *  - Sage reste la source de vérité : les tables `sales`, `clients`, `products`,
 *    `stock_snapshots` sont ALIMENTÉES par import et jamais renvoyées vers Sage.
 *  - Identifiants UUID stables sur toutes les entités.
 *  - Aucune règle métier ici : les seuils vivent dans `settings`,
 *    les règles dans `src/lib/rules`.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  integer,
  numeric,
  boolean,
  date,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  customType,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

export const userRoleEnum = pgEnum("user_role", [
  "ADMIN",
  "MARKETING",
  "REGLEMENTAIRE",
  "TRADE",
  "ANIMATRICE",
]);

export const clientTypeEnum = pgEnum("client_type", [
  "PHARMACIE",
  "PARAPHARMACIE",
  "GROSSISTE",
  "AUTRE",
]);

export const importTypeEnum = pgEnum("import_type", [
  "SALES",
  "CLIENTS",
  "PRODUCTS",
  "STOCK",
  "OBJECTIVES",
  "BUDGETS",
  "REGULATORY",
  "ANIMATIONS",
  "ANIM_OBJECTIVES",
  "ADS",
]);

export const importStatusEnum = pgEnum("import_status", [
  "PENDING",
  "DONE",
  "FAILED",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "TODO",
  "IN_PROGRESS",
  "DONE",
  "CANCELLED",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);

export const taskSourceEnum = pgEnum("task_source", [
  "MANUAL",
  "ACTION_CENTER",
  "REGLEMENTAIRE",
  "STOCK",
  "MARKETING",
  "TERRAIN",
  "COMMERCIAL",
]);

export const regulatoryStatusEnum = pgEnum("regulatory_status", [
  "A_DEPOSER",
  "EN_COURS",
  "VALIDE",
  "RENOUVELLEMENT",
  "EXPIRE",
]);

export const budgetCategoryEnum = pgEnum("budget_category", [
  "META",
  "TIKTOK",
  "GOOGLE",
  "DIGITAL",
  "INFLUENCE",
  "UGC",
  "CREATION",
  "SHOOTING",
  "EVENEMENT",
  "SPONSORING",
  "TRADE",
  "PLV",
  "ANIMATION",
  "GOODIES",
  "ECHANTILLONS",
  "PRESCRIPTEURS",
  "CONGRES",
  "AGENCE",
  "AUTRES",
]);

export const expenseStatusEnum = pgEnum("expense_status", [
  "PLANNED",
  "COMMITTED",
  "SPENT",
]);

export const contentStatusEnum = pgEnum("content_status", [
  "IDEE",
  "BRIEF",
  "CREATION",
  "VALIDATION",
  "PROGRAMME",
  "PUBLIE",
  "ANALYSE",
]);

export const animationStatusEnum = pgEnum("animation_status", [
  "PLANNED",
  "DONE",
  "CANCELLED",
]);

export const campaignChannelEnum = pgEnum("campaign_channel", [
  "META",
  "TIKTOK",
  "GOOGLE",
  "INFLUENCE",
  "TRADE",
  "EVENEMENT",
  "AUTRE",
]);

export const campaignStatusEnum = pgEnum("campaign_status", ["DRAFT", "PLANNED", "ACTIVE", "PAUSED", "DONE", "ANALYZED"]);

/* ------------------------------------------------------------------ */
/* Collaborateurs                                                      */
/* ------------------------------------------------------------------ */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("TRADE"),
  /** Ville de rattachement (animatrices : sert au rapprochement avec les objectifs par ville). */
  city: text("city"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Marques & produits                                                  */
/* ------------------------------------------------------------------ */

export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  color: text("color").notNull().default("#0f766e"),
  aliases: jsonb("aliases").$type<string[]>().notNull().default([]), // ex: CYGNE, CYGNE LAB pour CygneLab
  active: boolean("active").notNull().default(true),
  positioning: text("positioning"),
  target: text("target"),
  objectives: text("objectives"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    sku: text("sku"), // code article Sage (facultatif : absent sur certaines sources)
    nameKey: text("name_key").notNull().unique(), // désignation canonique normalisée
    name: text("name").notNull(), // désignation canonique (affichage)
    shortName: text("short_name"), // nom court (ex: fiche stock)
    category: text("category"),
    priceRetail: numeric("price_retail", { precision: 12, scale: 2 }), // PVC
    priceWholesale: numeric("price_wholesale", { precision: 12, scale: 2 }), // prix COMANET → client
    costPrice: numeric("cost_price", { precision: 12, scale: 2 }), // prix d'achat
    leadTimeDays: integer("lead_time_days").notNull().default(60),
    moq: integer("moq"),
    safetyStockDays: integer("safety_stock_days").notNull().default(30),
    active: boolean("active").notNull().default(true),
    needsReview: boolean("needs_review").notNull().default(false), // créé automatiquement par import
    benefits: text("benefits"),
    claims: text("claims"),
    actives: text("actives"),
    target: text("target"),
    marketingAngle: text("marketing_angle"),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("products_brand_idx").on(t.brandId), uniqueIndex("products_sku_uq").on(t.sku).where(sql`sku is not null`)],
);

/** Variantes de désignation (ventes, stock, objectifs…) rattachées à un produit canonique. */
export const productAliases = pgTable(
  "product_aliases",
  {
    alias: text("alias").primaryKey(), // désignation normalisée
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("IMPORT"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("product_aliases_product_idx").on(t.productId)],
);

/* ------------------------------------------------------------------ */
/* Clients (= points de vente)                                         */
/* ------------------------------------------------------------------ */

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code"), // code client Sage (facultatif)
    nameKey: text("name_key").notNull().unique(), // nom fonctionnel normalisé
    name: text("name").notNull(), // client fonctionnel (affichage)
    type: clientTypeEnum("type").notNull().default("AUTRE"),
    city: text("city"),
    channel: text("channel"), // ex: pharmacie / parapharmacie / grossiste / e-commerce
    salesRep: text("sales_rep"), // commercial
    phone: text("phone"),
    active: boolean("active").notNull().default(true),
    needsReview: boolean("needs_review").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("clients_city_idx").on(t.city), index("clients_rep_idx").on(t.salesRep), index("clients_code_idx").on(t.code)],
);

/** Raisons sociales / libellés bruts rattachés à un client fonctionnel. */
export const clientAliases = pgTable(
  "client_aliases",
  {
    alias: text("alias").primaryKey(), // raison sociale normalisée
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("IMPORT"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("client_aliases_client_idx").on(t.clientId)],
);

/* ------------------------------------------------------------------ */
/* Imports Sage                                                        */
/* ------------------------------------------------------------------ */

export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: importTypeEnum("type").notNull(),
    fileName: text("file_name").notNull(),
    mapping: jsonb("mapping").$type<Record<string, string>>().notNull(),
    totalRows: integer("total_rows").notNull().default(0),
    insertedRows: integer("inserted_rows").notNull().default(0),
    updatedRows: integer("updated_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    errorRows: integer("error_rows").notNull().default(0),
    errors: jsonb("errors").$type<{ row: number; message: string }[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    status: importStatusEnum("status").notNull().default("PENDING"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("imports_user_idx").on(t.userId)],
);

/** Fichiers téléversés en attente de mapping (stockés en base pour fonctionner sans disque persistant). */
export const importFiles = pgTable(
  "import_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    data: customType<{ data: Buffer; driverData: Buffer }>({ dataType() { return "bytea"; } })("data").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("import_files_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ */
/* Ventes (sell-in Sage)                                               */
/* ------------------------------------------------------------------ */

export const sales = pgTable(
  "sales",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(), // HT, MAD
    invoiceRef: text("invoice_ref"),
    lvcRef: text("lvc_ref"), // n° de bon de livraison
    site: text("site"), // canal / site de facturation (COS, CAS, COMANET, PHARMAFIRST…)
    salesRep: text("sales_rep"),
    unitPrice: numeric("unit_price", { precision: 12, scale: 4 }),
    rawClient: text("raw_client"), // raison sociale d'origine
    rawProduct: text("raw_product"), // désignation d'origine
    lineHash: text("line_hash").notNull(), // détection des doublons
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sales_line_hash_uq").on(t.lineHash),
    index("sales_date_idx").on(t.date),
    index("sales_client_idx").on(t.clientId),
    index("sales_product_idx").on(t.productId),
    index("sales_site_idx").on(t.site),
    index("sales_import_idx").on(t.importId),
  ],
);

/* ------------------------------------------------------------------ */
/* Stock                                                               */
/* ------------------------------------------------------------------ */

export const stockSnapshots = pgTable(
  "stock_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: numeric("quantity", { precision: 12, scale: 2 }).notNull(),
    onOrder: numeric("on_order", { precision: 12, scale: 2 }).notNull().default("0"), // commande fournisseur en cours
    date: date("date").notNull(),
    source: text("source").notNull().default("IMPORT"),
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stock_product_date_idx").on(t.productId, t.date), index("stock_snapshots_import_idx").on(t.importId)],
);

/* ------------------------------------------------------------------ */
/* Terrain : animations & saisies animatrices                          */
/* ------------------------------------------------------------------ */

export const animations = pgTable(
  "animations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    animatriceId: uuid("animatrice_id").references(() => users.id, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    status: animationStatusEnum("status").notNull().default("PLANNED"),
    /** Nombre de jours d'animation couverts par la ligne (colonne « NB JOUR ANIMATION »). */
    days: integer("days").notNull().default(1),
    /** Ville dénormalisée (celle du point de vente au moment de l'animation). */
    city: text("city"),
    cost: numeric("cost", { precision: 12, scale: 2 }).notNull().default("0"),
    durationHours: numeric("duration_hours", { precision: 5, scale: 1 }),
    customersAdvised: integer("customers_advised").notNull().default(0),
    samples: integer("samples").notNull().default(0),
    comment: text("comment"),
    photoUrl: text("photo_url"),
    /** Identité d'une ligne du fichier quotidien : date | ville | point de vente | animatrice. */
    dedupeKey: text("dedupe_key"),
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("animations_date_idx").on(t.date),
    index("animations_city_idx").on(t.city),
    uniqueIndex("animations_dedupe_uq").on(t.dedupeKey).where(sql`dedupe_key is not null`),
    index("animations_client_idx").on(t.clientId),
    index("animations_animatrice_idx").on(t.animatriceId),
    index("animations_brand_idx").on(t.brandId),
    index("animations_import_idx").on(t.importId),
  ],
);

export const animationLines = pgTable(
  "animation_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    animationId: uuid("animation_id")
      .notNull()
      .references(() => animations.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantitySold: integer("quantity_sold").notNull().default(0), // sell-out constaté
    /** Prix unitaire TTC appliqué (repris du fichier d'animation, sinon prix public du produit). */
    unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
    /** Valeur TTC de la ligne = quantité × prix unitaire. */
    amount: numeric("amount", { precision: 14, scale: 2 }),
    stockObserved: integer("stock_observed"), // stock rayon constaté
  },
  (t) => [index("animation_lines_animation_idx").on(t.animationId)],
);

/* ------------------------------------------------------------------ */
/* Réglementaire                                                       */
/* ------------------------------------------------------------------ */

/** Objectifs de sell-out animation, par marque × ville. `month` nul = objectif annuel. */
export const animationObjectives = pgTable(
  "animation_objectives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    city: text("city").notNull(),
    year: integer("year").notNull(),
    month: integer("month"),
    units: numeric("units", { precision: 12, scale: 2 }).notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("animation_objectives_uq").on(t.brandId, t.city, t.year, sql`coalesce(${t.month}, 0)`)],
);

export const regulatoryFiles = pgTable(
  "regulatory_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    dossier: text("dossier").notNull(), // libellé du dossier (ex: Enregistrement produit cosmétique DMP)
    /** Référence telle que déposée (utile quand aucun produit du référentiel n'est lié). */
    reference: text("reference"),
    /** MODELE_VENTE | ECHANTILLON | MINIDOSE | TRAVEL_SIZE | DECLARATION | TRANSFERT | AUTRE */
    variantType: text("variant_type").notNull().default("MODELE_VENTE"),
    /** Contenance déposée : « 30 ml », « 40 g »… (une contenance = un dossier). */
    size: text("size"),
    /** Format / conditionnement normalisé : TUBE, FLACON, POT, SACHET, SPRAY… */
    packaging: text("packaging"),
    /** Pièce délivrée : ATD (attestation de dépôt) | CE | ATTESTATION | TRANSFERT | AUCUN */
    documentType: text("document_type").notNull().default("ATD"),
    authorizationNumber: text("authorization_number"), // n° ATD
    filingDate: date("filing_date"), // date de dépôt DMP
    validationDate: date("validation_date"),
    expiryDate: date("expiry_date"), // fin de validité de l'ATD
    status: regulatoryStatusEnum("status").notNull().default("EN_COURS"),
    /** Étape Certificat d'Enregistrement : NON_APPLICABLE | A_DEMANDER | EN_ATTENTE | DOCS_LABO | OBTENU */
    certificateStatus: text("certificate_status").notNull().default("A_DEMANDER"),
    certificateNumber: text("certificate_number"),
    certificateDate: date("certificate_date"),
    /** Échantillon physique déposé / disponible (null = inconnu). */
    physicalProduct: boolean("physical_product"),
    /** Dossier bloqué (formule non conforme, ingrédient interdit…). */
    blocked: boolean("blocked").notNull().default(false),
    blockedReason: text("blocked_reason"),
    missingDocuments: text("missing_documents"),
    responsibleId: uuid("responsible_id").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
    /** Clé d'identité pour l'import (marque|référence|type|contenance) — évite les doublons. */
    dedupeKey: text("dedupe_key"),
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("regulatory_expiry_idx").on(t.expiryDate),
    index("regulatory_brand_idx").on(t.brandId),
    index("regulatory_certificate_idx").on(t.certificateStatus),
    uniqueIndex("regulatory_dedupe_uq").on(t.dedupeKey).where(sql`dedupe_key is not null`),
    index("regulatory_files_product_idx").on(t.productId),
    index("regulatory_files_responsible_idx").on(t.responsibleId),
    index("regulatory_files_import_idx").on(t.importId),
  ],
);

/** Historique d'un dossier : dépôts successifs, ATD, CE, renouvellements, notes datées. */
export const regulatoryEvents = pgTable(
  "regulatory_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fileId: uuid("file_id").notNull().references(() => regulatoryFiles.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    /** DEPOT | ATD | CE | RENOUVELLEMENT | EXPIRATION | BLOCAGE | NOTE | IMPORT */
    kind: text("kind").notNull(),
    label: text("label"),
    reference: text("reference"),
    expiryDate: date("expiry_date"),
    notes: text("notes"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("regulatory_events_file_idx").on(t.fileId, t.date), index("regulatory_events_user_idx").on(t.userId)],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    url: text("url").notNull(),
    entityType: text("entity_type").notNull(), // regulatory_file | task | product | ...
    entityId: uuid("entity_id").notNull(),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("documents_uploaded_by_idx").on(t.uploadedById)],
);

/* ------------------------------------------------------------------ */
/* Tâches                                                              */
/* ------------------------------------------------------------------ */

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("TODO"),
    priority: taskPriorityEnum("priority").notNull().default("MEDIUM"),
    dueDate: date("due_date"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    source: taskSourceEnum("source").notNull().default("MANUAL"),
    sourceKey: text("source_key"), // clé stable de la recommandation qui a généré la tâche
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    expectedImpact: text("expected_impact"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("tasks_assignee_idx").on(t.assigneeId),
    index("tasks_status_idx").on(t.status),
    index("tasks_source_key_idx").on(t.sourceKey),
    index("tasks_brand_idx").on(t.brandId),
    index("tasks_created_by_idx").on(t.createdById),
  ],
);

export const taskComments = pgTable(
  "task_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_comments_task_idx").on(t.taskId), index("task_comments_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ */
/* Marketing : budgets, dépenses, campagnes, contenus                  */
/* ------------------------------------------------------------------ */

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(), // budget marketing total
    referenceRevenue: numeric("reference_revenue", { precision: 14, scale: 2 }), // CA de référence
    pctOfRevenue: numeric("pct_of_revenue", { precision: 6, scale: 2 }), // % budget / CA
    notes: text("notes"),
  },
  (t) => [uniqueIndex("budgets_brand_year_uq").on(t.brandId, t.year)],
);

/** Répartition prévisionnelle du budget par catégorie (plan). */
export const budgetLines = pgTable(
  "budget_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    label: text("label").notNull(), // libellé d'origine (ex: "Com digitale", "Influenceuse")
    category: budgetCategoryEnum("category").notNull().default("AUTRES"),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  },
  (t) => [index("budget_lines_brand_year_idx").on(t.brandId, t.year)],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Nature de la campagne : AWARENESS, ACQUISITION, LANCEMENT, RAMADAN, 360… (voir lib/marketing-shared). */
    type: text("type").notNull().default("AWARENESS"),
    channel: campaignChannelEnum("channel").notNull().default("META"),
    objective: text("objective"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    budget: numeric("budget", { precision: 14, scale: 2 }),
    status: campaignStatusEnum("status").notNull().default("DRAFT"),
    audience: text("audience"),
    message: text("message"),
    offer: text("offer"),
    kpiTarget: text("kpi_target"),
    kpiActual: text("kpi_actual"),
    responsibleId: uuid("responsible_id").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("campaigns_brand_idx").on(t.brandId, t.startDate), index("campaigns_responsible_idx").on(t.responsibleId)],
);

/** Produits poussés par une campagne (référentiel produits existant, pas de duplication). */
export const campaignProducts = pgTable(
  "campaign_products",
  {
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ name: "campaign_products_pk", columns: [t.campaignId, t.productId] }),
    index("campaign_products_product_idx").on(t.productId),
  ],
);

/* ------------------------------------------------------------------ */
/* Régie publicitaire (Meta / TikTok / Google)                         */
/* ------------------------------------------------------------------ */

/** Compte publicitaire + état de synchronisation (import manuel aujourd'hui, API demain). */
export const adAccounts = pgTable(
  "ad_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: text("platform").notNull(), // META | TIKTOK | GOOGLE | AUTRE
    name: text("name").notNull(),
    externalId: text("external_id"),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    currency: text("currency").notNull().default("MAD"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    syncStatus: text("sync_status").notNull().default("MANUAL"), // MANUAL | OK | ERROR
    lastError: text("last_error"),
    importedRows: integer("imported_rows").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ad_accounts_uq").on(t.platform, t.name), index("ad_accounts_brand_idx").on(t.brandId)],
);

/** Une ligne = une journée × une publicité (ou campagne si le fichier n'a pas le détail). */
export const adMetrics = pgTable(
  "ad_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(),
    platform: text("platform").notNull(),
    accountId: uuid("account_id").references(() => adAccounts.id, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    campaignName: text("campaign_name").notNull(),
    adsetName: text("adset_name"),
    adName: text("ad_name"),
    spend: numeric("spend", { precision: 14, scale: 2 }).notNull().default("0"),
    impressions: integer("impressions").notNull().default(0),
    reach: integer("reach").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    linkClicks: integer("link_clicks").notNull().default(0),
    landingPageViews: integer("landing_page_views").notNull().default(0),
    leads: integer("leads").notNull().default(0),
    purchases: integer("purchases").notNull().default(0),
    revenue: numeric("revenue", { precision: 14, scale: 2 }).notNull().default("0"),
    dedupeKey: text("dedupe_key").notNull(),
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ad_metrics_dedupe_uq").on(t.dedupeKey),
    index("ad_metrics_date_idx").on(t.date),
    index("ad_metrics_brand_idx").on(t.brandId, t.date),
    index("ad_metrics_campaign_idx").on(t.campaignName),
    index("ad_metrics_account_idx").on(t.accountId),
    index("ad_metrics_campaign_id_idx").on(t.campaignId),
    index("ad_metrics_import_idx").on(t.importId),
  ],
);

/** Enrichissement d'une publicité : format, accroche, produit, contenu du planning éditorial. */
export const adCreatives = pgTable(
  "ad_creatives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: text("platform").notNull(),
    adName: text("ad_name").notNull(),
    format: text("format"),
    hook: text("hook"),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    contentId: uuid("content_id").references(() => contentItems.id, { onDelete: "set null" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ad_creatives_uq").on(t.platform, t.adName),
    index("ad_creatives_product_idx").on(t.productId),
    index("ad_creatives_content_idx").on(t.contentId),
  ],
);

/* ------------------------------------------------------------------ */
/* Influence                                                           */
/* ------------------------------------------------------------------ */

export const influencers = pgTable(
  "influencers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    instagram: text("instagram"),
    tiktok: text("tiktok"),
    followers: integer("followers"),
    engagementRate: numeric("engagement_rate", { precision: 6, scale: 2 }),
    audience: text("audience"),
    city: text("city"),
    country: text("country").default("Maroc"),
    category: text("category"),
    usualRate: numeric("usual_rate", { precision: 12, scale: 2 }),
    contact: text("contact"),
    active: boolean("active").notNull().default(true),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("influencers_name_uq").on(sql`lower(${t.name})`)],
);

export const collaborations = pgTable(
  "collaborations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    influencerId: uuid("influencer_id").notNull().references(() => influencers.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    date: date("date").notNull(),
    contentType: text("content_type"),
    stories: integer("stories").notNull().default(0),
    reels: integer("reels").notNull().default(0),
    posts: integer("posts").notNull().default(0),
    fee: numeric("fee", { precision: 12, scale: 2 }).notNull().default("0"),
    productValue: numeric("product_value", { precision: 12, scale: 2 }).notNull().default("0"),
    /** PROSPECT | CONTACTEE | NEGOCIATION | CONFIRMEE | CONTENU_RECU | PUBLIE | ANALYSE | TERMINE */
    status: text("status").notNull().default("PROSPECT"),
    reach: integer("reach"),
    impressions: integer("impressions"),
    views: integer("views"),
    likes: integer("likes"),
    comments: integer("comments"),
    shares: integer("shares"),
    saves: integer("saves"),
    linkClicks: integer("link_clicks"),
    promoCode: text("promo_code"),
    conversions: integer("conversions"),
    attributedRevenue: numeric("attributed_revenue", { precision: 14, scale: 2 }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("collaborations_date_idx").on(t.date),
    index("collaborations_influencer_idx").on(t.influencerId),
    index("collaborations_brand_idx").on(t.brandId),
    index("collaborations_campaign_idx").on(t.campaignId),
    index("collaborations_product_idx").on(t.productId),
  ],
);

/* ------------------------------------------------------------------ */
/* Activations marketing                                               */
/* ------------------------------------------------------------------ */

export const activations = pgTable(
  "activations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** EVENEMENT | SPONSORING | PLV | SHOOTING | SALON | SAMPLING | GOODIES | PARTENARIAT… */
    type: text("type").notNull().default("EVENEMENT"),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    date: date("date").notNull(),
    endDate: date("end_date"),
    place: text("place"),
    city: text("city"),
    responsibleId: uuid("responsible_id").references(() => users.id, { onDelete: "set null" }),
    objective: text("objective"),
    budgetPlanned: numeric("budget_planned", { precision: 14, scale: 2 }).notNull().default("0"),
    status: text("status").notNull().default("PLANNED"), // PLANNED | ACTIVE | DONE | CANCELLED
    participants: integer("participants"),
    leads: integer("leads"),
    samples: integer("samples"),
    newClients: integer("new_clients"),
    attributedRevenue: numeric("attributed_revenue", { precision: 14, scale: 2 }),
    results: text("results"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activations_date_idx").on(t.date),
    index("activations_brand_idx").on(t.brandId),
    index("activations_product_idx").on(t.productId),
    index("activations_campaign_idx").on(t.campaignId),
    index("activations_client_idx").on(t.clientId),
    index("activations_responsible_idx").on(t.responsibleId),
  ],
);

export const marketingExpenses = pgTable(
  "marketing_expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    activationId: uuid("activation_id").references(() => activations.id, { onDelete: "set null" }),
    collaborationId: uuid("collaboration_id").references(() => collaborations.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    category: budgetCategoryEnum("category").notNull(),
    label: text("label").notNull(),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
    status: expenseStatusEnum("status").notNull().default("PLANNED"),
    date: date("date").notNull(),
    attributedRevenue: numeric("attributed_revenue", { precision: 14, scale: 2 }), // CA attribué (ROI)
    conversions: integer("conversions"), // pour CPA
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("expenses_brand_date_idx").on(t.brandId, t.date),
    index("marketing_expenses_campaign_idx").on(t.campaignId),
    index("marketing_expenses_activation_idx").on(t.activationId),
    index("marketing_expenses_collaboration_idx").on(t.collaborationId),
    index("marketing_expenses_product_idx").on(t.productId),
  ],
);

export const contentItems = pgTable(
  "content_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    format: text("format"), // Reel, Story, Post, Carrousel, UGC, Vidéo…
    platform: text("platform"), // Instagram, TikTok, Facebook, YouTube…
    objective: text("objective"),
    brief: text("brief"),
    responsibleId: uuid("responsible_id").references(() => users.id, { onDelete: "set null" }),
    status: contentStatusEnum("status").notNull().default("IDEE"),
    campaignId: uuid("campaign_id").references((): any => campaigns.id, { onDelete: "set null" }),
    activationId: uuid("activation_id").references((): any => activations.id, { onDelete: "set null" }),
    influencerId: uuid("influencer_id").references((): any => influencers.id, { onDelete: "set null" }),
    budget: numeric("budget", { precision: 12, scale: 2 }),
    link: text("link"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("content_date_idx").on(t.date),
    index("content_items_brand_idx").on(t.brandId),
    index("content_items_product_idx").on(t.productId),
    index("content_items_responsible_idx").on(t.responsibleId),
    index("content_items_campaign_idx").on(t.campaignId),
    index("content_items_activation_idx").on(t.activationId),
    index("content_items_influencer_idx").on(t.influencerId),
  ],
);

/* ------------------------------------------------------------------ */
/* Objectifs & paramètres                                              */
/* ------------------------------------------------------------------ */

export const objectives = pgTable(
  "objectives",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }), // null = COMANET global
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }), // objectif produit (facultatif)
    year: integer("year").notNull(),
    month: integer("month"), // 1..12, null = objectif annuel
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull(), // CA HT
    units: numeric("units", { precision: 12, scale: 2 }), // unités (facultatif)
  },
  (t) => [
    uniqueIndex("objectives_scope_uq").on(
      sql`coalesce(${t.brandId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`coalesce(${t.productId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.year,
      sql`coalesce(${t.month}, 0)`,
    ),
    index("objectives_brand_idx").on(t.brandId),
    index("objectives_product_idx").on(t.productId),
  ],
);

export const settings = pgTable("settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Relations (pour les requêtes relationnelles drizzle)                */
/* ------------------------------------------------------------------ */

export const brandsRelations = relations(brands, ({ many }) => ({
  products: many(products),
  budgets: many(budgets),
  budgetLines: many(budgetLines),
  campaigns: many(campaigns),
  expenses: many(marketingExpenses),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  sales: many(sales),
  regulatoryFiles: many(regulatoryFiles),
}));

export const clientsRelations = relations(clients, ({ many }) => ({
  sales: many(sales),
  animations: many(animations),
}));

export const salesRelations = relations(sales, ({ one }) => ({
  client: one(clients, { fields: [sales.clientId], references: [clients.id] }),
  product: one(products, { fields: [sales.productId], references: [products.id] }),
}));

export const animationsRelations = relations(animations, ({ one, many }) => ({
  client: one(clients, { fields: [animations.clientId], references: [clients.id] }),
  animatrice: one(users, { fields: [animations.animatriceId], references: [users.id] }),
  brand: one(brands, { fields: [animations.brandId], references: [brands.id] }),
  lines: many(animationLines),
}));

export const animationLinesRelations = relations(animationLines, ({ one }) => ({
  animation: one(animations, { fields: [animationLines.animationId], references: [animations.id] }),
  product: one(products, { fields: [animationLines.productId], references: [products.id] }),
}));

export const regulatoryRelations = relations(regulatoryFiles, ({ one, many }) => ({
  product: one(products, { fields: [regulatoryFiles.productId], references: [products.id] }),
  brand: one(brands, { fields: [regulatoryFiles.brandId], references: [brands.id] }),
  responsible: one(users, { fields: [regulatoryFiles.responsibleId], references: [users.id] }),
  events: many(regulatoryEvents),
}));

export const campaignRelations = relations(campaigns, ({ one, many }) => ({
  brand: one(brands, { fields: [campaigns.brandId], references: [brands.id] }),
  responsible: one(users, { fields: [campaigns.responsibleId], references: [users.id] }),
  products: many(campaignProducts),
  expenses: many(marketingExpenses),
  collaborations: many(collaborations),
  activations: many(activations),
}));

export const campaignProductsRelations = relations(campaignProducts, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaignProducts.campaignId], references: [campaigns.id] }),
  product: one(products, { fields: [campaignProducts.productId], references: [products.id] }),
}));

export const influencerRelations = relations(influencers, ({ many }) => ({
  collaborations: many(collaborations),
}));

export const collaborationRelations = relations(collaborations, ({ one }) => ({
  influencer: one(influencers, { fields: [collaborations.influencerId], references: [influencers.id] }),
  brand: one(brands, { fields: [collaborations.brandId], references: [brands.id] }),
  product: one(products, { fields: [collaborations.productId], references: [products.id] }),
  campaign: one(campaigns, { fields: [collaborations.campaignId], references: [campaigns.id] }),
}));

export const activationRelations = relations(activations, ({ one }) => ({
  brand: one(brands, { fields: [activations.brandId], references: [brands.id] }),
  product: one(products, { fields: [activations.productId], references: [products.id] }),
  campaign: one(campaigns, { fields: [activations.campaignId], references: [campaigns.id] }),
  client: one(clients, { fields: [activations.clientId], references: [clients.id] }),
  responsible: one(users, { fields: [activations.responsibleId], references: [users.id] }),
}));

export const adMetricsRelations = relations(adMetrics, ({ one }) => ({
  account: one(adAccounts, { fields: [adMetrics.accountId], references: [adAccounts.id] }),
  brand: one(brands, { fields: [adMetrics.brandId], references: [brands.id] }),
  campaign: one(campaigns, { fields: [adMetrics.campaignId], references: [campaigns.id] }),
}));

export const regulatoryEventsRelations = relations(regulatoryEvents, ({ one }) => ({
  file: one(regulatoryFiles, { fields: [regulatoryEvents.fileId], references: [regulatoryFiles.id] }),
  user: one(users, { fields: [regulatoryEvents.userId], references: [users.id] }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  assignee: one(users, { fields: [tasks.assigneeId], references: [users.id] }),
  createdBy: one(users, { fields: [tasks.createdById], references: [users.id] }),
  brand: one(brands, { fields: [tasks.brandId], references: [brands.id] }),
  comments: many(taskComments),
}));

export const taskCommentsRelations = relations(taskComments, ({ one }) => ({
  task: one(tasks, { fields: [taskComments.taskId], references: [tasks.id] }),
  user: one(users, { fields: [taskComments.userId], references: [users.id] }),
}));

export const expensesRelations = relations(marketingExpenses, ({ one }) => ({
  brand: one(brands, { fields: [marketingExpenses.brandId], references: [brands.id] }),
  campaign: one(campaigns, { fields: [marketingExpenses.campaignId], references: [campaigns.id] }),
}));

export const contentRelations = relations(contentItems, ({ one }) => ({
  brand: one(brands, { fields: [contentItems.brandId], references: [brands.id] }),
  product: one(products, { fields: [contentItems.productId], references: [products.id] }),
  responsible: one(users, { fields: [contentItems.responsibleId], references: [users.id] }),
}));

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type User = typeof users.$inferSelect;
export type Brand = typeof brands.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Sale = typeof sales.$inferSelect;
export type StockSnapshot = typeof stockSnapshots.$inferSelect;
export type Animation = typeof animations.$inferSelect;
export type RegulatoryFile = typeof regulatoryFiles.$inferSelect;
export type RegulatoryEvent = typeof regulatoryEvents.$inferSelect;
export type AnimationObjective = typeof animationObjectives.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type AdAccount = typeof adAccounts.$inferSelect;
export type AdMetric = typeof adMetrics.$inferSelect;
export type Influencer = typeof influencers.$inferSelect;
export type Collaboration = typeof collaborations.$inferSelect;
export type Activation = typeof activations.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type MarketingExpense = typeof marketingExpenses.$inferSelect;
export type ContentItem = typeof contentItems.$inferSelect;
export type Import = typeof imports.$inferSelect;
export type BudgetLine = typeof budgetLines.$inferSelect;
export type Objective = typeof objectives.$inferSelect;

export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
export type TaskPriority = (typeof taskPriorityEnum.enumValues)[number];
export type BudgetCategory = (typeof budgetCategoryEnum.enumValues)[number];
export type ContentStatus = (typeof contentStatusEnum.enumValues)[number];
export type RegulatoryStatus = (typeof regulatoryStatusEnum.enumValues)[number];
