/** Stubs de `next/navigation`, `next/headers`, `next/cache` pour le pont CLI (lecture seule, sans session). */
const noSession = (name) => () => { throw new Error(`${name}() indisponible hors de Next.js : cette lecture exige une session.`); };
module.exports = {
  redirect: noSession("redirect"), permanentRedirect: noSession("permanentRedirect"), notFound: noSession("notFound"),
  cookies: noSession("cookies"), headers: noSession("headers"),
  revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn) => fn, cacheTag: () => undefined, cacheLife: () => undefined,
};
