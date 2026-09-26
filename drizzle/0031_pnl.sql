-- P&L (compte de résultat de gestion). Trois tables :
--  · pnl_charge_categories : postes de charges (référentiel modifiable), rangés par famille du P&L ;
--  · pnl_charges : charges saisies — ponctuelles (un mois) ou mensuelles récurrentes (du mois de début au mois de fin) ;
--  · pnl_bulk_sales : ventes en bloc à un distributeur (stock Gamarde / Ainhoa vendu à Cospharma à l'arrivage),
--    absentes des ventes importées : le CA et le coût d'achat de l'arrivage sont saisis.
-- Les ventes directes (sites COMANET) et les commissions de prestation (Pharmafirst) sont lues dans `sales`,
-- selon les règles de `settings.pnl`.

CREATE TABLE IF NOT EXISTS "pnl_charge_categories" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"grp" text NOT NULL,
	"sort" integer DEFAULT 100 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "pnl_charge_categories_grp_ck" CHECK ("grp" IN ('COMMERCIAL', 'PERSONNEL', 'STRUCTURE', 'FINANCIER', 'IMPOTS'))
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "pnl_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_key" text NOT NULL REFERENCES "pnl_charge_categories"("key") ON UPDATE CASCADE,
	"label" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"recurrence" text DEFAULT 'PONCTUELLE' NOT NULL,
	"start_month" date NOT NULL,
	"end_month" date,
	"brand_id" uuid REFERENCES "brands"("id") ON DELETE SET NULL,
	"notes" text,
	"created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pnl_charges_recurrence_ck" CHECK ("recurrence" IN ('PONCTUELLE', 'MENSUELLE')),
	CONSTRAINT "pnl_charges_months_ck" CHECK (extract(day from "start_month") = 1 AND ("end_month" IS NULL OR (extract(day from "end_month") = 1 AND "end_month" >= "start_month")))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pnl_charges_start_idx" ON "pnl_charges" ("start_month");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "pnl_bulk_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"brand_id" uuid NOT NULL REFERENCES "brands"("id") ON DELETE CASCADE,
	"client_id" uuid REFERENCES "clients"("id") ON DELETE SET NULL,
	"label" text NOT NULL,
	"quantity" numeric(14, 3),
	"amount_ht" numeric(14, 2) NOT NULL,
	"cost_amount" numeric(14, 2),
	"discount_pct" numeric(5, 2),
	"notes" text,
	"created_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pnl_bulk_sales_date_idx" ON "pnl_bulk_sales" ("date");
--> statement-breakpoint

INSERT INTO "pnl_charge_categories" ("key", "label", "grp", "sort") VALUES
	('REMISES_OPERATIONS', 'Remises sur opérations spéciales', 'COMMERCIAL', 10),
	('GRATUITES_DISTRIBUTEUR', 'Gratuités / avoirs distributeur (au coût d''achat)', 'COMMERCIAL', 20),
	('TRANSPORT', 'Transport et livraison', 'COMMERCIAL', 30),
	('COMMISSIONS', 'Commissions commerciales', 'COMMERCIAL', 40),
	('SALAIRES', 'Salaires nets', 'PERSONNEL', 10),
	('CHARGES_SOCIALES', 'Charges sociales (CNSS, AMO, IR)', 'PERSONNEL', 20),
	('ANIMATRICES', 'Animatrices', 'PERSONNEL', 30),
	('PRIMES', 'Primes et indemnités', 'PERSONNEL', 40),
	('LOYER', 'Loyer et charges locatives', 'STRUCTURE', 10),
	('TELECOM', 'Internet et téléphone', 'STRUCTURE', 20),
	('ENERGIE', 'Eau et électricité', 'STRUCTURE', 30),
	('HONORAIRES', 'Honoraires (comptable, juridique)', 'STRUCTURE', 40),
	('LOGICIELS', 'Logiciels et abonnements', 'STRUCTURE', 50),
	('VEHICULES', 'Véhicules et carburant', 'STRUCTURE', 60),
	('DEPLACEMENTS', 'Déplacements et voyages', 'STRUCTURE', 70),
	('FOURNITURES', 'Fournitures et petit matériel', 'STRUCTURE', 80),
	('ASSURANCES', 'Assurances', 'STRUCTURE', 90),
	('REGLEMENTAIRE', 'Frais réglementaires (DMP, dépôts)', 'STRUCTURE', 100),
	('AUTRES_STRUCTURE', 'Autres charges de structure', 'STRUCTURE', 200),
	('FRAIS_BANCAIRES', 'Frais bancaires', 'FINANCIER', 10),
	('INTERETS', 'Intérêts d''emprunt', 'FINANCIER', 20),
	('PERTES_CHANGE', 'Pertes de change', 'FINANCIER', 30),
	('IMPOT_SOCIETES', 'Impôt sur les sociétés', 'IMPOTS', 10),
	('TAXES', 'Taxes et impôts locaux', 'STRUCTURE', 110)
ON CONFLICT ("key") DO NOTHING;
