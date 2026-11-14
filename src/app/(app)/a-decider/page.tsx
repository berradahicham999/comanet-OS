import Link from "next/link";
import { Suspense } from "react";
import { requireAnyModule } from "@/lib/access";
import { requireAccessContext } from "@/lib/permissions";
import { listValidations } from "@/lib/validations/queue";
import { PageHeader } from "@/components/ui";
import { DecisionSection, DecisionSectionFallback, PendingCount } from "@/components/validations/decision-section";

export const dynamic = "force-dynamic";
export const metadata = { title: "À décider" };

/** La file complète « À décider » (le Cockpit n'en montre que les dix premières lignes). Même file que le téléphone. */
export default async function ADeciderPage() {
  await requireAnyModule();
  const access = await requireAccessContext();
  const pending = listValidations(access);
  return (
    <>
      <PageHeader
        eyebrow={<Link href="/" className="hover:underline">Cockpit</Link>}
        title="À décider"
        subtitle={<>Tout ce qui attend l&apos;accord de la direction : pièces bloquées, dépenses, contenus, décisions des agents et décisions marketing prioritaires · <Suspense fallback="lecture…"><PendingCount pending={pending} /></Suspense></>}
      />
      <Suspense fallback={<DecisionSectionFallback />}>
        <DecisionSection pending={pending} readOnly={!!access.preview} showEmpty />
      </Suspense>
    </>
  );
}
