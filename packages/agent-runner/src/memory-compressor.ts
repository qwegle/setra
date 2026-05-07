export interface ConversationMessage {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: string;
	tokenCount?: number;
}

export interface CompressedMemory {
	summary: string;
	keyDecisions: string[];
	pendingTasks: string[];
	filesModified: string[];
	originalMessageCount: number;
	compressedAt: string;
}

export interface MemoryCompressorOptions {
	maxTokens: number;
	keepRecentMessages: number;
	summarizePrompt?: string;
}

const DEFAULT_SUMMARIZE_PROMPT = `Summarize the conversation so far into a concise working memory. Include:
1. What the user asked for (the goal)
2. Key decisions made
3. What has been done so far
4. What still needs to be done
5. Any important constraints or preferences mentioned

Be concise but preserve all actionable information. Format as structured sections.`;

export class MemoryCompressor {
	private messages: ConversationMessage[] = [];
	private compressedMemories: CompressedMemory[] = [];
	private options: MemoryCompressorOptions;

	constructor(options: Partial<MemoryCompressorOptions> = {}) {
		this.options = {
			maxTokens: options.maxTokens ?? 80000,
			keepRecentMessages: options.keepRecentMessages ?? 10,
			summarizePrompt: options.summarizePrompt ?? DEFAULT_SUMMARIZE_PROMPT,
		};
	}

	addMessage(message: ConversationMessage): void {
		this.messages.push(message);
	}

	getTotalTokens(): number {
		return this.messages.reduce(
			(sum, message) =>
				sum + (message.tokenCount ?? Math.ceil(message.content.length / 4)),
			0,
		);
	}

	needsCompression(): boolean {
		return this.getTotalTokens() > this.options.maxTokens;
	}

	async compress(
		summarizer: (
			messages: ConversationMessage[],
			prompt: string,
		) => Promise<string>,
	): Promise<CompressedMemory> {
		const keepCount = Math.min(
			this.options.keepRecentMessages,
			this.messages.length,
		);
		const splitIndex = Math.max(0, this.messages.length - keepCount);
		const toCompress = this.messages.slice(0, splitIndex);
		const toKeep = this.messages.slice(splitIndex);

		const summary = await summarizer(
			toCompress,
			this.options.summarizePrompt ?? DEFAULT_SUMMARIZE_PROMPT,
		);

		const compressed: CompressedMemory = {
			summary,
			keyDecisions: extractDecisions(toCompress),
			pendingTasks: extractPendingTasks(toCompress),
			filesModified: extractFiles(toCompress),
			originalMessageCount: toCompress.length,
			compressedAt: new Date().toISOString(),
		};

		this.compressedMemories.push(compressed);
		this.messages = toKeep;

		return compressed;
	}

	getContextForAgent(): {
		systemPrefix: string;
		messages: ConversationMessage[];
	} {
		let systemPrefix = "";

		const latest = this.compressedMemories.at(-1);
		if (latest) {
			systemPrefix = `[WORKING MEMORY - Compressed from ${latest.originalMessageCount} messages]\n${latest.summary}\n\n`;

			if (latest.keyDecisions.length > 0) {
				systemPrefix += `Key decisions: ${latest.keyDecisions.join("; ")}\n`;
			}
			if (latest.pendingTasks.length > 0) {
				systemPrefix += `Remaining tasks: ${latest.pendingTasks.join("; ")}\n`;
			}
			if (latest.filesModified.length > 0) {
				systemPrefix += `Files touched: ${latest.filesModified.join(", ")}\n`;
			}
		}

		return { systemPrefix, messages: this.messages };
	}
}

function extractDecisions(messages: ConversationMessage[]): string[] {
	const decisions: string[] = [];
	for (const message of messages) {
		if (
			message.role === "assistant" &&
			(message.content.includes("decided") ||
				message.content.includes("I'll") ||
				message.content.includes("approach"))
		) {
			const lines = message.content
				.split("\n")
				.filter(
					(line) =>
						line.includes("✅") ||
						line.includes("→") ||
						line.toLowerCase().includes("decision"),
				);
			decisions.push(...lines.slice(0, 3));
		}
	}
	return decisions.slice(0, 10);
}

function extractPendingTasks(messages: ConversationMessage[]): string[] {
	const tasks: string[] = [];
	const lastAssistant = [...messages]
		.reverse()
		.find((message) => message.role === "assistant");
	if (lastAssistant) {
		const lines = lastAssistant.content
			.split("\n")
			.filter((line) => /^\s*[-*]\s/.test(line) || /^\d+\./.test(line));
		tasks.push(
			...lines
				.slice(0, 5)
				.map((line) =>
					line.replace(/^\s*[-*]\s*/, "").replace(/^\d+\.\s*/, ""),
				),
		);
	}
	return tasks;
}

function extractFiles(messages: ConversationMessage[]): string[] {
	const files = new Set<string>();
	for (const message of messages) {
		const matches = message.content.matchAll(
			/(?:created?|modified?|edited?|updated?)\s+[`"]?([a-zA-Z0-9_\-/.]+\.[a-z]+)[`"]?/gi,
		);
		for (const match of matches) {
			if (match[1]) {
				files.add(match[1]);
			}
		}
	}
	return Array.from(files).slice(0, 20);
}
