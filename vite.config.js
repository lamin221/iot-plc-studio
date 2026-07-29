import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./" garde les chemins relatifs, utile pour GitHub Pages / hebergement dans un sous-dossier.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
