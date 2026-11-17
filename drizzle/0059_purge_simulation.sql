-- Purge des pièces de simulation (SIMBL / SIMFA / SIMAV) : une pièce de simulation numérotée se supprime, mais
-- seulement quand `purgeSimulation()` l'annonce dans sa transaction (`comanet.purge_simulation`). Une pièce réelle
-- (ou une commande BC, toujours réelle) reste insupprimable. Les mouvements de stock de ces pièces restent au journal.
CREATE OR REPLACE FUNCTION "sales_documents_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  reassign boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."number" IS NOT NULL
       AND NOT (OLD."is_simulation" AND coalesce(current_setting('comanet.purge_simulation', true), '') = 'on') THEN
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
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "sales_document_lines_guard"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text; sim boolean;
BEGIN
  SELECT "status", "is_simulation" INTO st, sim FROM "sales_documents" WHERE "id" = COALESCE(NEW."document_id", OLD."document_id");
  IF st IS NULL OR st = 'BROUILLON' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' AND sim AND coalesce(current_setting('comanet.purge_simulation', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW."document_id", NEW."product_id", NEW."inventory_item_id", NEW."unit_cost", NEW."lot_id", NEW."warehouse_key", NEW."ref", NEW."designation", NEW."quantity", NEW."free_quantity",
        NEW."unit_price_ht", NEW."public_price_ttc", NEW."discount_pct", NEW."gross_ht", NEW."net_ht", NEW."tax_rate", NEW."vat_amount", NEW."ttc",
        NEW."source_line_id", NEW."lot_allocations", NEW."return_warehouse_key")
       IS NOT DISTINCT FROM
       (OLD."document_id", OLD."product_id", OLD."inventory_item_id", OLD."unit_cost", OLD."lot_id", OLD."warehouse_key", OLD."ref", OLD."designation", OLD."quantity", OLD."free_quantity",
        OLD."unit_price_ht", OLD."public_price_ttc", OLD."discount_pct", OLD."gross_ht", OLD."net_ht", OLD."tax_rate", OLD."vat_amount", OLD."ttc",
        OLD."source_line_id", OLD."lot_allocations", OLD."return_warehouse_key") THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Les lignes d''une pièce validée ne se modifient pas (corriger par un avoir).';
END $$;
