import { requireAccess, isOwnOnly } from "@/lib/access";
import { listBrands, listUsers } from "@/lib/users";
import { PageHeader, Card } from "@/components/ui";
import { TaskForm } from "@/components/task-form";

export const metadata = { title: "Nouvelle tâche" };

export default async function NewTaskPage(props: { searchParams: Promise<{ title?: string; entityType?: string; entityId?: string; brandId?: string; redirectTo?: string }> }) {
  await requireAccess("taches");
  const sp = await props.searchParams;
  const [users, brands] = await Promise.all([listUsers(), listBrands()]);
  return (
    <>
      <PageHeader eyebrow="Tâches" title="Nouvelle tâche" />
      <Card className="max-w-2xl"><TaskForm users={users} brands={brands} defaults={sp} isAnimatrice={await isOwnOnly()} redirectTo={sp.redirectTo} /></Card>
    </>
  );
}
