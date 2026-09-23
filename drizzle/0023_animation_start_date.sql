-- Animation sur plusieurs jours : date de début saisie (« Du … au … »). Idempotente : rejouable sans erreur.
-- Les lignes existantes gardent start_date vide (période inconnue) : rien n'est déduit.
ALTER TABLE "animations" ADD COLUMN IF NOT EXISTS "start_date" date;
