-- Produits : conditions fournisseur sur la fiche (Exwork HT en euros, remise client moyenne, taux de FOC).
-- Le coût de revient en MAD reste dans cost_price.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "exw_price_eur" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "avg_client_discount_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "foc_rate_pct" numeric(5, 2);
