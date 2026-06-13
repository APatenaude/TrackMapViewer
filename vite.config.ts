import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	plugins: [
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
				additionalManifestEntries: [{ url: "/tiles/tremblant.dzi", revision: null }],
				runtimeCaching: [
					{
						urlPattern: /\/tiles\/.*/,
						handler: "CacheFirst",
						options: {
							cacheName: "tiles-cache",
							expiration: {
								maxEntries: 5000,
								maxAgeSeconds: 60 * 60 * 24 * 30,
							},
						},
					},
				],
			},
		}),
	],
});
