-- Sécurité (Supabase Advisors, « RLS disabled ») : 61 tables publiques créées depuis la migration 0004 n'avaient
-- pas la RLS, donc l'API PostgREST de Supabase (clé anon, publique par nature) pouvait lire, modifier et vider
-- ces tables (médecins, droits des utilisateurs, P&L, conversations IA…).
-- Même principe que la migration 0004 : l'application ne passe jamais par PostgREST (connexion directe via
-- `pg`/Drizzle avec le rôle propriétaire des tables, qui contourne la RLS). Activer la RLS sans politique est donc
-- sans effet sur l'application et ferme uniquement l'accès REST public. Les politiques existantes
-- (`gamarde_orders`) ne sont pas touchées.
-- Générique : toute table publique encore sans RLS est couverte, y compris sur une base installée à neuf.
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

-- La vue `fact_sales` s'exécutait avec les droits de son propriétaire : via la clé anon, elle exposait les ventes
-- même derrière la RLS. Elle s'exécute désormais avec les droits de l'appelant (sans effet pour l'application).
ALTER VIEW IF EXISTS public.fact_sales SET (security_invoker = true);
