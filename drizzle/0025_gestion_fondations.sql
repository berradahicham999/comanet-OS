-- Gestion commerciale — lot 1 : fondations (voir docs/plan-gestion-commerciale.md).
-- Référentiels (clients et articles étendus, fournisseurs, TVA, modes de paiement, dépôts),
-- journal de stock en écriture seule, lots, numérotation des pièces, nouveaux modules de droits.
-- Idempotente : rejouable sans erreur.

ALTER TYPE "public"."import_type" ADD VALUE IF NOT EXISTS 'STOCK_INITIAL';--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Référentiels modifiables dans /parametres/gestion
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "tax_rates" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"rate" numeric(5, 2) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "tax_rates_rate_ck" CHECK ("rate" >= 0 AND "rate" < 100)
);--> statement-breakpoint
INSERT INTO "tax_rates" ("key", "label", "rate", "sort") VALUES
	('TVA20', 'TVA 20 %', 20, 10),
	('TVA14', 'TVA 14 %', 14, 20),
	('TVA10', 'TVA 10 %', 10, 30),
	('TVA7', 'TVA 7 %', 7, 40),
	('EXONERE', 'Exonéré (0 %)', 0, 50)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "payment_modes" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"requires_due_date" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint
INSERT INTO "payment_modes" ("key", "label", "requires_due_date", "sort") VALUES
	('CHEQUE', 'Chèque', false, 10),
	('EFFET', 'Effet / LCN', true, 20),
	('VIREMENT', 'Virement', false, 30),
	('ESPECES', 'Espèces', false, 40)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- Dépôts : INTERNE = suivi par le journal de mouvements ; EXTERNE = stock confié à un distributeur,
-- connu seulement par les photos importées (Cospharma pour Gamarde, Pharmafirst pour Auracos).
CREATE TABLE IF NOT EXISTS "warehouses" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'INTERNE' NOT NULL,
	"sellable" boolean DEFAULT true NOT NULL,
	"notes" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "warehouses_kind_ck" CHECK ("kind" IN ('INTERNE', 'EXTERNE'))
);--> statement-breakpoint
INSERT INTO "warehouses" ("key", "label", "kind", "sellable", "notes", "sort") VALUES
	('PRINCIPAL', 'Entrepôt COMANET', 'INTERNE', true, NULL, 10),
	('NON_VENDABLE', 'Non vendable (abîmé, périmé)', 'INTERNE', false, 'Retours abîmés ou périmés : hors stock disponible.', 20),
	('COSPHARMA', 'Dépôt Cospharma', 'EXTERNE', true, 'Stock confié au distributeur, mis à jour par import.', 30),
	('PHARMAFIRST', 'Dépôt Pharmafirst', 'EXTERNE', true, 'Stock confié au distributeur, mis à jour par import.', 40)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Clients : identité légale et conditions commerciales (le client reste le point de vente)
-- ---------------------------------------------------------------------------
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "account_code" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "legal_name" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "ice" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "if_number" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "rc" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "patente" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "billing_address" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "postal_code" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "email" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "contact_name" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "account_manager_id" uuid;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "default_discount_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "payment_mode_key" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "payment_days" integer;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "credit_limit" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "blocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "blocked_reason" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "clients" ADD CONSTRAINT "clients_account_manager_id_users_id_fk" FOREIGN KEY ("account_manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "clients" ADD CONSTRAINT "clients_payment_mode_key_payment_modes_key_fk" FOREIGN KEY ("payment_mode_key") REFERENCES "public"."payment_modes"("key") ON DELETE no action ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "clients" ADD CONSTRAINT "clients_discount_ck" CHECK ("default_discount_pct" IS NULL OR ("default_discount_pct" >= 0 AND "default_discount_pct" < 100));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "clients_account_code_uq" ON "clients" USING btree ("account_code") WHERE "account_code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_ice_idx" ON "clients" USING btree ("ice");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clients_account_manager_idx" ON "clients" USING btree ("account_manager_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "client_delivery_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"label" text NOT NULL,
	"address" text NOT NULL,
	"city" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_delivery_addresses" ADD CONSTRAINT "client_delivery_addresses_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_delivery_addresses_client_idx" ON "client_delivery_addresses" USING btree ("client_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "client_brand_discounts" (
	"client_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"discount_pct" numeric(5, 2) NOT NULL,
	CONSTRAINT "client_brand_discounts_pk" PRIMARY KEY("client_id","brand_id"),
	CONSTRAINT "client_brand_discounts_pct_ck" CHECK ("discount_pct" >= 0 AND "discount_pct" < 100)
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_brand_discounts" ADD CONSTRAINT "client_brand_discounts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_brand_discounts" ADD CONSTRAINT "client_brand_discounts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Articles : référence COMANET, EAN, nature, TVA, conditionnement, suivi des lots
-- ---------------------------------------------------------------------------
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "code" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "ean" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "kind" text DEFAULT 'PRODUIT' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tax_rate_key" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "unit" text DEFAULT 'unité' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "pack_size" integer;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "track_lots" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "last_purchase_price" numeric(12, 2);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "products" ADD CONSTRAINT "products_kind_ck" CHECK ("kind" IN ('PRODUIT', 'SERVICE'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "products" ADD CONSTRAINT "products_tax_rate_key_tax_rates_key_fk" FOREIGN KEY ("tax_rate_key") REFERENCES "public"."tax_rates"("key") ON DELETE no action ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_code_uq" ON "products" USING btree ("code") WHERE "code" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "products_ean_uq" ON "products" USING btree ("ean") WHERE "ean" IS NOT NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Fournisseurs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text,
	"legal_name" text NOT NULL,
	"name_key" text NOT NULL,
	"nature" text DEFAULT 'MARCHANDISES' NOT NULL,
	"ice" text,
	"if_number" text,
	"rc" text,
	"country" text DEFAULT 'Maroc' NOT NULL,
	"currency" text DEFAULT 'MAD' NOT NULL,
	"address" text,
	"city" text,
	"contact_name" text,
	"email" text,
	"phone" text,
	"payment_days" integer,
	"payment_mode_key" text,
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_nature_ck" CHECK ("nature" IN ('MARCHANDISES', 'HORS_STOCK'))
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_payment_mode_key_payment_modes_key_fk" FOREIGN KEY ("payment_mode_key") REFERENCES "public"."payment_modes"("key") ON DELETE no action ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_code_uq" ON "suppliers" USING btree ("code") WHERE "code" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "suppliers_name_key_idx" ON "suppliers" USING btree ("name_key");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "supplier_brands" (
	"supplier_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	CONSTRAINT "supplier_brands_pk" PRIMARY KEY("supplier_id","brand_id")
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "supplier_brands" ADD CONSTRAINT "supplier_brands_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "supplier_brands" ADD CONSTRAINT "supplier_brands_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "supplier_brands_brand_idx" ON "supplier_brands" USING btree ("brand_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Stock : lots et journal de mouvements (écriture seule)
-- ---------------------------------------------------------------------------
ALTER TABLE "stock_snapshots" ADD COLUMN IF NOT EXISTS "warehouse_key" text;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_snapshots" ADD CONSTRAINT "stock_snapshots_warehouse_key_warehouses_key_fk" FOREIGN KEY ("warehouse_key") REFERENCES "public"."warehouses"("key") ON DELETE no action ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stock_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_number" text NOT NULL,
	"expiry_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_lots" ADD CONSTRAINT "stock_lots_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_lots_product_lot_uq" ON "stock_lots" USING btree ("product_id","lot_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_lots_expiry_idx" ON "stock_lots" USING btree ("expiry_date");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid,
	"warehouse_key" text DEFAULT 'PRINCIPAL' NOT NULL,
	"counterpart_warehouse_key" text,
	"type" text NOT NULL,
	"quantity" numeric(12, 3) NOT NULL,
	"unit_cost" numeric(14, 4),
	"cmup_after" numeric(14, 4),
	"date" date NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid,
	"source_line_id" uuid,
	"reversal_of" uuid,
	"comment" text,
	"import_id" uuid,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_quantity_ck" CHECK ("quantity" <> 0),
	CONSTRAINT "stock_movements_type_ck" CHECK ("type" IN ('STOCK_INITIAL', 'ENTREE_ACHAT', 'SORTIE_BL', 'RETOUR_CLIENT', 'RETOUR_FOURNISSEUR', 'AJUSTEMENT_INVENTAIRE', 'CASSE_PERIME', 'ECHANTILLON_MARKETING', 'TRANSFERT'))
);--> statement-breakpoint
-- Aucune cascade : un article, un lot, un dépôt ou un import qui a des mouvements ne se supprime pas.
DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_warehouse_key_warehouses_key_fk" FOREIGN KEY ("warehouse_key") REFERENCES "public"."warehouses"("key") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_counterpart_warehouse_key_warehouses_key_fk" FOREIGN KEY ("counterpart_warehouse_key") REFERENCES "public"."warehouses"("key") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reversal_of_stock_movements_id_fk" FOREIGN KEY ("reversal_of") REFERENCES "public"."stock_movements"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_movements_product_date_idx" ON "stock_movements" USING btree ("product_id","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_movements_product_seq_idx" ON "stock_movements" USING btree ("product_id","seq");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_movements_lot_idx" ON "stock_movements" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_movements_source_idx" ON "stock_movements" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "stock_movements_import_idx" ON "stock_movements" USING btree ("import_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "stock_movements_reversal_uq" ON "stock_movements" USING btree ("reversal_of") WHERE "reversal_of" IS NOT NULL;--> statement-breakpoint

-- Le journal est en écriture seule : ni modification, ni suppression, ni TRUNCATE (même en cascade).
CREATE OR REPLACE FUNCTION "stock_movements_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Le journal de stock est en écriture seule : une erreur se corrige par un mouvement inverse.';
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "stock_movements_no_change" ON "stock_movements";--> statement-breakpoint
CREATE TRIGGER "stock_movements_no_change" BEFORE UPDATE OR DELETE ON "stock_movements" FOR EACH ROW EXECUTE FUNCTION "stock_movements_append_only"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "stock_movements_no_truncate" ON "stock_movements";--> statement-breakpoint
CREATE TRIGGER "stock_movements_no_truncate" BEFORE TRUNCATE ON "stock_movements" FOR EACH STATEMENT EXECUTE FUNCTION "stock_movements_append_only"();--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Numérotation des pièces : séries (format réglable) et compteur par année
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "document_series" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"pattern" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);--> statement-breakpoint
INSERT INTO "document_series" ("key", "label", "pattern", "sort") VALUES
	('BL', 'Bons de livraison', 'BL{AAAA}{N:5}', 10),
	('FA', 'Factures', 'FA{AAAA}{N:5}', 20),
	('AV', 'Avoirs', 'AV{AAAA}{N:5}', 30),
	('RC', 'Bons de retour client', 'RC{AAAA}{N:5}', 40),
	('CF', 'Commandes fournisseurs', 'CF{AAAA}{N:5}', 50),
	('BR', 'Bons de réception', 'BR{AAAA}{N:5}', 60),
	('INV', 'Inventaires', 'INV{AAAA}{N:3}', 70)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "document_sequences" (
	"series_key" text NOT NULL,
	"year" integer NOT NULL,
	"last_value" integer DEFAULT 0 NOT NULL,
	"issued_max" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_sequences_pk" PRIMARY KEY("series_key","year"),
	CONSTRAINT "document_sequences_values_ck" CHECK ("last_value" >= 0 AND "issued_max" >= 0 AND "last_value" >= "issued_max")
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_series_key_document_series_key_fk" FOREIGN KEY ("series_key") REFERENCES "public"."document_series"("key") ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Fichiers : logo et cachet de la société (même stockage que les autres fichiers)
-- ---------------------------------------------------------------------------
ALTER TABLE "content_assets" ADD COLUMN IF NOT EXISTS "company_slot" text;--> statement-breakpoint
ALTER TABLE "content_assets" DROP CONSTRAINT IF EXISTS "content_assets_owner_ck";--> statement-breakpoint
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_owner_ck" CHECK ((("content_id" IS NOT NULL)::int + ("activation_id" IS NOT NULL)::int + ("inventory_item_id" IS NOT NULL)::int + ("company_slot" IS NOT NULL)::int) = 1);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_assets_company_idx" ON "content_assets" USING btree ("company_slot","kind","version");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Droits : trois nouveaux modules (livraisons, facturation, achats)
-- ---------------------------------------------------------------------------
INSERT INTO "user_permissions" ("user_id", "module", "can_view", "can_create", "can_edit", "can_validate")
SELECT p."user_id", m.module, true, true, true, true
FROM "user_permissions" p
CROSS JOIN (VALUES ('livraisons'), ('facturation'), ('achats')) AS m(module)
WHERE p."module" = 'administration' AND p."can_validate"
ON CONFLICT ("user_id", "module") DO NOTHING;--> statement-breakpoint

INSERT INTO "role_templates" ("name", "description", "home_path", "scope", "flags", "sort_order")
SELECT 'Magasin', 'Bons de livraison, réceptions, comptage d''inventaire ; articles en lecture.', '/gestion', 'ALL'::"user_data_scope", '{}'::jsonb, 80
WHERE EXISTS (SELECT 1 FROM "role_templates") AND NOT EXISTS (SELECT 1 FROM "role_templates" WHERE "name" = 'Magasin');--> statement-breakpoint

INSERT INTO "role_template_permissions" ("template_id", "module", "can_view", "can_create", "can_edit", "can_validate")
SELECT t."id", m.module, m.v, m.c, m.e, m.va
FROM "role_templates" t
JOIN (VALUES
  ('Administrateur','livraisons',true,true,true,true), ('Administrateur','facturation',true,true,true,true), ('Administrateur','achats',true,true,true,true),
  ('Commercial / Trade','livraisons',true,true,true,true), ('Commercial / Trade','facturation',true,false,false,false),
  ('Magasin','livraisons',true,true,true,true), ('Magasin','stock',true,true,false,false), ('Magasin','produits',true,false,false,false),
  ('Magasin','taches',true,true,true,false)
) AS m(tname, module, v, c, e, va) ON m.tname = t."name"
ON CONFLICT ("template_id", "module") DO NOTHING;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Sécurité : RLS activée comme sur les autres tables (l'application passe par le rôle serveur)
-- ---------------------------------------------------------------------------
ALTER TABLE "tax_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_modes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "warehouses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_delivery_addresses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_brand_discounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "supplier_brands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_lots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_sequences" ENABLE ROW LEVEL SECURITY;
