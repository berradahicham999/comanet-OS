/**
 * Flux de ventes automatique (Pharmafirst → Auracos) — partie PURE (aucune base) : lecture du classeur du prestataire,
 * clés stables malgré le tri et les lignes identiques, échantillons, fenêtre d'années, garde-fou, saut de l'import manuel.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  feedActive, feedClientName, feedDownloadUrls, feedDropMessage, feedLineKeys, feedWindow, importSkippedForFeed, isSampleLine,
  looksLikeXlsx, parseFeedWorkbook,
} from "@/lib/import/sales-feed-shared";

/** Numéro de série Excel d'une date à 00:00:20 UTC, comme le fichier de Pharmafirst. */
const serial = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), 0, 0, 20) / 86400000 + 25569;

function workbook(detail: unknown[][], opts: { title?: string | null; stamp?: string } = {}): Uint8Array {
  const wb = XLSX.utils.book_new();
  const synth = [["AURACOS · PRO COLLAGENIUM 25ML · 2026"], [`Mis a jour le ${opts.stamp ?? "17/11/2026 a 22:20"} · source Sage`], [], ["Unites vendues", "CA HT"]];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(synth), "Synthese");
  const title = opts.title === undefined ? "Detail des lignes · PRO COLLAGENIUM 25ML · 2026" : opts.title;
  const rows = [[title], ["Date", "Piece", "Type", "Client", "Commercial", "Ville", "Unites", "CA HT", "Remarque"], ...detail];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Detail");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

const LINES = [
  [serial("2026-11-17"), "BL262636", "Facture", "DAISY", "Imad Alaoui", "Tetouan", 30, 10874.93, ""],
  [serial("2026-11-12"), "BL262591", "BL", "ECHANTILLON", "Non attribue", "Casablanca", 1, 0, "Echantillon"],
  [serial("2026-09-29"), null, "Facture", "PHARMACIE MALABATA HILLS", "Hanane Taoufiq", "Tanger", -24, -8699.94, ""],
  [serial("2026-07-22"), "BL261755", "Facture", "MARRAKECH PHAR (AMAL MICHMICH) (comptoir)", "Anas Belouali", "Marrakech", 45, 15660, ""],
  [serial("2026-05-21"), "BL261091", "Facture", "PARA SOLUNA SANTE (comptoir)", "Imad Alaoui", "Fes", 43, 14963.9, ""],
  [serial("2026-05-21"), "BL261091", "Facture", "PARA SOLUNA SANTE (comptoir)", "Imad Alaoui", "Fes", 43, 14963.9, ""],
];

describe("lecture du classeur", () => {
  test("onglet Detail, heure de mise à jour, année et produit du titre", () => {
    const p = parseFeedWorkbook(workbook(LINES));
    assert.equal(p.sheet, "Detail");
    assert.equal(p.stamp, "17/11/2026 22:20");
    assert.deepEqual(p.years, [2026]);
    assert.equal(p.lines.length, 6);
    assert.deepEqual(p.errors, []);
    assert.equal(p.lines[0].product, "PRO COLLAGENIUM 25ML");
  });

  test("dates exactes quel que soit le fuseau (heure d'été comprise)", () => {
    const p = parseFeedWorkbook(workbook(LINES));
    assert.deepEqual(p.lines.map((l) => l.date), ["2026-11-17", "2026-11-12", "2026-09-29", "2026-07-22", "2026-05-21", "2026-05-21"]);
  });

  test("avoir sans pièce, commercial « Non attribue » vidé, échantillon repéré", () => {
    const p = parseFeedWorkbook(workbook(LINES));
    const avoir = p.lines[2];
    assert.equal(avoir.piece, null);
    assert.equal(avoir.quantity, -24);
    assert.equal(avoir.amount, -8699.94);
    assert.equal(p.lines[1].rep, null);
    assert.equal(p.lines[1].isSample, true);
    assert.equal(p.lines[0].isSample, false);
  });

  test("ligne incomplète signalée, pas inventée", () => {
    const p = parseFeedWorkbook(workbook([[serial("2026-11-17"), "BL1", "Facture", "DAISY", "", "", null, 100, ""], ["", "", "", "", "", "", "", "", ""]]));
    assert.equal(p.lines.length, 0);
    assert.deepEqual(p.errors, [{ row: 3, message: "Unités absentes" }]);
  });

  test("sans produit dans le titre ni colonne Produit : erreur par ligne", () => {
    const p = parseFeedWorkbook(workbook([LINES[0]], { title: null }));
    assert.equal(p.lines.length, 0);
    assert.match(p.errors[0].message, /Produit inconnu/);
  });

  test("classeur sans en-tête reconnu : refus explicite", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["rien"]]), "Feuil1");
    assert.throws(() => parseFeedWorkbook(new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }))), /Aucun onglet de détail/);
  });

  test("client sans la mention « (comptoir) », échantillon par client ou remarque", () => {
    assert.equal(feedClientName("MARRAKECH PHAR (AMAL MICHMICH) (comptoir)"), "MARRAKECH PHAR (AMAL MICHMICH)");
    assert.equal(feedClientName("MONOUAF (COTE PARA)"), "MONOUAF (COTE PARA)");
    assert.equal(isSampleLine("ECHANTILLON", null), true);
    assert.equal(isSampleLine("DAISY", "Échantillon"), true);
    assert.equal(isSampleLine("DAISY", null), false);
  });
});

describe("clés stables", () => {
  const p = parseFeedWorkbook(workbook(LINES));

  test("deux lignes identiques d'un même BL gardent deux clés", () => {
    const keys = feedLineKeys("PHARMAFIRST", p.lines);
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.every((k) => k.startsWith("FEED:")));
  });

  test("une nouvelle vente en tête de fichier ne change pas les clés des autres", () => {
    const before = feedLineKeys("PHARMAFIRST", p.lines);
    const next = parseFeedWorkbook(workbook([[serial("2026-11-18"), "BL262700", "Facture", "CMA", "", "Rabat", 12, 4349.97, ""], ...LINES]));
    const after = feedLineKeys("PHARMAFIRST", next.lines);
    assert.deepEqual(after.slice(1), before);
  });

  test("une ligne corrigée change de clé (elle sera remplacée)", () => {
    const changed = LINES.map((l, i) => (i === 0 ? [...l.slice(0, 6), 36, 13049.92, ""] : l));
    const a = feedLineKeys("PHARMAFIRST", p.lines);
    const b = feedLineKeys("PHARMAFIRST", parseFeedWorkbook(workbook(changed)).lines);
    assert.notEqual(a[0], b[0]);
    assert.deepEqual(a.slice(1), b.slice(1));
  });
});

describe("fenêtre, garde-fou, import manuel", () => {
  test("fenêtre = années du fichier, jamais avant le départ du flux", () => {
    assert.deepEqual(feedWindow([2026], "2026-01-01"), { from: "2026-01-01", to: "2026-12-31" });
    assert.deepEqual(feedWindow([2026], "2026-06-01"), { from: "2026-06-01", to: "2026-12-31" });
    // Le fichier 2027 ne touche pas aux ventes 2026.
    assert.deepEqual(feedWindow([2027], "2026-01-01"), { from: "2027-01-01", to: "2027-12-31" });
    assert.equal(feedWindow([2025], "2026-01-01"), null);
    assert.equal(feedWindow([], "2026-01-01"), null);
  });

  test("garde-fou : baisse au-delà du seuil refusée", () => {
    assert.equal(feedDropMessage(0, 100, 20), null);
    assert.equal(feedDropMessage(1000, 850, 20), null);
    assert.equal(feedDropMessage(1000, 1200, 20), null);
    assert.match(feedDropMessage(1000, 500, 20)!, /50 %/);
  });

  test("import manuel : seules la marque et le site du flux, à partir du départ, sont ignorés", () => {
    const f = { enabled: true, site: "PHARMAFIRST", brandId: "auracos", from: "2026-01-01" };
    assert.equal(importSkippedForFeed(f, "2026-05-04", "PHARMAFIRST", "auracos"), true);
    assert.equal(importSkippedForFeed(f, "2026-05-04", "pharmafirst", "auracos"), true);
    assert.equal(importSkippedForFeed(f, "2025-12-31", "PHARMAFIRST", "auracos"), false);
    assert.equal(importSkippedForFeed(f, "2026-05-04", "PHARMAFIRST", "alphascience"), false);
    assert.equal(importSkippedForFeed(f, "2026-05-04", "COS", "auracos"), false);
    assert.equal(importSkippedForFeed({ ...f, enabled: false }, "2026-05-04", "PHARMAFIRST", "auracos"), false);
    assert.equal(feedActive({ ...f, from: null }), false);
  });
});

describe("téléchargement", () => {
  test("lien Drive ou Sheets → téléchargement direct puis export", () => {
    const id = "15GljuuP7CaL1uNpsng_FlRIqfM1JlwaJ";
    const urls = feedDownloadUrls(`https://docs.google.com/spreadsheets/d/${id}/edit?gid=861784160#gid=861784160`);
    assert.deepEqual(urls, [`https://drive.google.com/uc?export=download&id=${id}`, `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`]);
    assert.equal(feedDownloadUrls(`https://drive.google.com/file/d/${id}/view?usp=sharing`)[0], `https://drive.google.com/uc?export=download&id=${id}`);
    assert.deepEqual(feedDownloadUrls("https://exemple.test/fichier.xlsx"), ["https://exemple.test/fichier.xlsx"]);
  });

  test("une page de connexion n'est pas un classeur", () => {
    assert.equal(looksLikeXlsx(new TextEncoder().encode("<!doctype html>")), false);
    assert.equal(looksLikeXlsx(workbook(LINES)), true);
  });
});
