"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LMap } from "leaflet";
import { validateCabinetAction } from "@/app/(app)/medical/suivi/actions";

export type MapVisit = {
  id: string;
  seq: number;
  doctorId: string;
  doctorName: string;
  label: string;
  status: string;
  verificationStatus: string;
  events: { type: string; lat: number | null; lng: number | null; accuracyM: number | null; at: string; atLabel: string }[];
  cabinet: { lat: number; lng: number; validated: boolean } | null;
};

export type MapCabinet = { doctorId: string; name: string; lat: number; lng: number; validated: boolean };

const COLORS: Record<string, string> = { VERIFIEE: "#16a34a", A_VERIFIER: "#ea580c", NON_VERIFIEE: "#dc2626", HORS_CONTROLE: "#6b7280" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Carte du suivi terrain (Leaflet + OpenStreetMap, sans clé). Points de démarrage (pleins, numérotés dans
 * l'ordre de la journée) et de fin (cerclés), cabinets (carrés), trajet reliant les visites, couleur selon
 * le statut de contrôle. Un cabinet « à valider » se déplace à la souris puis se valide d'un clic.
 */
export function FieldMap({ visits, cabinets, editable }: { visits: MapVisit[]; cabinets: MapCabinet[]; editable: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LMap | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !ref.current) return;
      mapRef.current?.remove();
      const map = L.map(ref.current, { scrollWheelZoom: false });
      mapRef.current = map;
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const bounds: [number, number][] = [];
      const path: [number, number][] = [];

      const pin = (text: string, color: string, hollow: boolean) =>
        L.divIcon({
          className: "",
          iconSize: [26, 26],
          iconAnchor: [13, 13],
          html: `<div style="width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:600 11px system-ui;${hollow ? `background:#fff;color:${color};border:3px solid ${color}` : `background:${color};color:#fff;border:2px solid #fff`};box-shadow:0 1px 3px rgba(0,0,0,.4)">${esc(text)}</div>`,
        });
      const square = (color: string, dashed: boolean) =>
        L.divIcon({
          className: "",
          iconSize: [18, 18],
          iconAnchor: [9, 9],
          html: `<div style="width:18px;height:18px;border-radius:4px;background:${dashed ? "#fff7ed" : "#111827"};border:2px ${dashed ? "dashed" : "solid"} ${color};box-shadow:0 1px 3px rgba(0,0,0,.35)"></div>`,
        });

      for (const v of visits) {
        const color = COLORS[v.verificationStatus] ?? COLORS.HORS_CONTROLE;
        for (const e of v.events) {
          if (e.lat === null || e.lng === null) continue;
          if (e.type !== "START" && e.type !== "STOP" && e.type !== "NON_EFFECTUEE") continue;
          const ll: [number, number] = [e.lat, e.lng];
          bounds.push(ll);
          if (e.type === "START" || e.type === "NON_EFFECTUEE") path.push(ll);
          const kind = e.type === "START" ? "Démarrage" : e.type === "STOP" ? "Fin" : "Non effectuée";
          L.marker(ll, { icon: pin(e.type === "STOP" ? `${v.seq}'` : e.type === "NON_EFFECTUEE" ? `${v.seq}×` : String(v.seq), color, e.type === "STOP") })
            .bindPopup(`<b>${v.seq}. Dr ${esc(v.doctorName)}</b><br>${kind} à ${esc(e.atLabel)}${e.accuracyM !== null ? ` · ± ${e.accuracyM} m` : ""}<br>${esc(v.label)}<br><a href="/medical/visites/${v.id}">Fiche visite</a> · <a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${e.lat},${e.lng}">Google Maps</a>`)
            .addTo(map);
          if (e.accuracyM !== null && e.accuracyM > 0) L.circle(ll, { radius: e.accuracyM, color, weight: 1, opacity: 0.4, fillOpacity: 0.06 }).addTo(map);
        }
      }
      if (path.length > 1) L.polyline(path, { color: "#2563eb", weight: 2, dashArray: "6 6", opacity: 0.8 }).addTo(map);

      const seen = new Set<string>();
      for (const c of cabinets) {
        if (seen.has(c.doctorId)) continue;
        seen.add(c.doctorId);
        const ll: [number, number] = [c.lat, c.lng];
        bounds.push(ll);
        const marker = L.marker(ll, { icon: square(c.validated ? "#111827" : "#ea580c", !c.validated), draggable: editable && !c.validated });
        const html = `<b>Cabinet — Dr ${esc(c.name)}</b><br>${c.validated ? "Position validée" : "Position proposée au premier démarrage, <b>à valider</b>"}${editable && !c.validated ? `<br><button data-validate="${c.doctorId}" style="margin-top:6px;padding:4px 10px;border-radius:8px;background:#111827;color:#fff">Valider cette position</button><br><span style="font-size:11px;color:#6b7280">Déplacez le carré si le cabinet est ailleurs.</span>` : ""}`;
        marker.bindPopup(html);
        marker.on("popupopen", (ev) => {
          const btn = (ev.popup.getElement() as HTMLElement | undefined)?.querySelector<HTMLButtonElement>(`[data-validate="${c.doctorId}"]`);
          if (!btn) return;
          btn.onclick = async () => {
            btn.disabled = true;
            const p = marker.getLatLng();
            const res = await validateCabinetAction({ doctorId: c.doctorId, lat: p.lat, lng: p.lng });
            setMsg(res.ok ? `Position du cabinet de Dr ${c.name} validée : les contrôles de ses visites sont recalculés.` : res.message ?? "Validation refusée.");
            if (res.ok) {
              marker.setIcon(square("#111827", false));
              marker.dragging?.disable();
              marker.closePopup();
            } else btn.disabled = false;
          };
        });
        marker.addTo(map);
      }

      if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
      else map.setView([33.5731, -7.5898], 11);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [visits, cabinets, editable]);

  return (
    <div>
      {msg && <div className="mb-2 rounded-xl bg-green-soft border border-green/30 px-3 py-2 text-[13px] text-green">{msg}</div>}
      <div ref={ref} className="w-full h-[420px] rounded-xl border border-line overflow-hidden z-0" />
      <div className="mt-2 flex flex-wrap gap-3 text-[11.5px] text-muted">
        <span><span className="inline-block w-2.5 h-2.5 rounded-full mr-1" style={{ background: COLORS.VERIFIEE }} />Vérifiée</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full mr-1" style={{ background: COLORS.A_VERIFIER }} />À vérifier</span>
        <span><span className="inline-block w-2.5 h-2.5 rounded-full mr-1" style={{ background: COLORS.NON_VERIFIEE }} />Non vérifiée</span>
        <span>● démarrage · ○ fin (n′) · × non effectuée · ■ cabinet validé · ▢ cabinet à valider · - - trajet</span>
      </div>
    </div>
  );
}
