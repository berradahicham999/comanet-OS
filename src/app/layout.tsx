import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "COMANET OS", template: "%s · COMANET OS" },
  description: "Strategic, Marketing & Operational Intelligence Platform",
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "COMANET OS", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#f5f5f3",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
