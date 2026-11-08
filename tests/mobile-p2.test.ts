import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { businessHour, isSundayIn, pushMessage, reminderDue, stockAlertDue, stockAlertText, subscriptionGone, validEndpoint } from "@/lib/mobile/push-shared";
import { swipeDecision, SWIPE_THRESHOLD_PX } from "@/lib/mobile/validations-shared";
import { formDataFromPairs, readReport } from "@/lib/medical/report-input";
import { settle } from "@/lib/mobile/outbox-shared";
import { contentValidationKeys } from "@/lib/content/shared";
import { activationValidationKeys } from "@/lib/activations/shared";

describe("abonnements Web Push", () => {
  test("seuls les services de notification des navigateurs sont acceptés", () => {
    for (const e of ["https://fcm.googleapis.com/fcm/send/abc", "https://web.push.apple.com/QO", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://db5.notify.windows.com/w/?token=x"]) assert.equal(validEndpoint(e), true, e);
  });

  test("un abonnement forgé ne fait pas appeler n'importe quelle adresse au serveur", () => {
    for (const e of ["http://fcm.googleapis.com/x", "https://evil.example/x", "https://169.254.169.254/latest", "https://fcm.googleapis.com.evil.example/x", "https://notpush.apple.com/x", "pas une url", 42, null, `https://fcm.googleapis.com/${"x".repeat(1100)}`]) assert.equal(validEndpoint(e), false, String(e).slice(0, 40));
  });

  test("le message est court et ne mène qu'à une page interne", () => {
    assert.equal(pushMessage({ title: "t", href: "/taches/1" }).href, "/taches/1");
    assert.equal(pushMessage({ title: "t", href: "https://evil.example" }).href, "/notifications");
    assert.equal(pushMessage({ title: "t", href: "//evil.example" }).href, "/notifications");
    assert.equal(pushMessage({ title: "x".repeat(200), body: "y".repeat(400) }).title.length, 80);
    assert.equal(pushMessage({ title: "x", body: "y".repeat(400) }).body.length, 140);
  });

  test("seul un abonnement expiré est oublié", () => {
    assert.equal(subscriptionGone(410), true);
    assert.equal(subscriptionGone(404), true);
    assert.equal(subscriptionGone(500), false);
    assert.equal(subscriptionGone(undefined), false);
  });
});

describe("relances", () => {
  test("l'heure est celle du fuseau demandé, pas celle du serveur", () => {
    assert.equal(businessHour(new Date("2026-11-08T17:20:00Z"), "Asia/Tokyo"), 2);
    assert.equal(businessHour(new Date("2026-11-08T17:20:00Z"), "UTC"), 17);
    assert.equal(isSundayIn(new Date("2026-11-08T12:00:00Z"), "Africa/Casablanca"), true);
    assert.equal(isSundayIn(new Date("2026-11-09T12:00:00Z"), "Africa/Casablanca"), false);
  });

  test("une animatrice qui a saisi n'est jamais relancée", () => {
    assert.equal(reminderDue({ plannedToday: true, enteredToday: true, enteredRecently: true }, false), false);
  });

  test("une animation prévue relance même le dimanche ; une simple habitude, jamais le dimanche", () => {
    assert.equal(reminderDue({ plannedToday: true, enteredToday: false, enteredRecently: false }, true), true);
    assert.equal(reminderDue({ plannedToday: false, enteredToday: false, enteredRecently: true }, false), true);
    assert.equal(reminderDue({ plannedToday: false, enteredToday: false, enteredRecently: true }, true), false);
    assert.equal(reminderDue({ plannedToday: false, enteredToday: false, enteredRecently: false }, false), false);
  });

  test("une référence en tension n'est signalée qu'une fois par semaine", () => {
    const now = new Date("2026-11-08T08:00:00Z");
    assert.equal(stockAlertDue(null, now), true);
    assert.equal(stockAlertDue(new Date("2026-11-05T08:00:00Z"), now), false);
    assert.equal(stockAlertDue(new Date("2026-11-01T08:00:00Z"), now), true);
  });

  test("l'alerte groupe les références", () => {
    assert.deepEqual(stockAlertText(["A"]), { title: "Stock en tension : A", body: "A" });
    assert.equal(stockAlertText(["A", "B", "C", "D", "E"]).body, "A, B, C et 2 autres.");
  });
});

describe("geste de validation", () => {
  test("il faut aller assez loin, et dans le bon sens", () => {
    assert.equal(swipeDecision(SWIPE_THRESHOLD_PX + 1, 0), "OK");
    assert.equal(swipeDecision(-SWIPE_THRESHOLD_PX - 1, 0), "KO");
    assert.equal(swipeDecision(SWIPE_THRESHOLD_PX - 1, 0), null);
  });

  test("faire défiler la page ne valide jamais rien", () => {
    assert.equal(swipeDecision(150, 300), null);
    assert.equal(swipeDecision(-150, -151), null);
  });
});

describe("compte rendu mis en file", () => {
  test("le serveur le lit exactement comme un formulaire du bureau", () => {
    const fd = formDataFromPairs([["objective", " Présenter "], ["productId", "p1"], ["productId", "p2"], ["sampleCount", "2"], ["sample_product_0", "p1"], ["sample_qty_0", "3"], ["sample_product_1", "p2"], ["sample_qty_1", "0"], ["doctorInterest", ""]]);
    const r = readReport(fd, "u1");
    assert.equal(r.objective, "Présenter");
    assert.deepEqual(r.productIds, ["p1", "p2"]);
    assert.deepEqual(r.samples, [{ productId: "p1", quantity: 3 }]);
    assert.equal(r.doctorInterest, null);
    assert.equal(r.createdById, "u1");
  });

  test("ce qui n'est pas une paire de chaînes est écarté", () => {
    assert.equal([...formDataFromPairs("rien").keys()].length, 0);
    assert.equal([...formDataFromPairs([["a", 1], null, ["b", "ok"]]).keys()].join(), "b");
    assert.equal([...formDataFromPairs(Array.from({ length: 500 }, () => ["a", "b"])).keys()].length, 300);
  });

  test("une visite pas encore arrivée fait attendre le compte rendu, sans le perdre ni déranger", () => {
    const s = settle([{ clientEventId: "a" }], [{ clientEventId: "a", ok: false, code: "WAIT", message: "x" }]);
    assert.deepEqual(s.keep, ["a"]);
    assert.deepEqual(s.toFix, []);
    assert.deepEqual(s.remove, []);
  });
});

describe("transitions de validation", () => {
  const t = (fromKey: string, toKey: string, requiresComment: boolean) => ({ fromKey, toKey, requiresValidator: true, requiresComment });

  test("contenu : valider sans commentaire, corriger avec", () => {
    const refs = { statuses: [{ key: "ATT", awaitingValidation: true, inProduction: false }, { key: "OK", awaitingValidation: false, inProduction: false }, { key: "PROD", awaitingValidation: false, inProduction: true }], transitions: [t("ATT", "PROD", false), t("ATT", "OK", false), t("ATT", "PROD", true)] };
    assert.deepEqual(contentValidationKeys(refs), { validate: "OK", correct: "PROD" });
  });

  test("activation : refuser n'est jamais annuler", () => {
    const refs = { statuses: [{ key: "ATT", awaitingValidation: true, isValidated: false, isCancelled: false }, { key: "VAL", awaitingValidation: false, isValidated: true, isCancelled: false }, { key: "ANN", awaitingValidation: false, isValidated: false, isCancelled: true }, { key: "BR", awaitingValidation: false, isValidated: false, isCancelled: false }], transitions: [t("ATT", "ANN", true), t("ATT", "BR", true), t("ATT", "VAL", false)] };
    assert.deepEqual(activationValidationKeys(refs), { validate: "VAL", correct: "BR" });
  });
});
