import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],

  publicDir: false,

  optimizeDeps: {
    entries: ["index.html"],
  },

  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("firebase")) return "firebase";
          if (id.includes("react")) return "react";
          if (id.includes("@tanstack")) return "tanstack";
          return "vendor";
        },
      },
    },
  },

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});