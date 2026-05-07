import type { BoardEvent } from "./types.js";

export type EventHandler = (event: BoardEvent) => void;

/**
 * Subscribe to board SSE events.
 * Works in browser (EventSource) and in Node.js 18+ (native fetch + ReadableStream).
 *
 * Returns a cleanup function.
 */
export function subscribeBoardEvents(
	baseUrl: string,
	onEvent: EventHandler,
	onError?: (err: unknown) => void,
): () => void {
	// Browser path — native EventSource
	if (typeof EventSource !== "undefined") {
		const es = new EventSource(`${baseUrl}/api/events`);

		const handle = (e: MessageEvent, type: string) => {
			try {
				const data = JSON.parse(e.data as string) as Record<string, unknown>;
				onEvent({ type, data } as BoardEvent);
			} catch {
				/* ignore malformed events */
			}
		};

		for (const t of [
			"issue:updated",
			"agent:updated",
			"run:completed",
			"project:updated",
			"approval:pending",
			"ping",
		]) {
			es.addEventListener(t, (e) => handle(e as MessageEvent, t));
		}

		es.onerror = (e) => onError?.(e);
		return () => es.close();
	}

	// Node.js path — fetch + ReadableStream
	let aborted = false;
	const ctrl = new AbortController();

	(async () => {
		while (!aborted) {
			try {
				const res = await fetch(`${baseUrl}/api/events`, {
					signal: ctrl.signal,
				});
				if (!res.body) break;

				const reader = res.body.getReader();
				const dec = new TextDecoder();
				let buf = "";

				while (!aborted) {
					const { done, value } = await reader.read();
					if (done) break;
					buf += dec.decode(value, { stream: true });

					const blocks = buf.split("\n\n");
					buf = blocks.pop() ?? "";

					for (const block of blocks) {
						let event = "";
						let data = "";
						for (const line of block.split("\n")) {
							if (line.startsWith("event:")) event = line.slice(6).trim();
							if (line.startsWith("data:")) data = line.slice(5).trim();
						}
						if (event && data) {
							try {
								const parsed = JSON.parse(data) as Record<string, unknown>;
								onEvent({ type: event, data: parsed } as BoardEvent);
							} catch {
								/* ignore */
							}
						}
					}
				}
			} catch (err) {
				if (aborted) break;
				onError?.(err);
				// back-off before reconnect
				await new Promise((r) => setTimeout(r, 3000));
			}
		}
	})();

	return () => {
		aborted = true;
		ctrl.abort();
	};
}
