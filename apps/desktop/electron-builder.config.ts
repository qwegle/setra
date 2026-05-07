import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AfterPackContext, Configuration } from "electron-builder";

const config: Configuration = {
	// ── Identity ──────────────────────────────────────────────────────────────
	appId: "sh.setra.app",
	productName: "setra",
	copyright: `Copyright © ${new Date().getFullYear()} setra contributors`,

	// ── Directories ───────────────────────────────────────────────────────────
	directories: {
		output: "dist",
		buildResources: "resources",
	},

	// ── Source files ──────────────────────────────────────────────────────────
	files: [
		"out/**/*",
		"!out/**/*.map",
		// Only include production node_modules; exclude workspace symlinks that
		// point outside apps/desktop/ (electron-builder forbids files outside
		// the project root).  pnpm hoists workspace deps as symlinks — we copy
		// them via extraResources or bundle them at build time instead.
		"node_modules/**/*",
		"!node_modules/@setra",
		"!node_modules/@setra/*",
		"!node_modules/@setra/**",
		"!node_modules/@types",
		"!node_modules/@types/*",
		"!node_modules/@types/**",
		"!node_modules/typescript",
		"!node_modules/typescript/**",
		"!node_modules/**/sharp/**",
		"!node_modules/**/.turbo/**",
		"!**/.turbo/**",
		"!node_modules/**/*.md",
		"!node_modules/**/*.ts",
		"!node_modules/**/*.map",
		"!node_modules/**/test/**",
		"!node_modules/**/tests/**",
		"!node_modules/**/docs/**",
		"!node_modules/**/example/**",
		"!node_modules/**/examples/**",
		"!node_modules/**/.github/**",
		"!node_modules/**/CHANGELOG*",
		"!node_modules/**/LICENSE*",
		"!node_modules/**/README*",
	],

	// ── Native addons: must be outside asar ───────────────────────────────────
	asarUnpack: [
		"**/node_modules/node-pty/**",
		"**/node_modules/better-sqlite3/**",
	],

	extraResources: [
		// Board UI (the entire React app built from apps/board)
		{
			from: "../../apps/board/dist",
			to: "board",
			filter: ["**/*"],
		},
		// API server (Hono) — forked as a child process by the Electron main
		{
			from: "../../apps/server/dist",
			to: "server",
			filter: ["**/*"],
		},
		// DB migrations — needed by the server at runtime
		{
			from: "../../packages/db/migrations",
			to: "migrations",
			filter: ["**/*"],
		},
	],

	// ── Custom URL protocol ───────────────────────────────────────────────────
	protocols: [
		{
			name: "setra",
			schemes: ["setra"],
			role: "Viewer",
		},
	],

	// Ensure native addons are rebuilt for the bundled Electron ABI
	npmRebuild: true,
	afterPack: async (context: AfterPackContext) => {
		const unpackedDir =
			context.electronPlatformName === "darwin"
				? join(
						context.appOutDir,
						`${context.packager.appInfo.productFilename}.app`,
						"Contents",
						"Resources",
						"app.asar.unpacked",
					)
				: join(context.appOutDir, "resources", "app.asar.unpacked");
		if (!existsSync(unpackedDir)) return;

		execFileSync(
			process.execPath,
			[
				join(
					context.packager.info.projectDir,
					"scripts",
					"strip-native-bloat.cjs",
				),
				unpackedDir,
			],
			{ stdio: "inherit" },
		);
	},

	// ── Auto-updater / publish ─────────────────────────────────────────────────
	publish: [
		{
			provider: "github",
			owner: "nitikeshq",
			repo: "setra",
			releaseType: "release",
		},
		// S3 mirror for update server — configured only when env var is set
		...(process.env["S3_RELEASE_BUCKET"]
			? [
					{
						provider: "s3" as const,
						bucket: process.env["S3_RELEASE_BUCKET"],
						region: process.env["AWS_REGION"] ?? "us-east-1",
						path: "/releases",
						acl: "public-read" as const,
					},
				]
			: []),
	],

	// ────────────────────────────────────────────────────────────────────────
	// macOS — universal binary (.dmg + .zip)
	// ────────────────────────────────────────────────────────────────────────
	mac: {
		target: [
			{ target: "dmg", arch: ["universal"] },
			{ target: "zip", arch: ["universal"] },
		],
		// "universal" is built from arm64 + x64 via --universal flag in CI
		artifactName: "setra-${version}-mac-universal.${ext}",

		category: "public.app-category.developer-tools",
		icon: "resources/icon.icns",
		hardenedRuntime: true,
		gatekeeperAssess: false,
		entitlements: "resources/entitlements.mac.plist",
		entitlementsInherit: "resources/entitlements.mac.plist",

		// Notarization handled externally via xcrun notarytool in CI workflow
		notarize: false,

		// Code signing identity — populated from keychain set up in CI
		identity: process.env["CSC_NAME"] ?? undefined,
	},

	dmg: {
		sign: false,
		contents: [
			{ x: 130, y: 220 },
			{ x: 410, y: 220, type: "link", path: "/Applications" },
		],
		title: "setra ${version}",
	},

	// ────────────────────────────────────────────────────────────────────────
	// Linux — .deb, .rpm, .AppImage, .snap
	// ────────────────────────────────────────────────────────────────────────
	linux: {
		target: [
			{ target: "deb", arch: ["x64", "arm64"] },
			{ target: "rpm", arch: ["x64"] },
			{ target: "AppImage", arch: ["x64", "arm64"] },
			{ target: "snap", arch: ["x64"] },
		],
		artifactName: "setra-${version}-linux-${arch}.${ext}",

		icon: "resources/icon.png",
		category: "Development",
		description: "Run AI coding agents anywhere, remember everything",
		synopsis: "A field for AI agents",
		mimeTypes: ["x-scheme-handler/setra"],
	},

	deb: {
		depends: [
			"libgtk-3-0",
			"libnotify4",
			"libnss3",
			"libxss1",
			"libxtst6",
			"xdg-utils",
			"libatspi2.0-0",
			"libsecret-1-0",
		],
	},

	rpm: {
		depends: [
			"gtk3",
			"libnotify",
			"nss",
			"libXScrnSaver",
			"libXtst",
			"xdg-utils",
			"at-spi2-core",
			"libsecret",
		],
	},

	snap: {
		plugs: ["default", "password-manager-service", "ssh-keys"],
	},

	// ────────────────────────────────────────────────────────────────────────
	// Windows — NSIS installer + MSI
	// ────────────────────────────────────────────────────────────────────────
	win: {
		target: [
			{ target: "nsis", arch: ["x64"] },
			{ target: "msi", arch: ["x64"] },
		],
		artifactName: "setra-${version}-win-${arch}.${ext}",

		icon: "resources/icon.ico",
		certificateFile: process.env["WIN_CSC_LINK"] ?? undefined,
		certificatePassword: process.env["WIN_CSC_KEY_PASSWORD"] ?? undefined,
		verifyUpdateCodeSignature: !!process.env["WIN_CSC_LINK"],
		timeStampServer: "http://timestamp.digicert.com",
	},

	nsis: {
		oneClick: false,
		perMachine: false,
		allowToChangeInstallationDirectory: true,
		allowElevation: true,
		createDesktopShortcut: true,
		createStartMenuShortcut: true,
		shortcutName: "setra",
		runAfterFinish: true,
	},

	msi: {
		oneClick: false,
		runAfterFinish: false,
	},
};

export default config;
