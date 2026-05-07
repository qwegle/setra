// SQLite-based vector store — no external vector DB required.
// Embeddings stored as BLOB (Float32Array serialised to Buffer).
// Cosine similarity computed in JS after loading all embeddings.
//
// TODO: sqlite-vec can be added later for sub-linear ANN search at large scale
// (https://github.com/asg017/sqlite-vec). For most agent workloads (<10k entries)
// in-process cosine similarity is fast enough (~5ms for 1k entries).

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { embed, embedBatch } from "./embedder.js";
import type { MemoryEntry, MemoryStoreOptions, SearchResult } from "./types.js";

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS memories (
    id         TEXT PRIMARY KEY,
    session_id TEXT,
    plot_id    TEXT,
    agent_id   TEXT,
    content    TEXT NOT NULL,
    embedding  BLOB NOT NULL,
    metadata   TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )
`;

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += (a[i] ?? 0) * (b[i] ?? 0);
		normA += (a[i] ?? 0) * (a[i] ?? 0);
		normB += (b[i] ?? 0) * (b[i] ?? 0);
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}

function bufferToFloat32Array(buf: Buffer): Float32Array {
	return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function float32ArrayToBuffer(arr: Float32Array): Buffer {
	return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

interface MemoryRow {
	id: string;
	session_id: string | null;
	plot_id: string | null;
	agent_id: string | null;
	content: string;
	embedding: Buffer;
	metadata: string;
	created_at: number;
}

export class MemoryStore {
	private db: InstanceType<typeof Database> | null = null;
	private readonly options: Required<MemoryStoreOptions>;

	constructor(options: MemoryStoreOptions) {
		this.options = {
			dbPath: options.dbPath,
			modelId: options.modelId ?? "Xenova/all-MiniLM-L6-v2",
			maxEntries: options.maxEntries ?? 10000,
		};
	}

	async init(): Promise<void> {
		mkdirSync(path.dirname(this.options.dbPath), { recursive: true });
		this.db = new Database(this.options.dbPath);
		this.db.pragma("journal_mode = WAL");
		this.db.pragma("foreign_keys = ON");
		this.db.pragma("synchronous = NORMAL");
		this.db.pragma("cache_size = -32768");
		this.db.exec(CREATE_TABLE_SQL);
	}

	private getDb(): InstanceType<typeof Database> {
		if (!this.db)
			throw new Error("MemoryStore not initialised — call init() first");
		return this.db;
	}

	async add(
		content: string,
		metadata: Record<string, unknown> = {},
		context: { sessionId?: string; plotId?: string; agentId?: string } = {},
	): Promise<string> {
		const id = crypto.randomUUID();
		const embedding = await embed(content);
		const db = this.getDb();

		db.prepare(
			`INSERT INTO memories (id, session_id, plot_id, agent_id, content, embedding, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		).run(
			id,
			context.sessionId ?? null,
			context.plotId ?? null,
			context.agentId ?? null,
			content,
			float32ArrayToBuffer(embedding),
			JSON.stringify(metadata),
			Date.now(),
		);

		this.prune();
		return id;
	}

	async addBatch(
		entries: Array<{ content: string; metadata?: Record<string, unknown> }>,
		context: { sessionId?: string; plotId?: string; agentId?: string } = {},
	): Promise<string[]> {
		const contents = entries.map((e) => e.content);
		const embeddings = await embedBatch(contents);
		const db = this.getDb();
		const ids: string[] = [];

		const insert = db.prepare(
			`INSERT INTO memories (id, session_id, plot_id, agent_id, content, embedding, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		);

		const insertMany = db.transaction(() => {
			for (let i = 0; i < entries.length; i++) {
				const id = crypto.randomUUID();
				const entry = entries[i];
				const embedding = embeddings[i];
				if (!entry || !embedding) continue;
				insert.run(
					id,
					context.sessionId ?? null,
					context.plotId ?? null,
					context.agentId ?? null,
					entry.content,
					float32ArrayToBuffer(embedding),
					JSON.stringify(entry.metadata ?? {}),
					Date.now(),
				);
				ids.push(id);
			}
		});

		insertMany();
		this.prune();
		return ids;
	}

	async search(
		query: string,
		opts: {
			limit?: number;
			minScore?: number;
			plotId?: string;
			sessionId?: string;
		} = {},
	): Promise<SearchResult[]> {
		const limit = opts.limit ?? 10;
		const minScore = opts.minScore ?? 0.3;
		const queryEmbedding = await embed(query);
		const db = this.getDb();

		// Build query with optional filters
		let sql = "SELECT * FROM memories";
		const params: unknown[] = [];
		const conditions: string[] = [];

		if (opts.plotId) {
			conditions.push("plot_id = ?");
			params.push(opts.plotId);
		}
		if (opts.sessionId) {
			conditions.push("session_id = ?");
			params.push(opts.sessionId);
		}
		if (conditions.length > 0) {
			sql += " WHERE " + conditions.join(" AND ");
		}

		const rows = db.prepare(sql).all(...params) as MemoryRow[];

		const scored: SearchResult[] = [];
		for (const row of rows) {
			const embedding = bufferToFloat32Array(row.embedding);
			const score = cosineSimilarity(queryEmbedding, embedding);
			if (score >= minScore) {
				scored.push({
					entry: rowToEntry(row, score),
					score,
				});
			}
		}

		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, limit);
	}

	async delete(id: string): Promise<void> {
		this.getDb().prepare("DELETE FROM memories WHERE id = ?").run(id);
	}

	async clear(plotId?: string): Promise<void> {
		if (plotId) {
			this.getDb()
				.prepare("DELETE FROM memories WHERE plot_id = ?")
				.run(plotId);
		} else {
			this.getDb().prepare("DELETE FROM memories").run();
		}
	}

	count(): number {
		const row = this.getDb()
			.prepare("SELECT COUNT(*) as n FROM memories")
			.get() as { n: number };
		return row.n;
	}

	private prune(): void {
		const db = this.getDb();
		const current = (
			db.prepare("SELECT COUNT(*) as n FROM memories").get() as { n: number }
		).n;
		if (current > this.options.maxEntries) {
			const excess = current - this.options.maxEntries;
			db.prepare(
				`DELETE FROM memories WHERE id IN (
           SELECT id FROM memories ORDER BY created_at ASC LIMIT ?
         )`,
			).run(excess);
		}
	}
}

function rowToEntry(row: MemoryRow, score?: number): MemoryEntry {
	const entry: MemoryEntry = {
		id: row.id,
		content: row.content,
		embedding: bufferToFloat32Array(row.embedding),
		metadata: JSON.parse(row.metadata) as Record<string, unknown>,
		createdAt: row.created_at,
	};
	if (row.session_id !== null) entry.sessionId = row.session_id;
	if (row.plot_id !== null) entry.plotId = row.plot_id;
	if (row.agent_id !== null) entry.agentId = row.agent_id;
	if (score !== undefined) entry.score = score;
	return entry;
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton factory — follows the same pattern as @setra/db's getDb()
// ─────────────────────────────────────────────────────────────────────────────

let _store: MemoryStore | null = null;

export function getMemoryStore(dbPath?: string): MemoryStore {
	if (_store) return _store;
	const resolvedPath = dbPath ?? path.join(homedir(), ".setra", "memory.db");
	_store = new MemoryStore({ dbPath: resolvedPath });
	return _store;
}
