import Link from "next/link";
import { requireAccess } from "@/lib/access";
import { runDoctor } from "@/lib/meta/doctor";
import { PageHeader, Card, Section, Badge, Facts } from "@/components/ui";
import { fmtDate, fmtTime } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Diagnostic Meta" };

/**
 * Meta Connection Doctor : chaque ligne est un appel réel à l'API Graph. Le statut affiché
 * n'est jamais déduit de la présence du jeton.
 */
export default async function DiagnosticMetaPage() {
  await requireAccess("marketing");
  const report = await runDoctor();
  const tone = report.verdict === "LIVE" ? "green" : report.verdict === "DEGRADED" ? "orange" : "red";

  return (
    <>
      <PageHeader
        eyebrow="Digital Ads"
        title="Diagnostic de la connexion Meta"
        subtitle={`API ${report.apiVersion} · ${report.tokenCount} jeton(s) configuré(s) · exécuté le ${fmtDate(report.ranAt)} à ${fmtTime(report.ranAt)}`}
        actions={<><Link href="/marketing/ads" className="btn-secondary btn-sm">Command Center</Link><Link href="/marketing/ads/comptes" className="btn-secondary btn-sm">Comptes</Link><Link href="/marketing/ads/diagnostic" className="btn-primary btn-sm">Relancer</Link></>}
      />

      <Card className={`mb-4 border-${tone}/50`}>
        <div className="flex items-center gap-3">
          <Badge tone={tone} dot>{report.verdict === "LIVE" ? "Meta connecté" : report.verdict === "DEGRADED" ? "Connexion dégradée" : "Meta injoignable"}</Badge>
          <span className="text-[13px]">{report.summary}</span>
        </div>
      </Card>

      {report.tokens.length > 0 && (
        <Section title="Jetons" description="Lecture de `debug_token` : application émettrice, type, expiration, permissions. Un jeton d'utilisateur système sans expiration est attendu, avec `ads_read`.">
          <div className="grid gap-3 md:grid-cols-2">
            {report.tokens.map((tk) => (
              <Card key={tk.index}>
                <Facts cols={2} items={[
                  { label: "Jeton", value: <code className="text-[12px]">{tk.masked}</code> },
                  { label: "Valide", value: <Badge tone={tk.isValid ? "green" : "red"}>{tk.isValid ? "oui" : "non"}</Badge> },
                  { label: "Application", value: tk.appName ? `${tk.appName} (${tk.appId})` : tk.appId ?? "—" },
                  { label: "Type", value: tk.type ?? "—" },
                  { label: "Expiration", value: tk.expiresAt ? `${fmtDate(tk.expiresAt)} ${fmtTime(tk.expiresAt)}` : tk.isValid ? "n'expire pas" : "—" },
                  { label: "Accès aux données", value: tk.dataAccessExpiresAt ? fmtDate(tk.dataAccessExpiresAt) : "—" },
                  { label: "Permissions", value: tk.scopes.length ? tk.scopes.join(", ") : "—" },
                  { label: "Erreur", value: tk.error ?? "—" },
                ]} />
              </Card>
            ))}
          </div>
        </Section>
      )}

      <Section title="Vérifications globales" description="Identité, permissions, comptes visibles par chaque jeton.">
        <Card pad={false}>
          <ChecksTable checks={report.global} />
        </Card>
      </Section>

      {report.accounts.map((a) => (
        <Section key={a.id} title={`${a.name} (act_${a.externalId})`} description={`${a.currency} · ${a.timezone ?? "fuseau inconnu"} · rétention : ${a.retentionOk === null ? "non testée" : a.retentionOk ? "insights à 36 mois disponibles" : "insights à 36 mois refusés (voir ligne rétention)"}`}>
          <Card pad={false}>
            <ChecksTable checks={a.checks} />
          </Card>
        </Section>
      ))}

      {!report.accounts.length && (
        <Card><p className="text-[13px] text-muted">Aucun compte n&apos;est activé pour la synchronisation. Activez-en un sur l&apos;écran <Link href="/marketing/ads/comptes" className="underline">Comptes publicitaires</Link>.</p></Card>
      )}
    </>
  );
}

function ChecksTable({ checks }: { checks: Awaited<ReturnType<typeof runDoctor>>["global"] }) {
  return (
    <div className="overflow-x-auto">
      <table className="tbl text-[12.5px]">
        <thead><tr><th>Étape</th><th>Endpoint</th><th>Statut</th><th className="num">HTTP</th><th className="num">Code</th><th className="num">Sous-code</th><th>Message Meta</th><th>Lecture</th><th className="num">ms</th></tr></thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.step}>
              <td className="font-medium">{c.label}</td>
              <td><code className="text-[11.5px]">{c.endpoint}</code></td>
              <td><Badge tone={c.ok ? "green" : "red"} dot>{c.ok ? "OK" : "ÉCHEC"}</Badge></td>
              <td className="num">{c.result?.httpStatus ?? "—"}</td>
              <td className="num">{c.result?.code ?? "—"}</td>
              <td className="num">{c.result?.subcode ?? "—"}</td>
              <td className="max-w-[320px] text-[11.5px] text-ink-2">{c.result?.message ?? (c.ok ? sample(c.result?.sample) : "—")}{c.result?.fbtraceId ? <span className="block text-faint">trace {c.result.fbtraceId}</span> : null}</td>
              <td className="max-w-[420px] text-[11.5px]">{c.explanation ?? <span className="text-faint">—</span>}</td>
              <td className="num text-faint">{c.result?.ms ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sample(v: unknown): string {
  if (v === null || v === undefined) return "";
  try {
    const s = JSON.stringify(v);
    return s.length > 160 ? s.slice(0, 157) + "…" : s;
  } catch {
    return "";
  }
}
