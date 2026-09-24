-- Gestion commerciale — lot 5 : règlements (encaissements, imputations, relances) et bascule
-- (reprise des factures ouvertes de Sage). Idempotente et additive : l'ancien code la supporte.

INSERT INTO "document_series" ("key", "label", "pattern", "sort") VALUES
	('RG', 'Règlements clients', 'RG{AAAA}{N:5}', 100)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- Un virement ou des espèces sont encaissés à la réception ; un chèque ou un effet passe par le portefeuille.
ALTER TABLE "payment_modes" ADD COLUMN IF NOT EXISTS "collected_on_receipt" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "payment_modes" SET "collected_on_receipt" = true WHERE "key" IN ('VIREMENT', 'ESPECES');--> statement-breakpoint

-- Facture reprise de Sage à la bascule : déjà réglée en partie avant la reprise.
ALTER TABLE "sales_documents" ADD COLUMN IF NOT EXISTS "reprise_paid" numeric(14, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"series_key" text,
	"fiscal_year" integer,
	"client_id" uuid NOT NULL,
	"date" date NOT NULL,
	"mode_key" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"reference" text,
	"bank" text,
	"due_date" date,
	"status" text NOT NULL,
	"is_simulation" boolean DEFAULT true NOT NULL,
	"deposited_at" date,
	"collected_at" date,
	"bounced_at" date,
	"status_reason" text,
	"notes" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_status_ck" CHECK ("status" IN ('PORTEFEUILLE', 'REMIS', 'ENCAISSE', 'IMPAYE', 'ANNULE')),
	CONSTRAINT "payments_amount_ck" CHECK ("amount" > 0)
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_mode_key_fk" FOREIGN KEY ("mode_key") REFERENCES "public"."payment_modes"("key") ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_series_key_fk" FOREIGN KEY ("series_key") REFERENCES "public"."document_series"("key") ON DELETE restrict ON UPDATE cascade;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payments_number_uq" ON "payments" USING btree ("number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_client_idx" ON "payments" USING btree ("client_id", "date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments" USING btree ("status", "due_date");--> statement-breakpoint

-- Imputation (lettrage) : un règlement OU un avoir soldent tout ou partie d'une facture.
CREATE TABLE IF NOT EXISTS "payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"payment_id" uuid,
	"credit_note_id" uuid,
	"amount" numeric(14, 2) NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_source_ck" CHECK (("payment_id" IS NOT NULL)::int + ("credit_note_id" IS NOT NULL)::int = 1),
	CONSTRAINT "payment_allocations_amount_ck" CHECK ("amount" > 0)
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."sales_documents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_credit_note_id_fk" FOREIGN KEY ("credit_note_id") REFERENCES "public"."sales_documents"("id") ON DELETE restrict ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_allocations_invoice_idx" ON "payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_allocations_payment_idx" ON "payment_allocations" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_allocations_credit_idx" ON "payment_allocations" USING btree ("credit_note_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "payment_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"channel" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"invoices" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"sent_by_id" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_reminders_client_idx" ON "payment_reminders" USING btree ("client_id", "sent_at");--> statement-breakpoint

-- Un règlement enregistré garde son client, son montant, sa date, son mode et son numéro ; seul son statut
-- avance (portefeuille → remis → encaissé / impayé ; annulé depuis le portefeuille). Il ne se supprime pas.
CREATE OR REPLACE FUNCTION "payments_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Règlement % : il ne se supprime pas (annulation ou impayé).', OLD."number";
  END IF;
  IF (NEW."number", NEW."client_id", NEW."amount", NEW."date", NEW."mode_key", NEW."is_simulation")
     IS DISTINCT FROM (OLD."number", OLD."client_id", OLD."amount", OLD."date", OLD."mode_key", OLD."is_simulation") THEN
    RAISE EXCEPTION 'Règlement % : client, montant, date et mode ne se modifient pas.', OLD."number";
  END IF;
  IF OLD."status" IN ('ENCAISSE', 'IMPAYE', 'ANNULE') AND NEW."status" <> OLD."status"
     AND NOT (OLD."status" = 'ENCAISSE' AND NEW."status" = 'IMPAYE') THEN
    RAISE EXCEPTION 'Règlement % : statut % définitif.', OLD."number", OLD."status";
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "payments_guard" ON "payments";--> statement-breakpoint
CREATE TRIGGER "payments_guard" BEFORE UPDATE OR DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION "payments_guard"();--> statement-breakpoint

-- Le montant déjà réglé d'une facture reprise se fige avec elle.
CREATE OR REPLACE FUNCTION "sales_documents_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."number" IS NOT NULL THEN
      RAISE EXCEPTION 'Pièce % : une pièce numérotée ne se supprime pas (annulation ou avoir).', OLD."number";
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'BROUILLON' THEN
    IF NEW."status" = 'BROUILLON' THEN
      RAISE EXCEPTION 'Pièce % : une pièce validée ne redevient pas un brouillon.', OLD."number";
    END IF;
    IF (NEW."number", NEW."type", NEW."date", NEW."client_id", NEW."client_snapshot", NEW."company_snapshot", NEW."gross_ht", NEW."net_ht",
        NEW."vat_total", NEW."ttc", NEW."vat_breakdown", NEW."global_discount_pct", NEW."series_key", NEW."is_simulation", NEW."origin_document_id",
        NEW."due_date", NEW."payment_days", NEW."payment_mode_key", NEW."site", NEW."delivery_address", NEW."amount_in_words", NEW."content_hash", NEW."reprise_paid")
       IS DISTINCT FROM
       (OLD."number", OLD."type", OLD."date", OLD."client_id", OLD."client_snapshot", OLD."company_snapshot", OLD."gross_ht", OLD."net_ht",
        OLD."vat_total", OLD."ttc", OLD."vat_breakdown", OLD."global_discount_pct", OLD."series_key", OLD."is_simulation", OLD."origin_document_id",
        OLD."due_date", OLD."payment_days", OLD."payment_mode_key", OLD."site", OLD."delivery_address", OLD."amount_in_words", OLD."content_hash", OLD."reprise_paid") THEN
      RAISE EXCEPTION 'Pièce % : validée, elle n''est plus modifiable (corriger par un avoir).', OLD."number";
    END IF;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint

-- Avoirs validés avant ce lot : imputés sur leur facture d'origine, comme le fait désormais la validation
-- (la somme des avoirs d'une facture ne dépasse jamais son TTC : l'imputation est toujours complète).
INSERT INTO "payment_allocations" ("invoice_id", "credit_note_id", "amount")
SELECT v."origin_document_id", v."id", v."ttc"
FROM "sales_documents" v
WHERE v."type" = 'AVOIR' AND v."status" <> 'BROUILLON' AND v."origin_document_id" IS NOT NULL AND v."ttc" > 0
  AND NOT EXISTS (SELECT 1 FROM "payment_allocations" a WHERE a."credit_note_id" = v."id");--> statement-breakpoint

ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_reminders" ENABLE ROW LEVEL SECURITY;
