import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { McpServerConfig } from "./types.js";

const SETRA_DIR = join(homedir(), ".setra");

function sanitizeCompanyId(companyId: string): string {
	return companyId.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function getConfigPaths(companyId?: string | null): {
	configPath: string;
	tmpPath: string;
} {
	const suffix = companyId?.trim()
		? `mcp-${sanitizeCompanyId(companyId.trim())}.json`
		: "mcp.json";
	return {
		configPath: join(SETRA_DIR, suffix),
		tmpPath: join(SETRA_DIR, `${suffix}.tmp`),
	};
}

function ensureDir(): void {
	mkdirSync(SETRA_DIR, { recursive: true });
}

export function readMcpConfig(companyId?: string | null): McpServerConfig[] {
	try {
		const { configPath } = getConfigPaths(companyId);
		if (!existsSync(configPath)) return [];
		const raw = readFileSync(configPath, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed as McpServerConfig[];
	} catch {
		return [];
	}
}

export function writeMcpConfig(
	servers: McpServerConfig[],
	companyId?: string | null,
): void {
	ensureDir();
	const { configPath, tmpPath } = getConfigPaths(companyId);
	writeFileSync(tmpPath, JSON.stringify(servers, null, 2), "utf8");
	renameSync(tmpPath, configPath);
}

export function addServer(
	config: McpServerConfig,
	companyId?: string | null,
): void {
	const servers = readMcpConfig(companyId);
	servers.push(config);
	writeMcpConfig(servers, companyId);
}

export function removeServer(id: string, companyId?: string | null): void {
	const servers = readMcpConfig(companyId);
	writeMcpConfig(
		servers.filter((s) => s.id !== id),
		companyId,
	);
}

export function updateServer(
	id: string,
	partial: Partial<McpServerConfig>,
	companyId?: string | null,
): void {
	const servers = readMcpConfig(companyId);
	writeMcpConfig(
		servers.map((s) => (s.id === id ? { ...s, ...partial } : s)),
		companyId,
	);
}

// ─────────────────────────────────────────────────────────────────────────────
// Claude Desktop auto-discovery
// ─────────────────────────────────────────────────────────────────────────────

interface ClaudeServerEntry {
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
}

interface ClaudeDesktopConfig {
	mcpServers?: Record<string, ClaudeServerEntry>;
}

function getClaudeConfigPath(): string {
	if (platform() === "darwin") {
		return join(
			homedir(),
			"Library",
			"Application Support",
			"Claude",
			"claude_desktop_config.json",
		);
	}
	return join(homedir(), ".config", "claude", "claude_desktop_config.json");
}

export function discoverClaudeServers(): McpServerConfig[] {
	try {
		const path = getClaudeConfigPath();
		if (!existsSync(path)) return [];
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as ClaudeDesktopConfig;
		if (!parsed.mcpServers) return [];

		return Object.entries(parsed.mcpServers).map(([name, entry]) => {
			const config: McpServerConfig = {
				id: crypto.randomUUID(),
				name,
				transport: entry.url ? "sse" : "stdio",
				autoStart: false,
			};

			if (entry.command !== undefined) config.command = entry.command;
			if (entry.args !== undefined) config.args = entry.args;
			if (entry.env !== undefined) config.env = entry.env;
			if (entry.url !== undefined) config.url = entry.url;

			return config;
		});
	} catch {
		return [];
	}
}
