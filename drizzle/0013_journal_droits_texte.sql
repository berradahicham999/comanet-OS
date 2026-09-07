-- Le journal des droits concatène les étiquettes de tout ce qui a changé en un seul
-- enregistrement (« TEMPLATE_APPLIED+PERMISSIONS+SCOPE+FLAGS+ASSIGNMENTS »). La colonne
-- était limitée à 30 caractères : une modification complète d'un compte dépassait la limite,
-- l'insertion échouait et la fiche affichait une erreur alors que les droits étaient déjà
-- enregistrés. Sans limite, le journal accepte toute combinaison.
ALTER TABLE "permission_audit_logs" ALTER COLUMN "change" TYPE text;
