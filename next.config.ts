import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Les fichiers sont téléversés par morceaux (src/lib/chunked-upload.ts) ; ce plafond couvre un morceau
      // encodé en base64 (≈ 2 Mo) avec de la marge, tout en restant sous la limite de 4,5 Mo des hébergeurs serverless.
      bodySizeLimit: "4mb",
    },
  },
  serverExternalPackages: ["pg"],
  // Les migrations SQL (drizzle/) doivent être embarquées dans les fonctions serverless pour /installation.
  outputFileTracingIncludes: {
    "/installation": ["./drizzle/**/*"],
    // Le system prompt du copilote est un fichier Markdown versionné, lu à l'exécution.
    "/api/ai/**": ["./src/lib/ai/prompts/*.md"],
    "/**": ["./src/lib/ai/prompts/*.md"],
  },
};

export default nextConfig;
