CREATE TYPE "public"."data_scope" AS ENUM('ALL', 'TEAM', 'OWN');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_name" text NOT NULL,
	"action" varchar(50) NOT NULL,
	"module" varchar(50),
	"entity" varchar(50) NOT NULL,
	"entity_id" uuid,
	"entity_label" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"module" varchar(50) NOT NULL,
	"can_view" boolean DEFAULT false NOT NULL,
	"can_create" boolean DEFAULT false NOT NULL,
	"can_edit" boolean DEFAULT false NOT NULL,
	"can_delete" boolean DEFAULT false NOT NULL,
	"can_export" boolean DEFAULT false NOT NULL,
	"can_admin" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(50) NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"home_path" text DEFAULT '/' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "user_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"module" varchar(50),
	"data_scope" "data_scope" DEFAULT 'ALL' NOT NULL,
	"brand_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"cities" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "manager_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_scopes" ADD CONSTRAINT "user_scopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_role_module_uq" ON "role_permissions" USING btree ("role_id","module");--> statement-breakpoint
CREATE INDEX "role_permissions_role_idx" ON "role_permissions" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "user_roles_role_idx" ON "user_roles" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_scopes_user_module_uq" ON "user_scopes" USING btree ("user_id",coalesce("module", '*'));--> statement-breakpoint
CREATE INDEX "user_scopes_user_idx" ON "user_scopes" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_manager_id_users_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- RLS sur les nouvelles tables, comme 0004_indexes_rls.sql l'a fait pour les tables publiques :
-- l'application passe par une connexion directe (rôle propriétaire), donc sans effet sur elle ;
-- cela ferme uniquement l'accès REST public de Supabase.
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_scopes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Seed : les 7 rôles système reprennent les valeurs de l'enum user_role.
-- `priority` départage la page d'accueil quand une personne cumule plusieurs rôles.
INSERT INTO "roles" ("key", "name", "description", "home_path", "priority", "is_system") VALUES
	('ADMIN', 'Admin / DG', 'Accès complet à COMANET OS, y compris les paramètres.', '/', 100, true),
	('MANAGER_MEDICAL', 'Manager médical', 'Pilotage du réseau médical : délégués, secteurs, échantillons.', '/medical', 60, true),
	('MARKETING', 'Marketing', 'Campagnes, digital ads, influence, planning éditorial et budgets.', '/marketing', 50, true),
	('REGLEMENTAIRE', 'Réglementaire', 'Dossiers réglementaires et suivi des échéances.', '/reglementaire', 45, true),
	('TRADE', 'Trade', 'Ventes, clients, stock et imports Sage.', '/', 40, true),
	('DELEGUE_MEDICAL', 'Délégué médical', 'Ses médecins, ses visites et ses échantillons.', '/medical/visites/saisie', 30, true),
	('ANIMATRICE', 'Animatrice', 'Saisie terrain et suivi de ses animations.', '/terrain/saisie', 20, true)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint

-- ADMIN : tous les modules, toutes les actions, y compris l'administration.
INSERT INTO "role_permissions" ("role_id", "module", "can_view", "can_create", "can_edit", "can_delete", "can_export", "can_admin")
SELECT r."id", m."module", true, true, true, true, true, true
FROM "roles" r
CROSS JOIN (VALUES
	('cockpit'), ('actions'), ('ventes'), ('clients'), ('produits'), ('marques'), ('stock'),
	('terrain'), ('terrain_animatrices'), ('reglementaire'), ('marketing'), ('medical'),
	('medical_admin'), ('taches'), ('imports'), ('parametres'), ('recherche')
) AS m("module")
WHERE r."key" = 'ADMIN'
ON CONFLICT ("role_id", "module") DO NOTHING;--> statement-breakpoint

-- Les autres rôles reprennent exactement la matrice MODULES d'avant le refactor.
-- Toutes les actions sont accordées (sauf l'administration) : avant ce chantier,
-- l'accès à un module donnait déjà le droit d'y créer, modifier et supprimer.
INSERT INTO "role_permissions" ("role_id", "module", "can_view", "can_create", "can_edit", "can_delete", "can_export", "can_admin")
SELECT r."id", m."module", true, true, true, true, true, false
FROM "roles" r
JOIN (VALUES
	('MARKETING', 'cockpit'), ('MARKETING', 'actions'), ('MARKETING', 'ventes'), ('MARKETING', 'produits'),
	('MARKETING', 'marques'), ('MARKETING', 'stock'), ('MARKETING', 'marketing'), ('MARKETING', 'taches'),
	('MARKETING', 'recherche'),
	('TRADE', 'cockpit'), ('TRADE', 'actions'), ('TRADE', 'ventes'), ('TRADE', 'clients'), ('TRADE', 'produits'),
	('TRADE', 'marques'), ('TRADE', 'stock'), ('TRADE', 'terrain'), ('TRADE', 'terrain_animatrices'),
	('TRADE', 'taches'), ('TRADE', 'imports'), ('TRADE', 'recherche'),
	('REGLEMENTAIRE', 'cockpit'), ('REGLEMENTAIRE', 'actions'), ('REGLEMENTAIRE', 'produits'),
	('REGLEMENTAIRE', 'marques'), ('REGLEMENTAIRE', 'reglementaire'), ('REGLEMENTAIRE', 'taches'),
	('REGLEMENTAIRE', 'recherche'),
	('ANIMATRICE', 'terrain'), ('ANIMATRICE', 'taches'),
	('MANAGER_MEDICAL', 'medical'), ('MANAGER_MEDICAL', 'medical_admin'), ('MANAGER_MEDICAL', 'taches'),
	('DELEGUE_MEDICAL', 'medical'), ('DELEGUE_MEDICAL', 'taches')
) AS m("role_key", "module") ON m."role_key" = r."key"
ON CONFLICT ("role_id", "module") DO NOTHING;--> statement-breakpoint

-- Chaque utilisateur existant reçoit le rôle correspondant à son enum : personne ne gagne
-- ni ne perd d'accès au premier déploiement.
INSERT INTO "user_roles" ("user_id", "role_id")
SELECT u."id", r."id"
FROM "users" u
JOIN "roles" r ON r."key" = u."role"::text
ON CONFLICT ("user_id", "role_id") DO NOTHING;