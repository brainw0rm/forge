import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv, type Plugin } from "vite";
import { defineConfig } from "vitest/config";

/** Writes dist/ads.txt from VITE_ADSENSE_CLIENT so AdSense can verify the publisher. */
function adsTxt(client: string | undefined): Plugin {
  return {
    name: "ads-txt",
    apply: "build",
    writeBundle(options) {
      if (!client) return;
      const pub = client.replace(/^ca-/, "");
      writeFileSync(resolve(options.dir ?? "dist", "ads.txt"), `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`);
    },
  };
}

// In development the API runs in `wrangler pages dev` on :8788; Vite forwards /api to it.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [adsTxt(env.VITE_ADSENSE_CLIENT)],
    server: {
      proxy: {
        "/api": { target: "http://localhost:8788", changeOrigin: false },
        "/og": { target: "http://localhost:8788", changeOrigin: false },
      },
    },
    test: {
      // The API tests boot a local workerd; give them time.
      testTimeout: 90_000,
      hookTimeout: 60_000,
    },
  };
});
