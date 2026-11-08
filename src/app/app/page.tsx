import type { Metadata } from "next";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { InstallGuide } from "@/components/mobile/install-guide";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Installer l'application", description: "Installez COMANET OS sur votre téléphone." };

/**
 * Page à partager par simple lien : publique, sans aucune donnée. Le QR code reprend l'adresse réelle du site,
 * il reste juste si le domaine change.
 */
export default async function AppPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const url = `${proto}://${host}/app`;
  const qr = await QRCode.toString(url, { type: "svg", margin: 1, width: 180 });
  // Adresse de l'APK (DEPLOY_MOBILE.md). Tant qu'elle manque, Android s'installe depuis Chrome, comme un iPhone depuis Safari.
  return <InstallGuide qrSvg={qr} url={url} apkHref={process.env.APK_URL || null} />;
}
