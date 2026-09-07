-- Origine des fiches créées automatiquement par un import.
--
-- Le 05/09/2026, un reporting hebdo Meta a été chargé comme fichier de VENTES avec la colonne
-- « Campagne » prise pour un nom de produit : 58 faux produits (« Instagram post : … »,
-- « BOF Ultra Shield May 26 »…), 7 faux clients et 14 alias ont été créés au passage. L'import
-- a été annulé, mais l'annulation ne retirait que les lignes de vente : les fiches restaient,
-- et polluaient /stock (« Stock non renseigné »), /produits et les futurs rapprochements
-- (l'alias « GAMARDE » pointait vers un produit précis).
--
-- Ces colonnes enregistrent quel import a créé une fiche ou un alias. L'annulation d'un import
-- retire désormais aussi les produits et clients qu'il a créés, à condition qu'ils ne soient
-- référencés nulle part ailleurs (aucune vente, photo de stock, animation, objectif…).
-- NULL = fiche créée à la main dans l'application, ou avant cette migration.

ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "import_id" uuid REFERENCES "imports"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "import_id" uuid REFERENCES "imports"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "product_aliases" ADD COLUMN IF NOT EXISTS "import_id" uuid REFERENCES "imports"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "client_aliases" ADD COLUMN IF NOT EXISTS "import_id" uuid REFERENCES "imports"("id") ON DELETE SET NULL;--> statement-breakpoint

-- Retour en arrière (à exécuter à la main) :
--
--   ALTER TABLE "products" DROP COLUMN IF EXISTS "import_id";
--   ALTER TABLE "clients" DROP COLUMN IF EXISTS "import_id";
--   ALTER TABLE "product_aliases" DROP COLUMN IF EXISTS "import_id";
--   ALTER TABLE "client_aliases" DROP COLUMN IF EXISTS "import_id";

-- Reprise des fiches déjà créées avant cette colonne : on les rattache à l'import « par ligne »
-- (ventes, stock, animations, régie) lancé juste avant leur création, dans les 10 minutes.
-- Une fiche saisie à la main hors de toute fenêtre d'import garde NULL. Ce rattachement ne
-- supprime rien : il permet seulement au bouton « Retirer les fiches orphelines » d'un import
-- annulé de savoir quoi proposer, et la suppression reste conditionnée à l'absence de toute
-- référence (vente, photo de stock, animation, objectif…).
UPDATE "products" p SET "import_id" = i.id FROM "imports" i
  WHERE p."import_id" IS NULL AND i."type" IN ('SALES','STOCK','ANIMATIONS','ADS')
    AND p."created_at" >= i."created_at" AND p."created_at" < i."created_at" + interval '10 minutes'
    AND i."created_at" = (SELECT max(i2."created_at") FROM "imports" i2 WHERE i2."created_at" <= p."created_at");--> statement-breakpoint
UPDATE "clients" c SET "import_id" = i.id FROM "imports" i
  WHERE c."import_id" IS NULL AND i."type" IN ('SALES','STOCK','ANIMATIONS','ADS')
    AND c."created_at" >= i."created_at" AND c."created_at" < i."created_at" + interval '10 minutes'
    AND i."created_at" = (SELECT max(i2."created_at") FROM "imports" i2 WHERE i2."created_at" <= c."created_at");--> statement-breakpoint
UPDATE "product_aliases" a SET "import_id" = i.id FROM "imports" i
  WHERE a."import_id" IS NULL AND i."type" IN ('SALES','STOCK','ANIMATIONS','ADS')
    AND a."created_at" >= i."created_at" AND a."created_at" < i."created_at" + interval '10 minutes'
    AND i."created_at" = (SELECT max(i2."created_at") FROM "imports" i2 WHERE i2."created_at" <= a."created_at");--> statement-breakpoint
UPDATE "client_aliases" a SET "import_id" = i.id FROM "imports" i
  WHERE a."import_id" IS NULL AND i."type" IN ('SALES','STOCK','ANIMATIONS','ADS')
    AND a."created_at" >= i."created_at" AND a."created_at" < i."created_at" + interval '10 minutes'
    AND i."created_at" = (SELECT max(i2."created_at") FROM "imports" i2 WHERE i2."created_at" <= a."created_at");--> statement-breakpoint
