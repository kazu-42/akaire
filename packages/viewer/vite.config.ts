import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte()],
  // PDF.js の worker をビルドに含める
  optimizeDeps: {
    include: ["pdfjs-dist/legacy/build/pdf"],
  },
  build: {
    target: "es2022",
  },
});
