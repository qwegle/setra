/**
 * retry.ts — Exponential backoff retry utility for LLM calls.
 *
 * Retries on transient errors (rate limits, network failures, 5xx).
 * Does NOT retry on 4xx client errors (except 429).
 */

export interface RetryOptions {
	/** Max number of attempts (including first try). Default: 3 */
	maxAttempts?: number;
	/** Initial delay in ms before first retry. Default: 1000 */
	initialDelayMs?: number;
	/** Multiplier for each subsequent delay. Default: 2 */
	backoffMultiplier?: number;
	/** Max delay cap in ms. Default: 30000 */
	maxDelayMs?: number;
	/** Optional callback for logging retries */
	onRetry?: (attempt: number, error: Error, delayMs: number) => void;
}

const RETRYABLE_PATTERNS = [
	/429/i,
	/rate.?limit/i,
	/too.?many.?requests/i,
	/overloaded/i,
	/503/i,
	/502/i,
	/504/i,
	/service.?unavailable/i,
	/gateway.?timeout/i,
	/ECONNRESET/i,
	/ETIMEDOUT/i,
	/ENOTFOUND/i,
	/socket.?hang.?up/i,
	/network/i,
	/fetch.?failed/i,
];

function isRetryable(error: Error): boolean {
	const msg = error.message ?? "";
	// Don't retry 4xx client errors except 429
	if (/\b4\d{2}\b/.test(msg) && !/429/.test(msg)) return false;
	return RETRYABLE_PATTERNS.some((p) => p.test(msg));
}

export async function withRetry<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {},
): Promise<T> {
	const {
		maxAttempts = 3,
		initialDelayMs = 1000,
		backoffMultiplier = 2,
		maxDelayMs = 30000,
		onRetry,
	} = options;

	let lastError: Error | undefined;
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));
			if (attempt >= maxAttempts || !isRetryable(lastError)) {
				throw lastError;
			}
			const delay = Math.min(
				initialDelayMs * backoffMultiplier ** (attempt - 1),
				maxDelayMs,
			);
			// Add jitter (±25%)
			const jitter = delay * (0.75 + Math.random() * 0.5);
			onRetry?.(attempt, lastError, jitter);
			await new Promise((resolve) => setTimeout(resolve, jitter));
		}
	}
	throw lastError!;
}
