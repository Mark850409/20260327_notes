import { defineConfig } from "astro/config";
import vue  from "@astrojs/vue";
import node from "@astrojs/node";
import tailwind from "@astrojs/tailwind";

export default defineConfig({
  // SSR mode: every page request fetches fresh data from Flask API.
  // No static build step needed when content changes — just refresh the browser.
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [
    tailwind({ applyBaseStyles: false }),
    vue(),
  ],
  server: {
    host: "0.0.0.0",
    port: 4321,
  },
  vite: {
    define: {
      // SSR：與各頁 `import.meta.env.API_BASE` 一致（建置時由 process.env.API_BASE 或預設值寫入）
      "import.meta.env.API_BASE": JSON.stringify(
        process.env.API_BASE || "http://backend:5000"
      ),
    },
  },
});
