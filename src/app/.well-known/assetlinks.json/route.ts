export const dynamic = "force-dynamic";

/**
 * Digital Asset Links : Android y vérifie que l'APK et le site ont le même propriétaire, et retire alors la barre d'adresse.
 * `TWA_SHA256_FINGERPRINTS` accepte plusieurs empreintes, séparées par des virgules, pour une rotation du keystore.
 * Une empreinte est publique par nature : ce n'est pas un secret (voir DEPLOY_MOBILE.md).
 */
export function GET() {
  const fingerprints = (process.env.TWA_SHA256_FINGERPRINTS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const body = fingerprints.length
    ? [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: process.env.TWA_PACKAGE ?? "ma.comanet.os", sha256_cert_fingerprints: fingerprints } }]
    : [];
  return Response.json(body, { headers: { "Cache-Control": "public, max-age=3600" } });
}
