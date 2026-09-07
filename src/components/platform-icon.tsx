import { Globe, Mail, MessageCircle, Music2, Printer, type LucideProps } from "lucide-react";

/**
 * Pictogramme d'une plateforme de publication. La colonne `content_platforms.icon` porte un
 * nom : les marques (Instagram, Facebook, YouTube, TikTok) sont dessinées ici — lucide ne les
 * fournit plus — les autres viennent de lucide. Un nom inconnu affiche la première lettre.
 */
export function PlatformIcon({ icon, label, size = 14, className }: { icon: string | null | undefined; label?: string; size?: number; className?: string }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className, "aria-hidden": true };
  switch (icon) {
    case "Instagram":
      return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="0.8" fill="currentColor" /></svg>;
    case "Facebook":
      return <svg {...common}><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" /></svg>;
    case "Youtube":
      return <svg {...common}><path d="M2.5 17a24 24 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49 49 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24 24 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49 49 0 0 1-16.2 0A2 2 0 0 1 2.5 17" /><path d="m10 15 5-3-5-3z" /></svg>;
    case "Music2": return <Music2 {...(common as LucideProps)} />;
    case "MessageCircle": return <MessageCircle {...(common as LucideProps)} />;
    case "Globe": return <Globe {...(common as LucideProps)} />;
    case "Mail": return <Mail {...(common as LucideProps)} />;
    case "Printer": return <Printer {...(common as LucideProps)} />;
    default:
      return <span className={className} style={{ fontSize: size * 0.7, lineHeight: 1, fontWeight: 600 }} aria-hidden>{(label ?? icon ?? "?").charAt(0).toUpperCase()}</span>;
  }
}
