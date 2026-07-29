import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "even — settle up with anyone",
        short_name: "even",
        description: "Pay and request money with anyone, instantly.",
        theme_color: "#5B4DF5",
        background_color: "#F1F1F5",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Never cache API responses — this is live financial data.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: { port: 5173 },
});
