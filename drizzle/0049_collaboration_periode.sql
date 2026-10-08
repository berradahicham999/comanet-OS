-- Influence : une collaboration couvre une période (souvent un ou deux mois), plus seulement un jour.
-- `date` reste la date de début ; `end_date` vide = collaboration d'un seul jour (historique inchangé).
ALTER TABLE "collaborations" ADD COLUMN IF NOT EXISTS "end_date" date;
--> statement-breakpoint
ALTER TABLE "collaborations" DROP CONSTRAINT IF EXISTS "collaborations_period_chk";
--> statement-breakpoint
ALTER TABLE "collaborations" ADD CONSTRAINT "collaborations_period_chk" CHECK ("end_date" IS NULL OR "end_date" >= "date");
