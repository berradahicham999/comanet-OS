CREATE TYPE "public"."doctor_interest" AS ENUM('FAIBLE', 'MOYEN', 'FORT');--> statement-breakpoint
CREATE TYPE "public"."doctor_potential" AS ENUM('A', 'B', 'C');--> statement-breakpoint
CREATE TYPE "public"."doctor_status" AS ENUM('NOUVEAU', 'ACTIF', 'A_REACTIVER', 'INACTIF');--> statement-breakpoint
CREATE TYPE "public"."medical_visit_status" AS ENUM('PLANIFIEE', 'REALISEE', 'ANNULEE', 'REPORTEE', 'NON_EFFECTUEE');--> statement-breakpoint
CREATE TYPE "public"."sample_movement_type" AS ENUM('ENTREE', 'SORTIE_VISITE', 'TRANSFERT', 'AJUSTEMENT');--> statement-breakpoint
ALTER TYPE "public"."import_type" ADD VALUE IF NOT EXISTS 'MEDECINS';--> statement-breakpoint
ALTER TYPE "public"."task_source" ADD VALUE IF NOT EXISTS 'MEDICAL';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'DELEGUE_MEDICAL';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE IF NOT EXISTS 'MANAGER_MEDICAL';--> statement-breakpoint
CREATE TABLE "doctor_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"delegate_id" uuid,
	"date" date NOT NULL,
	"duration_minutes" integer,
	"gps_lat" numeric(9, 6),
	"gps_lng" numeric(9, 6),
	"visit_type" text DEFAULT 'VISITE' NOT NULL,
	"objective" text,
	"result" text,
	"doctor_interest" "doctor_interest",
	"comment" text,
	"next_action" text,
	"next_visit_date" date,
	"status" "medical_visit_status" DEFAULT 'PLANIFIEE' NOT NULL,
	"dedupe_key" text,
	"import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"email" text,
	"specialty_id" uuid,
	"sub_specialty" text,
	"address_line" text,
	"city" text,
	"sector_id" uuid,
	"gps_lat" numeric(9, 6),
	"gps_lng" numeric(9, 6),
	"delegate_id" uuid,
	"status" "doctor_status" DEFAULT 'NOUVEAU' NOT NULL,
	"potential" "doctor_potential",
	"visit_frequency_days" integer,
	"last_visit_at" timestamp with time zone,
	"comments" text,
	"notes" text,
	"dedupe_key" text,
	"import_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medical_delegate_sectors" (
	"delegate_id" uuid NOT NULL,
	"sector_id" uuid NOT NULL,
	CONSTRAINT "medical_delegate_sectors_delegate_id_sector_id_pk" PRIMARY KEY("delegate_id","sector_id")
);
--> statement-breakpoint
CREATE TABLE "medical_delegates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"zone" text,
	"monthly_visit_objective" integer DEFAULT 0 NOT NULL,
	"weekly_visit_objective" integer DEFAULT 0 NOT NULL,
	"manager_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medical_delegates_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "medical_sectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"city" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medical_specialties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "medical_specialties_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sample_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delegate_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"type" "sample_movement_type" NOT NULL,
	"quantity" integer NOT NULL,
	"visit_id" uuid,
	"date" date NOT NULL,
	"comment" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"product_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visit_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visit_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "doctor_visits" ADD CONSTRAINT "doctor_visits_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_visits" ADD CONSTRAINT "doctor_visits_delegate_id_users_id_fk" FOREIGN KEY ("delegate_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_visits" ADD CONSTRAINT "doctor_visits_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_specialty_id_medical_specialties_id_fk" FOREIGN KEY ("specialty_id") REFERENCES "public"."medical_specialties"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_sector_id_medical_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."medical_sectors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_delegate_id_users_id_fk" FOREIGN KEY ("delegate_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_delegate_sectors" ADD CONSTRAINT "medical_delegate_sectors_delegate_id_medical_delegates_id_fk" FOREIGN KEY ("delegate_id") REFERENCES "public"."medical_delegates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_delegate_sectors" ADD CONSTRAINT "medical_delegate_sectors_sector_id_medical_sectors_id_fk" FOREIGN KEY ("sector_id") REFERENCES "public"."medical_sectors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_delegates" ADD CONSTRAINT "medical_delegates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_delegates" ADD CONSTRAINT "medical_delegates_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_movements" ADD CONSTRAINT "sample_movements_delegate_id_users_id_fk" FOREIGN KEY ("delegate_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_movements" ADD CONSTRAINT "sample_movements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_movements" ADD CONSTRAINT "sample_movements_visit_id_doctor_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."doctor_visits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sample_movements" ADD CONSTRAINT "sample_movements_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_products" ADD CONSTRAINT "visit_products_visit_id_doctor_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."doctor_visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_products" ADD CONSTRAINT "visit_products_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_samples" ADD CONSTRAINT "visit_samples_visit_id_doctor_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."doctor_visits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visit_samples" ADD CONSTRAINT "visit_samples_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "doctor_visits_doctor_idx" ON "doctor_visits" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "doctor_visits_delegate_idx" ON "doctor_visits" USING btree ("delegate_id");--> statement-breakpoint
CREATE INDEX "doctor_visits_date_idx" ON "doctor_visits" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "doctor_visits_dedupe_uq" ON "doctor_visits" USING btree ("dedupe_key") WHERE dedupe_key is not null;--> statement-breakpoint
CREATE INDEX "doctors_sector_idx" ON "doctors" USING btree ("sector_id");--> statement-breakpoint
CREATE INDEX "doctors_delegate_idx" ON "doctors" USING btree ("delegate_id");--> statement-breakpoint
CREATE INDEX "doctors_specialty_idx" ON "doctors" USING btree ("specialty_id");--> statement-breakpoint
CREATE INDEX "doctors_import_idx" ON "doctors" USING btree ("import_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doctors_dedupe_uq" ON "doctors" USING btree ("dedupe_key") WHERE dedupe_key is not null;--> statement-breakpoint
CREATE INDEX "medical_delegate_sectors_sector_idx" ON "medical_delegate_sectors" USING btree ("sector_id");--> statement-breakpoint
CREATE INDEX "medical_delegates_manager_idx" ON "medical_delegates" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "sample_movements_delegate_product_idx" ON "sample_movements" USING btree ("delegate_id","product_id");--> statement-breakpoint
CREATE INDEX "sample_movements_visit_idx" ON "sample_movements" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "visit_products_visit_idx" ON "visit_products" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "visit_samples_visit_idx" ON "visit_samples" USING btree ("visit_id");
