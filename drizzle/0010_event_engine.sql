-- Event Engine — premier flux : ANIMATION_COMPLETED.
--
-- Ce que ces deux tables apportent, et que rien ne pouvait donner jusqu'ici :
--
--  · `events` est le journal de ce qui S'EST PASSÉ, avec son statut de traitement. Les
--    recommandations de l'Action Center restent calculées à la lecture — cette table ne
--    stocke aucun KPI, aucun agrégat, aucune recommandation. Elle enregistre un fait daté
--    et ce qu'il a déclenché.
--  · `event_consequences` répond à « pourquoi cette tâche existe ». Une règle évaluée à la
--    lecture voit qu'un produit est sous le seuil ; elle ne saura jamais DEPUIS QUAND ni À
--    CAUSE DE QUOI. C'est ce franchissement, daté et causé, qui est conservé ici — et c'est
--    ce dont la mesure d'impact (phase ultérieure) aura besoin.
--
-- Idempotence : `events.dedupe_key` est unique et porte l'identifiant de l'animation, pas le
-- quadruplet jour|ville|POS|animatrice. Renommer un point de vente ne change donc pas
-- l'identité de l'événement. Une animation corrigée réutilise la même clé : la ligne est
-- mise à jour, `revision` est incrémentée et le statut repasse à `pending`.
--
-- Réversible : le bloc de retour en fin de fichier supprime exactement ce qui est créé ici.

CREATE TABLE IF NOT EXISTS "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"dedupe_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"processed_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"revision" integer DEFAULT 1 NOT NULL
);--> statement-breakpoint

-- Une seule ligne par fait métier : c'est ce qui rend le rejeu sans danger.
CREATE UNIQUE INDEX IF NOT EXISTS "events_dedupe_uq" ON "events" USING btree ("dedupe_key");--> statement-breakpoint
-- Le rattrapage lit « les plus vieux en attente » : l'index porte le filtre et l'ordre.
CREATE INDEX IF NOT EXISTS "events_pending_idx" ON "events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_entity_idx" ON "events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "events_type_idx" ON "events" USING btree ("type","occurred_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "event_consequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"outcome" text NOT NULL,
	"recommendation_key" text,
	"task_id" uuid,
	"entity_type" text,
	"entity_id" uuid,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

ALTER TABLE "event_consequences" ADD CONSTRAINT "event_consequences_event_id_events_id_fk"
	FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_consequences" ADD CONSTRAINT "event_consequences_task_id_tasks_id_fk"
	FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "event_consequences_event_idx" ON "event_consequences" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_consequences_task_idx" ON "event_consequences" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "event_consequences_entity_idx" ON "event_consequences" USING btree ("entity_type","entity_id","created_at");--> statement-breakpoint

-- Retraitement d'un même événement : une seule conséquence par (événement, règle, entité).
CREATE UNIQUE INDEX IF NOT EXISTS "event_consequences_uq"
	ON "event_consequences" USING btree ("event_id","rule_id","entity_id");--> statement-breakpoint

-- UNE SEULE TÂCHE OUVERTE PAR RECOMMANDATION, garantie par la base.
--
-- `createTaskFromRecommendation()` vérifiait déjà l'unicité, mais en deux temps (lecture puis
-- écriture) et hors transaction : deux événements traités en parallèle sur le même produit
-- créaient deux tâches. L'index est PARTIEL sur les statuts ouverts, pour que la re-création
-- d'une tâche après clôture — comportement voulu — reste possible.
-- Vérifié avant migration : aucun doublon existant en production.
CREATE UNIQUE INDEX IF NOT EXISTS "tasks_open_source_key_uq"
	ON "tasks" USING btree ("source_key")
	WHERE "source_key" IS NOT NULL AND "status" IN ('TODO','IN_PROGRESS');--> statement-breakpoint

-- Retour en arrière (à exécuter à la main, dans cet ordre) :
--
--   DROP INDEX IF EXISTS "tasks_open_source_key_uq";
--   DROP TABLE IF EXISTS "event_consequences";
--   DROP TABLE IF EXISTS "events";
--
-- Aucune donnée métier n'est perdue : ces tables n'en contiennent aucune qui ne soit
-- dérivable des animations, du stock et des tâches. Les tâches créées par le moteur
-- survivent au retour en arrière, elles ne perdent que leur traçabilité.
