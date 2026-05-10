/**
 * Subscribes to the shared SSE stream and surfaces `run:chunk` events
 * for the given agent (or, when agentId is null, all agents in the
 * tenant). Returns a rolling buffer of recent chunks plus the most
 * recent assistant/tool_use chunk so consumers can render an "agent X
 * is doing Y right now" strip without polling.
 */

import { useEffect, useRef, useState } from "react";
import type { AgentRunLogChunk } from "../lib/api";

const BASE = import.meta.env.VITE_API_URL ?? "/api";
const MAX_BUFFER = 100;

export interface RunChunkEvent extends AgentRunLogChunk {
	runId: string;
	agentId: string;
	companyId: string | null;
}

interface RawChunkPayload {
	runId?: string;
	agentId?: string;
	companyId?: string | null;
	sequence?: number;
	type?: AgentRunLogChunk["type"];
	toolName?: string | null;
	content?: string;
	recordedAt?: string;
}

function parse(e: MessageEvent): RunChunkEvent | null {
	let raw: RawChunkPayload;
	try {
		raw = JSON.parse(e.data) as RawChunkPayload;
	} catch {
		return null;
	}
	if (!raw.runId || !raw.agentId || !raw.type) return null;
	return {
		runId: raw.runId,
		agentId: raw.agentId,
		companyId: raw.companyId ?? null,
		type: raw.type,
		content: raw.content ?? "",
		toolName: raw.toolName ?? undefined,
		sequence: raw.sequence,
		timestamp: raw.recordedAt ?? new Date().toISOString(),
	};
}

export interface UseRunChunkStreamOptions {
	agentId?: string | null;
	runId?: string | null;
	limit?: number;
}

export interface RunChunkStreamState {
	chunks: RunChunkEvent[];
	latest: RunChunkEvent | null;
	connected: boolean;
}

export function useRunChunkStream(
	opts: UseRunChunkStreamOptions = {},
): RunChunkStreamState {
	const { agentId = null, runId = null, limit = MAX_BUFFER } = opts;
	const [chunks, setChunks] = useState<RunChunkEvent[]>([]);
	const [latest, setLatest] = useState<RunChunkEvent | null>(null);
	const [connected, setConnected] = useState(false);
	const esRef = useRef<EventSource | null>(null);

	useEffect(() => {
		let cancelled = false;
		let retryHandle: ReturnType<typeof setTimeout> | null = null;

		function connect() {
			if (cancelled) return;
			const es = new EventSource(`${BASE}/events`);
			esRef.current = es;
			es.onopen = () => setConnected(true);

			es.addEventListener("run:chunk", (raw: MessageEvent) => {
				const evt = parse(raw);
				if (!evt) return;
				if (agentId && evt.agentId !== agentId) return;
				if (runId && evt.runId !== runId) return;
				setLatest(evt);
				setChunks((prev) => {
					const next = [...prev, evt];
					if (next.length > limit) next.splice(0, next.length - limit);
					return next;
				});
			});

			es.onerror = () => {
				setConnected(false);
				es.close();
				retryHandle = setTimeout(connect, 3000);
			};
		}

		connect();
		return () => {
			cancelled = true;
			if (retryHandle) clearTimeout(retryHandle);
			esRef.current?.close();
		};
	}, [agentId, runId, limit]);

	return { chunks, latest, connected };
}
