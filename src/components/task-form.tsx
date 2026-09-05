import type { Task } from "@/db/schema";
import { saveTask } from "@/app/(app)/taches/actions";

export function TaskForm({ task, users, brands, defaults, isAnimatrice, redirectTo }: {
  task?: Task | null;
  users: { id: string; name: string }[];
  brands: { id: string; name: string }[];
  defaults?: { title?: string; entityType?: string; entityId?: string; brandId?: string; assigneeId?: string; dueDate?: string };
  isAnimatrice?: boolean;
  redirectTo?: string;
}) {
  const t = task;
  return (
    <form action={saveTask} className="space-y-2 text-[13px]">
      {t && <input type="hidden" name="id" value={t.id} />}
      <input type="hidden" name="entityType" value={t?.entityType ?? defaults?.entityType ?? ""} />
      <input type="hidden" name="entityId" value={t?.entityId ?? defaults?.entityId ?? ""} />
      {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}
      <label className="block"><span className="label block mb-1">Titre</span><input name="title" defaultValue={t?.title ?? defaults?.title ?? ""} className="input h-10" required /></label>
      <label className="block"><span className="label block mb-1">Description</span><textarea name="description" defaultValue={t?.description ?? ""} className="textarea min-h-[90px]" /></label>
      <div className="grid grid-cols-2 gap-2">
        {!isAnimatrice && <label className="block"><span className="label block mb-1">Responsable</span><select name="assigneeId" defaultValue={t?.assigneeId ?? defaults?.assigneeId ?? ""} className="select h-10"><option value="">Non assignée</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>}
        <label className="block"><span className="label block mb-1">Deadline</span><input type="date" name="dueDate" defaultValue={t?.dueDate ?? defaults?.dueDate ?? ""} className="input h-10" /></label>
        <label className="block"><span className="label block mb-1">Priorité</span><select name="priority" defaultValue={t?.priority ?? "MEDIUM"} className="select h-10"><option value="LOW">Basse</option><option value="MEDIUM">Moyenne</option><option value="HIGH">Haute</option><option value="CRITICAL">Critique</option></select></label>
        <label className="block"><span className="label block mb-1">Marque</span><select name="brandId" defaultValue={t?.brandId ?? defaults?.brandId ?? ""} className="select h-10"><option value="">—</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      </div>
      <label className="block"><span className="label block mb-1">Impact attendu</span><input name="expectedImpact" defaultValue={t?.expectedImpact ?? ""} className="input h-10" placeholder="ex: +15 % de sell-out sur le point de vente" /></label>
      <button className="btn-primary w-full" type="submit">{t ? "Enregistrer" : "Créer la tâche"}</button>
    </form>
  );
}
