export type McpTransport = "stdio" | "sse" | "http";
export type McpServerStatus = "stopped" | "starting" | "connected" | "error";

export interface McpServerConfig {
	id: string;
	name: string;
	transport: McpTransport;
	// stdio
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	// sse/http
	url?: string;
	// common
	autoStart: boolean;
	description?: string;
}

export interface McpTool {
	serverId: string;
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export interface McpServerState {
	config: McpServerConfig;
	status: McpServerStatus;
	tools: McpTool[];
	pid?: number;
	error?: string;
	lastConnectedAt?: number;
}
