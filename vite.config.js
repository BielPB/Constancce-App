import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    cssCodeSplit: true,
    sourcemap: false,
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // lucide-react precisa ser checado antes do bucket "react-vendor" —
          // "react" é substring de "lucide-react", então a ordem antiga fazia
          // os ícones caírem junto com react/react-dom em vez do chunk próprio.
          if (id.includes("lucide-react")) return "icons";
          if (id.includes("react") || id.includes("scheduler")) return "react-vendor";
          return "vendor";
        },
      },
    },
  },
});
