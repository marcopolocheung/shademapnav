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
        manualChunks: {
          'maplibre': ['maplibre-gl'],
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
