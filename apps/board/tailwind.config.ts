import type { Config } from "tailwindcss";

export default {
	darkMode: ["class"],
	content: ["./index.html", "./src/**/*.{ts,tsx}"],
	theme: {
		extend: {
			colors: {
				// Setra dark palette — coding-themed
				ground: {
					950: "#080c10",
					900: "#0d1117",
					850: "#111821",
					800: "#161c27",
					750: "#1c2333",
					700: "#21293b",
				},
				setra: {
					50: "#e8f4fd",
					100: "#c4e2fa",
					200: "#92c9f5",
					300: "#5aacf0",
					400: "#2d92e8",
					500: "#1a78d4",
					600: "#145fb0",
					700: "#0f498a",
					800: "#0a3566",
					900: "#062247",
				},
				accent: {
					green: "#22c55e",
					yellow: "#eab308",
					red: "#ef4444",
					purple: "#a855f7",
					cyan: "#06b6d4",
					orange: "#f97316",
				},
				border: "hsl(var(--border))",
				input: "hsl(var(--input))",
				ring: "hsl(var(--ring))",
				background: "hsl(var(--background))",
				foreground: "hsl(var(--foreground))",
				primary: {
					DEFAULT: "hsl(var(--primary))",
					foreground: "hsl(var(--primary-foreground))",
				},
				secondary: {
					DEFAULT: "hsl(var(--secondary))",
					foreground: "hsl(var(--secondary-foreground))",
				},
				muted: {
					DEFAULT: "hsl(var(--muted))",
					foreground: "hsl(var(--muted-foreground))",
				},
				card: {
					DEFAULT: "hsl(var(--card))",
					foreground: "hsl(var(--card-foreground))",
				},
			},
			fontFamily: {
				sans: ["Inter", "system-ui", "sans-serif"],
				mono: ["JetBrains Mono", "Menlo", "monospace"],
			},
			borderRadius: {
				lg: "var(--radius)",
				md: "calc(var(--radius) - 2px)",
				sm: "calc(var(--radius) - 4px)",
			},
			keyframes: {
				"fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
				"slide-in-up": {
					from: { transform: "translateY(8px)", opacity: "0" },
					to: { transform: "translateY(0)", opacity: "1" },
				},
				"pulse-border": {
					"0%, 100%": { borderColor: "rgba(26,120,212,0.4)" },
					"50%": { borderColor: "rgba(26,120,212,0.9)" },
				},
			},
			animation: {
				"fade-in": "fade-in 0.15s ease-out",
				"slide-in-up": "slide-in-up 0.2s ease-out",
				"pulse-border": "pulse-border 2s ease-in-out infinite",
			},
		},
	},
	plugins: [],
} satisfies Config;
