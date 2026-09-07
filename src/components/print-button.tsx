"use client";

export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className="btn-primary btn-sm">Imprimer / enregistrer en PDF</button>;
}
