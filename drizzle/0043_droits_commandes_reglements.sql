-- Droits de la gestion commerciale, plus fins : deux modules détachés.
--   commandes  : bons de commande clients (jusqu'ici sous « livraisons ») — un commercial peut prendre
--                des commandes sans pouvoir préparer ni valider de BL.
--   reglements : encaissements, imputations, relances (jusqu'ici sous « facturation ») — un commercial
--                peut encaisser un chèque sans pouvoir émettre de facture.
-- Aucun compte ne perd de droit : chacun reçoit sur le nouveau module exactement ce qu'il avait sur
-- l'ancien. On retire ensuite à la main, fiche par fiche (Paramètres → Utilisateurs).

INSERT INTO "user_permissions" ("user_id", "module", "can_view", "can_create", "can_edit", "can_validate")
SELECT p."user_id", m.target, p."can_view", p."can_create", p."can_edit", p."can_validate"
FROM "user_permissions" p
JOIN (VALUES ('livraisons', 'commandes'), ('facturation', 'reglements')) AS m(source, target) ON m.source = p."module"
ON CONFLICT ("user_id", "module") DO NOTHING;--> statement-breakpoint

INSERT INTO "role_template_permissions" ("template_id", "module", "can_view", "can_create", "can_edit", "can_validate")
SELECT p."template_id", m.target, p."can_view", p."can_create", p."can_edit", p."can_validate"
FROM "role_template_permissions" p
JOIN (VALUES ('livraisons', 'commandes'), ('facturation', 'reglements')) AS m(source, target) ON m.source = p."module"
ON CONFLICT ("template_id", "module") DO NOTHING;--> statement-breakpoint

-- Modèle « Commercial (prise de commande) » : saisit et confirme ses commandes chez ses clients,
-- ne voit que les siennes ; ni BL, ni facture, ni règlement (à cocher en plus si besoin).
INSERT INTO "role_templates" ("name", "description", "home_path", "scope", "flags", "sort_order")
SELECT 'Commercial (prise de commande)',
  'Saisit et confirme les commandes de ses clients (BC + PDF), ne voit que ses commandes ; ni BL, ni facture, ni règlement. Cocher « Règlements » → Créer pour encaisser les chèques.',
  '/gestion/pieces?type=COMMANDE', 'OWN'::"user_data_scope", '{}'::jsonb, 85
WHERE EXISTS (SELECT 1 FROM "role_templates") AND NOT EXISTS (SELECT 1 FROM "role_templates" WHERE "name" = 'Commercial (prise de commande)');--> statement-breakpoint

INSERT INTO "role_template_permissions" ("template_id", "module", "can_view", "can_create", "can_edit", "can_validate")
SELECT t."id", m.module, m.v, m.c, m.e, m.va
FROM "role_templates" t
JOIN (VALUES
  ('commandes', true, true, true, false),
  ('clients', true, false, false, false),
  ('produits', true, false, false, false),
  ('taches', true, true, true, false)
) AS m(module, v, c, e, va) ON true
WHERE t."name" = 'Commercial (prise de commande)'
ON CONFLICT ("template_id", "module") DO NOTHING;
