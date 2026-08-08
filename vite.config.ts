import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  // Foursquare Places API does not allow browser CORS from arbitrary origins.
  // During local development, proxy through Vite so requests are same-origin.
  // In production, this should be handled by your hosting layer (reverse proxy
  // / serverless function) to avoid exposing the API key and to satisfy CORS.
  server: {
    proxy: {
      "/__fsq": {
        target: "https://places-api.foursquare.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/__fsq/, ""),
        configure: (proxy) => {

        },
      },
      // Overpass: overpass-api.de returns CORS-less error responses under load.
      // Route through the dev server so dev matches the prod /api/overpass proxy.
      "/__overpass": {
        target: "https://overpass-api.de",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/__overpass/, "/api/interpreter"),
      },
      // Cerebras (agent LLM, OpenAI-compatible): route dev requests through Vite
      // to sidestep CORS. The browser sends Authorization: Bearer
      // <VITE_CEREBRAS_API_KEY> (dev only).
      "/__cerebras": {
        target: "https://api.cerebras.ai",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/__cerebras/, ""),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Function form keeps chunking compatible across Vite/Rollup versions.
        manualChunks: (id) => {
          if (id.includes("node_modules/maplibre-gl")) return "maplibre";
          if (
            id.includes("node_modules/react-router-dom") ||
            id.includes("node_modules/react-dom") ||
            id.includes("node_modules/react/")
          ) {
            return "react-vendor";
          }
          return undefined;
        },
      },
    },
  },
});
