import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { tracksPlugin } from "./vite-tracks";

export default defineConfig({
	plugins: [
		tracksPlugin(),
		VitePWA({
			registerType: "autoUpdate",
			manifest: {
				name: "Track Map",
				short_name: "TrackMap",
				theme_color: "#000000",
				background_color: "#000000",
				display: "standalone",
				icons: [
					{ src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
					{ src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
					{ src: "icons/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
				],
			},
			workbox: {
				globPatterns: ["**/*.{js,css,html,ico,png,svg,json}"],
				// Tracks are cached at runtime instead: the list must come from the network first, or a
				// link to a newly added track would hit the previous deploy's list.
				globIgnores: ["tracks/**"],
				runtimeCaching: [
					{
						// Tile folders carry the image hash, so a cached tile never goes stale.
						urlPattern: ({ url }) => url.pathname.startsWith("/tracks/") && url.pathname.includes("/tiles-"),
						handler: "CacheFirst",
						options: {
							cacheName: "track-tiles",
							expiration: { maxEntries: 20000 },
						},
					},
					{
						urlPattern: ({ url }) => url.pathname === "/tracks/index.json",
						handler: "NetworkFirst",
						options: { cacheName: "track-list", networkTimeoutSeconds: 3 },
					},
					{
						// Linked from the list as track.json?v=<content hash>: a given URL never changes.
						urlPattern: ({ url }) => url.pathname.startsWith("/tracks/") && url.pathname.endsWith("/track.json"),
						handler: "CacheFirst",
						options: { cacheName: "track-docs", expiration: { maxEntries: 100 } },
					},
				],
			},
		}),
	],
});
