-- Médical : reprise de l'historique des visites d'un CRM (copie unique, rejouable sans doublon).
-- Les visites reprises sont HISTORIQUE (hors contrôle GPS) ; une VM sans compte COMANET OS garde son nom
-- sur la visite (delegate_label), sans qu'aucun compte ne soit créé.
ALTER TYPE "public"."import_type" ADD VALUE IF NOT EXISTS 'VISITES_MEDICALES';--> statement-breakpoint
ALTER TABLE "doctor_visits" ADD COLUMN IF NOT EXISTS "delegate_label" text;--> statement-breakpoint
ALTER TABLE "doctor_visits" DROP CONSTRAINT IF EXISTS "doctor_visits_timing_source_ck";--> statement-breakpoint
ALTER TABLE "doctor_visits" ADD CONSTRAINT "doctor_visits_timing_source_ck" CHECK ("timing_source" IN ('CHRONO', 'SAISIE_MANUELLE', 'AVANT_CHRONO', 'HISTORIQUE'));--> statement-breakpoint
ALTER TABLE "doctors" DROP CONSTRAINT IF EXISTS "doctors_gps_source_ck";--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_gps_source_ck" CHECK ("gps_source" IS NULL OR "gps_source" IN ('PREMIERE_VISITE', 'MANUELLE', 'ADRESSE', 'HISTORIQUE'));
