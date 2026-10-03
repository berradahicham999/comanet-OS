-- Médical v2 : une visite chronométrée est « en cours » entre « Démarrer » et « Terminer ».
-- Seule dans son fichier : Postgres refuse d'utiliser une valeur d'enum dans la transaction qui l'a créée,
-- et aucune migration n'en a besoin (l'unicité de la visite en cours porte sur started_at / ended_at).
ALTER TYPE "public"."medical_visit_status" ADD VALUE IF NOT EXISTS 'EN_COURS' BEFORE 'REALISEE';
--> statement-breakpoint
-- Ordonnances : nouveau type d'import (utilisé à l'exécution seulement, jamais dans une migration).
ALTER TYPE "public"."import_type" ADD VALUE IF NOT EXISTS 'PRESCRIPTIONS';
