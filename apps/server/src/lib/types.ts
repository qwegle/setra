export interface RunRow {
	id: string;
	agent: string;
	agent_version: string | null;
	agent_args: string | null;
	plot_id: string;
}

export interface AgentRow {
	id: string;
	slug: string;
	display_name: string;
	adapter_type: string | null;
	model_id: string | null;
	system_prompt: string | null;
	skills: string | null;
	company_id: string | null;
}

export interface IssueRow {
	id: string;
	projectId: string;
	companyId: string | null;
	slug: string;
	title: string;
	description: string | null;
	workspacePath: string | null;
}

export interface RuntimeKeys {
	anthropicKey?: string;
	openAiKey?: string;
	geminiKey?: string;
	openRouterKey?: string;
	groqKey?: string;
}

export interface LlmUsage {
	promptTokens: number;
	completionTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens?: number;
}

export interface LlmCallResult {
	content: string;
	usage: LlmUsage;
	costUsd: number;
}

export interface ToolSkill {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	prompt: string | null;
}

export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	kind: "builtin" | "mcp" | "skill";
	serverId?: string;
	actualName?: string;
	skill?: ToolSkill;
}

export interface ToolContext {
	tools: ToolDefinition[];
	byName: Map<string, ToolDefinition>;
}

export interface ToolExecutionResult {
	content: string;
	usage: LlmUsage;
	costUsd: number;
	stopLoop?: boolean;
}

export interface ToolSubIssueInput {
	title?: string;
	description?: string;
	priority?: string;
	estimatedComplexity?: string;
}

export interface SpawnRunInput {
	runId: string;
	agentSlug: string;
	issueId?: string | null;
	task?: string | null;
	companyId: string | null;
	/** Collaboration channel that triggered this run (e.g. "general", "proj-todo-app") */
	sourceChannel?: string | null;
}

export interface TextCallInput {
	adapterId: string;
	model: string;
	systemPrompt: string;
	task: string;
	runtimeKeys: RuntimeKeys;
	maxTokens?: number | undefined;
}

export interface ToolExecutionInput {
	tool: ToolDefinition;
	args: Record<string, unknown>;
	agent: AgentRow;
	issue: IssueRow | null;
	companyId: string | null;
	runId: string;
	worktreePath?: string | undefined;
	adapterId: string;
	model: string;
	systemPrompt: string;
	runtimeKeys: RuntimeKeys;
}

export interface ToolDefinitionInput {
	agent: AgentRow;
	issue: IssueRow | null;
	companyId: string | null;
}

export interface AdapterLoopInput {
	model: string;
	systemPrompt: string;
	task: string;
	agent: AgentRow;
	issue: IssueRow | null;
	maxTokens?: number | undefined;
	runId: string;
	worktreePath?: string | undefined;
	runtimeKeys: RuntimeKeys;
	adapterId: string;
	companyId: string | null;
}
