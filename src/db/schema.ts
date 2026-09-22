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
  time,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  customType,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

/**
 * Rôle « legacy » : conservé pour la session et les contraintes existantes,
 * tenu à jour sur le rôle système prioritaire. Les permissions réelles
 * viennent de `user_roles` → `role_permissions`, jamais de cette colonne.
 */
export const userRoleEnum = pgEnum("user_role", [
  "ADMIN",
  "MARKETING",
  "REGLEMENTAIRE",
  "TRADE",
  "ANIMATRICE",
  "DELEGUE_MEDICAL",
  "MANAGER_MEDICAL",
]);

/** Étendue des données visibles : toutes, celles de son équipe, ou les siennes seules. */
export const dataScopeEnum = pgEnum("data_scope", ["ALL", "TEAM", "OWN"]);

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
  "MEDECINS",
  "INVENTORY",
  "INFLUENCERS",
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
  /** Proposée par le copilote IA : n'entre ni dans les compteurs ni dans les retards tant qu'elle n'est pas acceptée. */
  "PROPOSED",
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
  "MEDICAL",
  /** Copilote IA (outil `propose_task`). */
  "AI",
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

export const doctorStatusEnum = pgEnum("doctor_status", ["NOUVEAU", "ACTIF", "A_REACTIVER", "INACTIF"]);

export const doctorPotentialEnum = pgEnum("doctor_potential", ["A", "B", "C"]);

export const medicalVisitStatusEnum = pgEnum("medical_visit_status", [
  "PLANIFIEE",
  "REALISEE",
  "ANNULEE",
  "REPORTEE",
  "NON_EFFECTUEE",
]);

export const doctorInterestEnum = pgEnum("doctor_interest", ["FAIBLE", "MOYEN", "FORT"]);

export const sampleMovementTypeEnum = pgEnum("sample_movement_type", [
  "ENTREE",
  "SORTIE_VISITE",
  "TRANSFERT",
  "AJUSTEMENT",
]);

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
  phone: text("phone"),
  jobTitle: text("job_title"),
  /** Responsable hiérarchique — rend le périmètre « équipe » calculable pour tous les modules. */
  managerId: uuid("manager_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  /** `false` = compte suspendu : ses données et sa configuration de droits restent intactes. */
  active: boolean("active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Rôles, permissions, périmètres                                      */
/* ------------------------------------------------------------------ */

/**
 * Rôles administrables depuis Paramètres. Les 7 rôles système (`isSystem`)
 * reprennent les valeurs de `user_role` : renommables, jamais supprimables.
 * `priority` départage la page d'accueil quand une personne cumule des rôles.
 */
export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: varchar("key", { length: 50 }).notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  homePath: text("home_path").notNull().default("/"),
  priority: integer("priority").notNull().default(0),
  isSystem: boolean("is_system").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rolePermissions = pgTable(
  "role_permissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    module: varchar("module", { length: 50 }).notNull(),
    canView: boolean("can_view").notNull().default(false),
    canCreate: boolean("can_create").notNull().default(false),
    canEdit: boolean("can_edit").notNull().default(false),
    canDelete: boolean("can_delete").notNull().default(false),
    canExport: boolean("can_export").notNull().default(false),
    canAdmin: boolean("can_admin").notNull().default(false),
  },
  (t) => [
    uniqueIndex("role_permissions_role_module_uq").on(t.roleId, t.module),
    index("role_permissions_role_idx").on(t.roleId),
  ],
);

/** Une personne peut cumuler plusieurs rôles : ses droits sont l'union des leurs. */
export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] }), index("user_roles_role_idx").on(t.roleId)],
);

/**
 * Périmètre de données. `module` à NULL = périmètre global de la personne ;
 * une valeur = exception pour ce module précis. Tableaux vides = aucune restriction.
 */
export const userScopes = pgTable(
  "user_scopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    module: varchar("module", { length: 50 }),
    dataScope: dataScopeEnum("data_scope").notNull().default("ALL"),
    brandIds: uuid("brand_ids").array().notNull().default(sql`'{}'::uuid[]`),
    cities: text("cities").array().notNull().default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_scopes_user_module_uq").on(
      t.userId,
      sql`coalesce(${t.module}, '*')`,
    ),
    index("user_scopes_user_idx").on(t.userId),
  ],
);

/* ------------------------------------------------------------------ */
/* Permissions modulaires par utilisateur (remplace rôles → user_roles) */
/* ------------------------------------------------------------------ */

/**
 * Portée des données d'une personne : ses propres données, ses marques et
 * clients assignés, ou tout. Enum distinct de `data_scope` (legacy, avec TEAM)
 * pour que la migration n'ait pas à étendre un type en cours d'utilisation.
 */
export const userDataScopeEnum = pgEnum("user_data_scope", ["OWN", "ASSIGNED", "ALL"]);

/**
 * Matrice de droits d'un utilisateur : une ligne par module, quatre cases.
 * C'est la SEULE source de vérité des droits ; les modèles de rôle ne servent
 * qu'à pré-remplir cette table. Créer / Modifier / Valider impliquent Voir
 * (contrainte SQL dans la migration, dépendance aussi gérée par l'interface).
 */
export const userPermissions = pgTable(
  "user_permissions",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    module: varchar("module", { length: 50 }).notNull(),
    canView: boolean("can_view").notNull().default(false),
    canCreate: boolean("can_create").notNull().default(false),
    canEdit: boolean("can_edit").notNull().default(false),
    canValidate: boolean("can_validate").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.module] })],
);

/** Portée globale de la personne (une seule valeur, tous modules confondus). */
export const userScope = pgTable("user_scope", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  scope: userDataScopeEnum("scope").notNull().default("ALL"),
  /** Toutes les marques, y compris celles créées plus tard (remplace la liste `user_brand_assignments`). */
  allBrands: boolean("all_brands").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Marques rattachées à la personne — utilisées par la portée « assignés ». */
export const userBrandAssignments = pgTable(
  "user_brand_assignments",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.brandId] }), index("user_brand_assignments_brand_idx").on(t.brandId)],
);

/**
 * Villes rattachées à la personne : tous les clients de la ville entrent dans sa portée,
 * y compris ceux importés plus tard. Rapprochement par `cityKey()` (accents et alias ignorés).
 */
export const userCityAssignments = pgTable(
  "user_city_assignments",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    city: text("city").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.city] })],
);

/** Clients rattachés à la personne — utilisés par la portée « assignés ». */
export const userClientAssignments = pgTable(
  "user_client_assignments",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.clientId] }), index("user_client_assignments_client_idx").on(t.clientId)],
);

/**
 * Interrupteurs transverses : contrôlent une information quel que soit le
 * module qui l'affiche. Un commercial peut voir tout le module Ventes sans
 * jamais voir une marge.
 */
export const userFlags = pgTable("user_flags", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Prix d'achat, marges, prix COMANET. */
  seeMargins: boolean("see_margins").notNull().default(false),
  /** Totaux d'enveloppes toutes marques. */
  seeGlobalBudgets: boolean("see_global_budgets").notNull().default(false),
  /** Cachets d'influenceuses, rémunération des animatrices. */
  seeInternalCosts: boolean("see_internal_costs").notNull().default(false),
  /** Engager / valider une dépense. */
  approveSpend: boolean("approve_spend").notNull().default(false),
  /** Tout export xlsx / csv / impression. */
  exportData: boolean("export_data").notNull().default(false),
  /** Journal d'activité et journal des droits. */
  readActivityLog: boolean("read_activity_log").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Modèles de rôle : simples raccourcis de pré-remplissage, éditables par
 * l'administrateur. Appliquer un modèle cumule (OR) ses cases avec la matrice
 * courante ; aucun lien n'est conservé ensuite avec l'utilisateur.
 */
export const roleTemplates = pgTable("role_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description"),
  /** Page d'accueil proposée à l'application du modèle. */
  homePath: text("home_path").notNull().default("/"),
  scope: userDataScopeEnum("scope").notNull().default("ALL"),
  flags: jsonb("flags").$type<Record<string, boolean>>().notNull().default({}),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const roleTemplatePermissions = pgTable(
  "role_template_permissions",
  {
    templateId: uuid("template_id")
      .notNull()
      .references(() => roleTemplates.id, { onDelete: "cascade" }),
    module: varchar("module", { length: 50 }).notNull(),
    canView: boolean("can_view").notNull().default(false),
    canCreate: boolean("can_create").notNull().default(false),
    canEdit: boolean("can_edit").notNull().default(false),
    canValidate: boolean("can_validate").notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.module] })],
);

/**
 * Journal des modifications de droits : qui a changé quoi, pour qui, quand.
 * Noms dénormalisés pour rester lisible après suppression d'un compte.
 */
export const permissionAuditLogs = pgTable(
  "permission_audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
    targetUserName: text("target_user_name").notNull(),
    /**
     * Étiquettes concaténées par « + » : PERMISSIONS, SCOPE, ASSIGNMENTS, FLAGS, SUSPEND, REACTIVATE,
     * TEMPLATE_APPLIED, DUPLICATED, CREATED, TEMPLATE_EDITED, TEMPLATE_DELETED. Sans limite de
     * longueur : une modification complète en cumule cinq.
     */
    change: text("change").notNull(),
    before: jsonb("before"),
    after: jsonb("after"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("permission_audit_logs_created_idx").on(t.createdAt.desc()),
    index("permission_audit_logs_target_idx").on(t.targetUserId),
  ],
);

/**
 * Journal d'activité. `actorName` est dénormalisé pour que le journal reste
 * lisible après la suppression d'un utilisateur.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    action: varchar("action", { length: 50 }).notNull(),
    module: varchar("module", { length: 50 }),
    entity: varchar("entity", { length: 50 }).notNull(),
    entityId: uuid("entity_id"),
    entityLabel: text("entity_label"),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt.desc()),
    index("audit_logs_actor_idx").on(t.actorId),
    index("audit_logs_entity_idx").on(t.entity, t.entityId),
    index("audit_logs_action_idx").on(t.action),
  ],
);

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
  /**
   * Marque fusionnée dans une autre (doublon de référentiel, ex. un compte publicitaire nommé
   * autrement). La fiche est conservée désactivée ; toute la couche analytique lit ses lignes
   * sous la marque cible. Rien n'est supprimé.
   */
  mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => brands.id, { onDelete: "set null" }),
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
    /** Import qui a créé la fiche automatiquement (NULL : saisie manuelle). Sert à l'annulation. */
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
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
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
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
    /** Import qui a créé la fiche automatiquement (NULL : saisie manuelle). Sert à l'annulation. */
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
    type: clientTypeEnum("type").notNull().default("AUTRE"),
    city: text("city"),
    /** Secteur commercial (maille d'analyse des ventes) — déduit de la ville, corrigeable à la main. Voir `src/lib/sectors.ts`. */
    sector: text("sector"),
    channel: text("channel"), // ex: pharmacie / parapharmacie / grossiste / e-commerce
    salesRep: text("sales_rep"), // commercial
    phone: text("phone"),
    active: boolean("active").notNull().default(true),
    needsReview: boolean("needs_review").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("clients_city_idx").on(t.city), index("clients_sector_idx").on(t.sector), index("clients_rep_idx").on(t.salesRep), index("clients_code_idx").on(t.code)],
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
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
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
    /**
     * Qui a écrit cette ligne EN DERNIER : 'saisie' (un humain, dans l'application) ou
     * 'import' (le fichier quotidien). L'import ne remplace jamais une ligne 'saisie' —
     * il journalise le conflit. `import_id` ne suffisait pas : une animation importée puis
     * corrigée dans l'application garde son `import_id`.
     */
    source: text("source").notNull().default("import"),
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
    index("animations_source_date_idx").on(t.source, t.date),
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
/* Stock chez le client (relevés terrain)                              */
/* ------------------------------------------------------------------ */

/** Par quel canal un relevé de stock a été fait. */
export const clientStockChannelEnum = pgEnum("client_stock_channel", ["ANIMATION", "TOURNEE_COMMERCIALE", "IMPORT"]);

/**
 * Relevé du stock constaté CHEZ un client (le point de vente est le client : il n'existe
 * pas de second référentiel). Une ligne par relevé, jamais d'écrasement : l'historique
 * est conservé et le « stock actuel » est le dernier relevé par produit
 * (`src/lib/client-stock.ts`, seul module autorisé à écrire ici).
 *
 * Donnée terrain, distincte du stock COMANET (`stock_snapshots`) et jamais renvoyée
 * vers Sage. Deux populations alimentent la même table : les animatrices depuis la
 * saisie terrain (`channel = ANIMATION`, `animation_id` renseigné) et les commerciaux
 * depuis la fiche client (`channel = TOURNEE_COMMERCIALE`).
 */
export const clientStockReadings = pgTable(
  "client_stock_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    /** Unités constatées en rayon + réserve du point de vente. */
    quantity: integer("quantity").notNull(),
    /** Jour du relevé (jour de l'animation, ou jour de la tournée). */
    readAt: date("read_at").notNull(),
    /** Qui a relevé (animatrice ou commercial). */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    channel: clientStockChannelEnum("channel").notNull(),
    /** Journée d'animation d'origine : une correction de l'animation remplace SES relevés, pas ceux des autres. */
    animationId: uuid("animation_id").references(() => animations.id, { onDelete: "set null" }),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("client_stock_readings_client_product_date_idx").on(t.clientId, t.productId, t.readAt),
    index("client_stock_readings_animation_idx").on(t.animationId),
    index("client_stock_readings_user_idx").on(t.userId),
  ],
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
/* Médical : délégués, médecins, visites, échantillons                 */
/* ------------------------------------------------------------------ */

export const medicalSpecialties = pgTable("medical_specialties", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const medicalSectors = pgTable("medical_sectors", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  city: text("city"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Profil complémentaire d'un délégué médical — n'existe que pour un `users.role = DELEGUE_MEDICAL` / `MANAGER_MEDICAL`. */
export const medicalDelegates = pgTable(
  "medical_delegates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    zone: text("zone"),
    monthlyVisitObjective: integer("monthly_visit_objective").notNull().default(0),
    weeklyVisitObjective: integer("weekly_visit_objective").notNull().default(0),
    managerId: uuid("manager_id").references(() => users.id, { onDelete: "set null" }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("medical_delegates_manager_idx").on(t.managerId)],
);

export const medicalDelegateSectors = pgTable(
  "medical_delegate_sectors",
  {
    delegateId: uuid("delegate_id")
      .notNull()
      .references(() => medicalDelegates.id, { onDelete: "cascade" }),
    sectorId: uuid("sector_id")
      .notNull()
      .references(() => medicalSectors.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.delegateId, t.sectorId] }),
    index("medical_delegate_sectors_sector_idx").on(t.sectorId),
  ],
);

export const doctors = pgTable(
  "doctors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    specialtyId: uuid("specialty_id").references(() => medicalSpecialties.id, { onDelete: "set null" }),
    subSpecialty: text("sub_specialty"),
    addressLine: text("address_line"),
    city: text("city"),
    sectorId: uuid("sector_id").references(() => medicalSectors.id, { onDelete: "set null" }),
    gpsLat: numeric("gps_lat", { precision: 9, scale: 6 }),
    gpsLng: numeric("gps_lng", { precision: 9, scale: 6 }),
    delegateId: uuid("delegate_id").references(() => users.id, { onDelete: "set null" }),
    status: doctorStatusEnum("status").notNull().default("NOUVEAU"),
    /** Classification A/B/C — éditable manuellement ; suggérée par `doctorFlags()` mais jamais écrasée automatiquement. */
    potential: doctorPotentialEnum("potential"),
    /** Fréquence de visite recommandée en jours. Null = utilise `settings.medicalDefaultVisitFrequencyDays`. */
    visitFrequencyDays: integer("visit_frequency_days"),
    lastVisitAt: timestamp("last_visit_at", { withTimezone: true }),
    comments: text("comments"),
    notes: text("notes"),
    dedupeKey: text("dedupe_key"),
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("doctors_sector_idx").on(t.sectorId),
    index("doctors_delegate_idx").on(t.delegateId),
    index("doctors_specialty_idx").on(t.specialtyId),
    index("doctors_import_idx").on(t.importId),
    uniqueIndex("doctors_dedupe_uq").on(t.dedupeKey).where(sql`dedupe_key is not null`),
  ],
);

/** Marques concernées par un prescripteur (celles qu'il prescrit ou pourrait prescrire). */
export const doctorBrands = pgTable(
  "doctor_brands",
  {
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.doctorId, t.brandId] }), index("doctor_brands_brand_idx").on(t.brandId)],
);

export const doctorVisits = pgTable(
  "doctor_visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id, { onDelete: "cascade" }),
    delegateId: uuid("delegate_id").references(() => users.id, { onDelete: "set null" }),
    date: date("date").notNull(),
    durationMinutes: integer("duration_minutes"),
    gpsLat: numeric("gps_lat", { precision: 9, scale: 6 }),
    gpsLng: numeric("gps_lng", { precision: 9, scale: 6 }),
    visitType: text("visit_type").notNull().default("VISITE"),
    objective: text("objective"),
    result: text("result"),
    doctorInterest: doctorInterestEnum("doctor_interest"),
    comment: text("comment"),
    nextAction: text("next_action"),
    nextVisitDate: date("next_visit_date"),
    /** Objections rencontrées chez le praticien (texte libre). */
    objections: text("objections"),
    /** Documentation laissée (brochures, fiches, argumentaires). */
    documentation: text("documentation"),
    status: medicalVisitStatusEnum("status").notNull().default("PLANIFIEE"),
    dedupeKey: text("dedupe_key"),
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("doctor_visits_doctor_idx").on(t.doctorId),
    index("doctor_visits_delegate_idx").on(t.delegateId),
    index("doctor_visits_date_idx").on(t.date),
    uniqueIndex("doctor_visits_dedupe_uq").on(t.dedupeKey).where(sql`dedupe_key is not null`),
  ],
);

export const visitProducts = pgTable(
  "visit_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => doctorVisits.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
  },
  (t) => [index("visit_products_visit_idx").on(t.visitId)],
);

export const visitSamples = pgTable(
  "visit_samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    visitId: uuid("visit_id")
      .notNull()
      .references(() => doctorVisits.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
  },
  (t) => [index("visit_samples_visit_idx").on(t.visitId)],
);

/** Mouvements de stock d'échantillons par délégué × produit. Le solde courant = somme des `quantity` signées. */
export const sampleMovements = pgTable(
  "sample_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    delegateId: uuid("delegate_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    type: sampleMovementTypeEnum("type").notNull(),
    /** Signée : positive pour ENTREE, négative pour SORTIE_VISITE/AJUSTEMENT négatif. */
    quantity: integer("quantity").notNull(),
    visitId: uuid("visit_id").references(() => doctorVisits.id, { onDelete: "set null" }),
    date: date("date").notNull(),
    comment: text("comment"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sample_movements_delegate_product_idx").on(t.delegateId, t.productId),
    index("sample_movements_visit_idx").on(t.visitId),
  ],
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
    /** Business Manager propriétaire — un jeton ne couvre que les comptes de son business. */
    businessId: text("business_id"),
    businessName: text("business_name"),
    /** Fuseau du compte publicitaire : les journées de la régie y sont découpées, PAS en Africa/Casablanca. */
    timezone: text("timezone"),
    /** Synchronisation automatique activée (nécessite external_id + un jeton valide). */
    syncEnabled: boolean("sync_enabled").notNull().default(false),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    /**
     * Verrou : posé au début d'une synchronisation, levé à la fin. Le cron horaire et le
     * bouton « Actualiser » peuvent tomber en même temps sur le même compte ; sans verrou,
     * deux passages liraient la même fenêtre et doubleraient la consommation de quota.
     */
    syncStartedAt: timestamp("sync_started_at", { withTimezone: true }),
    syncStatus: text("sync_status").notNull().default("MANUAL"), // MANUAL | OK | ERROR
    lastError: text("last_error"),
    importedRows: integer("imported_rows").notNull().default(0),
    /**
     * Rattrapage historique (2023 →). `backfill_cursor` = premier jour du prochain mois à lire ;
     * `null` tant que rien n'a été lancé. Le rattrapage est reprenable : chaque passage lit
     * quelques mois puis avance le curseur, pour tenir dans la durée d'une fonction serveur.
     */
    backfillCursor: date("backfill_cursor"),
    backfillStatus: text("backfill_status").notNull().default("IDLE"), // IDLE | RUNNING | DONE | ERROR
    backfillError: text("backfill_error"),
    backfillUpdatedAt: timestamp("backfill_updated_at", { withTimezone: true }),
    /** Mois refusés par Meta (rétention 37 mois, permission…) : « Historique indisponible pour cette période ». */
    backfillGaps: jsonb("backfill_gaps").$type<{ month: string; reason: string }[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ad_accounts_uq").on(t.platform, t.name),
    // Un compte est identifié par son id de régie, pas par son nom : renommer un compte dans
    // Ads Manager doit mettre à jour la ligne existante, pas en créer une seconde.
    uniqueIndex("ad_accounts_external_uq").on(t.platform, t.externalId),
    index("ad_accounts_brand_idx").on(t.brandId),
  ],
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
    /** Conversations démarrées (Messenger/WhatsApp) — le résultat des campagnes « Messages ». */
    messagingStarted: integer("messaging_started").notNull().default(0),
    revenue: numeric("revenue", { precision: 14, scale: 2 }).notNull().default("0"),
    /** Identifiants Meta/TikTok/Google : stables même si la campagne est renommée dans la régie. */
    externalCampaignId: text("external_campaign_id"),
    externalAdsetId: text("external_adset_id"),
    externalAdId: text("external_ad_id"),
    /** Créative Meta diffusée par la publicité ce jour-là (clé vers `ad_entities` niveau CREATIVE). */
    externalCreativeId: text("external_creative_id"),
    /** Vues vidéo (3 s) et engagements sur la publication : lus dans `actions`, 0 si absents. */
    videoViews: integer("video_views").notNull().default(0),
    postEngagement: integer("post_engagement").notNull().default(0),
    /** Devise d'origine du compte publicitaire (EUR, USD…). `spend` et `revenue` sont TOUJOURS en MAD. */
    currency: text("currency").notNull().default("MAD"),
    /** Montants tels que remontés par la régie, avant conversion — trace d'audit. */
    spendOriginal: numeric("spend_original", { precision: 14, scale: 2 }),
    revenueOriginal: numeric("revenue_original", { precision: 14, scale: 2 }),
    /** Taux appliqué pour obtenir les MAD (1 si la devise est déjà le MAD). Jamais deviné : saisi en Paramètres. */
    fxRate: numeric("fx_rate", { precision: 12, scale: 6 }),
    /** IMPORT (fichier de régie) | API (synchronisation automatique). */
    source: text("source").notNull().default("IMPORT"),
    /** Fenêtre d'attribution demandée à la régie (ex. « 7d_click,1d_view ») : sans elle, un CA n'est pas comparable. */
    attributionWindow: text("attribution_window"),
    /**
     * Journée non close au moment de la lecture. Une ligne partielle n'entre JAMAIS dans une
     * moyenne, un écart ou un CPA de référence : la dépense de la journée est déjà là, les
     * conversions arrivent après. Elle s'affiche à part, avec son heure de relevé.
     */
    isPartial: boolean("is_partial").notNull().default(false),
    /** Heure du dernier relevé de cette ligne — c'est la fraîcheur affichée à l'écran. */
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    dedupeKey: text("dedupe_key").notNull(),
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ad_metrics_dedupe_uq").on(t.dedupeKey),
    index("ad_metrics_partial_idx").on(t.date, t.isPartial),
    index("ad_metrics_external_campaign_idx").on(t.platform, t.externalCampaignId),
    index("ad_metrics_source_idx").on(t.accountId, t.date, t.source),
    index("ad_metrics_date_idx").on(t.date),
    index("ad_metrics_brand_idx").on(t.brandId, t.date),
    index("ad_metrics_campaign_idx").on(t.campaignName),
    index("ad_metrics_account_idx").on(t.accountId),
    index("ad_metrics_campaign_id_idx").on(t.campaignId),
    index("ad_metrics_import_idx").on(t.importId),
  ],
);

/**
 * État de diffusion courant d'une campagne de régie — un instantané, pas un historique.
 *
 * `ad_metrics` est le journal des métriques par jour ; il ne dit pas si une campagne tourne
 * encore à cet instant. C'est pourtant la question de la journée en cours : une campagne en
 * pause ou à budget épuisé n'apparaît nulle part dans les chiffres, elle apparaît par son
 * absence. Une ligne par campagne de régie, remplacée à chaque passage.
 */
export const adCampaignStates = pgTable(
  "ad_campaign_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: text("platform").notNull(),
    externalCampaignId: text("external_campaign_id").notNull(),
    accountId: uuid("account_id").references(() => adAccounts.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Ce que l'annonceur a demandé (ACTIVE | PAUSED | ARCHIVED…). */
    status: text("status").notNull(),
    /** Ce que Meta applique réellement — un compte impayé met en pause sans changer `status`. */
    effectiveStatus: text("effective_status"),
    objective: text("objective"),
    /** Budgets convertis en MAD avec le taux saisi, comme les dépenses. Jamais devinés. */
    dailyBudget: numeric("daily_budget", { precision: 14, scale: 2 }),
    lifetimeBudget: numeric("lifetime_budget", { precision: 14, scale: 2 }),
    budgetRemaining: numeric("budget_remaining", { precision: 14, scale: 2 }),
    /** Budget quotidien tel que remonté par la régie, avant conversion — trace d'audit. */
    dailyBudgetOriginal: numeric("daily_budget_original", { precision: 14, scale: 2 }),
    currency: text("currency").notNull().default("MAD"),
    fxRate: numeric("fx_rate", { precision: 12, scale: 6 }),
    startTime: timestamp("start_time", { withTimezone: true }),
    stopTime: timestamp("stop_time", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ad_campaign_states_uq").on(t.platform, t.externalCampaignId),
    index("ad_campaign_states_account_idx").on(t.accountId),
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

/**
 * Rattachement d'une campagne de régie à une campagne COMANET.
 *
 * Une campagne COMANET couvre souvent plusieurs campagnes Meta (prospection + retargeting),
 * et les noms de régie ne suivent aucune convention (« gamarde », « Post: "…" »). On rattache
 * donc sur l'identifiant externe quand il est connu (stable au renommage), sur le nom normalisé
 * sinon — d'où `match_key`, qui porte l'un ou l'autre.
 */
export const campaignAdLinks = pgTable(
  "campaign_ad_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // META | TIKTOK | GOOGLE
    /** Identifiant de campagne dans la régie, s'il est connu (synchronisation API). */
    externalCampaignId: text("external_campaign_id"),
    /** Libellé au moment du rattachement, pour l'affichage. */
    externalCampaignName: text("external_campaign_name").notNull(),
    /** `external_campaign_id` s'il existe, sinon le nom normalisé. Une campagne de régie ne peut être rattachée qu'une fois. */
    matchKey: text("match_key").notNull(),
    accountId: uuid("account_id").references(() => adAccounts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("campaign_ad_links_uq").on(t.platform, t.matchKey),
    index("campaign_ad_links_campaign_idx").on(t.campaignId),
    index("campaign_ad_links_account_idx").on(t.accountId),
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

/* Référentiels du module Activations : tout est modifiable depuis /parametres/activations. */

export const activationTypes = pgTable("activation_types", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  icon: text("icon"),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
  /** Module qui pilote ce type par défaut : `marketing` (équipe marketing) ou `clients` (trade). */
  defaultModule: text("default_module").notNull().default("marketing"),
  defaultBudgetCategory: budgetCategoryEnum("default_budget_category").notNull().default("AUTRES"),
  /** Checklist de préparation par défaut, une entrée par étape. */
  defaultChecklist: jsonb("default_checklist").$type<string[]>().notNull().default([]),
});

export const activationStatuses = pgTable("activation_statuses", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  tone: text("tone").notNull().default("gray"),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
  awaitingValidation: boolean("awaiting_validation").notNull().default(false),
  /** Le budget de l'activation est engagé dans le Command Center. */
  isValidated: boolean("is_validated").notNull().default(false),
  isRunning: boolean("is_running").notNull().default(false),
  isDone: boolean("is_done").notNull().default(false),
  isMeasured: boolean("is_measured").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  isCancelled: boolean("is_cancelled").notNull().default(false),
});

export const activationStatusTransitions = pgTable(
  "activation_status_transitions",
  {
    fromKey: text("from_key").notNull().references(() => activationStatuses.key, { onDelete: "cascade" }),
    toKey: text("to_key").notNull().references(() => activationStatuses.key, { onDelete: "cascade" }),
    requiresValidator: boolean("requires_validator").notNull().default(false),
    requiresComment: boolean("requires_comment").notNull().default(false),
    label: text("label"),
  },
  (t) => [primaryKey({ columns: [t.fromKey, t.toKey] })],
);

export const activationObjectives = pgTable("activation_objectives", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const activationTargets = pgTable("activation_targets", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

/** Postes budgétaires d'une activation, chacun rattaché à une catégorie du budget marketing. */
export const activationCostItems = pgTable("activation_cost_items", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  budgetCategory: budgetCategoryEnum("budget_category").notNull().default("AUTRES"),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

/** Catégories d'articles d'inventaire (PLV, échantillon, goodie, print). */
export const inventoryCategories = pgTable("inventory_categories", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  budgetCategory: budgetCategoryEnum("budget_category").notNull().default("PLV"),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export type ActivationTemplateDefaults = {
  objectiveKey?: string; targetKey?: string; description?: string;
  /** Jours de préparation avant la date de début. */
  prepOffsetDays?: number;
  /** Durée par défaut, en jours (1 = une journée). */
  durationDays?: number;
  budgetLines?: { costItemKey: string; label?: string; planned?: number }[];
  checklist?: string[];
};

export const activationTemplates = pgTable(
  "activation_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    typeKey: text("type_key").references(() => activationTypes.key, { onDelete: "set null" }),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    defaults: jsonb("defaults").$type<ActivationTemplateDefaults>().notNull().default({}),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activation_templates_type_idx").on(t.typeKey)],
);

/**
 * Activations marketing hors digital (événement, PLV, sampling, salon…).
 *
 * `type` et `status` sont des CLÉS vers les tables de référence ci-dessus. `brand_id`,
 * `product_id` et `client_id` restent le « principal » (compatibilité des vues existantes),
 * la liste complète vit dans `activation_brands` / `activation_products` / `activation_clients`.
 * Le statut n'est modifié que par `src/lib/activations/workflow.ts`.
 */
export const activations = pgTable(
  "activations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    type: text("type").notNull().default("AUTRE").references(() => activationTypes.key),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    /** Début (date de l'activation). */
    date: date("date").notNull(),
    endDate: date("end_date"),
    /** Début de la préparation (checklist). */
    prepDate: date("prep_date"),
    place: text("place"),
    city: text("city"),
    responsibleId: uuid("responsible_id").references(() => users.id, { onDelete: "set null" }),
    validatorId: uuid("validator_id").references(() => users.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    /** Texte libre historique (compatibilité) ; l'objectif structuré est `objective_key`. */
    objective: text("objective"),
    objectiveKey: text("objective_key").references(() => activationObjectives.key, { onDelete: "set null" }),
    targetKey: text("target_key").references(() => activationTargets.key, { onDelete: "set null" }),
    description: text("description"),
    templateId: uuid("template_id").references(() => activationTemplates.id, { onDelete: "set null" }),
    /** Animation Terrain liée (lien, jamais une copie). */
    linkedAnimationId: uuid("linked_animation_id").references(() => animations.id, { onDelete: "set null" }),
    /** Somme des lignes budgétaires prévues (maintenue par `src/lib/activations/budget.ts`). */
    budgetPlanned: numeric("budget_planned", { precision: 14, scale: 2 }).notNull().default("0"),
    status: text("status").notNull().default("IDEE").references(() => activationStatuses.key),
    /* Résultats saisis après l'activation — légers, jamais obligatoires. */
    participants: integer("participants"),
    leads: integer("leads"),
    samples: integer("samples"),
    newClients: integer("new_clients"),
    pharmaciesReached: integer("pharmacies_reached"),
    ordersOnSite: integer("orders_on_site"),
    ordersAmount: numeric("orders_amount", { precision: 14, scale: 2 }),
    pressMentions: integer("press_mentions"),
    /** CA réellement mesuré (commandes prises sur place, code promo…). Jamais estimé. */
    attributedRevenue: numeric("attributed_revenue", { precision: 14, scale: 2 }),
    results: text("results"),
    publishedLink: text("published_link"),
    resultsAt: timestamp("results_at", { withTimezone: true }),
    notes: text("notes"),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    measuredAt: timestamp("measured_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activations_date_idx").on(t.date),
    index("activations_status_idx").on(t.status, t.date),
    index("activations_type_idx").on(t.type),
    index("activations_city_idx").on(t.city),
    index("activations_brand_idx").on(t.brandId),
    index("activations_product_idx").on(t.productId),
    index("activations_campaign_idx").on(t.campaignId),
    index("activations_client_idx").on(t.clientId),
    index("activations_responsible_idx").on(t.responsibleId),
    index("activations_validator_idx").on(t.validatorId),
    index("activations_created_by_idx").on(t.createdById),
    index("activations_animation_idx").on(t.linkedAnimationId),
  ],
);

export const activationBrands = pgTable(
  "activation_brands",
  {
    activationId: uuid("activation_id").notNull().references(() => activations.id, { onDelete: "cascade" }),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.activationId, t.brandId] }), index("activation_brands_brand_idx").on(t.brandId)],
);

export const activationProducts = pgTable(
  "activation_products",
  {
    activationId: uuid("activation_id").notNull().references(() => activations.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.activationId, t.productId] }), index("activation_products_product_idx").on(t.productId)],
);

export const activationClients = pgTable(
  "activation_clients",
  {
    activationId: uuid("activation_id").notNull().references(() => activations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.activationId, t.clientId] }), index("activation_clients_client_idx").on(t.clientId)],
);

export const activationContributors = pgTable(
  "activation_contributors",
  {
    activationId: uuid("activation_id").notNull().references(() => activations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.activationId, t.userId] }), index("activation_contributors_user_idx").on(t.userId)],
);

/**
 * Lignes budgétaires d'une activation : prévu (proposition), engagé (devis / bon de commande),
 * dépensé (facture). Chaque ligne est reflétée dans `marketing_expenses` par
 * `src/lib/activations/budget.ts` (`activation_ref = 'LINE:<id>'`) dès que l'activation est validée.
 */
export const activationBudgetLines = pgTable(
  "activation_budget_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activationId: uuid("activation_id").notNull().references(() => activations.id, { onDelete: "cascade" }),
    costItemKey: text("cost_item_key").notNull().references(() => activationCostItems.key),
    /** Marque imputée (par défaut la marque principale de l'activation). */
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    label: text("label").notNull(),
    planned: numeric("planned", { precision: 14, scale: 2 }).notNull().default("0"),
    committed: numeric("committed", { precision: 14, scale: 2 }).notNull().default("0"),
    spent: numeric("spent", { precision: 14, scale: 2 }).notNull().default("0"),
    supplier: text("supplier"),
    quoteRef: text("quote_ref"),
    invoiceRef: text("invoice_ref"),
    date: date("date"),
    notes: text("notes"),
    sort: integer("sort").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activation_budget_lines_activation_idx").on(t.activationId, t.sort), index("activation_budget_lines_brand_idx").on(t.brandId)],
);

export const activationChecklistItems = pgTable(
  "activation_checklist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activationId: uuid("activation_id").notNull().references(() => activations.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    done: boolean("done").notNull().default(false),
    doneAt: timestamp("done_at", { withTimezone: true }),
    doneById: uuid("done_by_id").references(() => users.id, { onDelete: "set null" }),
    dueDate: date("due_date"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [
    index("activation_checklist_activation_idx").on(t.activationId, t.sort),
    index("activation_checklist_assignee_idx").on(t.assigneeId),
    index("activation_checklist_done_by_idx").on(t.doneById),
  ],
);

export const activationComments = pgTable(
  "activation_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activationId: uuid("activation_id").notNull().references(() => activations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activation_comments_activation_idx").on(t.activationId, t.createdAt), index("activation_comments_user_idx").on(t.userId)],
);

/** Historique des statuts d'une activation : qui, quand, commentaire. Jamais purgé. */
export const activationStatusHistory = pgTable(
  "activation_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activationId: uuid("activation_id").notNull().references(() => activations.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activation_status_history_activation_idx").on(t.activationId, t.createdAt), index("activation_status_history_user_idx").on(t.userId)],
);

/* ------------------------------------------------------------------ */
/* Inventaire matériel (PLV, échantillons, goodies, print)             */
/* ------------------------------------------------------------------ */

/**
 * Article d'inventaire. `stock` est le stock courant, maintenu à chaque mouvement dans la
 * même transaction (`src/lib/activations/inventory.ts`). Distinct des échantillons médicaux
 * des délégués (`sample_movements`), qui suivent une logique par délégué.
 */
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    sku: text("sku"),
    categoryKey: text("category_key").notNull().references(() => inventoryCategories.key),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    unit: text("unit").notNull().default("pièce"),
    unitCost: numeric("unit_cost", { precision: 12, scale: 2 }).notNull().default("0"),
    stock: integer("stock").notNull().default(0),
    alertThreshold: integer("alert_threshold"),
    location: text("location"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_items_name_uq").on(sql`lower(${t.name})`, sql`coalesce(${t.brandId}, '00000000-0000-0000-0000-000000000000'::uuid)`),
    index("inventory_items_brand_idx").on(t.brandId),
    index("inventory_items_product_idx").on(t.productId),
    index("inventory_items_category_idx").on(t.categoryKey),
    index("inventory_items_import_idx").on(t.importId),
  ],
);

/** Mouvement signé : ENTREE (+), SORTIE (−, liée à une activation ou libre), AJUSTEMENT (±). */
export const inventoryMovements = pgTable(
  "inventory_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id").notNull().references(() => inventoryItems.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // ENTREE | SORTIE | AJUSTEMENT
    quantity: integer("quantity").notNull(),
    unitCost: numeric("unit_cost", { precision: 12, scale: 2 }),
    activationId: uuid("activation_id").references(() => activations.id, { onDelete: "set null" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    reason: text("reason"),
    date: date("date").notNull(),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    importId: uuid("import_id").references(() => imports.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("inventory_movements_item_idx").on(t.itemId, t.date),
    index("inventory_movements_activation_idx").on(t.activationId),
    index("inventory_movements_client_idx").on(t.clientId),
    index("inventory_movements_user_idx").on(t.createdById),
    index("inventory_movements_import_idx").on(t.importId),
  ],
);

/** Matériel consommé par une activation : article × quantité, valorisé au coût du moment. */
export const activationMaterials = pgTable(
  "activation_materials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    activationId: uuid("activation_id").notNull().references(() => activations.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").notNull().references(() => inventoryItems.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
    unitCost: numeric("unit_cost", { precision: 12, scale: 2 }).notNull().default("0"),
    movementId: uuid("movement_id").references(() => inventoryMovements.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activation_materials_activation_idx").on(t.activationId),
    index("activation_materials_item_idx").on(t.itemId),
    index("activation_materials_movement_idx").on(t.movementId),
    index("activation_materials_user_idx").on(t.createdById),
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
    /** Origine dans l'activation (`LINE:<id>` ou `MATERIAL:<catégorie>`) : synchronisation idempotente. */
    activationRef: text("activation_ref"),
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
    uniqueIndex("marketing_expenses_activation_ref_uq").on(t.activationId, t.activationRef).where(sql`${t.activationRef} is not null`),
    index("marketing_expenses_collaboration_idx").on(t.collaborationId),
    index("marketing_expenses_product_idx").on(t.productId),
  ],
);

/**
 * Contenus du planning éditorial.
 *
 * Plateforme, format, objectif et statut sont des CLÉS vers les tables de référence
 * (`content_platforms`, `content_formats`, `content_objectives`, `content_statuses`),
 * modifiables depuis /parametres. Le cycle de vie est piloté par `content_status_transitions`
 * et la fonction unique `transition()` de `src/lib/content/workflow.ts`.
 * Un contenu archivé n'est jamais supprimé : il garde brief, fichiers et historique.
 */
export const contentItems = pgTable(
  "content_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    date: date("date").notNull(),
    publishTime: time("publish_time"),
    /** Date de livraison du livrable, distincte de la date de publication. */
    deadline: date("deadline"),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    /** Produit principal ; la liste complète vit dans `content_products`. */
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    format: text("format").references(() => contentFormats.key, { onDelete: "set null" }),
    platform: text("platform").references(() => contentPlatforms.key, { onDelete: "set null" }),
    objective: text("objective").references(() => contentObjectives.key, { onDelete: "set null" }),
    /** Brief libre (V1) — conservé comme « notes de brief ». */
    brief: text("brief"),
    keyMessage: text("key_message"),
    angle: text("angle"),
    hook: text("hook"),
    caption: text("caption"),
    hashtags: text("hashtags"),
    cta: text("cta"),
    constraints: text("constraints"),
    mandatoryMentions: text("mandatory_mentions"),
    forbiddenClaims: text("forbidden_claims"),
    /** Références / inspirations : [{ url, label }]. Les images uploadées vont dans `content_assets` (kind REFERENCE). */
    references: jsonb("references").$type<{ url: string; label?: string }[]>().notNull().default([]),
    deliverables: text("deliverables"),
    templateId: uuid("template_id").references(() => briefTemplates.id, { onDelete: "set null" }),
    responsibleId: uuid("responsible_id").references(() => users.id, { onDelete: "set null" }),
    validatorId: uuid("validator_id").references(() => users.id, { onDelete: "set null" }),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").notNull().default("IDEE").references(() => contentStatuses.key),
    campaignId: uuid("campaign_id").references((): any => campaigns.id, { onDelete: "set null" }),
    activationId: uuid("activation_id").references((): any => activations.id, { onDelete: "set null" }),
    influencerId: uuid("influencer_id").references((): any => influencers.id, { onDelete: "set null" }),
    budget: numeric("budget", { precision: 12, scale: 2 }),
    /** Lien du post publié. */
    link: text("link"),
    /** Performance saisie à la main (facultative) en attendant les connecteurs. */
    reach: integer("reach"),
    engagement: integer("engagement"),
    perfNotes: text("perf_notes"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("content_date_idx").on(t.date),
    index("content_items_brand_idx").on(t.brandId),
    index("content_items_brand_date_idx").on(t.brandId, t.date),
    index("content_items_status_idx").on(t.status),
    index("content_items_platform_idx").on(t.platform),
    index("content_items_deadline_idx").on(t.deadline),
    index("content_items_product_idx").on(t.productId),
    index("content_items_responsible_idx").on(t.responsibleId),
    index("content_items_validator_idx").on(t.validatorId),
    index("content_items_created_by_idx").on(t.createdById),
    index("content_items_template_idx").on(t.templateId),
    index("content_items_campaign_idx").on(t.campaignId),
    index("content_items_activation_idx").on(t.activationId),
    index("content_items_influencer_idx").on(t.influencerId),
  ],
);

/* Référentiels du planning éditorial (configurables dans /parametres) */

export const contentPlatforms = pgTable("content_platforms", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  icon: text("icon"),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
  specs: jsonb("specs").$type<{ ratios?: string[]; maxDurationSec?: number; notes?: string }>().notNull().default({}),
});

export const contentFormats = pgTable("content_formats", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
  defaultDeliverable: text("default_deliverable"),
});

export const contentObjectives = pgTable("content_objectives", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const contentStatuses = pgTable("content_statuses", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  tone: text("tone").notNull().default("gray"),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
  isPublished: boolean("is_published").notNull().default(false),
  isArchived: boolean("is_archived").notNull().default(false),
  awaitingValidation: boolean("awaiting_validation").notNull().default(false),
  inProduction: boolean("in_production").notNull().default(false),
});

export const contentStatusTransitions = pgTable(
  "content_status_transitions",
  {
    fromKey: text("from_key").notNull().references(() => contentStatuses.key, { onDelete: "cascade" }),
    toKey: text("to_key").notNull().references(() => contentStatuses.key, { onDelete: "cascade" }),
    requiresValidator: boolean("requires_validator").notNull().default(false),
    requiresComment: boolean("requires_comment").notNull().default(false),
    label: text("label"),
  },
  (t) => [primaryKey({ columns: [t.fromKey, t.toKey] })],
);

export type BriefTemplateDefaults = {
  keyMessage?: string; angle?: string; hook?: string; caption?: string; hashtags?: string; cta?: string;
  constraints?: string; mandatoryMentions?: string; forbiddenClaims?: string; deliverables?: string; deadlineOffsetDays?: number;
};

export const briefTemplates = pgTable(
  "brief_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    objectiveKey: text("objective_key").references(() => contentObjectives.key, { onDelete: "set null" }),
    platformKey: text("platform_key").references(() => contentPlatforms.key, { onDelete: "set null" }),
    formatKey: text("format_key").references(() => contentFormats.key, { onDelete: "set null" }),
    defaults: jsonb("defaults").$type<BriefTemplateDefaults>().notNull().default({}),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("brief_templates_brand_idx").on(t.brandId)],
);

export const brandValidators = pgTable(
  "brand_validators",
  {
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.brandId, t.userId] }), index("brand_validators_user_idx").on(t.userId)],
);

export const contentProducts = pgTable(
  "content_products",
  {
    contentId: uuid("content_id").notNull().references(() => contentItems.id, { onDelete: "cascade" }),
    productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.contentId, t.productId] }), index("content_products_product_idx").on(t.productId)],
);

/** Historique des changements de statut : qui, quand, commentaire. Jamais purgé. */
export const contentStatusHistory = pgTable(
  "content_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentId: uuid("content_id").notNull().references(() => contentItems.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("content_status_history_content_idx").on(t.contentId, t.createdAt), index("content_status_history_user_idx").on(t.userId)],
);

export const contentComments = pgTable(
  "content_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentId: uuid("content_id").notNull().references(() => contentItems.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("content_comments_content_idx").on(t.contentId, t.createdAt), index("content_comments_user_idx").on(t.userId)],
);

/**
 * Fichiers versionnés (livrables, références, devis, factures, photos…). Le fichier est stocké
 * en base (`data`). Table polymorphe : exactement un propriétaire parmi contenu, activation,
 * article d'inventaire (contrainte `content_assets_owner_ck`). Seul `src/lib/content/assets.ts`
 * lit ou écrit `data`.
 */
export const contentAssets = pgTable(
  "content_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentId: uuid("content_id").references(() => contentItems.id, { onDelete: "cascade" }),
    activationId: uuid("activation_id").references(() => activations.id, { onDelete: "cascade" }),
    inventoryItemId: uuid("inventory_item_id").references(() => inventoryItems.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("LIVRABLE"), // LIVRABLE | REFERENCE | DEVIS | FACTURE | VISUEL | PHOTO | COMPTE_RENDU
    name: text("name").notNull(),
    mime: text("mime").notNull().default("application/octet-stream"),
    size: integer("size").notNull().default(0),
    version: integer("version").notNull().default(1),
    data: customType<{ data: Buffer; driverData: Buffer }>({ dataType() { return "bytea"; } })("data"),
    uploadedById: uuid("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("content_assets_content_idx").on(t.contentId, t.kind, t.version),
    index("content_assets_activation_idx").on(t.activationId, t.kind, t.version),
    index("content_assets_inventory_idx").on(t.inventoryItemId, t.kind, t.version),
    index("content_assets_user_idx").on(t.uploadedById),
    check("content_assets_owner_ck", sql`((${t.contentId} is not null)::int + (${t.activationId} is not null)::int + (${t.inventoryItemId} is not null)::int) = 1`),
  ],
);

/* ------------------------------------------------------------------ */
/* Notifications in-app                                                */
/* ------------------------------------------------------------------ */

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_unread_idx").on(t.userId, t.readAt, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Event Engine                                                        */
/* ------------------------------------------------------------------ */

/**
 * Journal des faits métier et de leur traitement.
 *
 * Ce n'est ni un cache de KPI ni un stock de recommandations : les chiffres du cockpit et
 * les cartes de l'Action Center restent calculés à la lecture depuis les tables sources.
 * Cette table enregistre qu'un fait s'est produit, quand, à cause de quoi, et où en est son
 * traitement — ce qu'aucune règle évaluée à la lecture ne peut reconstituer.
 *
 * `dedupeKey` porte l'identifiant de l'entité (`ANIMATION_COMPLETED:<animation_id>`), pas la
 * clé naturelle jour|ville|POS|animatrice : renommer un point de vente ne doit pas créer un
 * second événement. Une correction réutilise la même clé, incrémente `revision` et repasse
 * `status` à `pending`.
 *
 * Ne pas confondre avec `audit_logs` (qui a modifié quoi) ni avec `regulatory_events`
 * (journal métier d'un dossier réglementaire, descriptif et non déclencheur).
 */
export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** ANIMATION_COMPLETED — un seul type dans cette phase. */
    type: text("type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    dedupeKey: text("dedupe_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    /** saisie_terrain | import_animations */
    source: text("source").notNull(),
    /** Temps métier : la date de l'animation, pas celle de la saisie. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /** Temps technique : quand la ligne a été écrite. */
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** pending | processing | done | failed | obsolete */
    status: text("status").notNull().default("pending"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    /** Incrémentée à chaque ré-émission (animation corrigée). */
    revision: integer("revision").notNull().default(1),
  },
  (t) => [
    uniqueIndex("events_dedupe_uq").on(t.dedupeKey),
    index("events_pending_idx").on(t.status, t.createdAt),
    index("events_entity_idx").on(t.entityType, t.entityId),
    index("events_type_idx").on(t.type, t.occurredAt),
  ],
);

/**
 * Ce qu'un événement a déclenché : quelle règle, quel verdict, quelle tâche.
 *
 * `detail` conserve la couverture AVANT et APRÈS le fait, les seuils appliqués et les unités
 * qui ont provoqué le mouvement. C'est la trace du franchissement de seuil : une règle
 * évaluée à la lecture sait qu'un produit est sous le seuil, jamais depuis quand ni pourquoi.
 */
export const eventConsequences = pgTable(
  "event_consequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    /** Identifiant de la règle évaluée, tel qu'enregistré dans `src/lib/rules`. */
    ruleId: text("rule_id").notNull(),
    /** no_risk | already_at_risk | threshold_crossed | task_created | task_existing | task_flagged */
    outcome: text("outcome").notNull(),
    /** Clé de recommandation de l'Action Center (ex. `stock-coverage:<product_id>`). */
    recommendationKey: text("recommendation_key"),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("event_consequences_event_idx").on(t.eventId),
    index("event_consequences_task_idx").on(t.taskId),
    index("event_consequences_entity_idx").on(t.entityType, t.entityId, t.createdAt),
    // Retraitement d'un même événement : une conséquence par (événement, règle, entité).
    uniqueIndex("event_consequences_uq").on(t.eventId, t.ruleId, t.entityId),
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
/* Analytics marketing transverse (Phase 4)                            */
/* ------------------------------------------------------------------ */

/*
 * Couche de faits alimentée depuis les modules existants par `src/lib/analytics-marketing/refresh.ts`.
 * Aucun second référentiel : les faits pointent vers `brands`, `products`, `campaigns`, `clients`.
 * Seuls les canaux (`dim_channel`), leurs correspondances (`channel_mappings`) et le calendrier
 * (`dim_period`) sont nouveaux. `fact_sales` est une VUE SQL (voir la migration 0017), lue en SQL brut.
 */

/** Référentiel des canaux marketing — modifiable dans /parametres/analytics. */
export const dimChannel = pgTable("dim_channel", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  /** DIGITAL_PAID | ORGANIC | INFLUENCE | TERRAIN | EVENT | TRADE | PRESCRIPTION | PRODUCTION | OTHER */
  family: text("family").notNull().default("OTHER"),
  /** Résultat « propre » du canal (clé de `metrics_definitions`) : base du coût par résultat. */
  resultMetric: text("result_metric"),
  /** Résultat de repli quand le principal est à zéro sur la période. */
  fallbackResultMetric: text("fallback_result_metric"),
  color: text("color").notNull().default("#64748b"),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

/** Comment chaque source se range dans un canal. `source_key = '*'` : toute la source. */
export const channelMappings = pgTable(
  "channel_mappings",
  {
    /** BUDGET_CATEGORY | AD_PLATFORM | CONTENT_PLATFORM | ACTIVATION_TYPE | COLLABORATION | ANIMATION | SAMPLE */
    sourceKind: text("source_kind").notNull(),
    sourceKey: text("source_key").notNull(),
    channelKey: text("channel_key").notNull().references(() => dimChannel.key, { onDelete: "restrict" }),
  },
  (t) => [primaryKey({ columns: [t.sourceKind, t.sourceKey] })],
);

/** Calendrier jour (2024 → 2028) : jointures de tendance et détection des mois sans import. */
export const dimPeriod = pgTable(
  "dim_period",
  {
    day: date("day").primaryKey(),
    month: text("month").notNull(),
    quarter: text("quarter").notNull(),
    year: integer("year").notNull(),
    isoWeek: text("iso_week").notNull(),
    monthStart: date("month_start").notNull(),
    isMonthEnd: boolean("is_month_end").notNull(),
  },
  (t) => [index("dim_period_month_idx").on(t.month)],
);

/**
 * Une ligne = une dépense × jour × marque × produit, après répartition.
 * Reconstruite par `source_kind` ; `source_id` mène à la ligne d'origine (lien « corriger »).
 * Un montant NULL est « non mesurable » — jamais 0 par défaut.
 */
export const factMarketingSpend = pgTable(
  "fact_marketing_spend",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    day: date("day").notNull(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    city: text("city"),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    channelKey: text("channel_key").notNull().references(() => dimChannel.key, { onDelete: "restrict" }),
    subChannel: text("sub_channel"),
    budgetCategory: budgetCategoryEnum("budget_category").notNull().default("AUTRES"),
    /** AD_METRIC | EXPENSE | ACTIVATION_LINE | COLLABORATION | CONTENT | ANIMATION | SAMPLE */
    sourceKind: text("source_kind").notNull(),
    sourceId: uuid("source_id").notNull(),
    sourceLabel: text("source_label"),
    /** Pourquoi un montant manque (ex. COUT_NON_MESURE). */
    sourceRef: text("source_ref"),
    planned: numeric("planned", { precision: 14, scale: 2 }),
    committed: numeric("committed", { precision: 14, scale: 2 }),
    spent: numeric("spent", { precision: 14, scale: 2 }),
    /** Quote-part appliquée à la ligne d'origine et sa base : PRORATA_SALES | EQUAL | DECLARED | NONE. */
    share: numeric("share", { precision: 8, scale: 6 }).notNull().default("1"),
    shareBasis: text("share_basis").notNull().default("NONE"),
    isPartial: boolean("is_partial").notNull().default(false),
    /** MEASURED (régie, code promo, saisie) | NONE. */
    attributionMode: text("attribution_mode").notNull().default("NONE"),
    attributedRevenue: numeric("attributed_revenue", { precision: 14, scale: 2 }),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fms_day_idx").on(t.day),
    index("fms_brand_day_idx").on(t.brandId, t.day),
    index("fms_channel_day_idx").on(t.channelKey, t.day),
    index("fms_product_day_idx").on(t.productId, t.day),
    index("fms_campaign_idx").on(t.campaignId),
    index("fms_source_idx").on(t.sourceKind, t.sourceId),
    index("fms_city_idx").on(t.city),
  ],
);

/** Une ligne = un résultat mesuré × type (clé de `metrics_definitions`), même grain que les dépenses. */
export const factMarketingResult = pgTable(
  "fact_marketing_result",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    day: date("day").notNull(),
    brandId: uuid("brand_id").notNull().references(() => brands.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    city: text("city"),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    channelKey: text("channel_key").notNull().references(() => dimChannel.key, { onDelete: "restrict" }),
    subChannel: text("sub_channel"),
    sourceKind: text("source_kind").notNull(),
    sourceId: uuid("source_id").notNull(),
    sourceLabel: text("source_label"),
    resultKey: text("result_key").notNull(),
    value: numeric("value", { precision: 16, scale: 2 }).notNull(),
    share: numeric("share", { precision: 8, scale: 6 }).notNull().default("1"),
    /** MEASURED | DECLARED (saisi à la main). */
    measurement: text("measurement").notNull().default("MEASURED"),
    isPartial: boolean("is_partial").notNull().default(false),
    refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("fmr_day_idx").on(t.day),
    index("fmr_brand_day_idx").on(t.brandId, t.day),
    index("fmr_channel_key_idx").on(t.channelKey, t.resultKey, t.day),
    index("fmr_product_day_idx").on(t.productId, t.day),
    index("fmr_source_idx").on(t.sourceKind, t.sourceId),
  ],
);

/**
 * Dictionnaire des métriques : libellé, unité, sens, seuils, mode d'attribution.
 * La formule est documentaire ; le calcul vit dans `src/lib/analytics-marketing/metrics.ts`
 * et un test vérifie que chaque clé a sa fonction.
 */
export const metricsDefinitions = pgTable("metrics_definitions", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  description: text("description"),
  formula: text("formula").notNull(),
  /** MAD | PCT | RATIO | COUNT | MULTIPLE | SCORE | POINTS */
  unit: text("unit").notNull(),
  /** HIGHER_BETTER | LOWER_BETTER | NEUTRAL */
  direction: text("direction").notNull().default("NEUTRAL"),
  /** MEASURED | CORRELATION | NONE — affiché à côté du chiffre. */
  attribution: text("attribution").notNull().default("NONE"),
  source: text("source").notNull(),
  /** MONEY | SALES | RESULT | RETURN | COMPOSITE */
  family: text("family").notNull().default("RESULT"),
  warnThreshold: numeric("warn_threshold", { precision: 14, scale: 4 }),
  alertThreshold: numeric("alert_threshold", { precision: 14, scale: 4 }),
  sort: integer("sort").notNull().default(0),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Journal des rafraîchissements de la couche de faits — la fraîcheur affichée à l'écran. */
export const analyticsRefreshLog = pgTable(
  "analytics_refresh_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceKind: text("source_kind").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    spendRows: integer("spend_rows").notNull().default(0),
    resultRows: integer("result_rows").notNull().default(0),
    ok: boolean("ok").notNull().default(false),
    error: text("error"),
    /** IMPORT | SYNC | WORKFLOW | CRON | MANUAL */
    triggeredBy: text("triggered_by").notNull().default("MANUAL"),
  },
  (t) => [index("analytics_refresh_log_source_idx").on(t.sourceKind, t.startedAt)],
);

/* ------------------------------------------------------------------ */
/* Copilote IA                                                         */
/* ------------------------------------------------------------------ */

/*
 * Le copilote lit la donnée métier par des outils typés et n'écrit QUE dans ces tables
 * (plus une insertion dans `tasks` au statut PROPOSED et un brouillon dans `ai_reports`).
 * `tests/ai/read-only.test.ts` interdit toute autre écriture depuis `src/lib/ai/`.
 */

export const aiConversations = pgTable(
  "ai_conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    title: text("title"),
    /** Module ou page d'où la conversation a été ouverte (ex. « terrain », « /marketing/budgets »). */
    contextModule: text("context_module"),
    contextPath: text("context_path"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_conversations_user_idx").on(t.userId, t.updatedAt)],
);

export const aiMessages = pgTable(
  "ai_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").notNull().references(() => aiConversations.id, { onDelete: "cascade" }),
    /** user | assistant */
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** Appels d'outils de ce tour (nom, paramètres, résumé du résultat). */
    toolCalls: jsonb("tool_calls"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    model: text("model"),
    latencyMs: integer("latency_ms"),
    /** chat | explain | brief | plan | report */
    surface: text("surface").notNull().default("chat"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_messages_conversation_idx").on(t.conversationId, t.createdAt), index("ai_messages_created_idx").on(t.createdAt)],
);

/** Journal de chaque appel d'outil : qui, quel outil, quels paramètres, durée, nombre de lignes. */
export const aiToolCalls = pgTable(
  "ai_tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id").references(() => aiMessages.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    tool: text("tool").notNull(),
    params: jsonb("params"),
    durationMs: integer("duration_ms").notNull().default(0),
    rowCount: integer("row_count").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_tool_calls_user_idx").on(t.userId, t.createdAt), index("ai_tool_calls_tool_idx").on(t.tool)],
);

/** Réponses mises en cache : « Expliquer » (1 h par combinaison de filtres), brief du matin (1 jour par personne). */
export const aiCache = pgTable(
  "ai_cache",
  {
    key: text("key").primaryKey(),
    surface: text("surface").notNull(),
    content: text("content").notNull(),
    model: text("model"),
    tokensIn: integer("tokens_in").notNull().default(0),
    tokensOut: integer("tokens_out").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_cache_expires_idx").on(t.expiresAt)],
);

/** Plan d'exécution « Détailler » d'une recommandation de l'Action Center, par clé stable. */
export const aiActionPlans = pgTable("ai_action_plans", {
  recKey: text("rec_key").primaryKey(),
  contentMd: text("content_md").notNull(),
  model: text("model"),
  createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Brouillons de rapports (COMANET WEEKLY, MONTHLY BRAND REVIEW) validables par la direction. */
export const aiReports = pgTable(
  "ai_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** WEEKLY | MONTHLY_BRAND_REVIEW */
    type: text("type").notNull(),
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    title: text("title").notNull(),
    contentMd: text("content_md").notNull(),
    /** Outils appelés et périodes citées : chaque section du rapport indique sa source. */
    sources: jsonb("sources"),
    /** DRAFT | VALIDATED | ARCHIVED */
    status: text("status").notNull().default("DRAFT"),
    model: text("model"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    validatedById: uuid("validated_by_id").references(() => users.id, { onDelete: "set null" }),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_reports_type_idx").on(t.type, t.periodStart), index("ai_reports_brand_idx").on(t.brandId)],
);

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
  adLinks: many(campaignAdLinks),
}));

export const campaignAdLinkRelations = relations(campaignAdLinks, ({ one }) => ({
  campaign: one(campaigns, { fields: [campaignAdLinks.campaignId], references: [campaigns.id] }),
  account: one(adAccounts, { fields: [campaignAdLinks.accountId], references: [adAccounts.id] }),
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

export const activationRelations = relations(activations, ({ one, many }) => ({
  brand: one(brands, { fields: [activations.brandId], references: [brands.id] }),
  product: one(products, { fields: [activations.productId], references: [products.id] }),
  campaign: one(campaigns, { fields: [activations.campaignId], references: [campaigns.id] }),
  client: one(clients, { fields: [activations.clientId], references: [clients.id] }),
  responsible: one(users, { fields: [activations.responsibleId], references: [users.id] }),
  validator: one(users, { fields: [activations.validatorId], references: [users.id] }),
  typeRef: one(activationTypes, { fields: [activations.type], references: [activationTypes.key] }),
  statusRef: one(activationStatuses, { fields: [activations.status], references: [activationStatuses.key] }),
  template: one(activationTemplates, { fields: [activations.templateId], references: [activationTemplates.id] }),
  linkedAnimation: one(animations, { fields: [activations.linkedAnimationId], references: [animations.id] }),
  brands: many(activationBrands),
  products: many(activationProducts),
  clients: many(activationClients),
  contributors: many(activationContributors),
  budgetLines: many(activationBudgetLines),
  checklist: many(activationChecklistItems),
  comments: many(activationComments),
  history: many(activationStatusHistory),
  materials: many(activationMaterials),
}));

export const activationBrandsRelations = relations(activationBrands, ({ one }) => ({
  activation: one(activations, { fields: [activationBrands.activationId], references: [activations.id] }),
  brand: one(brands, { fields: [activationBrands.brandId], references: [brands.id] }),
}));
export const activationProductsRelations = relations(activationProducts, ({ one }) => ({
  activation: one(activations, { fields: [activationProducts.activationId], references: [activations.id] }),
  product: one(products, { fields: [activationProducts.productId], references: [products.id] }),
}));
export const activationClientsRelations = relations(activationClients, ({ one }) => ({
  activation: one(activations, { fields: [activationClients.activationId], references: [activations.id] }),
  client: one(clients, { fields: [activationClients.clientId], references: [clients.id] }),
}));
export const activationContributorsRelations = relations(activationContributors, ({ one }) => ({
  activation: one(activations, { fields: [activationContributors.activationId], references: [activations.id] }),
  user: one(users, { fields: [activationContributors.userId], references: [users.id] }),
}));
export const activationBudgetLinesRelations = relations(activationBudgetLines, ({ one }) => ({
  activation: one(activations, { fields: [activationBudgetLines.activationId], references: [activations.id] }),
  costItem: one(activationCostItems, { fields: [activationBudgetLines.costItemKey], references: [activationCostItems.key] }),
  brand: one(brands, { fields: [activationBudgetLines.brandId], references: [brands.id] }),
}));
export const activationChecklistItemsRelations = relations(activationChecklistItems, ({ one }) => ({
  activation: one(activations, { fields: [activationChecklistItems.activationId], references: [activations.id] }),
  assignee: one(users, { fields: [activationChecklistItems.assigneeId], references: [users.id] }),
}));
export const activationCommentsRelations = relations(activationComments, ({ one }) => ({
  activation: one(activations, { fields: [activationComments.activationId], references: [activations.id] }),
  user: one(users, { fields: [activationComments.userId], references: [users.id] }),
}));
export const activationStatusHistoryRelations = relations(activationStatusHistory, ({ one }) => ({
  activation: one(activations, { fields: [activationStatusHistory.activationId], references: [activations.id] }),
  user: one(users, { fields: [activationStatusHistory.userId], references: [users.id] }),
}));
export const activationMaterialsRelations = relations(activationMaterials, ({ one }) => ({
  activation: one(activations, { fields: [activationMaterials.activationId], references: [activations.id] }),
  item: one(inventoryItems, { fields: [activationMaterials.itemId], references: [inventoryItems.id] }),
  movement: one(inventoryMovements, { fields: [activationMaterials.movementId], references: [inventoryMovements.id] }),
}));
export const inventoryItemsRelations = relations(inventoryItems, ({ one, many }) => ({
  category: one(inventoryCategories, { fields: [inventoryItems.categoryKey], references: [inventoryCategories.key] }),
  brand: one(brands, { fields: [inventoryItems.brandId], references: [brands.id] }),
  product: one(products, { fields: [inventoryItems.productId], references: [products.id] }),
  movements: many(inventoryMovements),
}));
export const inventoryMovementsRelations = relations(inventoryMovements, ({ one }) => ({
  item: one(inventoryItems, { fields: [inventoryMovements.itemId], references: [inventoryItems.id] }),
  activation: one(activations, { fields: [inventoryMovements.activationId], references: [activations.id] }),
  client: one(clients, { fields: [inventoryMovements.clientId], references: [clients.id] }),
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

export const eventsRelations = relations(events, ({ many }) => ({
  consequences: many(eventConsequences),
}));

export const eventConsequencesRelations = relations(eventConsequences, ({ one }) => ({
  event: one(events, { fields: [eventConsequences.eventId], references: [events.id] }),
  task: one(tasks, { fields: [eventConsequences.taskId], references: [tasks.id] }),
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

export const usersRelations = relations(users, ({ one, many }) => ({
  manager: one(users, { fields: [users.managerId], references: [users.id], relationName: "manager" }),
  roles: many(userRoles),
  scopes: many(userScopes),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  permissions: many(rolePermissions),
  users: many(userRoles),
}));

export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({
  role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));

export const userScopesRelations = relations(userScopes, ({ one }) => ({
  user: one(users, { fields: [userScopes.userId], references: [users.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, { fields: [auditLogs.actorId], references: [users.id] }),
}));

export const medicalDelegatesRelations = relations(medicalDelegates, ({ one, many }) => ({
  user: one(users, { fields: [medicalDelegates.userId], references: [users.id] }),
  manager: one(users, { fields: [medicalDelegates.managerId], references: [users.id] }),
  sectors: many(medicalDelegateSectors),
}));

export const medicalDelegateSectorsRelations = relations(medicalDelegateSectors, ({ one }) => ({
  delegate: one(medicalDelegates, { fields: [medicalDelegateSectors.delegateId], references: [medicalDelegates.id] }),
  sector: one(medicalSectors, { fields: [medicalDelegateSectors.sectorId], references: [medicalSectors.id] }),
}));

export const doctorsRelations = relations(doctors, ({ one, many }) => ({
  specialty: one(medicalSpecialties, { fields: [doctors.specialtyId], references: [medicalSpecialties.id] }),
  sector: one(medicalSectors, { fields: [doctors.sectorId], references: [medicalSectors.id] }),
  delegate: one(users, { fields: [doctors.delegateId], references: [users.id] }),
  visits: many(doctorVisits),
}));

export const doctorVisitsRelations = relations(doctorVisits, ({ one, many }) => ({
  doctor: one(doctors, { fields: [doctorVisits.doctorId], references: [doctors.id] }),
  delegate: one(users, { fields: [doctorVisits.delegateId], references: [users.id] }),
  products: many(visitProducts),
  samples: many(visitSamples),
}));

export const visitProductsRelations = relations(visitProducts, ({ one }) => ({
  visit: one(doctorVisits, { fields: [visitProducts.visitId], references: [doctorVisits.id] }),
  product: one(products, { fields: [visitProducts.productId], references: [products.id] }),
}));

export const visitSamplesRelations = relations(visitSamples, ({ one }) => ({
  visit: one(doctorVisits, { fields: [visitSamples.visitId], references: [doctorVisits.id] }),
  product: one(products, { fields: [visitSamples.productId], references: [products.id] }),
}));

export const sampleMovementsRelations = relations(sampleMovements, ({ one }) => ({
  delegate: one(users, { fields: [sampleMovements.delegateId], references: [users.id] }),
  product: one(products, { fields: [sampleMovements.productId], references: [products.id] }),
  visit: one(doctorVisits, { fields: [sampleMovements.visitId], references: [doctorVisits.id] }),
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
export type ClientStockReading = typeof clientStockReadings.$inferSelect;
export type ClientStockChannel = (typeof clientStockChannelEnum.enumValues)[number];
export type Animation = typeof animations.$inferSelect;
export type RegulatoryFile = typeof regulatoryFiles.$inferSelect;
export type RegulatoryEvent = typeof regulatoryEvents.$inferSelect;
export type AnimationObjective = typeof animationObjectives.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type AdAccount = typeof adAccounts.$inferSelect;
export type AdMetric = typeof adMetrics.$inferSelect;
export type CampaignAdLink = typeof campaignAdLinks.$inferSelect;
export type Influencer = typeof influencers.$inferSelect;
export type Collaboration = typeof collaborations.$inferSelect;
export type Activation = typeof activations.$inferSelect;
export type ActivationType = typeof activationTypes.$inferSelect;
export type ActivationStatus = typeof activationStatuses.$inferSelect;
export type ActivationTemplate = typeof activationTemplates.$inferSelect;
export type ActivationBudgetLine = typeof activationBudgetLines.$inferSelect;
export type ActivationChecklistItem = typeof activationChecklistItems.$inferSelect;
export type InventoryItem = typeof inventoryItems.$inferSelect;
export type InventoryMovement = typeof inventoryMovements.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type MarketingExpense = typeof marketingExpenses.$inferSelect;
export type ContentItem = typeof contentItems.$inferSelect;
export type Import = typeof imports.$inferSelect;
export type BudgetLine = typeof budgetLines.$inferSelect;
export type Objective = typeof objectives.$inferSelect;
export type MedicalSpecialty = typeof medicalSpecialties.$inferSelect;
export type MedicalSector = typeof medicalSectors.$inferSelect;
export type MedicalDelegate = typeof medicalDelegates.$inferSelect;
export type Doctor = typeof doctors.$inferSelect;
export type DoctorVisit = typeof doctorVisits.$inferSelect;
export type SampleMovement = typeof sampleMovements.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type EventConsequence = typeof eventConsequences.$inferSelect;

export type Role = typeof roles.$inferSelect;
export type RolePermission = typeof rolePermissions.$inferSelect;
export type UserScope = typeof userScopes.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type UserPermissionRow = typeof userPermissions.$inferSelect;
export type UserFlagsRow = typeof userFlags.$inferSelect;
export type RoleTemplate = typeof roleTemplates.$inferSelect;
export type RoleTemplatePermission = typeof roleTemplatePermissions.$inferSelect;
export type PermissionAuditLog = typeof permissionAuditLogs.$inferSelect;
export type UserDataScope = (typeof userDataScopeEnum.enumValues)[number];

export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type DataScope = (typeof dataScopeEnum.enumValues)[number];
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
export type TaskPriority = (typeof taskPriorityEnum.enumValues)[number];
export type BudgetCategory = (typeof budgetCategoryEnum.enumValues)[number];
/** Clé de `content_statuses` (référentiel en base, plus un enum). */
export type ContentStatus = string;
export type ContentPlatform = typeof contentPlatforms.$inferSelect;
export type ContentFormat = typeof contentFormats.$inferSelect;
export type ContentObjective = typeof contentObjectives.$inferSelect;
export type ContentStatusRow = typeof contentStatuses.$inferSelect;
export type ContentStatusTransition = typeof contentStatusTransitions.$inferSelect;
export type BriefTemplate = typeof briefTemplates.$inferSelect;
export type ContentAsset = typeof contentAssets.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type RegulatoryStatus = (typeof regulatoryStatusEnum.enumValues)[number];
export type DoctorStatus = (typeof doctorStatusEnum.enumValues)[number];
export type DoctorPotential = (typeof doctorPotentialEnum.enumValues)[number];
export type MedicalVisitStatus = (typeof medicalVisitStatusEnum.enumValues)[number];
export type DoctorInterest = (typeof doctorInterestEnum.enumValues)[number];
export type SampleMovementType = (typeof sampleMovementTypeEnum.enumValues)[number];

/* ------------------------------------------------------------------ */
/* Ads Command Center : catalogue des objets de régie, mémoire, journal */
/* ------------------------------------------------------------------ */

/**
 * Catalogue des objets publicitaires (campagne, ensemble, publicité, créative), y compris
 * archivés. `ad_metrics` ne porte que des noms ; c'est ici que vivent l'objectif, les dates,
 * le texte et le format de la créative, le produit rattaché et les étiquettes de contenu.
 * Une ligne par (plateforme, niveau, identifiant de régie), remplacée à chaque catalogage.
 */
export const adEntities = pgTable(
  "ad_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    platform: text("platform").notNull(),
    level: text("level").notNull(), // CAMPAIGN | ADSET | AD | CREATIVE
    externalId: text("external_id").notNull(),
    accountId: uuid("account_id").references(() => adAccounts.id, { onDelete: "cascade" }),
    /** Parent direct (ensemble → campagne, publicité → ensemble, créative → publicité). */
    parentExternalId: text("parent_external_id"),
    externalCampaignId: text("external_campaign_id"),
    externalAdsetId: text("external_adset_id"),
    externalCreativeId: text("external_creative_id"),
    name: text("name").notNull(),
    status: text("status"),
    effectiveStatus: text("effective_status"),
    objective: text("objective"),
    createdTime: timestamp("created_time", { withTimezone: true }),
    startTime: timestamp("start_time", { withTimezone: true }),
    stopTime: timestamp("stop_time", { withTimezone: true }),
    /** Créative : texte principal, titre, visuel. Vides pour les autres niveaux. */
    title: text("title"),
    body: text("body"),
    thumbnailUrl: text("thumbnail_url"),
    imageUrl: text("image_url"),
    videoId: text("video_id"),
    objectType: text("object_type"), // VIDEO | PHOTO | SHARE | CAROUSEL…
    callToAction: text("call_to_action"),
    linkUrl: text("link_url"),
    /** Marque et produit du référentiel existant. AUTO = déduit du texte ; MANUAL = corrigé à la main (jamais écrasé). */
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
    productSource: text("product_source"), // AUTO | MANUAL
    /** Étiquettes de contenu : { format, angle, hook, offer, contentType }. `tags_source` MANUAL protège une correction. */
    tags: jsonb("tags").$type<Record<string, string>>().notNull().default({}),
    tagsSource: text("tags_source").notNull().default("AUTO"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("ad_entities_uq").on(t.platform, t.level, t.externalId),
    index("ad_entities_account_idx").on(t.accountId, t.level),
    index("ad_entities_campaign_idx").on(t.externalCampaignId),
    index("ad_entities_product_idx").on(t.productId),
    index("ad_entities_brand_idx").on(t.brandId),
  ],
);

/**
 * Journal des passages de synchronisation et de rattrapage : ce que l'écran affiche comme
 * « dernière synchronisation réussie », et ce que le diagnostic relit pour expliquer une panne.
 */
export const adSyncLog = pgTable(
  "ad_sync_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id").references(() => adAccounts.id, { onDelete: "cascade" }),
    mode: text("mode").notNull(), // full | intraday | backfill | entities
    since: date("since"),
    until: date("until"),
    rows: integer("rows").notNull().default(0),
    ok: boolean("ok").notNull(),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ad_sync_log_account_idx").on(t.accountId, t.finishedAt)],
);

/**
 * Mémoire marketing : phrases apprises des données publicitaires (« les créatives témoignage
 * fonctionnent pour Auracos »), avec leurs preuves et leur confiance. Recalculée par le moteur ;
 * jamais saisie à la main, jamais inventée sans preuve. Lisible par le copilote.
 */
export const adMemory = pgTable(
  "ad_memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull().unique(),
    scope: text("scope").notNull(), // BRAND | PRODUCT | CROSS_BRAND | SEASON | FORMAT | ANGLE
    brandId: uuid("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => products.id, { onDelete: "cascade" }),
    statement: text("statement").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull().default({}),
    confidence: integer("confidence").notNull().default(0),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ad_memory_brand_idx").on(t.brandId), index("ad_memory_scope_idx").on(t.scope)],
);
