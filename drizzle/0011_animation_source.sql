-- Origine d'une animation : la saisie humaine gagne toujours sur le fichier.
--
-- Le problème que cette colonne résout a été créé par la Phase 0. Avant elle, une animation
-- saisie dans l'application avait `dedupe_key = NULL` et ne pouvait entrer en conflit avec
-- rien. Depuis, elle porte la MÊME clé que l'import (jour|ville|POS|animatrice) — ce qui est
-- voulu, c'est ce qui empêche les doublons — mais l'import, lui, fait un `ON CONFLICT DO
-- UPDATE` : il écraserait la saisie, purgerait ses lignes produit et les réinsérerait depuis
-- le fichier. Silencieusement, puisque les quantités se ressemblent.
--
-- Pendant la bascule WhatsApp → application, les deux canaux coexistent forcément. Une
-- animatrice qui saisit le lundi et voit sa journée remplacée le vendredi par l'import du
-- fichier n'utilisera plus jamais l'application.
--
-- `import_id IS NULL` ne suffisait pas à distinguer les deux origines : une animation créée
-- par import puis CORRIGÉE dans l'application garde son `import_id`. Elle serait donc, elle
-- aussi, écrasée au prochain passage. La colonne enregistre qui a écrit EN DERNIER.
--
-- Valeurs : 'saisie' (un humain, depuis l'application) | 'import' (le fichier quotidien).

ALTER TABLE "animations" ADD COLUMN IF NOT EXISTS "source" text DEFAULT 'import' NOT NULL;--> statement-breakpoint

-- Valeur initiale de la colonne nouvelle : les animations sans import viennent de la saisie.
-- Idempotent, et sans effet sur les lignes déjà qualifiées si la migration est rejouée.
UPDATE "animations" SET "source" = 'saisie' WHERE "import_id" IS NULL AND "source" = 'import';--> statement-breakpoint

-- L'indicateur d'adoption lit « saisie vs import par semaine » : l'index porte les deux axes.
CREATE INDEX IF NOT EXISTS "animations_source_date_idx" ON "animations" USING btree ("source","date");--> statement-breakpoint

-- Retour en arrière (à exécuter à la main) :
--
--   DROP INDEX IF EXISTS "animations_source_date_idx";
--   ALTER TABLE "animations" DROP COLUMN IF EXISTS "source";
--
-- Aucune donnée métier n'est perdue : l'origine reste approximable par `import_id IS NULL`.
