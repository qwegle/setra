/**
 * SSH Safety Guardrails
 *
 * Enforces command allowlisting and deletion guards for remote SSH grounds.
 * Config stored per ground at ~/.setra/grounds/{groundId}/safety.json
 */

export interface SshSafetyConfig {
	/** If true, user has explicitly opted out of deletion guard. Default: false */
	allowDestructiveWithoutConfirmation: boolean;
	/** Allowed command categories on remote SSH */
	allowedCategories: ("deploy" | "cicd" | "monitor" | "support")[];
}

export interface SafetyCheckResult {
	safe: boolean;
	requiresConfirmation: boolean;
	reason: string;
	suggestedAlternative?: string;
}

// ─── Destructive command patterns ────────────────────────────────────────────

const DESTRUCTIVE_PATTERNS: RegExp[] = [
	/\brm\s+(?:-[a-zA-Z]*[rf][a-zA-Z]*\s)/i,
	/\brmdir\b/i,
	/\bdrop\s+(?:table|database|schema|index|view)\b/i,
	/\btruncate\b/i,
	/\bdelete\s+from\b(?!.*\bwhere\b)/i,
	/\bkubectl\s+delete\b/i,
	/\bdocker\s+(?:rm|rmi|volume\s+rm|network\s+rm)\b/i,
	/\bterraform\s+destroy\b/i,
	/\bdropdb\b/i,
	/\bdrop_table\b/i,
];

/** Returns true if command contains destructive operations. */
export function isDestructiveCommand(command: string): boolean {
	return DESTRUCTIVE_PATTERNS.some((re) => re.test(command));
}

// ─── Allowed-scope patterns ───────────────────────────────────────────────────

const DEPLOY_PATTERNS: RegExp[] = [
	/\bdocker\b/,
	/\bkubectl\b/,
	/\bsystemctl\b/,
	/\bpm2\b/,
	/\bnginx\b/,
	/\bcaddy\b/,
	/\bdeploy\b/i,
	/\bantctl\b/,
	/\bhelm\b/,
	/\bheroku\b/,
	/\bcapistrano\b/,
];

const CICD_PATTERNS: RegExp[] = [
	/\bgit\s+(?:push|pull|fetch|clone)\b/,
	/\bmake\b/,
	/\bnpm\s+run\b/,
	/\byarn\b/,
	/\bpnpm\b/,
	/\bcargo\s+build\b/,
	/\bgo\s+build\b/,
	/\bmvn\b/,
	/\bgradle\b/,
	/\bbazel\b/,
	/\bnpm\s+(?:install|ci|test|build)\b/,
	/\bpip\s+install\b/,
];

const MONITOR_PATTERNS: RegExp[] = [
	/\bjournalctl\b/,
	/\btail\b/,
	/\bgrep\b/,
	/\bcat\b/,
	/\bless\b/,
	/\bmore\b/,
	/\bps\b/,
	/\btop\b/,
	/\bhtop\b/,
	/\bdf\b/,
	/\bfree\b/,
	/\bnetstat\b/,
	/\bss\b/,
	/\blsof\b/,
	/\buptime\b/,
	/\bvmstat\b/,
	/\biostat\b/,
	/\bdocker\s+(?:logs|stats|ps|inspect)\b/,
	/\bkubectl\s+(?:logs|describe|get|top)\b/,
];

const SUPPORT_PATTERNS: RegExp[] = [
	/\bls\b/,
	/\bpwd\b/,
	/\bwhoami\b/,
	/\benv\b/,
	/\becho\b/,
	/\bcat\b/,
	/\bhead\b/,
	/\bwc\b/,
	/\bdiff\b/,
	/\bstat\b/,
	/\bfile\b/,
	/\bwhich\b/,
	/\btype\b/,
	/\bfind\b/,
	/\bgrep\b/,
	/\bcurl\s+(?:-[a-zA-Z]*[gG]|--get)\b/,
	/\bcurl\s+-[a-zA-Z]*[sS]\b/,
];

const CATEGORY_PATTERNS: Record<string, RegExp[]> = {
	deploy: DEPLOY_PATTERNS,
	cicd: CICD_PATTERNS,
	monitor: MONITOR_PATTERNS,
	support: SUPPORT_PATTERNS,
};

/** Returns true if the command falls within any of the allowed categories. */
export function isInAllowedScope(
	command: string,
	allowedCategories: string[],
): boolean {
	return allowedCategories.some((cat) => {
		const patterns = CATEGORY_PATTERNS[cat];
		return patterns?.some((re) => re.test(command)) ?? false;
	});
}

// ─── Main safety check ────────────────────────────────────────────────────────

/**
 * Check a command before running it on a remote SSH ground.
 * Returns a SafetyCheckResult describing whether execution should proceed.
 */
export function checkSshCommand(
	command: string,
	config: SshSafetyConfig,
): SafetyCheckResult {
	const destructive = isDestructiveCommand(command);
	const inScope = isInAllowedScope(command, config.allowedCategories);

	// Destructive commands always require confirmation (unless opted out)
	if (destructive) {
		if (config.allowDestructiveWithoutConfirmation) {
			return {
				safe: true,
				requiresConfirmation: false,
				reason: "Destructive command allowed by explicit opt-out",
			};
		}
		return {
			safe: false,
			requiresConfirmation: true,
			reason: `Destructive command detected: "${command.slice(0, 80)}". Explicit confirmation required.`,
			suggestedAlternative:
				"Verify you have a backup and rollback plan before proceeding.",
		};
	}

	// Out-of-scope commands are blocked when categories are configured
	if (config.allowedCategories.length > 0 && !inScope) {
		return {
			safe: false,
			requiresConfirmation: false,
			reason: `Command "${command.slice(0, 80)}" is not in the allowed categories: [${config.allowedCategories.join(", ")}].`,
			suggestedAlternative:
				"Only deploy, CI/CD, monitoring, or support commands are permitted on remote SSH grounds.",
		};
	}

	return {
		safe: true,
		requiresConfirmation: false,
		reason: "Command is within allowed scope",
	};
}

// ─── System prompt guidelines ─────────────────────────────────────────────────

export const SSH_SUPPORT_GUIDELINES = `
## Remote SSH Safety Guidelines

You are operating on a REMOTE server. Follow these rules strictly:

### ALLOWED on remote SSH:
- Deployment: docker, kubectl, systemctl, pm2, nginx, caddy, deploy scripts
- CI/CD: git push/pull, make, build commands, test runners
- Monitoring: logs, status checks, ps, top, df, free
- Support: read-only diagnostics, config inspection

### REQUIRES CONFIRMATION:
- Any deletion: rm, rmdir, DROP, DELETE, TRUNCATE, kubectl delete
- Service restarts that cause downtime: systemctl stop, docker stop
- Config changes that affect production traffic

### PROHIBITED without explicit --allow-destructive flag:
- rm -rf on system directories
- DROP DATABASE, DROP TABLE
- terraform destroy
- kubectl delete namespace

### Support work guidelines:
1. DIAGNOSE before acting — read logs, check status first
2. PROPOSE changes, don't auto-apply — use team_request_approval
3. Document every change in the channel
4. Test in staging before production (if available)
5. Always have a rollback plan
`;
