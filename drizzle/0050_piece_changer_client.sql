-- Retours de tests : un BL (ou une commande) validé sur le mauvais client change de client, pas seulement de
-- nom imprimé. Le garde-fou laisse alors bouger le client, l'identité figée et l'empreinte, et rien d'autre,
-- seulement pour un BL ou une commande et seulement quand `reassignDocumentClient()` l'annonce dans sa
-- transaction (`comanet.reassign_client`). Facture et avoir restent figés : avoir puis nouvelle facture.
CREATE OR REPLACE FUNCTION "sales_documents_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reassign boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."number" IS NOT NULL THEN
      RAISE EXCEPTION 'Pièce % : une pièce numérotée ne se supprime pas (annulation ou avoir).', OLD."number";
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'BROUILLON' THEN
    IF NEW."status" = 'BROUILLON' THEN
      RAISE EXCEPTION 'Pièce % : une pièce validée ne redevient pas un brouillon.', OLD."number";
    END IF;
    reassign := coalesce(current_setting('comanet.reassign_client', true), '') = 'on' AND OLD."type" IN ('BL', 'COMMANDE');
    IF (NEW."number", NEW."type", NEW."date",
        CASE WHEN reassign THEN OLD."client_id" ELSE NEW."client_id" END,
        CASE WHEN reassign THEN (OLD."client_snapshot" - 'legalName') ELSE (NEW."client_snapshot" - 'legalName') END,
        NEW."company_snapshot", NEW."gross_ht", NEW."net_ht",
        NEW."vat_total", NEW."ttc", NEW."vat_breakdown", NEW."global_discount_pct", NEW."series_key", NEW."is_simulation", NEW."origin_document_id",
        NEW."due_date", NEW."payment_days", NEW."payment_mode_key", NEW."site", NEW."delivery_address", NEW."amount_in_words",
        CASE WHEN reassign THEN OLD."content_hash" ELSE NEW."content_hash" END,
        NEW."reprise_paid")
       IS DISTINCT FROM
       (OLD."number", OLD."type", OLD."date", OLD."client_id", (OLD."client_snapshot" - 'legalName'), OLD."company_snapshot", OLD."gross_ht", OLD."net_ht",
        OLD."vat_total", OLD."ttc", OLD."vat_breakdown", OLD."global_discount_pct", OLD."series_key", OLD."is_simulation", OLD."origin_document_id",
        OLD."due_date", OLD."payment_days", OLD."payment_mode_key", OLD."site", OLD."delivery_address", OLD."amount_in_words", OLD."content_hash", OLD."reprise_paid") THEN
      RAISE EXCEPTION 'Pièce % : validée, elle n''est plus modifiable (corriger par un avoir).', OLD."number";
    END IF;
  END IF;
  RETURN NEW;
END $$;
