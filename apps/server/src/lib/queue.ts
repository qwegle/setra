import crypto from "node:crypto";
import { getRawDb } from "@setra/db";
import { withRetry } from "./retry.js";

export interface QueueJob {
	id: string;
	type: "agent-run" | "pipeline" | "wake" | "brief-regen";
	payload: Record<string, unknown>;
	priority: number;
	createdAt: number;
	attempts: number;
	maxAttempts: number;
	status: "waiting" | "active" | "completed" | "failed";
	result?: unknown;
	error?: string;
}

type QueueHandler = (job: QueueJob) => Promise<unknown>;

class JobQueue {
	private handlers = new Map<string, QueueHandler>();
	private activeCount = 0;
	private readonly maxConcurrency: number;
	private ticking = false;
	private initialised = false;

	constructor(opts: { maxConcurrency?: number } = {}) {
		this.maxConcurrency = Math.max(1, opts.maxConcurrency ?? 10);
	}

	private ensureStorage(): void {
		if (this.initialised) return;
		const db = getRawDb();
		db.exec(`
			CREATE TABLE IF NOT EXISTS jobs (
				id TEXT PRIMARY KEY,
				type TEXT NOT NULL,
				payload TEXT NOT NULL,
				priority INTEGER NOT NULL DEFAULT 3,
				created_at INTEGER NOT NULL,
				available_at INTEGER NOT NULL,
				attempts INTEGER NOT NULL DEFAULT 0,
				max_attempts INTEGER NOT NULL DEFAULT 3,
				status TEXT NOT NULL DEFAULT 'waiting',
				result TEXT,
				error TEXT,
				updated_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_jobs_status_priority
				ON jobs(status, priority, available_at, created_at);
			UPDATE jobs
			   SET status = 'waiting', updated_at = strftime('%s','now') * 1000
			 WHERE status = 'active';
		`);
		this.initialised = true;
	}

	private hydrate(row: {
		id: string;
		type: QueueJob["type"];
		payload: string;
		priority: number;
		created_at: number;
		attempts: number;
		max_attempts: number;
		status: QueueJob["status"];
		result: string | null;
		error: string | null;
	}): QueueJob {
		return {
			id: row.id,
			type: row.type,
			payload: JSON.parse(row.payload) as Record<string, unknown>,
			priority: row.priority,
			createdAt: row.created_at,
			attempts: row.attempts,
			maxAttempts: row.max_attempts,
			status: row.status,
			...(row.result ? { result: JSON.parse(row.result) } : {}),
			...(row.error ? { error: row.error } : {}),
		};
	}

	add(
		type: QueueJob["type"],
		payload: Record<string, unknown>,
		opts: { priority?: number; maxAttempts?: number } = {},
	): string {
		this.ensureStorage();
		const id = crypto.randomUUID();
		const createdAt = Date.now();
		getRawDb()
			.prepare(
				`INSERT INTO jobs (id, type, payload, priority, created_at, available_at, attempts, max_attempts, status, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'waiting', ?)`,
			)
			.run(
				id,
				type,
				JSON.stringify(payload),
				opts.priority ?? 3,
				createdAt,
				createdAt,
				opts.maxAttempts ?? 3,
				createdAt,
			);
		queueMicrotask(() => this.tick());
		return id;
	}

	process(type: QueueJob["type"], handler: QueueHandler): void {
		this.ensureStorage();
		this.handlers.set(type, handler);
		queueMicrotask(() => this.tick());
	}

	private async runJob(row: ReturnType<JobQueue["hydrate"]>): Promise<void> {
		const handler = this.handlers.get(row.type);
		if (!handler) return;
		this.activeCount += 1;
		try {
			const result = await handler(row);
			getRawDb()
				.prepare(
					`UPDATE jobs
						SET status = 'completed', result = ?, error = NULL, updated_at = ?
					 WHERE id = ?`,
				)
				.run(JSON.stringify(result ?? null), Date.now(), row.id);
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			const attempts = row.attempts;
			if (attempts < row.maxAttempts) {
				const retryInfo = this.getRetryInfo(attempts);
				getRawDb()
					.prepare(
						`UPDATE jobs
							SET status = 'waiting', error = ?, available_at = ?, updated_at = ?
						 WHERE id = ?`,
					)
					.run(err.message, Date.now() + retryInfo.delayMs, Date.now(), row.id);
			} else {
				getRawDb()
					.prepare(
						`UPDATE jobs
							SET status = 'failed', error = ?, updated_at = ?
						 WHERE id = ?`,
					)
					.run(err.message, Date.now(), row.id);
			}
		} finally {
			this.activeCount -= 1;
			queueMicrotask(() => this.tick());
		}
	}

	private getRetryInfo(attempt: number): { delayMs: number } {
		const delayMs = Math.min(1000 * 2 ** Math.max(0, attempt - 1), 30_000);
		return { delayMs };
	}

	private tick(): void {
		if (this.ticking) return;
		this.ensureStorage();
		this.ticking = true;
		try {
			while (this.activeCount < this.maxConcurrency) {
				const row = getRawDb()
					.prepare(
						`SELECT id, type, payload, priority, created_at, attempts, max_attempts, status, result, error
						   FROM jobs
						  WHERE status = 'waiting'
						    AND available_at <= ?
						    AND type IN (${
									Array.from(this.handlers.keys())
										.map(() => "?")
										.join(", ") || "''"
								})
						  ORDER BY priority ASC, created_at ASC
						  LIMIT 1`,
					)
					.get(Date.now(), ...this.handlers.keys()) as
					| {
							id: string;
							type: QueueJob["type"];
							payload: string;
							priority: number;
							created_at: number;
							attempts: number;
							max_attempts: number;
							status: QueueJob["status"];
							result: string | null;
							error: string | null;
					  }
					| undefined;
				if (!row) break;
				const claimed = getRawDb()
					.prepare(
						`UPDATE jobs
							SET status = 'active', attempts = attempts + 1, updated_at = ?
						 WHERE id = ? AND status = 'waiting'`,
					)
					.run(Date.now(), row.id);
				if ((claimed.changes ?? 0) === 0) continue;
				const activeRow = this.hydrate({
					...row,
					attempts: row.attempts + 1,
					status: "active",
				});
				void this.runJob(activeRow);
			}
		} finally {
			this.ticking = false;
		}
	}

	getJob(id: string): QueueJob | undefined {
		this.ensureStorage();
		const row = getRawDb()
			.prepare(
				`SELECT id, type, payload, priority, created_at, attempts, max_attempts, status, result, error
				   FROM jobs WHERE id = ?`,
			)
			.get(id) as Parameters<JobQueue["hydrate"]>[0] | undefined;
		return row ? this.hydrate(row) : undefined;
	}

	getActive(): QueueJob[] {
		this.ensureStorage();
		return (
			getRawDb()
				.prepare(
					`SELECT id, type, payload, priority, created_at, attempts, max_attempts, status, result, error
				   FROM jobs WHERE status = 'active' ORDER BY priority ASC, created_at ASC`,
				)
				.all() as Parameters<JobQueue["hydrate"]>[0][]
		).map((row) => this.hydrate(row));
	}

	getWaiting(): QueueJob[] {
		this.ensureStorage();
		return (
			getRawDb()
				.prepare(
					`SELECT id, type, payload, priority, created_at, attempts, max_attempts, status, result, error
				   FROM jobs WHERE status = 'waiting' ORDER BY priority ASC, created_at ASC`,
				)
				.all() as Parameters<JobQueue["hydrate"]>[0][]
		).map((row) => this.hydrate(row));
	}

	getStats(): {
		waiting: number;
		active: number;
		completed: number;
		failed: number;
	} {
		this.ensureStorage();
		const rows = getRawDb()
			.prepare(`SELECT status, COUNT(*) AS count FROM jobs GROUP BY status`)
			.all() as Array<{ status: QueueJob["status"]; count: number }>;
		const counts = { waiting: 0, active: 0, completed: 0, failed: 0 };
		for (const row of rows) counts[row.status] = row.count;
		return counts;
	}
}

export const jobQueue = new JobQueue({ maxConcurrency: 10 });

export async function runQueuedJob<T>(fn: () => Promise<T>): Promise<T> {
	return withRetry(fn, { maxAttempts: 1 });
}
