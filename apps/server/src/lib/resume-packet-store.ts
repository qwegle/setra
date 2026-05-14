/**
 * resume-packet-store.ts — in-memory consumed-once cache for cold-start
 * resume packets (P18 wiring).
 *
 * The pure builder lives in `resume-packets.ts` and is rebuilt on demand
 * from DB state (in-flight runs + open approvals). This store is the
 * shipping layer:
 *
 *   - At server bootstrap, primeResumePackets() walks once and caches a
 *     ResumePacket per (companyId, agentSlug) — these are the "you were
 *     doing X when the process died" preambles.
 *   - At dispatch time, run-orchestrator calls
 *     consumeResumePacketFor(companyId, agentSlug) and prepends the body
 *     to the system prompt of the very first new run for that agent.
 *   - Consumption is one-shot per (boot, agent) — subsequent dispatches
 *     get nothing because the agent has, by then, seen the recovery
 *     context.
 *
 * Rebuilt on every boot, so the cache is always fresh against the
 * current DB state. No persistence needed.
 */

import { createLogger } from "./logger.js";
import { type ResumePacket, buildResumePackets } from "./resume-packets.js";

const log = createLogger("resume-packets");

const cache = new Map<string, ResumePacket>();

function key(companyId: string | null, agentSlug: string): string {
	return `${companyId ?? "_"}::${agentSlug}`;
}

/**
 * Walk the DB for in-flight work and build a ResumePacket per affected
 * agent. Called once at server bootstrap; safe to call again (it
 * overwrites the cache from the latest DB state).
 */
export function primeResumePackets(): number {
	cache.clear();
	const packets = buildResumePackets();
	for (const p of packets) {
		cache.set(key(p.companyId, p.agentSlug), p);
		log.info("resume packet prepared", {
			agentSlug: p.agentSlug,
			companyId: p.companyId,
			activeRuns: p.activeRunIds.length,
			pendingApprovals: p.pendingApprovalIds.length,
		});
	}
	if (packets.length > 0) {
		log.info("resume packets primed", { count: packets.length });
	}
	return packets.length;
}

/**
 * Pop the resume packet for (companyId, agentSlug) if one exists, marking
 * it consumed. The body is meant to be prepended to the agent's next
 * system prompt.
 */
export function consumeResumePacketFor(
	companyId: string | null,
	agentSlug: string,
): ResumePacket | null {
	const k = key(companyId, agentSlug);
	const packet = cache.get(k);
	if (!packet) return null;
	cache.delete(k);
	log.info("resume packet consumed", {
		agentSlug,
		companyId,
		activeRuns: packet.activeRunIds.length,
		pendingApprovals: packet.pendingApprovalIds.length,
	});
	return packet;
}

/** Read-only snapshot for the /api/runtime/resume-packets endpoint. */
export function listCachedResumePackets(): ResumePacket[] {
	return Array.from(cache.values());
}

/** Test hook — clears the cache between tests. */
export function _resetResumePacketStore(): void {
	cache.clear();
}
