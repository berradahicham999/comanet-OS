-- Rapports : une notification (cloche + téléphone) à chaque nouveau rapport, y compris ceux que les agents externes
-- écrivent directement en base. `notified_at` marque le rapport annoncé ; le balayage (`notifyNewReports()`, cron
-- horaire et chaque ouverture de page) le réserve par un UPDATE conditionnel, donc personne n'est notifié deux fois.
ALTER TABLE "ai_reports" ADD COLUMN IF NOT EXISTS "notified_at" timestamp with time zone;
--> statement-breakpoint
-- Les rapports déjà présents ne sont pas annoncés après coup (44 notifications d'un coup).
UPDATE "ai_reports" SET "notified_at" = "created_at" WHERE "notified_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_reports_unnotified_idx" ON "ai_reports" ("created_at") WHERE "notified_at" IS NULL;
