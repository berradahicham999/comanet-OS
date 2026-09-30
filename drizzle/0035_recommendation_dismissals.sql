-- Action Center : recommandations écartées à la main (réponse connue hors du logiciel : congés, accord verbal…).
-- Une ligne par clé de recommandation ; elle revient à « until » ou si sa priorité s'aggrave.

CREATE TABLE IF NOT EXISTS "recommendation_dismissals" (
	"key" text PRIMARY KEY NOT NULL,
	"rule" text NOT NULL,
	"title" text NOT NULL,
	"priority" "task_priority" NOT NULL,
	"reason" text,
	"until" timestamp with time zone NOT NULL,
	"dismissed_by_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"dismissed_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recommendation_dismissals" ENABLE ROW LEVEL SECURITY;
