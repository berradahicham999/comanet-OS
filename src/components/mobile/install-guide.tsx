"use client";

import { useEffect, useState } from "react";
import { Download, Share, SquarePlus } from "lucide-react";

type Platform = "android" | "ios" | "ios-other" | "desktop";
type InstallPrompt = Event & { prompt: () => Promise<void> };

function detect(): Platform {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return /CriOS|FxiOS|EdgiOS/i.test(ua) ? "ios-other" : "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return <li className="flex gap-3 text-[14.5px] text-ink-2"><span className="h-6 w-6 rounded-full bg-accent-soft text-accent text-[12.5px] font-semibold flex items-center justify-center shrink-0">{n}</span><span>{children}</span></li>;
}

function IosGuide() {
  return (
    <ol className="space-y-3">
      <Step n={1}>Dans <b>Safari</b>, touchez <b>Partager</b> <Share size={15} className="inline align-text-bottom" /> en bas de l&apos;écran.</Step>
      <Step n={2}>Touchez <b>Sur l&apos;écran d&apos;accueil</b> <SquarePlus size={15} className="inline align-text-bottom" />.</Step>
      <Step n={3}>Touchez <b>Ajouter</b>, puis ouvrez <b>COMANET</b> depuis l&apos;écran d&apos;accueil et connectez-vous.</Step>
    </ol>
  );
}

function AndroidGuide({ apkHref, prompt, onInstall }: { apkHref: string | null; prompt: InstallPrompt | null; onInstall: () => void }) {
  if (apkHref) {
    return (
      <div className="space-y-4">
        <a href={apkHref} className="btn-primary w-full h-14 text-[16px]"><Download size={18} /> Télécharger l&apos;application</a>
        <ol className="space-y-3">
          <Step n={1}>Ouvrez le fichier téléchargé.</Step>
          <Step n={2}>Si le téléphone refuse : touchez <b>Paramètres</b>, activez <b>Autoriser cette source</b>, puis revenez.</Step>
          <Step n={3}>Touchez <b>Installer</b>, ouvrez <b>COMANET</b> et connectez-vous.</Step>
        </ol>
        <p className="text-[12.5px] text-muted">Android peut prévenir que l&apos;application ne vient pas du Play Store : c&apos;est normal, elle est distribuée par COMANET.</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {prompt && <button type="button" onClick={onInstall} className="btn-primary w-full h-14 text-[16px]"><Download size={18} /> Installer l&apos;application</button>}
      <ol className="space-y-3">
        <Step n={1}>Dans <b>Chrome</b>, touchez le menu <b>⋮</b> en haut à droite.</Step>
        <Step n={2}>Touchez <b>Installer l&apos;application</b> ou <b>Ajouter à l&apos;écran d&apos;accueil</b>.</Step>
        <Step n={3}>Ouvrez <b>COMANET</b> depuis l&apos;écran d&apos;accueil et connectez-vous.</Step>
      </ol>
    </div>
  );
}

export function InstallGuide({ qrSvg, url, apkHref }: { qrSvg: string; url: string; apkHref: string | null }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setPlatform(detect()), 0);
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPrompt); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => { clearTimeout(id); window.removeEventListener("beforeinstallprompt", onPrompt); };
  }, []);

  return (
    <main className="min-h-dvh bg-bg px-4 py-8 pb-[calc(32px+env(safe-area-inset-bottom))]">
      <div className="max-w-[420px] mx-auto space-y-5">
        <header>
          <div className="text-[12px] uppercase tracking-wider text-muted">COMANET OS</div>
          <h1 className="text-[24px] font-semibold text-ink">Installer l&apos;application</h1>
          <p className="text-[14.5px] text-muted mt-1">Elle s&apos;ouvre d&apos;un geste et continue de fonctionner sans réseau, en pharmacie comme en sous-sol.</p>
        </header>

        <section className="card p-4">
          {platform === "ios" && <IosGuide />}
          {platform === "ios-other" && <div className="space-y-3"><p className="text-[14.5px] text-ink-2">Sur iPhone, l&apos;installation se fait depuis <b>Safari</b>. Ouvrez cette adresse dans Safari :</p><p className="text-[14px] font-medium break-all">{url}</p></div>}
          {platform === "android" && <AndroidGuide apkHref={apkHref} prompt={prompt} onInstall={() => void prompt?.prompt()} />}
          {(platform === "desktop" || platform === null) && (
            <div className="text-center space-y-2">
              <p className="text-[14.5px] text-ink-2">Scannez ce code avec votre téléphone.</p>
              <div className="inline-block [&>svg]:h-[180px] [&>svg]:w-[180px]" dangerouslySetInnerHTML={{ __html: qrSvg }} />
              <p className="text-[12.5px] text-muted break-all">{url}</p>
            </div>
          )}
        </section>

        {(platform === "android" || platform === "ios") && (
          <details className="card p-4 text-[14px]">
            <summary className="min-h-11 flex items-center font-medium">{platform === "ios" ? "Vous êtes sur Android ?" : "Vous êtes sur iPhone ?"}</summary>
            <div className="pt-2">{platform === "ios" ? <AndroidGuide apkHref={apkHref} prompt={null} onInstall={() => {}} /> : <IosGuide />}</div>
          </details>
        )}

        <a href="/m" className="btn-secondary w-full h-12 text-[14.5px]">Continuer dans le navigateur</a>
      </div>
    </main>
  );
}
