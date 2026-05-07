import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

const uuidSchema = z.string().uuid();
const isoDateSchema = z.string().datetime({ offset: true });

// ─────────────────────────────────────────────────────────────────────────────
// GROUND — SSH remote machine
// ─────────────────────────────────────────────────────────────────────────────

export const GroundAuthTypeSchema = z.enum(["key", "password", "agent"]);
export type GroundAuthType = z.infer<typeof GroundAuthTypeSchema>;

export const GroundStatusSchema = z.enum([
	"unknown",
	"connected",
	"disconnected",
	"error",
]);
export type GroundStatus = z.infer<typeof GroundStatusSchema>;

export const GroundSchema = z.object({
	id: uuidSchema,
	name: z.string().min(1).max(100),
	host: z.string().min(1),
	port: z.number().int().min(1).max(65535).default(22),
	username: z.string().min(1),
	authType: GroundAuthTypeSchema,
	keyPath: z.string().nullable().optional(),
	tmuxPrefix: z.string().default("setra"),
	status: GroundStatusSchema.default("unknown"),
	lastPingAt: isoDateSchema.nullable().optional(),
	notes: z.string().nullable().optional(),
	createdAt: isoDateSchema,
	updatedAt: isoDateSchema,
});

export const CreateGroundSchema = GroundSchema.omit({
	id: true,
	status: true,
	lastPingAt: true,
	createdAt: true,
	updatedAt: true,
});

export const UpdateGroundSchema = CreateGroundSchema.partial();

export type Ground = z.infer<typeof GroundSchema>;
export type CreateGround = z.infer<typeof CreateGroundSchema>;
export type UpdateGround = z.infer<typeof UpdateGroundSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// PROJECT — a git repository
// ─────────────────────────────────────────────────────────────────────────────

export const ProjectSchema = z.object({
	id: uuidSchema,
	name: z.string().min(1).max(200),
	repoPath: z.string().min(1),
	remoteUrl: z.string().url().nullable().optional(),
	defaultBranch: z.string().default("main"),
	totalCostUsd: z.number().nonnegative().default(0),
	totalRuns: z.number().int().nonnegative().default(0),
	lastActiveAt: isoDateSchema.nullable().optional(),
	createdAt: isoDateSchema,
	updatedAt: isoDateSchema,
});

export const CreateProjectSchema = ProjectSchema.omit({
	id: true,
	totalCostUsd: true,
	totalRuns: true,
	lastActiveAt: true,
	createdAt: true,
	updatedAt: true,
});

export const UpdateProjectSchema = CreateProjectSchema.partial();

export type SetraProject = z.infer<typeof ProjectSchema>;
export type CreateProject = z.infer<typeof CreateProjectSchema>;
export type UpdateProject = z.infer<typeof UpdateProjectSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// PLOT — isolated git worktree (one per task)
// ─────────────────────────────────────────────────────────────────────────────

export const PlotStatusSchema = z.enum([
	"idle",
	"running",
	"paused",
	"archived",
	"error",
]);
export type PlotStatus = z.infer<typeof PlotStatusSchema>;

export const AgentTemplateConfigSchema = z.object({
	name: z.string(),
	systemPrompt: z.string().optional(),
	model: z.string().optional(),
	tools: z.array(z.string()).optional(),
	contextInject: z
		.object({
			packageJson: z.boolean().default(true),
			readme: z.boolean().default(true),
			gitLog: z.number().int().min(0).max(50).default(20),
		})
		.optional(),
});
export type AgentTemplateConfig = z.infer<typeof AgentTemplateConfigSchema>;

export const PlotSchema = z.object({
	id: uuidSchema,
	name: z.string().min(1).max(200),
	projectId: uuidSchema,
	worktreePath: z.string().nullable().optional(),
	branch: z.string().min(1),
	baseBranch: z.string().default("main"),
	groundId: uuidSchema.nullable().optional(),
	status: PlotStatusSchema.default("idle"),
	agentTemplate: AgentTemplateConfigSchema.nullable().optional(),
	description: z.string().nullable().optional(),
	autoCheckpoint: z.boolean().default(true),
	checkpointIntervalS: z.number().int().min(60).max(86400).default(300),
	totalCostUsd: z.number().nonnegative().default(0),
	lastActiveAt: isoDateSchema.nullable().optional(),
	claimedBySessionId: z.string().nullable().optional(),
	createdAt: isoDateSchema,
	updatedAt: isoDateSchema,
});

export const CreatePlotSchema = PlotSchema.omit({
	id: true,
	worktreePath: true,
	status: true,
	totalCostUsd: true,
	lastActiveAt: true,
	claimedBySessionId: true,
	createdAt: true,
	updatedAt: true,
}).extend({
	// branch is auto-generated from plot id if omitted
	branch: z.string().optional(),
});

export const UpdatePlotSchema = z.object({
	name: z.string().min(1).max(200).optional(),
	description: z.string().nullable().optional(),
	status: PlotStatusSchema.optional(),
	agentTemplate: AgentTemplateConfigSchema.nullable().optional(),
	autoCheckpoint: z.boolean().optional(),
	checkpointIntervalS: z.number().int().min(60).max(86400).optional(),
	groundId: uuidSchema.nullable().optional(),
});

export type Plot = z.infer<typeof PlotSchema>;
export type CreatePlot = z.infer<typeof CreatePlotSchema>;
export type UpdatePlot = z.infer<typeof UpdatePlotSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// RUN — a single agent invocation
// ─────────────────────────────────────────────────────────────────────────────

export const RunStatusSchema = z.enum([
	"pending",
	"running",
	"completed",
	"failed",
	"cancelled",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const AgentNameSchema = z.enum([
	"claude",
	"codex",
	"gemini",
	"ollama",
	"custom",
	"amp",
	"opencode",
	"anthropic-api",
	"openai-api",
	"aws-bedrock",
	"azure-openai",
	"gcp-vertex",
	"custom-openai",
	"setra-native",
	"ssh-ground",
]);
export type AgentName = z.infer<typeof AgentNameSchema>;

export const RunSchema = z.object({
	id: uuidSchema,
	plotId: uuidSchema,
	agent: AgentNameSchema,
	agentVersion: z.string().nullable().optional(),
	agentBinary: z.string().nullable().optional(),
	agentArgs: z.array(z.string()).nullable().optional(),
	status: RunStatusSchema.default("pending"),
	ptyPid: z.number().int().nullable().optional(),
	tmuxSession: z.string().nullable().optional(),
	groundId: uuidSchema.nullable().optional(),
	promptTokens: z.number().int().nonnegative().default(0),
	completionTokens: z.number().int().nonnegative().default(0),
	cacheReadTokens: z.number().int().nonnegative().default(0),
	cacheWriteTokens: z.number().int().nonnegative().default(0),
	costUsd: z.number().nonnegative().default(0),
	costConfidence: z.enum(["high", "low", "none"]).default("none"),
	outcome: z.enum(["success", "partial", "failed"]).nullable().optional(),
	errorMessage: z.string().nullable().optional(),
	exitCode: z.number().int().nullable().optional(),
	startedAt: isoDateSchema,
	endedAt: isoDateSchema.nullable().optional(),
	updatedAt: isoDateSchema,
});

export const CreateRunSchema = z.object({
	plotId: uuidSchema,
	agent: AgentNameSchema,
	agentVersion: z.string().optional(),
	agentBinary: z.string().optional(),
	agentArgs: z.array(z.string()).optional(),
	groundId: uuidSchema.optional(),
});

export type Run = z.infer<typeof RunSchema>;
export type CreateRun = z.infer<typeof CreateRunSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// CHUNK — terminal output chunk
// ─────────────────────────────────────────────────────────────────────────────

export const ChunkTypeSchema = z.enum([
	"output",
	"input",
	"system",
	"cost_update",
]);
export type ChunkType = z.infer<typeof ChunkTypeSchema>;

export const ChunkSchema = z.object({
	id: z.number().int(),
	runId: uuidSchema,
	sequence: z.number().int().nonnegative(),
	content: z.string(),
	chunkType: ChunkTypeSchema.default("output"),
	recordedAt: isoDateSchema,
});

export type Chunk = z.infer<typeof ChunkSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// MARK — git checkpoint
// ─────────────────────────────────────────────────────────────────────────────

export const MarkTypeSchema = z.enum([
	"auto",
	"manual",
	"pre_path",
	"post_path",
	"session_end",
]);
export type MarkType = z.infer<typeof MarkTypeSchema>;

export const MarkSchema = z.object({
	id: uuidSchema,
	runId: uuidSchema.nullable().optional(),
	plotId: uuidSchema,
	commitHash: z.string().min(7).max(64),
	branch: z.string(),
	message: z.string().nullable().optional(),
	markType: MarkTypeSchema.default("auto"),
	filesChanged: z.number().int().nonnegative().default(0),
	insertions: z.number().int().nonnegative().default(0),
	deletions: z.number().int().nonnegative().default(0),
	createdAt: isoDateSchema,
});

export const CreateMarkSchema = MarkSchema.omit({
	id: true,
	createdAt: true,
});

export type Mark = z.infer<typeof MarkSchema>;
export type CreateMark = z.infer<typeof CreateMarkSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// TRACE — vector memory entry
// ─────────────────────────────────────────────────────────────────────────────

export const TraceSourceTypeSchema = z.enum([
	"run_output",
	"file_diff",
	"user_note",
	"mark_diff",
	"synthetic",
	"handoff",
]);
export type TraceSourceType = z.infer<typeof TraceSourceTypeSchema>;

export const TraceSchema = z.object({
	id: uuidSchema,
	runId: uuidSchema.nullable().optional(),
	projectId: uuidSchema,
	content: z.string().min(1),
	contentHash: z.string().length(64),
	sourceType: TraceSourceTypeSchema.default("run_output"),
	vectorId: z.string().nullable().optional(),
	isSynthetic: z.boolean().default(false),
	createdAt: isoDateSchema,
});

export const CreateTraceSchema = TraceSchema.omit({
	id: true,
	vectorId: true,
	createdAt: true,
});

export type Trace = z.infer<typeof TraceSchema>;
export type CreateTrace = z.infer<typeof CreateTraceSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// TEAM / COMPANY — multi-agent coordination
// ─────────────────────────────────────────────────────────────────────────────

export const TeamMemberRoleSchema = z.enum([
	"orchestrator",
	"engineer",
	"reviewer",
	"qa",
	"custom",
]);
export type TeamMemberRole = z.infer<typeof TeamMemberRoleSchema>;

export const TeamMemberSchema = z.object({
	id: uuidSchema,
	name: z.string().min(1),
	role: TeamMemberRoleSchema,
	agent: AgentNameSchema,
	model: z.string().optional(),
	systemPrompt: z.string().optional(),
	// Orchestrator uses expensive model (claude-opus), workers use fast model (claude-sonnet)
	maxTurns: z.number().int().min(1).max(100).default(15),
	isOrchestrator: z.boolean().default(false),
});

export type TeamMember = z.infer<typeof TeamMemberSchema>;

export const CompanySchema = z.object({
	id: uuidSchema,
	name: z.string().min(1).max(100),
	projectId: uuidSchema,
	members: z.array(TeamMemberSchema),
	createdAt: isoDateSchema,
	updatedAt: isoDateSchema,
});

export type Company = z.infer<typeof CompanySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// LEDGER — cost tracking and reporting
// ─────────────────────────────────────────────────────────────────────────────

export const LedgerEntrySchema = z.object({
	runId: uuidSchema,
	plotId: uuidSchema,
	plotName: z.string(),
	projectId: uuidSchema,
	projectName: z.string(),
	agent: AgentNameSchema,
	startedAt: isoDateSchema,
	endedAt: isoDateSchema.nullable().optional(),
	promptTokens: z.number().int().nonnegative(),
	completionTokens: z.number().int().nonnegative(),
	cacheReadTokens: z.number().int().nonnegative(),
	cacheWriteTokens: z.number().int().nonnegative(),
	costUsd: z.number().nonnegative(),
	costConfidence: z.enum(["high", "low", "none"]),
});

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const LedgerSummarySchema = z.object({
	totalCostUsd: z.number().nonnegative(),
	totalRuns: z.number().int().nonnegative(),
	totalPromptTokens: z.number().int().nonnegative(),
	totalCompletionTokens: z.number().int().nonnegative(),
	totalCacheReadTokens: z.number().int().nonnegative(),
	totalCacheWriteTokens: z.number().int().nonnegative(),
	// Percentage of tokens served from cache — proves caching is working
	cacheHitRate: z.number().min(0).max(1),
	byProject: z.array(
		z.object({
			projectId: uuidSchema,
			projectName: z.string(),
			costUsd: z.number().nonnegative(),
			runs: z.number().int().nonnegative(),
		}),
	),
	byAgent: z.array(
		z.object({
			agent: AgentNameSchema,
			costUsd: z.number().nonnegative(),
			runs: z.number().int().nonnegative(),
		}),
	),
});

export type LedgerSummary = z.infer<typeof LedgerSummarySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// IPC API schemas — input/output for contextBridge calls
// ─────────────────────────────────────────────────────────────────────────────

// Terminal
export const TerminalSpawnInputSchema = z.object({
	plotId: uuidSchema,
	runId: uuidSchema,
	cols: z.number().int().min(20).max(500).default(220),
	rows: z.number().int().min(5).max(200).default(50),
});

export const TerminalResizeInputSchema = z.object({
	runId: uuidSchema,
	cols: z.number().int().min(20).max(500),
	rows: z.number().int().min(5).max(200),
});

export const TerminalWriteInputSchema = z.object({
	runId: uuidSchema,
	data: z.string(),
});

export type TerminalSpawnInput = z.infer<typeof TerminalSpawnInputSchema>;
export type TerminalResizeInput = z.infer<typeof TerminalResizeInputSchema>;
export type TerminalWriteInput = z.infer<typeof TerminalWriteInputSchema>;

// Trace search
export const TraceSearchInputSchema = z.object({
	projectId: uuidSchema,
	query: z.string().min(1).max(500),
	topK: z.number().int().min(1).max(20).default(5),
	sourceType: TraceSourceTypeSchema.optional(),
});

export type TraceSearchInput = z.infer<typeof TraceSearchInputSchema>;

export const TraceSearchResultSchema = z.object({
	trace: TraceSchema,
	score: z.number().min(0).max(1),
});

export type TraceSearchResult = z.infer<typeof TraceSearchResultSchema>;

// ─── Module Manifest (Phase 1 local + Phase 2 marketplace) ───────────────────

export type SetraModulePermission =
	| "runs:read"
	| "runs:write"
	| "plots:read"
	| "plots:write"
	| "org:read"
	| "audit:read"
	| "billing:read"
	| "network:outbound"
	| "filesystem:workspace"
	| "mcp:tools:register"
	| "ui:sidebar"
	| "ui:commands"
	| "ui:notifications"
	| "shell:exec"
	| "ssh:read";

export type SetraModuleManifest = {
	name: string;
	version: string;
	displayName: string;
	description: string;
	publisher: string;
	/** URL-safe identifier used in filesystem paths and DB keys */
	slug: string;
	tier: "free" | "pro" | "team" | "enterprise" | "partner";
	requires: { setraCore: string; node?: string };
	permissions: SetraModulePermission[];
	dangerousPermissions?: SetraModulePermission[];
	main: string;
	uiMain?: string;
	mcpTools?: Array<{
		name: string;
		description: string;
		inputSchema: Record<string, unknown>;
	}>;
	configSchema?: Record<
		string,
		{
			type: "string" | "number" | "boolean" | "secret";
			description: string;
			required?: boolean;
			default?: unknown;
		}
	>;
	emitsEvents?: string[];
	categories?: string[];
	license: string;
	docs?: string;
	changelog?: string;
	support?: string;
	/** Ed25519 hex signature over artifactSha256 by publisher key */
	publisherSignature?: string;
	/** SHA-256 of the module artifact tarball */
	artifactSha256?: string;
};
