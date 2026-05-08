import { Hono } from "hono";
import { logActivity } from "../lib/audit.js";
import { getCompanyId } from "../lib/company-scope.js";
import {
	assignAgentToProject,
	autoAssignLeadershipAgents,
	getScopedAgentOrThrow,
	isLeadershipAgent,
	listProjectAgents,
	unassignAgentFromProject,
} from "../lib/project-agents.js";

export const projectAgentsRoute = new Hono();

projectAgentsRoute.get("/:projectId/agents", (c) => {
	try {
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		return c.json(listProjectAgents(projectId, companyId));
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "failed to list project agents";
		const status = message === "project not found" ? 404 : 500;
		return c.json({ error: message }, status);
	}
});

projectAgentsRoute.post("/:projectId/agents", async (c) => {
	try {
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		const body = (await c.req.json()) as {
			agentRosterId?: string;
			role?: string;
			assignedBy?: string;
		};
		if (!body.agentRosterId?.trim()) {
			return c.json({ error: "agentRosterId is required" }, 400);
		}
		assignAgentToProject({
			projectId,
			companyId,
			agentRosterId: body.agentRosterId,
			...(body.role ? { role: body.role } : {}),
			...(body.assignedBy ? { assignedBy: body.assignedBy } : {}),
		});
		await logActivity(c, "project.agent.assigned", "project", projectId, {
			agentRosterId: body.agentRosterId,
			role: body.role ?? "member",
		});
		return c.json({ ok: true });
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "failed to assign project agent";
		const status =
			message === "project not found" || message === "agent not found"
				? 404
				: 500;
		return c.json({ error: message }, status);
	}
});

projectAgentsRoute.delete("/:projectId/agents/:agentRosterId", async (c) => {
	try {
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		const agentRosterId = c.req.param("agentRosterId");
		const agent = getScopedAgentOrThrow(agentRosterId, companyId);
		if (isLeadershipAgent(agent)) {
			return c.json(
				{ error: "Leadership agents stay assigned to every project" },
				409,
			);
		}
		unassignAgentFromProject({ projectId, companyId, agentRosterId });
		await logActivity(c, "project.agent.unassigned", "project", projectId, {
			agentRosterId,
		});
		return c.json({ ok: true });
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: "failed to unassign project agent";
		const status =
			message === "project not found" || message === "agent not found"
				? 404
				: 500;
		return c.json({ error: message }, status);
	}
});

projectAgentsRoute.post(
	"/:projectId/agents/auto-assign-leadership",
	async (c) => {
		try {
			const companyId = getCompanyId(c);
			const projectId = c.req.param("projectId");
			const leaders = autoAssignLeadershipAgents(projectId, companyId);
			await logActivity(
				c,
				"project.agent.leadership_assigned",
				"project",
				projectId,
				{
					assigned: leaders.map((leader) => leader.id),
				},
			);
			return c.json({ ok: true, assigned: leaders.length, leaders });
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "failed to auto-assign leadership";
			const status = message === "project not found" ? 404 : 500;
			return c.json({ error: message }, status);
		}
	},
);

projectAgentsRoute.post("/:projectId/agents/reassign", async (c) => {
	try {
		const companyId = getCompanyId(c);
		const projectId = c.req.param("projectId");
		const body = (await c.req.json()) as {
			agentRosterId?: string;
			fromProjectId?: string | null;
		};
		if (!body.agentRosterId?.trim()) {
			return c.json({ error: "agentRosterId is required" }, 400);
		}
		const agent = getScopedAgentOrThrow(body.agentRosterId, companyId);
		if (body.fromProjectId && !isLeadershipAgent(agent)) {
			unassignAgentFromProject({
				projectId: body.fromProjectId,
				companyId,
				agentRosterId: body.agentRosterId,
			});
		}
		assignAgentToProject({
			projectId,
			companyId,
			agentRosterId: body.agentRosterId,
			role: isLeadershipAgent(agent) ? "lead" : "member",
			assignedBy: "ceo",
		});
		await logActivity(c, "project.agent.reassigned", "project", projectId, {
			agentRosterId: body.agentRosterId,
			fromProjectId: body.fromProjectId ?? null,
		});
		return c.json({ ok: true });
	} catch (error) {
		const message =
			error instanceof Error
				? error.message
				: "failed to reassign project agent";
		const status =
			message === "project not found" || message === "agent not found"
				? 404
				: 500;
		return c.json({ error: message }, status);
	}
});

export default projectAgentsRoute;
