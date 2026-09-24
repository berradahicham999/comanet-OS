-- Retours de tests d'Hicham : le nom du client imprimé sur une pièce validée se corrige (motif, historique,
-- PDF régénéré). Seule la clé « legalName » de l'identité figée devient modifiable ; client, montants,
-- numéro, ICE et adresse restent figés.
CREATE OR REPLACE FUNCTION "sales_documents_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF (NEW."number", NEW."type", NEW."date", NEW."client_id", (NEW."client_snapshot" - 'legalName'), NEW."company_snapshot", NEW."gross_ht", NEW."net_ht",
        NEW."vat_total", NEW."ttc", NEW."vat_breakdown", NEW."global_discount_pct", NEW."series_key", NEW."is_simulation", NEW."origin_document_id",
        NEW."due_date", NEW."payment_days", NEW."payment_mode_key", NEW."site", NEW."delivery_address", NEW."amount_in_words", NEW."content_hash", NEW."reprise_paid")
       IS DISTINCT FROM
       (OLD."number", OLD."type", OLD."date", OLD."client_id", (OLD."client_snapshot" - 'legalName'), OLD."company_snapshot", OLD."gross_ht", OLD."net_ht",
        OLD."vat_total", OLD."ttc", OLD."vat_breakdown", OLD."global_discount_pct", OLD."series_key", OLD."is_simulation", OLD."origin_document_id",
        OLD."due_date", OLD."payment_days", OLD."payment_mode_key", OLD."site", OLD."delivery_address", OLD."amount_in_words", OLD."content_hash", OLD."reprise_paid") THEN
      RAISE EXCEPTION 'Pièce % : validée, elle n''est plus modifiable (corriger par un avoir).', OLD."number";
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

-- Avoir financier (sans facture ni BL d'origine) : remise accordée sur objectifs atteints, ventilée par marque.
INSERT INTO "credit_reasons" ("key", "label", "with_return", "sort") VALUES
	('REMISE_OBJECTIFS', 'Remise sur objectifs (avoir financier)', false, 45)
ON CONFLICT ("key") DO NOTHING;
