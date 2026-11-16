"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { moveReportAction } from "./actions";

type Status = "DRAFT" | "VALIDATED" | "ARCHIVED";

/** Boutons du cycle d'un rapport. Le serveur tranche (`reportMove()`) ; un refus s'affiche au lieu de casser la page. */
export function ReportStatusButtons({ id, status, canValidate, canEdit, openDecisions }: {
  id: string; status: Status; canValidate: boolean; canEdit: boolean; openDecisions: number;
}) {
  const [state, action, pending] = useActionState(moveReportAction, null);
  const btn = (move: "VALIDATE" | "ARCHIVE" | "REOPEN", label: string, cls: string, confirmText?: string) => (
    <button type="submit" name="move" value={move} className={cls} disabled={pending}
      onClick={(e) => { if (confirmText && !window.confirm(confirmText)) e.preventDefault(); }}>
      {label}
    </button>
  );
  const edit = canEdit || canValidate;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {pending && <Loader2 size={14} className="animate-spin text-muted" />}
      {status === "DRAFT" && canValidate && openDecisions === 0 && btn("VALIDATE", "Valider", "btn-primary btn-sm")}
      {status === "VALIDATED" && canValidate && btn("REOPEN", "Annuler la validation", "btn-ghost btn-sm", "Remettre ce rapport en brouillon ? Les décisions déjà tranchées restent acquises.")}
      {status !== "ARCHIVED" && edit && btn("ARCHIVE", "Archiver", "btn-ghost btn-sm")}
      {status === "ARCHIVED" && edit && btn("REOPEN", "Désarchiver", "btn-secondary btn-sm")}
      {state?.error && <span className="text-[12.5px] text-red basis-full text-right">{state.error}</span>}
    </form>
  );
}
