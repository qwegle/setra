export interface MemoryEntry {
	id: string;
	sessionId?: string;
	plotId?: string;
	agentId?: string;
	content: string;
	embedding: Float32Array;
	metadata: Record<string, unknown>;
	createdAt: number;
	score?: number;
}

export interface SearchResult {
	entry: MemoryEntry;
	score: number;
}

export interface MemoryStoreOptions {
	dbPath: string;
	modelId?: string;
	maxEntries?: number;
}
