import { type ChildProcess, fork } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { closeDb, getDb, runMigrations, seedBuiltins } from "@setra/db";
import { getMemoryStore } from "@setra/memory";
import { getMonitorService } from "@setra/monitor";
import {
	BrowserWindow,
	Menu,
	Tray,
	app,
	dialog,
	ipcMain,
	nativeTheme,
	shell,
} from "electron";
import log from "electron-log/main";
import { autoUpdater } from "electron-updater";

// Ignore EPIPE errors from electron-log when the parent shell pipe is closed.
// This prevents a broken stdout pipe from crashing the main process.
process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
	if (err.code === "EPIPE") return;
	log.error("[main] uncaughtException:", err);
	throw err;
});
process.stdout?.on("error", (err: NodeJS.ErrnoException) => {
	if (err.code === "EPIPE") return;
});
process.stderr?.on("error", (err: NodeJS.ErrnoException) => {
	if (err.code === "EPIPE") return;
});
import { registerCommandsHandlers } from "./ipc/commands.js";
import { registerCompanyHandlers, registerCompanyRun } from "./ipc/company.js";
import { registerGovernanceHandlers } from "./ipc/governance.js";
import { registerGroundsHandlers } from "./ipc/grounds.js";
import { registerInstancesHandlers } from "./ipc/instances.js";
import { registerIntegrationsHandlers } from "./ipc/integrations.js";
import { registerKanbanHandlers } from "./ipc/kanban.js";
import { registerLedgerHandlers } from "./ipc/ledger.js";
import { registerMcpHandlers } from "./ipc/mcp.js";
import { registerMemoryHandlers } from "./ipc/memory.js";
import { registerModelsHandlers } from "./ipc/models.js";
import { registerMonitorHandlers } from "./ipc/monitor.js";
import { registerPlotsHandlers } from "./ipc/plots.js";
import { registerPrHandlers } from "./ipc/pr.js";
import { registerProfileHandlers } from "./ipc/profile.js";
import { registerProjectsHandlers } from "./ipc/projects.js";
import {
	startPtyDispatchPoller,
	stopPtyDispatchPoller,
} from "./ipc/pty-dispatch.js";
import { registerRunsHandlers } from "./ipc/runs.js";
import { registerSecurityToolHandlers } from "./ipc/security-tools.js";
import {
	loadSettingsIntoEnv,
	registerSettingsHandlers,
} from "./ipc/settings.js";
import { registerSkillsHandlers } from "./ipc/skills.js";
import { registerTeamHandlers } from "./ipc/team.js";
import { registerTerminalHandlers } from "./ipc/terminal.js";
import { registerToolsHandlers } from "./ipc/tools.js";
import { registerTracesHandlers } from "./ipc/traces.js";
import { registerWebSearchHandlers } from "./ipc/web-search.js";
import { registerWikiHandlers } from "./ipc/wiki.js";

// Logging — write to ~/.setra/logs/
log.initialize();
log.transports.file.resolvePathFn = () =>
	join(homedir(), ".setra", "logs", "main.log");
console.log = log.log;
console.error = log.error;
console.warn = log.warn;
console.debug = log.debug;

const IS_DEV = process.env["NODE_ENV"] === "development";
const PROTOCOL_SCHEME = "setra";

app.commandLine.appendSwitch("js-flags", "--max-old-space-size=256");
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

// Register custom protocol before app ready
if (process.defaultApp && process.argv.length >= 2) {
	app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [
		process.argv[1] ?? "",
	]);
} else {
	app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
}

// ─── Embedded API server ─────────────────────────────────────────────────────
// In production the Hono server runs as a forked child process so the board UI
// can reach localhost:3141 without the user starting anything manually.
// In dev mode we skip this because the developer runs `pnpm --filter @setra/server dev`.
const SETRA_PORT = Number(process.env.SETRA_PORT ?? 3141);
let serverProcess: ChildProcess | null = null;

async function startEmbeddedServer(): Promise<void> {
	// In dev mode, assume the developer is running the server separately
	if (IS_DEV) {
		log.info("[server] Dev mode — skipping embedded server (use pnpm dev)");
		return;
	}

	// Locate the bundled server entry point
	// Production: resources/server/index.js (copied by electron-builder extraResources)
	const candidates = [
		join(process.resourcesPath ?? "", "server", "index.js"),
		// Fallback: monorepo layout (for local production builds)
		resolve(__dirname, "..", "..", "..", "server", "dist", "index.js"),
	];

	const serverEntry = candidates.find((p) => existsSync(p));
	if (!serverEntry) {
		log.warn("[server] No server entry found — API will not be available");
		log.warn("[server] Searched:", candidates);
		return;
	}

	log.info("[server] Starting embedded server from:", serverEntry);

	serverProcess = fork(serverEntry, [], {
		env: {
			...process.env,
			SETRA_PORT: String(SETRA_PORT),
			NODE_ENV: "production",
		},
		stdio: ["ignore", "pipe", "pipe", "ipc"],
		silent: true,
	});

	serverProcess.stdout?.on("data", (data: Buffer) => {
		log.info("[server]", data.toString().trimEnd());
	});
	serverProcess.stderr?.on("data", (data: Buffer) => {
		log.error("[server]", data.toString().trimEnd());
	});
	serverProcess.on("exit", (code, signal) => {
		log.warn(`[server] exited code=${code} signal=${signal}`);
		serverProcess = null;
	});

	// Wait briefly for the server to be ready
	const maxWait = 8000;
	const start = Date.now();
	while (Date.now() - start < maxWait) {
		try {
			const res = await fetch(`http://localhost:${SETRA_PORT}/api/health`);
			if (res.ok) {
				log.info("[server] Embedded server ready on port", SETRA_PORT);
				return;
			}
		} catch {
			// not ready yet
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	log.warn(
		"[server] Server did not become ready within timeout — continuing anyway",
	);
}

function stopEmbeddedServer(): void {
	if (serverProcess && !serverProcess.killed) {
		log.info("[server] Stopping embedded server");
		serverProcess.kill("SIGTERM");
		serverProcess = null;
	}
}

// Required for Electron Security: disable remote module
// (it's already disabled by default in Electron 14+, but be explicit)
app.commandLine.appendSwitch("no-sandbox", "false");
// Limit renderer V8 heap to 512 MB to prevent runaway memory usage
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=512");

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Shell environment — load the user's real shell env so PATH includes
// brew, nvm, pyenv, etc. Without this, agent binaries won't be found.
// Same pattern as Superset's applyShellEnvToProcess().
async function applyShellEnvToProcess(): Promise<void> {
	try {
		// shell-env reads the interactive shell env without spawning a full login shell
		const { shellEnv } = await import("shell-env");
		const env = await shellEnv();

		for (const [key, value] of Object.entries(env)) {
			if (value !== undefined) {
				process.env[key] = value;
			}
		}

		// Security: remove Google API key from the env we pass to child processes
		// (it ends up in terminal PTYs otherwise — not great)
		delete process.env["GOOGLE_API_KEY"];

		log.info("[main] Shell environment applied, PATH:", process.env["PATH"]);
	} catch (err) {
		log.error("[main] Failed to apply shell environment:", err);
	}
}

// Database initialisation
let dbReadyPromise: Promise<void> | null = null;

async function initDatabase(): Promise<void> {
	if (dbReadyPromise) return dbReadyPromise;

	dbReadyPromise = (async () => {
		const setraDir = join(homedir(), ".setra");
		mkdirSync(setraDir, { recursive: true });
		mkdirSync(join(setraDir, "logs"), { recursive: true });

		const dbPath = join(setraDir, "setra.db");

		try {
			getDb({ dbPath, verbose: IS_DEV });
		} catch (err) {
			// Native module ABI mismatch in dev — non-fatal, board UI uses external server
			log.warn("[db] Failed to open database (native module issue):", err);
			return;
		}

		// In dev mode: __dirname = apps/desktop/out/main/ → go up 4 levels to setra root → packages/db/migrations
		// In production: migrations should be bundled alongside the app resources
		const migrationsPath = IS_DEV
			? join(__dirname, "..", "..", "..", "..", "packages", "db", "migrations")
			: join(process.resourcesPath ?? join(__dirname, ".."), "migrations");

		try {
			await runMigrations(migrationsPath);
			seedBuiltins();
			log.info("[db] Database ready:", dbPath);
		} catch (err) {
			log.error("[db] Migration failed:", err);
		}
	})();

	return dbReadyPromise;
}

// Window creation
function createMainWindow(): BrowserWindow {
	const win = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 900,
		minHeight: 600,
		center: true,
		titleBarStyle: "hiddenInset",
		// trafficLightPosition only has effect on macOS
		trafficLightPosition: { x: 16, y: 16 },
		backgroundColor: "#0d1117",
		title: "Setra",
		show: false,
		webPreferences: {
			preload: join(__dirname, "..", "preload", "index.js"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: false,
			backgroundThrottling: true,
			offscreen: false,
			// Allow the renderer to load local fonts bundled in the app
			webSecurity: !IS_DEV,
		},
	});

	// Show only after content is rendered to avoid flash of white
	win.once("ready-to-show", () => {
		win.show();
		// DevTools are available via Cmd+Shift+I but not auto-opened
		// (auto-opening DevTools causes 500MB+ additional memory usage)
	});
	// Fallback: show the window after 5s even if ready-to-show never fires
	setTimeout(() => {
		if (!win.isDestroyed() && !win.isVisible()) win.show();
	}, 5000);

	// Capture renderer console messages — rate-limited to prevent memory buildup
	let consoleLogCount = 0;
	win.webContents.on(
		"console-message",
		(_event, level, message, line, sourceId) => {
			// Only log errors unconditionally; limit others to first 100
			if (level === 2 || consoleLogCount < 100) {
				const levelLabel = ["log", "warn", "error", "info"][level] ?? "log";
				console.log(
					`[renderer:${levelLabel}] ${message} (${sourceId}:${line})`,
				);
				consoleLogCount++;
			}
		},
	);
	win.webContents.on(
		"did-fail-load",
		(_event, errorCode, errorDescription, validatedURL) => {
			console.error(
				`[renderer] did-fail-load ${errorCode} ${errorDescription} url=${validatedURL}`,
			);
		},
	);
	win.webContents.on("render-process-gone", (_event, details) => {
		console.error(
			`[renderer] render-process-gone reason=${details.reason} exitCode=${details.exitCode}`,
		);
	});

	win.webContents.setWindowOpenHandler(({ url }) => {
		// Open external links in the OS default browser, not in Electron
		void shell.openExternal(url);
		return { action: "deny" };
	});

	if (IS_DEV) {
		// Board dev server is always on :5173 (strictPort)
		void win.loadURL("http://localhost:5173").catch(() => {
			if (!win.isDestroyed()) win.show();
		});
	} else {
		// Production: load the board through the embedded Hono server so that
		// relative /api calls resolve correctly (file:// would break them).
		void win.loadURL(`http://localhost:${SETRA_PORT}/`).catch(() => {
			// Fallback: load static file directly (server may not be ready)
			void win.loadFile(join(process.resourcesPath, "board", "index.html"));
		});
	}

	win.on("closed", () => {
		mainWindow = null;
	});

	return win;
}

// System tray
function createTray(): void {
	// Use a template icon on macOS (monochrome, adapts to light/dark menu bar)
	const iconPath = IS_DEV
		? join(__dirname, "..", "..", "resources", "trayIconTemplate.png")
		: join(process.resourcesPath, "trayIconTemplate.png");

	try {
		tray = new Tray(iconPath);
		tray.setToolTip("Setra");

		const contextMenu = Menu.buildFromTemplate([
			{
				label: "Open Setra",
				click: () => {
					mainWindow?.show();
					mainWindow?.focus();
				},
			},
			{ type: "separator" },
			{
				label: "Quit Setra",
				accelerator: "CmdOrCtrl+Q",
				click: () => app.quit(),
			},
		]);

		tray.setContextMenu(contextMenu);
		tray.on("click", () => {
			mainWindow?.show();
			mainWindow?.focus();
		});
	} catch {
		// Tray icon file not found in dev — not fatal
		log.warn(
			"[tray] Could not create tray icon (expected in dev without resources)",
		);
	}
}

// Application menu
function buildAppMenu(): void {
	const template: Parameters<typeof Menu.buildFromTemplate>[0] = [
		{
			label: "Setra",
			submenu: [
				{ role: "about" },
				{ type: "separator" },
				{ role: "services" },
				{ type: "separator" },
				{ role: "hide" },
				{ role: "hideOthers" },
				{ role: "unhide" },
				{ type: "separator" },
				{ role: "quit" },
			],
		},
		{
			label: "Edit",
			submenu: [
				{ role: "undo" },
				{ role: "redo" },
				{ type: "separator" },
				{ role: "cut" },
				{ role: "copy" },
				{ role: "paste" },
				{ role: "selectAll" },
			],
		},
		{
			label: "View",
			submenu: [
				{ role: "reload" },
				{ role: "forceReload" },
				{ type: "separator" },
				{ role: "toggleDevTools" },
				{ type: "separator" },
				{ role: "togglefullscreen" },
			],
		},
		{
			label: "Window",
			submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "close" }],
		},
	];

	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Deep link handling (setra://)
function handleDeepLink(url: string): void {
	log.info("[main] Deep link received:", url);

	if (!mainWindow) {
		createMainWindow();
	}

	mainWindow?.show();
	mainWindow?.focus();

	// Strip the protocol and send the path to the renderer for client-side routing
	// e.g. setra://plots/abc-123 → /plots/abc-123
	const path = `/${url.split("://")[1] ?? ""}`;
	mainWindow?.webContents.send("deep-link-navigate", path);
}

// IPC: global handlers (per-domain handlers registered in ipc/*.ts)
function registerGlobalIpcHandlers(): void {
	// Theme sync
	ipcMain.handle("app:get-theme", () =>
		nativeTheme.shouldUseDarkColors ? "dark" : "light",
	);

	ipcMain.on("app:set-theme", (_event, theme: "dark" | "light" | "system") => {
		nativeTheme.themeSource = theme;
	});

	// Shell open
	ipcMain.handle("app:open-external", async (_event, url: string) => {
		// Only allow https:// and setra:// links
		if (url.startsWith("https://") || url.startsWith("setra://")) {
			await shell.openExternal(url);
		}
	});

	// App version
	ipcMain.handle("app:version", () => app.getVersion());

	// Folder picker — returns absolute path or null if cancelled
	ipcMain.handle("app:pick-folder", async () => {
		const win = BrowserWindow.getFocusedWindow() ?? undefined;
		const result = await dialog.showOpenDialog({
			...(win ? { parentWindow: win } : {}),
			properties: ["openDirectory"],
			title: "Select workspace folder",
		} as Electron.OpenDialogOptions);
		if (result.canceled || result.filePaths.length === 0) return null;
		return result.filePaths[0];
	});

	// Company run registration — called by launcher via notifyRenderer
	ipcMain.on(
		"company:run-started",
		(
			_event,
			{ runId, port, token }: { runId: string; port: number; token: string },
		) => {
			registerCompanyRun(runId, port, token ?? "");
		},
	);
}

function configureAutoUpdates(): void {
	if (!app.isPackaged) return;

	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.on("update-available", (info) => {
		mainWindow?.webContents.send("update-available", info.version);
	});
	autoUpdater.on("update-downloaded", () => {
		mainWindow?.webContents.send("update-downloaded");
	});

	setTimeout(() => {
		autoUpdater.checkForUpdates().catch(() => {});
	}, 3000);
}

// Lifecycle
void app.whenReady().then(async () => {
	await applyShellEnvToProcess();

	await initDatabase();
	loadSettingsIntoEnv(); // Load API keys from SQLite into process.env before any agents start

	// Start the embedded API server (production only — dev uses external server)
	await startEmbeddedServer();

	registerGlobalIpcHandlers();
	registerPlotsHandlers();
	registerRunsHandlers();
	registerTerminalHandlers();
	registerGroundsHandlers();
	registerToolsHandlers();
	registerTracesHandlers();
	registerLedgerHandlers();
	registerMonitorHandlers();
	getMonitorService().start();
	registerCommandsHandlers();
	registerMcpHandlers();
	registerSkillsHandlers();
	registerInstancesHandlers();
	registerGovernanceHandlers();
	registerMemoryHandlers();
	registerModelsHandlers();
	registerSecurityToolHandlers();
	registerCompanyHandlers();
	registerPrHandlers();
	registerProfileHandlers();
	registerIntegrationsHandlers();
	registerWikiHandlers();
	registerKanbanHandlers();
	registerProjectsHandlers();
	registerSettingsHandlers();
	registerTeamHandlers();
	registerWebSearchHandlers();
	try {
		await getMemoryStore().init();
	} catch (err) {
		log.warn("[memory] Memory store init failed (non-fatal):", err);
	}

	// Start PTY dispatch poller — picks up pending runs for PTY-only agents
	// (claude, codex, amp, opencode, gemini) that the server dispatcher creates
	// but cannot execute server-side.
	startPtyDispatchPoller();

	buildAppMenu();
	mainWindow = createMainWindow();
	createTray();
	configureAutoUpdates();

	app.on("activate", () => {
		// macOS: re-open window when dock icon is clicked and no windows are open
		if (BrowserWindow.getAllWindows().length === 0) {
			mainWindow = createMainWindow();
		} else {
			mainWindow?.show();
		}
	});
});

// macOS: single-instance deep links arrive via open-url event
app.on("open-url", (_event, url) => handleDeepLink(url));

// Windows/Linux: second instance deep links arrive in argv
app.on("second-instance", (_event, argv) => {
	const deepLink = argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`));
	if (deepLink) handleDeepLink(deepLink);
	mainWindow?.show();
	mainWindow?.focus();
});

app.on("window-all-closed", () => {
	// On macOS, keep the process alive (standard macOS behaviour)
	if (process.platform !== "darwin") {
		app.quit();
	}
});

app.on("before-quit", () => {
	stopEmbeddedServer();
	stopPtyDispatchPoller();
	closeDb();
	tray?.destroy();
});
