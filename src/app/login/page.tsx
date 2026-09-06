import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { homeForUser } from "@/lib/access";
import { LoginForm } from "./login-form";

export const metadata = { title: "Connexion" };

export default async function LoginPage(props: { searchParams: Promise<{ next?: string }> }) {
  const session = await getSession();
  if (session) redirect(await homeForUser());
  const { next } = await props.searchParams;
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-8">
          <div className="h-10 w-10 rounded-xl bg-accent text-white flex items-center justify-center font-bold text-lg">C</div>
          <div>
            <div className="font-semibold tracking-tight text-lg leading-tight">COMANET OS</div>
            <div className="text-xs text-muted">Strategic, Marketing & Operational Intelligence</div>
          </div>
        </div>
        <div className="card card-pad">
          <h1 className="text-base font-semibold mb-1">Connexion</h1>
          <p className="text-sm text-muted mb-5">Accédez à votre cockpit et à vos tâches.</p>
          <LoginForm next={next} />
        </div>
        <p className="text-[12px] text-faint mt-6 text-center">
          Démo : hicham@comanet.ma / comanet2026
        </p>
      </div>
    </main>
  );
}
