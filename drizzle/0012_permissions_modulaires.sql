-- Permissions modulaires par utilisateur.
--
-- Les rôles figés (`roles` → `role_permissions` → `user_roles`) sont remplacés par une
-- matrice PROPRE à chaque utilisateur (`user_permissions`), une portée globale
-- (`user_scope`), des assignations de marques et de clients, et six interrupteurs
-- transverses (`user_flags`). Les modèles de rôle (`role_templates`) ne servent plus
-- qu'à pré-remplir : aucun lien n'est conservé avec l'utilisateur après application.
--
-- Cette migration NE SUPPRIME PAS les anciennes tables : elles sont laissées en place,
-- inutilisées, jusqu'à ce que tous les comptes aient été vérifiés en production.
-- `users.role` (enum) reste en lecture seule, recalculée par l'application.
--
-- Remappage des 17 anciens modules vers les 14 nouveaux :
--   produits + marques         → produits
--   stock                      → stock
--   marketing                  → marketing + influence + budgets + assets
--   terrain + terrain_animatrices → terrain (animatrices = Valider)
--   medical + medical_admin    → medical (admin = Valider)
--   parametres                 → administration (Valider = ancien « administrer »)
--   imports                    → supprimé : importer = Créer sur le module concerné
--   cockpit, actions, recherche → supprimés : visibles dès qu'un module l'est
--   ventes                     → ventes (+ rapports en lecture)

CREATE TYPE "public"."user_data_scope" AS ENUM('OWN', 'ASSIGNED', 'ALL');--> statement-breakpoint

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_login_at" timestamp with time zone;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_permissions" (
	"user_id" uuid NOT NULL,
	"module" varchar(50) NOT NULL,
	"can_view" boolean DEFAULT false NOT NULL,
	"can_create" boolean DEFAULT false NOT NULL,
	"can_edit" boolean DEFAULT false NOT NULL,
	"can_validate" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_permissions_user_id_module_pk" PRIMARY KEY("user_id","module"),
	CONSTRAINT "user_permissions_view_implied" CHECK ("can_view" OR NOT ("can_create" OR "can_edit" OR "can_validate"))
);--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_scope" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"scope" "user_data_scope" DEFAULT 'ALL' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "user_scope" ADD CONSTRAINT "user_scope_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_brand_assignments" (
	"user_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	CONSTRAINT "user_brand_assignments_user_id_brand_id_pk" PRIMARY KEY("user_id","brand_id")
);--> statement-breakpoint
ALTER TABLE "user_brand_assignments" ADD CONSTRAINT "user_brand_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_brand_assignments" ADD CONSTRAINT "user_brand_assignments_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_brand_assignments_brand_idx" ON "user_brand_assignments" USING btree ("brand_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_client_assignments" (
	"user_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	CONSTRAINT "user_client_assignments_user_id_client_id_pk" PRIMARY KEY("user_id","client_id")
);--> statement-breakpoint
ALTER TABLE "user_client_assignments" ADD CONSTRAINT "user_client_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_client_assignments" ADD CONSTRAINT "user_client_assignments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_client_assignments_client_idx" ON "user_client_assignments" USING btree ("client_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "user_flags" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"see_margins" boolean DEFAULT false NOT NULL,
	"see_global_budgets" boolean DEFAULT false NOT NULL,
	"see_internal_costs" boolean DEFAULT false NOT NULL,
	"approve_spend" boolean DEFAULT false NOT NULL,
	"export_data" boolean DEFAULT false NOT NULL,
	"read_activity_log" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "user_flags" ADD CONSTRAINT "user_flags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "role_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"home_path" text DEFAULT '/' NOT NULL,
	"scope" "user_data_scope" DEFAULT 'ALL' NOT NULL,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "role_template_permissions" (
	"template_id" uuid NOT NULL,
	"module" varchar(50) NOT NULL,
	"can_view" boolean DEFAULT false NOT NULL,
	"can_create" boolean DEFAULT false NOT NULL,
	"can_edit" boolean DEFAULT false NOT NULL,
	"can_validate" boolean DEFAULT false NOT NULL,
	CONSTRAINT "role_template_permissions_template_id_module_pk" PRIMARY KEY("template_id","module")
);--> statement-breakpoint
ALTER TABLE "role_template_permissions" ADD CONSTRAINT "role_template_permissions_template_id_role_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."role_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "permission_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_name" text NOT NULL,
	"target_user_id" uuid,
	"target_user_name" text NOT NULL,
	"change" varchar(30) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "permission_audit_logs" ADD CONSTRAINT "permission_audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_audit_logs" ADD CONSTRAINT "permission_audit_logs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "permission_audit_logs_created_idx" ON "permission_audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "permission_audit_logs_target_idx" ON "permission_audit_logs" USING btree ("target_user_id");--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Reprise des droits existants : personne ne gagne ni ne perd d'accès.
-- ---------------------------------------------------------------------------

-- Droits effectifs d'avant, par (utilisateur, ancien module) : union des rôles explicites,
-- ou à défaut du rôle système correspondant à l'enum `users.role`.
CREATE TEMP TABLE "_old_perms" AS
SELECT u."id" AS user_id, rp."module",
       bool_or(rp."can_view") AS can_view, bool_or(rp."can_create") AS can_create,
       bool_or(rp."can_edit") AS can_edit, bool_or(rp."can_delete") AS can_delete,
       bool_or(rp."can_export") AS can_export, bool_or(rp."can_admin") AS can_admin
FROM "users" u
JOIN "roles" r ON r."active" AND (
      r."id" IN (SELECT "role_id" FROM "user_roles" ur WHERE ur."user_id" = u."id")
   OR (NOT EXISTS (SELECT 1 FROM "user_roles" ur WHERE ur."user_id" = u."id") AND r."key" = u."role"::text))
JOIN "role_permissions" rp ON rp."role_id" = r."id"
GROUP BY u."id", rp."module";--> statement-breakpoint

-- Anciens rôles effectifs (clés), pour les interrupteurs et la portée.
CREATE TEMP TABLE "_old_roles" AS
SELECT u."id" AS user_id, r."key"
FROM "users" u
JOIN "roles" r ON (
      r."id" IN (SELECT "role_id" FROM "user_roles" ur WHERE ur."user_id" = u."id")
   OR (NOT EXISTS (SELECT 1 FROM "user_roles" ur WHERE ur."user_id" = u."id") AND r."key" = u."role"::text));--> statement-breakpoint

-- Remappage module par module (Valider = ancien « administrer » ou « supprimer »).
INSERT INTO "user_permissions" ("user_id", "module", "can_view", "can_create", "can_edit", "can_validate")
SELECT user_id, new_module,
       bool_or(can_view), bool_or(can_create AND can_view), bool_or(can_edit AND can_view), bool_or(can_validate AND can_view)
FROM (
  SELECT p.user_id, m.new_module, p.can_view, p.can_create, p.can_edit,
         (p.can_admin OR p.can_delete) AS can_validate
  FROM "_old_perms" p
  JOIN (VALUES
    ('produits','produits'), ('marques','produits'), ('stock','stock'), ('ventes','ventes'), ('clients','clients'),
    ('marketing','marketing'), ('marketing','influence'), ('marketing','budgets'), ('marketing','assets'),
    ('terrain','terrain'), ('reglementaire','reglementaire'), ('medical','medical'), ('taches','taches'),
    ('parametres','administration')
  ) AS m(old_module, new_module) ON m.old_module = p."module"
  UNION ALL
  -- « Terrain — animatrices » et « Médical — administration » deviennent le droit Valider du module parent.
  SELECT p.user_id, 'terrain', p.can_view, false, false, p.can_view FROM "_old_perms" p WHERE p."module" = 'terrain_animatrices'
  UNION ALL
  SELECT p.user_id, 'medical', p.can_view, false, false, p.can_view FROM "_old_perms" p WHERE p."module" = 'medical_admin'
  UNION ALL
  -- Rapports : en lecture pour qui voyait déjà les ventes.
  SELECT p.user_id, 'rapports', p.can_view, false, false, false FROM "_old_perms" p WHERE p."module" = 'ventes'
) x
WHERE can_view
GROUP BY user_id, new_module
ON CONFLICT ("user_id", "module") DO NOTHING;--> statement-breakpoint

-- Portée : animatrices et délégués médicaux ne voyaient que leurs données ; les autres tout.
-- Une ligne `user_scopes` globale existante est respectée (TEAM devient ASSIGNED).
INSERT INTO "user_scope" ("user_id", "scope")
SELECT u."id",
       COALESCE(
         (SELECT CASE s."data_scope"::text WHEN 'OWN' THEN 'OWN' WHEN 'TEAM' THEN 'ASSIGNED' ELSE 'ALL' END
            FROM "user_scopes" s WHERE s."user_id" = u."id" AND s."module" IS NULL LIMIT 1),
         CASE WHEN EXISTS (SELECT 1 FROM "_old_roles" o WHERE o.user_id = u."id" AND o."key" IN ('ADMIN','MARKETING','TRADE','REGLEMENTAIRE','MANAGER_MEDICAL')) THEN 'ALL'
              WHEN EXISTS (SELECT 1 FROM "_old_roles" o WHERE o.user_id = u."id" AND o."key" IN ('ANIMATRICE','DELEGUE_MEDICAL')) THEN 'OWN'
              ELSE 'ALL' END
       )::"user_data_scope"
FROM "users" u
ON CONFLICT ("user_id") DO NOTHING;--> statement-breakpoint

INSERT INTO "user_brand_assignments" ("user_id", "brand_id")
SELECT s."user_id", b."id"
FROM "user_scopes" s
JOIN LATERAL unnest(s."brand_ids") AS bid ON true
JOIN "brands" b ON b."id" = bid
WHERE s."module" IS NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- Interrupteurs transverses : reproduisent ce que chaque ancien rôle voyait déjà.
INSERT INTO "user_flags" ("user_id", "see_margins", "see_global_budgets", "see_internal_costs", "approve_spend", "export_data", "read_activity_log")
SELECT u."id",
       EXISTS (SELECT 1 FROM "_old_roles" o WHERE o.user_id = u."id" AND o."key" IN ('ADMIN','TRADE')),
       EXISTS (SELECT 1 FROM "_old_roles" o WHERE o.user_id = u."id" AND o."key" IN ('ADMIN','MARKETING')),
       EXISTS (SELECT 1 FROM "_old_roles" o WHERE o.user_id = u."id" AND o."key" IN ('ADMIN','MARKETING')),
       EXISTS (SELECT 1 FROM "_old_roles" o WHERE o.user_id = u."id" AND o."key" = 'ADMIN'),
       COALESCE((SELECT bool_or(p.can_export) FROM "_old_perms" p WHERE p.user_id = u."id"), false),
       EXISTS (SELECT 1 FROM "_old_roles" o WHERE o.user_id = u."id" AND o."key" = 'ADMIN')
FROM "users" u
ON CONFLICT ("user_id") DO NOTHING;--> statement-breakpoint

-- Garde-fou : au moins un compte actif doit administrer. Si aucun compte n'a hérité du
-- module Administration (base sans rôle ADMIN), la migration s'arrête plutôt que de
-- verrouiller l'application.
DO $$
BEGIN
  IF (SELECT count(*) FROM "users") > 0 AND NOT EXISTS (
    SELECT 1 FROM "user_permissions" p JOIN "users" u ON u."id" = p."user_id"
    WHERE u."active" AND p."module" = 'administration' AND p."can_validate"
  ) THEN
    RAISE EXCEPTION 'Aucun compte actif avec le module Administration : migration refusée.';
  END IF;
END $$;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Modèles de rôle livrés (pré-remplissage uniquement, tous modifiables).
-- ---------------------------------------------------------------------------
INSERT INTO "role_templates" ("name", "description", "home_path", "scope", "flags", "sort_order")
SELECT * FROM (VALUES
  ('Administrateur', 'Accès complet à tous les modules, tous les interrupteurs.', '/', 'ALL'::"user_data_scope",
    '{"seeMargins":true,"seeGlobalBudgets":true,"seeInternalCosts":true,"approveSpend":true,"exportData":true,"readActivityLog":true}'::jsonb, 0),
  ('Animatrice', 'Saisie terrain de ses propres animations, produits en lecture.', '/terrain/saisie', 'OWN'::"user_data_scope", '{}'::jsonb, 10),
  ('Délégué médical', 'Ses prescripteurs, ses visites, ses échantillons ; produits en lecture.', '/medical/visites/saisie', 'OWN'::"user_data_scope", '{}'::jsonb, 20),
  ('Manager médical', 'Tout le module Délégué médical, y compris délégués et secteurs.', '/medical', 'ALL'::"user_data_scope", '{"exportData":true}'::jsonb, 30),
  ('Marketing', 'Marketing digital, influence, budgets, assets, produits.', '/marketing', 'ALL'::"user_data_scope",
    '{"seeGlobalBudgets":true,"seeInternalCosts":true,"exportData":true}'::jsonb, 40),
  ('Réglementaire', 'Dossiers réglementaires, produits en modification.', '/reglementaire', 'ALL'::"user_data_scope", '{"exportData":true}'::jsonb, 50),
  ('Commercial / Trade', 'Ventes, clients, stock, terrain, tâches.', '/ventes', 'ALL'::"user_data_scope", '{"exportData":true}'::jsonb, 60),
  ('Infographiste', 'Bibliothèque d''assets en gestion complète, marketing en création, influence en lecture.', '/marketing/planning', 'ALL'::"user_data_scope", '{}'::jsonb, 70)
) AS t(name, description, home_path, scope, flags, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM "role_templates");--> statement-breakpoint

INSERT INTO "role_template_permissions" ("template_id", "module", "can_view", "can_create", "can_edit", "can_validate")
SELECT t."id", m.module, m.v, m.c, m.e, m.va
FROM "role_templates" t
JOIN (VALUES
  ('Administrateur','produits',true,true,true,true), ('Administrateur','stock',true,true,true,true), ('Administrateur','reglementaire',true,true,true,true),
  ('Administrateur','ventes',true,true,true,true), ('Administrateur','clients',true,true,true,true), ('Administrateur','marketing',true,true,true,true),
  ('Administrateur','influence',true,true,true,true), ('Administrateur','budgets',true,true,true,true), ('Administrateur','terrain',true,true,true,true),
  ('Administrateur','medical',true,true,true,true), ('Administrateur','taches',true,true,true,true), ('Administrateur','assets',true,true,true,true),
  ('Administrateur','rapports',true,true,true,true), ('Administrateur','administration',true,true,true,true),

  ('Animatrice','terrain',true,true,true,false), ('Animatrice','produits',true,false,false,false), ('Animatrice','taches',true,true,true,false),

  ('Délégué médical','medical',true,true,true,false), ('Délégué médical','produits',true,false,false,false), ('Délégué médical','taches',true,true,true,false),

  ('Manager médical','medical',true,true,true,true), ('Manager médical','produits',true,false,false,false), ('Manager médical','taches',true,true,true,true),
  ('Manager médical','rapports',true,false,false,false),

  ('Marketing','marketing',true,true,true,true), ('Marketing','influence',true,true,true,true), ('Marketing','budgets',true,true,true,false),
  ('Marketing','assets',true,true,true,true), ('Marketing','produits',true,false,true,false), ('Marketing','ventes',true,false,false,false),
  ('Marketing','taches',true,true,true,false), ('Marketing','rapports',true,true,false,false),

  ('Réglementaire','reglementaire',true,true,true,true), ('Réglementaire','produits',true,false,true,false), ('Réglementaire','taches',true,true,true,false),

  ('Commercial / Trade','ventes',true,true,true,false), ('Commercial / Trade','clients',true,true,true,false), ('Commercial / Trade','produits',true,false,false,false),
  ('Commercial / Trade','stock',true,true,true,false), ('Commercial / Trade','terrain',true,true,true,true), ('Commercial / Trade','taches',true,true,true,false),
  ('Commercial / Trade','rapports',true,true,false,false),

  ('Infographiste','assets',true,true,true,true), ('Infographiste','marketing',true,true,false,false), ('Infographiste','influence',true,false,false,false),
  ('Infographiste','taches',true,true,true,false), ('Infographiste','produits',true,false,false,false)
) AS m(tname, module, v, c, e, va) ON m.tname = t."name"
ON CONFLICT DO NOTHING;--> statement-breakpoint

DROP TABLE IF EXISTS "_old_perms";--> statement-breakpoint
DROP TABLE IF EXISTS "_old_roles";--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Module Délégué médical — compléments du cahier des charges (section 4).
-- ---------------------------------------------------------------------------
ALTER TABLE "doctor_visits" ADD COLUMN IF NOT EXISTS "objections" text;--> statement-breakpoint
ALTER TABLE "doctor_visits" ADD COLUMN IF NOT EXISTS "documentation" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "doctor_brands" (
	"doctor_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	CONSTRAINT "doctor_brands_doctor_id_brand_id_pk" PRIMARY KEY("doctor_id","brand_id")
);--> statement-breakpoint
ALTER TABLE "doctor_brands" ADD CONSTRAINT "doctor_brands_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_brands" ADD CONSTRAINT "doctor_brands_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doctor_brands_brand_idx" ON "doctor_brands" USING btree ("brand_id");
