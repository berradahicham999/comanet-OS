import type { MetadataRoute } from "next";

/**
 * Un manifest vaut pour tout le site : il ne peut pas varier selon la personne. `/m` est donc le seul point d'entrée,
 * et c'est l'écran qui s'adapte aux droits (`personaOf()`).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/m",
    name: "COMANET OS",
    short_name: "COMANET",
    description: "Le terrain COMANET : saisie, stock, tournée, même sans réseau.",
    lang: "fr",
    start_url: "/m",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f5f5f3",
    theme_color: "#0f766e",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
