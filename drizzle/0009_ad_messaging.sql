-- Résultat affiché selon l'objectif réel de la campagne, pas uniquement les achats.
--
-- Beaucoup de campagnes Meta ici visent le trafic ou la messagerie (WhatsApp/Messenger), pas
-- la vente en ligne : leur juger le CPA/ROAS n'a aucun sens, elles n'ont jamais de conversion
-- e-commerce à remonter. Meta envoie déjà les conversations démarrées dans le même bloc
-- `actions` que les achats et les leads — la donnée était disponible, seulement pas lue.

ALTER TABLE "ad_metrics" ADD COLUMN IF NOT EXISTS "messaging_started" integer DEFAULT 0 NOT NULL;
