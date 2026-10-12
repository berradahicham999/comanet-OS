-- Anti-doublon des commandes clients : un double clic sur « Enregistrer » créait plusieurs commandes identiques
-- (BC202600006 → 021 le 06/10/2026). Refuse une 2e commande du même utilisateur pour le même client dans les 20 s.
-- Appliquée à la main en prod le 12/10/2026 ; idempotente. Doublée côté application (saveDraft → DuplicateOrderError).
CREATE OR REPLACE FUNCTION public.prevent_duplicate_commande() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE dup text;
BEGIN
  IF NEW.type <> 'COMMANDE' OR coalesce(NEW.is_simulation, false) OR NEW.client_id IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('commande:' || NEW.client_id::text || ':' || coalesce(NEW.created_by_id::text, '')));
  SELECT number INTO dup FROM public.sales_documents
   WHERE type = 'COMMANDE' AND client_id = NEW.client_id
     AND created_by_id IS NOT DISTINCT FROM NEW.created_by_id
     AND status <> 'ANNULE'
     AND created_at > now() - interval '20 seconds'
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Commande déjà enregistrée (%) il y a quelques secondes — doublon bloqué.', coalesce(dup, 'en cours')
      USING ERRCODE = 'P0001', HINT = 'DUPLICATE_ORDER';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_prevent_duplicate_commande ON public.sales_documents;
--> statement-breakpoint
CREATE TRIGGER trg_prevent_duplicate_commande BEFORE INSERT ON public.sales_documents
FOR EACH ROW EXECUTE FUNCTION public.prevent_duplicate_commande();
