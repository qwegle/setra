import { getRawDb } from "@setra/db";
import { getCompanySettings } from "./company-settings.js";

export interface ProjectSettings {
	autoTestEnabled: boolean;
	testCommand: string;
	maxParallelRuns: number;
	budgetCapUsd: number;
	autoApprove: boolean;
	defaultBranch: string;
}

const FALLBACK_PROJECT_SETTINGS: ProjectSettings = {
	autoTestEnabled: false,
	testCommand: "",
	maxParallelRuns: 3,
	budgetCapUsd: 0,
	autoApprove: false,
	defaultBranch: "main",
};

function clampNumber(value: unknown, min: number, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	return Math.max(min, value);
}

export function getProjectSettingsDefaults(input?: {
	companyId?: string | null;
	defaultBranch?: string | null;
}): ProjectSettings {
	const companySettings = input?.companyId
		? getCompanySettings(input.companyId)
		: {};
	return {
		autoTestEnabled: FALLBACK_PROJECT_SETTINGS.autoTestEnabled,
		testCommand: FALLBACK_PROJECT_SETTINGS.testCommand,
		maxParallelRuns:
			typeof companySettings["max_parallel_runs"] === "number" &&
			companySettings["max_parallel_runs"] > 0
				? companySettings["max_parallel_runs"]
				: FALLBACK_PROJECT_SETTINGS.maxParallelRuns,
		budgetCapUsd: FALLBACK_PROJECT_SETTINGS.budgetCapUsd,
		autoApprove: Boolean(
			companySettings["governance_auto_approve"] ??
				FALLBACK_PROJECT_SETTINGS.autoApprove,
		),
		defaultBranch:
			input?.defaultBranch?.trim() || FALLBACK_PROJECT_SETTINGS.defaultBranch,
	};
}

export function parseProjectSettingsOverrides(
	settingsJson: string | null | undefined,
): Partial<ProjectSettings> {
	if (!settingsJson?.trim()) return {};
	try {
		const parsed = JSON.parse(settingsJson) as Record<string, unknown>;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return {};
		const overrides: Partial<ProjectSettings> = {};
		if (typeof parsed.autoTestEnabled === "boolean") {
			overrides.autoTestEnabled = parsed.autoTestEnabled;
		}
		if (typeof parsed.testCommand === "string") {
			overrides.testCommand = parsed.testCommand.trim();
		}
		if (
			typeof parsed.maxParallelRuns === "number" &&
			Number.isFinite(parsed.maxParallelRuns)
		) {
			overrides.maxParallelRuns = Math.max(
				1,
				Math.round(parsed.maxParallelRuns),
			);
		}
		if (
			typeof parsed.budgetCapUsd === "number" &&
			Number.isFinite(parsed.budgetCapUsd)
		) {
			overrides.budgetCapUsd = Math.max(0, parsed.budgetCapUsd);
		}
		if (typeof parsed.autoApprove === "boolean") {
			overrides.autoApprove = parsed.autoApprove;
		}
		if (
			typeof parsed.defaultBranch === "string" &&
			parsed.defaultBranch.trim()
		) {
			overrides.defaultBranch = parsed.defaultBranch.trim();
		}
		return overrides;
	} catch {
		return {};
	}
}

export function normalizeProjectSettingsInput(
	input: unknown,
): Partial<ProjectSettings> {
	if (!input || typeof input !== "object" || Array.isArray(input)) return {};
	const parsed = input as Record<string, unknown>;
	const normalized: Partial<ProjectSettings> = {};
	if (typeof parsed.autoTestEnabled === "boolean") {
		normalized.autoTestEnabled = parsed.autoTestEnabled;
	}
	if (typeof parsed.testCommand === "string") {
		normalized.testCommand = parsed.testCommand.trim();
	}
	if (parsed.maxParallelRuns !== undefined) {
		normalized.maxParallelRuns = clampNumber(parsed.maxParallelRuns, 1, 1);
	}
	if (parsed.budgetCapUsd !== undefined) {
		normalized.budgetCapUsd = clampNumber(parsed.budgetCapUsd, 0, 0);
	}
	if (typeof parsed.autoApprove === "boolean") {
		normalized.autoApprove = parsed.autoApprove;
	}
	if (typeof parsed.defaultBranch === "string") {
		normalized.defaultBranch = parsed.defaultBranch.trim() || "main";
	}
	return normalized;
}

export function getProjectSettings(projectId: string): ProjectSettings {
	const row = getRawDb()
		.prepare(
			`SELECT company_id AS companyId, default_branch AS defaultBranch, settings_json AS settingsJson
			   FROM board_projects
			  WHERE id = ?
			  LIMIT 1`,
		)
		.get(projectId) as
		| {
				companyId: string | null;
				defaultBranch: string | null;
				settingsJson: string | null;
		  }
		| undefined;
	const defaults = getProjectSettingsDefaults({
		companyId: row?.companyId ?? null,
		defaultBranch: row?.defaultBranch ?? null,
	});
	return { ...defaults, ...parseProjectSettingsOverrides(row?.settingsJson) };
}
