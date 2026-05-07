export interface TeamTemplate {
	id: string;
	name: string;
	description: string;
	agents: Array<{ name: string; role: string; adapter: string }>;
	icon: string; // lucide icon name
}

export const TEAM_TEMPLATES: TeamTemplate[] = [
	{
		id: "engineering",
		name: "Engineering Squad",
		description: "Full-stack engineering team",
		agents: [
			{ name: "CEO", role: "Chief Executive", adapter: "auto" },
			{ name: "Engineer", role: "Software Engineer", adapter: "auto" },
			{ name: "QA", role: "Quality Assurance", adapter: "auto" },
			{ name: "DevOps", role: "DevOps Engineer", adapter: "auto" },
		],
		icon: "Code2",
	},
	{
		id: "marketing",
		name: "Marketing Crew",
		description: "Content and growth team",
		agents: [
			{ name: "CEO", role: "Chief Executive", adapter: "auto" },
			{ name: "Copywriter", role: "Content Writer", adapter: "auto" },
			{ name: "Researcher", role: "Market Researcher", adapter: "auto" },
		],
		icon: "Megaphone",
	},
	{
		id: "product",
		name: "Product Team",
		description: "Product and design team",
		agents: [
			{ name: "CEO", role: "Chief Executive", adapter: "auto" },
			{ name: "PM", role: "Product Manager", adapter: "auto" },
			{ name: "Engineer", role: "Software Engineer", adapter: "auto" },
		],
		icon: "Layers",
	},
	{
		id: "devops",
		name: "DevOps Cell",
		description: "Infrastructure and operations",
		agents: [
			{ name: "CEO", role: "Chief Executive", adapter: "auto" },
			{ name: "Platform", role: "Platform Engineer", adapter: "auto" },
			{ name: "Monitor", role: "Site Reliability", adapter: "auto" },
		],
		icon: "Server",
	},
];

export const AVAILABLE_SKILLS = [
	{
		id: "code-review",
		name: "Code Review",
		description: "Review pull requests and code quality",
	},
	{
		id: "pr-writing",
		name: "PR Writing",
		description: "Write clear pull request descriptions",
	},
	{
		id: "research",
		name: "Research",
		description: "Web research and information gathering",
	},
	{
		id: "bug-triage",
		name: "Bug Triage",
		description: "Analyze and prioritize bugs",
	},
	{
		id: "ui-testing",
		name: "UI Testing",
		description: "Test user interfaces and report issues",
	},
	{
		id: "copywriting",
		name: "Copywriting",
		description: "Write marketing and product copy",
	},
	{
		id: "data-analysis",
		name: "Data Analysis",
		description: "Analyze data and generate insights",
	},
	{
		id: "documentation",
		name: "Documentation",
		description: "Write technical documentation",
	},
	{
		id: "devops-scripts",
		name: "DevOps Scripts",
		description: "Write deployment and automation scripts",
	},
];

export const ADAPTERS = [
	{
		id: "auto",
		name: "Auto-detect",
		description: "Use first configured provider — recommended",
		recommended: true,
		requiresKey: false,
		offline: false,
	},
	{
		id: "claude_local",
		name: "Claude",
		description: "Anthropic Claude (local CLI)",
		recommended: false,
		requiresKey: true,
		offline: false,
	},
	{
		id: "codex_local",
		name: "Codex",
		description: "OpenAI Codex CLI",
		recommended: false,
		requiresKey: true,
		offline: false,
	},
	{
		id: "gemini_local",
		name: "Gemini",
		description: "Google Gemini CLI",
		recommended: false,
		requiresKey: true,
		offline: false,
	},
	{
		id: "opencode_local",
		name: "OpenCode",
		description: "OpenCode local agent",
		recommended: false,
		requiresKey: false,
		offline: false,
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		description: "Access 200+ models via OpenRouter",
		recommended: false,
		requiresKey: true,
		offline: false,
	},
	{
		id: "groq",
		name: "Groq",
		description: "Ultra-fast inference via Groq",
		recommended: false,
		requiresKey: true,
		offline: false,
	},
	{
		id: "ollama",
		name: "Ollama",
		description: "Local models via Ollama",
		recommended: false,
		requiresKey: false,
		offline: true,
	},
	{
		id: "lmstudio",
		name: "LM Studio",
		description: "Local models via LM Studio",
		recommended: false,
		requiresKey: false,
		offline: true,
	},
	{
		id: "cursor",
		name: "Cursor",
		description: "Cursor IDE agent",
		recommended: false,
		requiresKey: false,
		offline: false,
	},
	{
		id: "http",
		name: "Custom HTTP",
		description: "Any OpenAI-compatible endpoint",
		recommended: false,
		requiresKey: true,
		offline: false,
	},
];

export const ADAPTER_MODELS: Record<string, string[]> = {
	auto: ["auto"],
	claude_local: ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
	codex_local: ["gpt-5.5", "gpt-5.4", "o4-mini", "o3", "gpt-4.1", "gpt-4o"],
	gemini_local: ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-pro"],
	opencode_local: ["gpt-5.5", "gpt-5.4", "gpt-4o", "gpt-4o-mini", "gpt-4.1"],
	openrouter: [
		"openrouter/auto",
		"google/gemini-2.5-flash-preview-05-20:free",
		"qwen/qwen3-235b-a22b:free",
	],
	groq: [
		"llama-3.3-70b-versatile",
		"qwen-qwq-32b",
		"deepseek-r1-distill-llama-70b",
	],
	ollama: [
		"kimi-k2.6",
		"qwen3.5",
		"minimax-m2.7",
		"glm-5.1",
		"qwen2.5-coder:7b",
		"llama3.2:3b",
		"deepseek-r1:7b",
	],
	lmstudio: ["local-model"],
	cursor: ["cursor-default"],
	http: ["gpt-5.5", "gpt-5.4", "gpt-4o", "gpt-4o-mini", "gpt-4.1", "custom"],
	"openai-api": [
		"gpt-5.5",
		"gpt-5.4",
		"gpt-4o-mini",
		"gpt-4o",
		"gpt-4.1",
		"o4-mini",
		"o3",
	],
	"anthropic-api": ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
	"gemini-api": ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-pro"],
};
