import { Badge, type Tone } from "@/components/ui";
import { VERIFICATION_LABELS, type VerificationStatus } from "@/lib/medical/gps-shared";

const TONE: Record<VerificationStatus, Tone> = { VERIFIEE: "green", A_VERIFIER: "orange", NON_VERIFIEE: "red", HORS_CONTROLE: "gray" };

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  return <Badge tone={TONE[status] ?? "gray"} dot>{VERIFICATION_LABELS[status] ?? status}</Badge>;
}
