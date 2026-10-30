-- Sécurité (Supabase Advisors, alerte critique « rls_disabled_in_public » du 25/10/2026) : les tables créées par
-- les migrations 0044 (Marketing OS), 0046 (générateur d'actions), 0047 (bibliothèque), 0048 (Studio créatif) et
-- 0052 (sorties marketing) n'avaient pas la RLS : l'API PostgREST (clé anon, publique par nature) pouvait lire,
-- modifier et vider plans, actions, décisions, modèles et concepts créatifs.
-- Même principe que les migrations 0004 et 0033 : l'application se connecte en direct (`pg`/Drizzle, rôle
-- propriétaire qui contourne la RLS) ; activer la RLS sans politique ferme seulement l'accès REST public.
-- Générique : toute table publique encore sans RLS est couverte, y compris sur une base installée à neuf.
-- Le test `tests/rls-migrations.test.ts` échoue désormais si une nouvelle table n'est pas verrouillée.
DO $$
DECLARE t record;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
  END LOOP;
END $$;
--> statement-breakpoint

-- Supabase Advisors « function_search_path_mutable » : les fonctions de garde (gel des pièces, journaux en écriture
-- seule, anti-doublon de commande) résolvaient leurs noms selon le search_path de l'appelant. On le fige.
-- Par nom et sans signature (ce sont des fonctions de trigger) ; une fonction absente est ignorée.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'stock_movements_append_only', 'sales_documents_guard', 'sales_document_lines_guard',
      'sales_documents_no_truncate', 'purchase_documents_guard', 'purchase_document_children_guard',
      'purchase_documents_no_truncate', 'stock_counts_guard', 'stock_count_children_guard',
      'payments_guard', 'visit_events_append_only', 'prevent_duplicate_commande'
    )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f.sig);
  END LOOP;
END $$;
