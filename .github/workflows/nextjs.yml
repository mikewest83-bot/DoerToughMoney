import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/DoerToughMoney/" : "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["apple-touch-icon.png"],
      manifest: {
        name: "DoerToughMoney — your money, your decisions, your advantage",
        short_name: "DoerToughMoney",
        description:
          "Track accounts, bills, budgets and goals, and find savings with DealTough.",
        theme_color: "#5B4DF5",
        background_color: "#F1F1F5",
        display: "standalone",
        start_url: "/DoerToughMoney/",
        icons: [
          {
            src: "/DoerToughMoney/pwa-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/DoerToughMoney/pwa-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/DoerToughMoney/pwa-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
  ],
  server: {
    port: 5173,
  },
});