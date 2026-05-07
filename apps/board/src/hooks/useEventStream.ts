import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

const BASE = import.meta.env.VITE_API_URL ?? "/api";

/**
 * Single shared EventSource for the whole app.
 *
 * Consolidates what used to be three independent EventSource connections
 * (useLiveEvents + useRealtimeUpdates + useSSEStatus) into one stream that
 * - tracks connection status
 * - invalidates React Query keys on every server event
 * - auto-reconnects with backoff on error
 *
 * Returns a stable status value for the UI badge.
 */

export type SSEStatus = "connecting" | "connected" | "disconnected";

interface EventPayload {
	runId?: string;
	agentId?: string;
	status?: string;
}

function safeParse(e: MessageEvent): EventPayload {
	try {
		return JSON.parse(e.data) as EventPayload;
	} catch {
		return {};
	}
}

export function useEventStream(): SSEStatus {
	const qc = useQueryClient();
	const [status, setStatus] = useState<SSEStatus>("connecting");
	const esRef = useRef<EventSource | null>(null);
	const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

	useEffect(() => {
		let cancelled = false;
		let retryHandle: ReturnType<typeof setTimeout> | null = null;

		// Debounced invalidation to avoid rapid-fire re-renders during active agents
		function debouncedInvalidate(key: string, queryKeys: string[][], delay = 1000) {
			if (debounceTimers.current[key]) {
				clearTimeout(debounceTimers.current[key]);
			}
			debounceTimers.current[key] = setTimeout(() => {
				for (const qk of queryKeys) {
					void qc.invalidateQueries({ queryKey: qk });
				}
				delete debounceTimers.current[key];
			}, delay);
		}

		function connect() {
			if (cancelled) return;
			const es = new EventSource(`${BASE}/events`);
			esRef.current = es;

			es.onopen = () => setStatus("connected");

			es.addEventListener("issue:updated", () => {
				debouncedInvalidate("issues", [["issues"], ["projects"]]);
			});
			es.addEventListener("agent:updated", () => {
				debouncedInvalidate("agents", [["agents"], ["agents-roster"]]);
			});
			es.addEventListener("agent:status_changed", () => {
				debouncedInvalidate("agents-status", [["agents"], ["agents-roster"]]);
			});
			es.addEventListener("agent:bulk_paused", () => {
				debouncedInvalidate("agents-bulk", [["agents"], ["agents-roster"], ["budget"]]);
			});
			es.addEventListener("agent:bulk_resumed", () => {
				debouncedInvalidate("agents-resumed", [["agents"], ["agents-roster"]]);
			});
			es.addEventListener("run:updated", (e: MessageEvent) => {
				const data = safeParse(e);
				debouncedInvalidate("run-updated", [["agents"]], 2000);
				if (data.agentId) {
					void qc.invalidateQueries({ queryKey: ["agent-runs", data.agentId] });
					void qc.invalidateQueries({
						queryKey: ["agent-detail", data.agentId],
					});
				}
			});
			es.addEventListener("run:completed", (e: MessageEvent) => {
				const data = safeParse(e);
				void qc.invalidateQueries({ queryKey: ["agents"] });
				void qc.invalidateQueries({ queryKey: ["budget"] });
				if (data.agentId) {
					void qc.invalidateQueries({ queryKey: ["agent-runs", data.agentId] });
					void qc.invalidateQueries({
						queryKey: ["agent-detail", data.agentId],
					});
				}
			});
			es.addEventListener("project:updated", () => {
				void qc.invalidateQueries({ queryKey: ["projects"] });
			});
			es.addEventListener("review_requested", () => {
				void qc.invalidateQueries({ queryKey: ["review"] });
				void qc.invalidateQueries({ queryKey: ["approvals"] });
			});
			es.addEventListener("review_resolved", () => {
				void qc.invalidateQueries({ queryKey: ["review"] });
				void qc.invalidateQueries({ queryKey: ["approvals"] });
			});
			es.addEventListener("artifact:created", () => {
				void qc.invalidateQueries({ queryKey: ["artifacts"] });
			});
			es.addEventListener("clone:brief_updated", () => {
				void qc.invalidateQueries({ queryKey: ["clone", "profile"] });
			});
			es.addEventListener("budget:hard_stop", () => {
				void qc.invalidateQueries({ queryKey: ["budget"] });
				void qc.invalidateQueries({ queryKey: ["agents"] });
			});
			es.addEventListener("collab:message", () => {
				debouncedInvalidate("collab", [["collab-messages"], ["collab-channels"]]);
			});

			es.onerror = () => {
				setStatus("disconnected");
				es.close();
				retryHandle = setTimeout(connect, 3000);
			};
		}

		connect();
		return () => {
			cancelled = true;
			if (retryHandle) clearTimeout(retryHandle);
			// Clear all debounce timers
			for (const timer of Object.values(debounceTimers.current)) {
				clearTimeout(timer);
			}
			debounceTimers.current = {};
			esRef.current?.close();
		};
	}, [qc]);

	return status;
}
