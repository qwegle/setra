export type AutonomyLevel = "none" | "basic" | "plus" | "semi" | "full";

export interface AutonomyConfig {
	level: AutonomyLevel;
	autoContinue: boolean;
	autoBuild: boolean;
	autoLoadContext: boolean;
	smartContext: boolean;
	autoApply: boolean;
	canExec: boolean;
	autoExec: boolean;
	autoDebug: boolean;
	autoCommit: boolean;
}

const AUTONOMY_PRESETS: Record<AutonomyLevel, AutonomyConfig> = {
	none: {
		level: "none",
		autoContinue: false,
		autoBuild: false,
		autoLoadContext: false,
		smartContext: false,
		autoApply: false,
		canExec: false,
		autoExec: false,
		autoDebug: false,
		autoCommit: false,
	},
	basic: {
		level: "basic",
		autoContinue: true,
		autoBuild: true,
		autoLoadContext: false,
		smartContext: false,
		autoApply: false,
		canExec: false,
		autoExec: false,
		autoDebug: false,
		autoCommit: false,
	},
	plus: {
		level: "plus",
		autoContinue: true,
		autoBuild: true,
		autoLoadContext: false,
		smartContext: true,
		autoApply: false,
		canExec: true,
		autoExec: false,
		autoDebug: false,
		autoCommit: true,
	},
	semi: {
		level: "semi",
		autoContinue: true,
		autoBuild: true,
		autoLoadContext: true,
		smartContext: true,
		autoApply: false,
		canExec: true,
		autoExec: false,
		autoDebug: false,
		autoCommit: true,
	},
	full: {
		level: "full",
		autoContinue: true,
		autoBuild: true,
		autoLoadContext: true,
		smartContext: true,
		autoApply: true,
		canExec: true,
		autoExec: true,
		autoDebug: true,
		autoCommit: true,
	},
};

export function getAutonomyConfig(level: AutonomyLevel): AutonomyConfig {
	return { ...AUTONOMY_PRESETS[level] };
}

export function resolveAutonomy(
	level: AutonomyLevel,
	overrides?: Partial<AutonomyConfig>,
): AutonomyConfig {
	const base = getAutonomyConfig(level);
	if (!overrides) {
		return base;
	}
	return { ...base, ...overrides };
}

export function canPerformAction(
	config: AutonomyConfig,
	action: keyof Omit<AutonomyConfig, "level">,
): boolean {
	return config[action] === true;
}

export function describeAutonomy(level: AutonomyLevel): string {
	const descriptions: Record<AutonomyLevel, string> = {
		none: "Manual — agent suggests, you do everything",
		basic: "Assisted — auto-continues and builds, manual apply",
		plus: "Enhanced — smart context, can execute commands, auto-commits",
		semi: "Semi-auto — loads context automatically, still requires approval to apply changes (DEFAULT)",
		full: "Full autopilot — agent does everything including applying changes and debugging",
	};
	return descriptions[level];
}
