-- Audit d'optimisation (Supabase Advisors) :
--  - 45 clés étrangères sans index de couverture → jointures et ON DELETE en scan séquentiel
--    dès que les tables grossissent (sales, activations, content_items, marketing_expenses...).
--  - RLS désactivée sur les 32 tables publiques → l'API PostgREST de Supabase (clé anon) peut
--    lire/écrire toute la base. L'application ne passe jamais par PostgREST (connexion directe
--    via `pg`/Drizzle, rôle propriétaire des tables qui contourne RLS), donc l'activer ici est
--    sans effet sur l'app et ferme uniquement l'accès REST public.
CREATE INDEX "product_aliases_product_idx" ON "product_aliases" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "client_aliases_client_idx" ON "client_aliases" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "imports_user_idx" ON "imports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "import_files_user_idx" ON "import_files" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sales_import_idx" ON "sales" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "stock_snapshots_import_idx" ON "stock_snapshots" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "animations_brand_idx" ON "animations" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "animations_import_idx" ON "animations" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "regulatory_files_product_idx" ON "regulatory_files" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "regulatory_files_responsible_idx" ON "regulatory_files" USING btree ("responsible_id");--> statement-breakpoint
CREATE INDEX "regulatory_files_import_idx" ON "regulatory_files" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "regulatory_events_user_idx" ON "regulatory_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "documents_uploaded_by_idx" ON "documents" USING btree ("uploaded_by_id");--> statement-breakpoint
CREATE INDEX "tasks_brand_idx" ON "tasks" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "tasks_created_by_idx" ON "tasks" USING btree ("created_by_id");--> statement-breakpoint
CREATE INDEX "task_comments_task_idx" ON "task_comments" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "task_comments_user_idx" ON "task_comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "campaigns_responsible_idx" ON "campaigns" USING btree ("responsible_id");--> statement-breakpoint
CREATE INDEX "campaign_products_product_idx" ON "campaign_products" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "ad_accounts_brand_idx" ON "ad_accounts" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "ad_metrics_account_idx" ON "ad_metrics" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "ad_metrics_campaign_id_idx" ON "ad_metrics" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "ad_metrics_import_idx" ON "ad_metrics" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "ad_creatives_product_idx" ON "ad_creatives" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "ad_creatives_content_idx" ON "ad_creatives" USING btree ("content_id");--> statement-breakpoint
CREATE INDEX "collaborations_brand_idx" ON "collaborations" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "collaborations_campaign_idx" ON "collaborations" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "collaborations_product_idx" ON "collaborations" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "activations_brand_idx" ON "activations" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "activations_product_idx" ON "activations" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "activations_campaign_idx" ON "activations" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "activations_client_idx" ON "activations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "activations_responsible_idx" ON "activations" USING btree ("responsible_id");--> statement-breakpoint
CREATE INDEX "marketing_expenses_campaign_idx" ON "marketing_expenses" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "marketing_expenses_activation_idx" ON "marketing_expenses" USING btree ("activation_id");--> statement-breakpoint
CREATE INDEX "marketing_expenses_collaboration_idx" ON "marketing_expenses" USING btree ("collaboration_id");--> statement-breakpoint
CREATE INDEX "marketing_expenses_product_idx" ON "marketing_expenses" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "content_items_brand_idx" ON "content_items" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "content_items_product_idx" ON "content_items" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "content_items_responsible_idx" ON "content_items" USING btree ("responsible_id");--> statement-breakpoint
CREATE INDEX "content_items_campaign_idx" ON "content_items" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "content_items_activation_idx" ON "content_items" USING btree ("activation_id");--> statement-breakpoint
CREATE INDEX "content_items_influencer_idx" ON "content_items" USING btree ("influencer_id");--> statement-breakpoint
CREATE INDEX "objectives_brand_idx" ON "objectives" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "objectives_product_idx" ON "objectives" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "brands" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "import_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "animations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "animation_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "animation_objectives" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "regulatory_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "regulatory_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "budget_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ad_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ad_metrics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ad_creatives" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "influencers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collaborations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "marketing_expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "objectives" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;
