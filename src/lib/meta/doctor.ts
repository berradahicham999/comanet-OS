/**
 * Meta Connection Doctor — le statut « connecté » ne se déduit jamais de la présence du jeton.
 *
 * Chaque vérification est un appel réel à l'API Graph, sans reprise automatique, avec le
 * statut HTTP, le code, le sous-code, le message et l'endpoint conservés tels quels. Le
 * diagnostic descend la hiérarchie complète (compte → campagnes → ensembles → publicités →
 * créatives → insights) puis sonde la rétention : Meta ne sert que 37 mois d'insights.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { META_API_VERSION, debugToken, metaTokens, probe, tokenFor, type ProbeResult, type TokenDebug } from "./client";

export type DoctorCheck = {
  step: string;
  label: string;
  endpoint: string;
  ok: boolean;
  /** Ce que l'échec signifie et ce qu'il faut faire, en français. */
  explanation: string | null;
  result: ProbeResult | null;
};

export type DoctorAccount = {
  id: string;
  name: string;
  externalId: string;
  currency: string;
  timezone: string | null;
  status: string | null;
  checks: DoctorCheck[];
  /** Plus ancienne journée réellement servie par la sonde de rétention (ou null). */
  retentionOk: boolean | null;
};

export type DoctorReport = {
  apiVersion: string;
  tokenCount: number;
  tokens: (TokenDebug & { index: number; masked: string })[];
  global: DoctorCheck[];
  accounts: DoctorAccount[];
  /** Verdict : LIVE (tout répond), DEGRADED (un compte ou une étape échoue), DOWN (rien ne répond). */
  verdict: "LIVE" | "DEGRADED" | "DOWN";
  summary: string;
  ranAt: string;
};

/** Traduction des codes Meta en cause probable et geste à faire. */
export function explainMetaError(r: ProbeResult): string {
  const msg = (r.message ?? "").toLowerCase();
  if (msg.includes("api access blocked") || msg.includes("application does not have permission") || msg.includes("app is not approved")) {
    return "L'application Meta qui a émis ce jeton est bloquée ou restreinte (application désactivée, alerte de conformité non traitée, accès Marketing API retiré, ou mode développement expiré). Ce n'est pas un jeton expiré. Ouvrir developers.facebook.com → l'application → Alertes / Paramètres, régler le blocage, puis régénérer un jeton d'utilisateur système (Business Settings → Utilisateurs système → Générer un jeton, permission ads_read) et le remettre dans META_ACCESS_TOKEN sur Vercel.";
  }
  if (r.code === 190) {
    if (r.subcode === 463 || msg.includes("expired")) return "Jeton expiré. Régénérer un jeton d'utilisateur système sans expiration (Business Settings → Utilisateurs système) et le remplacer sur Vercel, puis redéployer.";
    if (r.subcode === 460 || msg.includes("password")) return "Jeton invalidé par un changement de mot de passe ou une déconnexion. Régénérer un jeton d'utilisateur système.";
    return "Jeton invalide ou révoqué (code 190). Régénérer un jeton d'utilisateur système et vérifier qu'il est copié en entier.";
  }
  if (r.code === 10 || r.code === 200 || r.code === 2635) return "Permission manquante sur l'objet demandé : le jeton n'a pas ads_read sur ce compte, ou le compte n'est pas attribué à l'utilisateur système (Business Settings → Utilisateurs système → Attribuer des ressources → Comptes publicitaires, droit « Afficher les performances »).";
  if (r.code === 100 && (msg.includes("37") || msg.includes("older") || msg.includes("time range"))) return "Meta refuse la période : les insights ne sont servis que sur 37 mois glissants. Historique indisponible pour cette période.";
  if (r.code === 100) return "Paramètre ou champ refusé par cette version de l'API (code 100). Vérifier META_API_VERSION et les champs demandés.";
  if (r.code === 4 || r.code === 17 || r.code === 32 || r.code === 613 || r.code === 80000 || r.code === 80004) return "Limite de débit atteinte (quota d'appels de l'application ou du compte). Réessayer plus tard ; réduire la fréquence des synchronisations.";
  if (r.code === 368) return "Compte ou utilisateur temporairement bloqué par Meta pour violation de règles.";
  if (r.code === 2 || r.code === 1) return "Erreur temporaire côté Meta. Réessayer.";
  if (r.httpStatus === null) return "Réseau injoignable depuis le serveur.";
  return "Erreur non classée : lire le code et le message ci-contre.";
}

function check(step: string, label: string, endpoint: string, r: ProbeResult): DoctorCheck {
  return { step, label, endpoint, ok: r.ok, explanation: r.ok ? null : explainMetaError(r), result: r };
}

const mask = (t: string) => (t.length > 12 ? `${t.slice(0, 6)}…${t.slice(-4)}` : "••••");

/** Trente-six mois en arrière, une seule journée : sous la limite de rétention, doit répondre. */
function retentionProbeDay(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 36, 15));
  return d.toISOString().slice(0, 10);
}

export async function runDoctor(now = new Date()): Promise<DoctorReport> {
  const tokens = metaTokens();
  const report: DoctorReport = {
    apiVersion: META_API_VERSION, tokenCount: tokens.length, tokens: [], global: [], accounts: [],
    verdict: "DOWN", summary: "", ranAt: now.toISOString(),
  };
  if (!tokens.length) {
    report.global.push({ step: "token", label: "Jeton présent", endpoint: "—", ok: false, explanation: "META_ACCESS_TOKEN absent des variables d'environnement Vercel. Rien ne peut être testé.", result: null });
  }

  for (const [i, t] of tokens.entries()) {
    const d = await debugToken(t);
    report.tokens.push({ ...d, index: i + 1, masked: mask(t) });
    report.global.push(check(`token-${i + 1}`, `Jeton ${i + 1} : validité (debug_token)`, "debug_token", await probe("debug_token", { input_token: t }, t)));
    report.global.push(check(`me-${i + 1}`, `Jeton ${i + 1} : identité (me)`, "me", await probe("me", { fields: "id,name" }, t)));
    report.global.push(check(`perms-${i + 1}`, `Jeton ${i + 1} : permissions (me/permissions)`, "me/permissions", await probe("me/permissions", {}, t)));
    report.global.push(check(`accounts-${i + 1}`, `Jeton ${i + 1} : comptes accessibles (me/adaccounts)`, "me/adaccounts", await probe("me/adaccounts", { fields: "id,account_id,name,currency,account_status", limit: "50" }, t)));
  }

  const rows = await db.execute(sql`
    select id, name, external_id, currency, timezone, sync_status
    from ad_accounts where platform = 'META' and sync_enabled = true and external_id is not null order by name`);
  for (const a of rows.rows as { id: string; name: string; external_id: string; currency: string; timezone: string | null; sync_status: string }[]) {
    const act = `act_${a.external_id}`;
    if (!tokens.length) {
      report.accounts.push({ id: a.id, name: a.name, externalId: a.external_id, currency: a.currency, timezone: a.timezone, status: a.sync_status, retentionOk: null,
        checks: [{ step: "account", label: "Compte publicitaire", endpoint: act, ok: false, explanation: "Non testé : aucun jeton configuré.", result: null }] });
      continue;
    }
    // Le jeton retenu pour ce compte, sinon chaque jeton jusqu'au premier qui lit le compte.
    let token = tokenFor(a.external_id);
    let first = await probe(act, { fields: "id,account_id,name,currency,timezone_name,account_status,amount_spent" }, token);
    if (!first.ok) {
      for (const t of tokens) {
        if (t === token) continue;
        const r = await probe(act, { fields: "id,account_id,name,currency,timezone_name,account_status,amount_spent" }, t);
        if (r.ok) { token = t; first = r; break; }
      }
    }
    const checks: DoctorCheck[] = [check("account", "Compte publicitaire", act, first)];
    let retentionOk: boolean | null = null;
    if (first.ok) {
      checks.push(check("campaigns", "Campagnes", `${act}/campaigns`, await probe(`${act}/campaigns`, { fields: "id,name,objective,effective_status", limit: "3" }, token)));
      checks.push(check("adsets", "Ensembles de publicités", `${act}/adsets`, await probe(`${act}/adsets`, { fields: "id,name,campaign_id,effective_status", limit: "3" }, token)));
      checks.push(check("ads", "Publicités", `${act}/ads`, await probe(`${act}/ads`, { fields: "id,name,adset_id,effective_status", limit: "3" }, token)));
      checks.push(check("creatives", "Créatives", `${act}/adcreatives`, await probe(`${act}/adcreatives`, { fields: "id,name,object_type,thumbnail_url", limit: "3" }, token)));
      checks.push(check("insights", "Insights (7 derniers jours)", `${act}/insights`, await probe(`${act}/insights`, { level: "account", date_preset: "last_7d", fields: "spend,impressions,clicks" }, token)));
      const day = retentionProbeDay(now);
      const ret = await probe(`${act}/insights`, { level: "account", time_range: JSON.stringify({ since: day, until: day }), fields: "spend" }, token);
      retentionOk = ret.ok;
      checks.push({ ...check("retention", `Rétention : insights à 36 mois (${day})`, `${act}/insights`, ret), explanation: ret.ok ? null : `${explainMetaError(ret)} Les mois antérieurs seront marqués « historique indisponible ».` });
    }
    report.accounts.push({ id: a.id, name: a.name, externalId: a.external_id, currency: a.currency, timezone: a.timezone, status: a.sync_status, checks, retentionOk });
  }

  const allChecks = [...report.global, ...report.accounts.flatMap((a) => a.checks)];
  const failures = allChecks.filter((c) => !c.ok);
  const accountFailures = report.accounts.filter((a) => a.checks.some((c) => !c.ok && c.step !== "retention"));
  if (!tokens.length) {
    report.verdict = "DOWN";
    report.summary = "Aucun jeton configuré.";
  } else if (!report.accounts.length) {
    report.verdict = report.global.some((c) => c.ok) ? "DEGRADED" : "DOWN";
    report.summary = "Aucun compte activé pour la synchronisation.";
  } else if (accountFailures.length === report.accounts.length && report.accounts.every((a) => !a.checks[0].ok)) {
    report.verdict = "DOWN";
    report.summary = `Aucun compte ne répond : ${accountFailures[0].checks[0].result?.message ?? "erreur inconnue"}.`;
  } else if (failures.some((c) => c.step !== "retention")) {
    report.verdict = "DEGRADED";
    report.summary = `${failures.filter((c) => c.step !== "retention").length} vérification(s) en échec sur ${allChecks.length}.`;
  } else {
    report.verdict = "LIVE";
    report.summary = `Toutes les vérifications passent (${allChecks.length}).`;
  }
  return report;
}
