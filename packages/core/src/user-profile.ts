/**
 * SetraProfile — User Intelligence Profile
 *
 * A living document that agents read at session start to adapt their
 * behaviour to the specific user. Auto-updated after every session.
 * Stored locally at ~/.setra/profile.json — never sent to cloud.
 *
 * Think of it as the agent's "memory of you" — the more you use setra,
 * the better it understands your style, priorities, and working patterns.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SetraProfile {
	/** User's preferred name */
	displayName: string;

	/** Technical expertise level — affects how agents explain things */
	technicalDepth: "beginner" | "intermediate" | "advanced" | "expert";

	/** Preferred communication style */
	communicationStyle: {
		verbosity: "concise" | "detailed" | "contextual";
		tone: "formal" | "casual" | "technical";
		prefersBulletPoints: boolean;
		prefersCodeExamples: boolean;
		preferredLanguage: string; // "en", "hi", "or" (Odia), etc.
	};

	/** Primary domains of work */
	domains: string[]; // e.g. ["security", "governance", "saas", "ai"]

	/** Working context */
	workContext: {
		organization?: string;
		role?: string;
		currentProjects: string[];
		timezone?: string;
		workingHoursUtc?: { start: number; end: number }; // 0-23
	};

	/** How this user makes decisions */
	decisionStyle: {
		prefersOptions: boolean; // show multiple options vs just the best one
		prefersConfirmation: boolean; // ask before destructive/install actions (default: true)
		riskTolerance: "low" | "medium" | "high";
		autoApproveThreshold: number; // cost in USD below which auto-approve (0 = always ask)
	};

	/** Recurring priorities the agent should always keep in mind */
	priorities: string[];

	/** Things the user wants agents to avoid */
	avoidances: string[];

	/** Patterns observed across sessions */
	observedPatterns: Array<{
		pattern: string;
		frequency: number;
		lastSeen: string; // ISO date
	}>;

	/** Agent behaviour preferences */
	agentPreferences: {
		preferredDefaultModel: string;
		preferLocalModels: boolean;
		showTokenUsage: boolean;
		showThinkingProcess: boolean;
		pauseOnErrors: boolean;
	};

	/** Metadata */
	version: number; // schema version, start at 1
	interactionCount: number;
	createdAt: string;
	lastUpdated: string;
}

export const DEFAULT_PROFILE: SetraProfile = {
	displayName: "User",
	technicalDepth: "intermediate",
	communicationStyle: {
		verbosity: "contextual",
		tone: "technical",
		prefersBulletPoints: true,
		prefersCodeExamples: true,
		preferredLanguage: "en",
	},
	domains: [],
	workContext: {
		currentProjects: [],
	},
	decisionStyle: {
		prefersOptions: true,
		prefersConfirmation: true,
		riskTolerance: "medium",
		autoApproveThreshold: 0,
	},
	priorities: [],
	avoidances: [],
	observedPatterns: [],
	agentPreferences: {
		preferredDefaultModel: "auto",
		preferLocalModels: false,
		showTokenUsage: true,
		showThinkingProcess: false,
		pauseOnErrors: true,
	},
	version: 1,
	interactionCount: 0,
	createdAt: new Date().toISOString(),
	lastUpdated: new Date().toISOString(),
};

function profilePath(): string {
	return join(homedir(), ".setra", "profile.json");
}

export function loadProfile(): SetraProfile {
	const path = profilePath();
	if (!existsSync(path)) return { ...DEFAULT_PROFILE };
	try {
		const raw = readFileSync(path, "utf8");
		return {
			...DEFAULT_PROFILE,
			...(JSON.parse(raw) as Partial<SetraProfile>),
		};
	} catch {
		return { ...DEFAULT_PROFILE };
	}
}

export function saveProfile(profile: SetraProfile): void {
	const dir = join(homedir(), ".setra");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const updated = { ...profile, lastUpdated: new Date().toISOString() };
	writeFileSync(profilePath(), JSON.stringify(updated, null, 2), "utf8");
}

export function updateProfile(updates: Partial<SetraProfile>): SetraProfile {
	const current = loadProfile();
	const merged = {
		...current,
		...updates,
		lastUpdated: new Date().toISOString(),
	};
	saveProfile(merged);
	return merged;
}

export function incrementInteractionCount(): void {
	const p = loadProfile();
	saveProfile({ ...p, interactionCount: p.interactionCount + 1 });
}

export function recordPattern(pattern: string): void {
	const p = loadProfile();
	const existing = p.observedPatterns.find((x) => x.pattern === pattern);
	if (existing) {
		existing.frequency += 1;
		existing.lastSeen = new Date().toISOString();
	} else {
		p.observedPatterns.push({
			pattern,
			frequency: 1,
			lastSeen: new Date().toISOString(),
		});
	}
	// Keep top 50 patterns by frequency
	p.observedPatterns.sort((a, b) => b.frequency - a.frequency);
	p.observedPatterns = p.observedPatterns.slice(0, 50);
	saveProfile(p);
}

/**
 * buildProfileContext — formats the profile into a string that agents
 * include in their system prompt for personalised behaviour.
 */
export function buildProfileContext(profile: SetraProfile): string {
	const lines: string[] = [
		`## User Intelligence Profile`,
		`Name: ${profile.displayName}`,
		`Technical depth: ${profile.technicalDepth}`,
		`Style: ${profile.communicationStyle.verbosity}, ${profile.communicationStyle.tone}`,
		profile.domains.length > 0 ? `Domains: ${profile.domains.join(", ")}` : "",
		profile.workContext.organization
			? `Organization: ${profile.workContext.organization}`
			: "",
		profile.workContext.currentProjects.length > 0
			? `Active projects: ${profile.workContext.currentProjects.join(", ")}`
			: "",
		profile.priorities.length > 0
			? `Priorities: ${profile.priorities.join("; ")}`
			: "",
		profile.avoidances.length > 0
			? `Avoid: ${profile.avoidances.join("; ")}`
			: "",
		`Always ask before installing tools or destructive actions: ${profile.decisionStyle.prefersConfirmation}`,
		profile.observedPatterns.length > 0
			? `Observed patterns: ${profile.observedPatterns
					.slice(0, 5)
					.map((p) => p.pattern)
					.join("; ")}`
			: "",
	];
	return lines.filter(Boolean).join("\n");
}
