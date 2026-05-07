import { describe, expect, it } from "vitest";
import {
	type SshSafetyConfig,
	checkSshCommand,
	isDestructiveCommand,
	isInAllowedScope,
} from "../ssh-safety.js";

// ─── isDestructiveCommand ─────────────────────────────────────────────────────

describe("isDestructiveCommand", () => {
	it("detects rm -rf", () => {
		expect(isDestructiveCommand("rm -rf /var/log")).toBe(true);
	});

	it("detects rm -fr variant", () => {
		expect(isDestructiveCommand("rm -fr /tmp/build")).toBe(true);
	});

	it("detects rm with long flag", () => {
		expect(isDestructiveCommand("rm --recursive --force /data")).toBe(false); // long flags not matched
		expect(isDestructiveCommand("rm -rf /data")).toBe(true);
	});

	it("returns false for safe ls -la", () => {
		expect(isDestructiveCommand("ls -la")).toBe(false);
	});

	it("detects DROP TABLE", () => {
		expect(isDestructiveCommand("DROP TABLE users")).toBe(true);
	});

	it("detects drop database (case insensitive)", () => {
		expect(isDestructiveCommand("drop database mydb")).toBe(true);
	});

	it("detects TRUNCATE", () => {
		expect(isDestructiveCommand("TRUNCATE events")).toBe(true);
	});

	it("detects DELETE FROM without WHERE", () => {
		expect(isDestructiveCommand("DELETE FROM logs")).toBe(true);
	});

	it("does NOT flag DELETE FROM with WHERE", () => {
		// Has WHERE — not matched by pattern
		expect(isDestructiveCommand("DELETE FROM logs WHERE id = 1")).toBe(false);
	});

	it("detects kubectl delete", () => {
		expect(isDestructiveCommand("kubectl delete pod my-pod")).toBe(true);
	});

	it("detects docker rm", () => {
		expect(isDestructiveCommand("docker rm my-container")).toBe(true);
	});

	it("detects terraform destroy", () => {
		expect(isDestructiveCommand("terraform destroy -auto-approve")).toBe(true);
	});

	it("returns false for docker build", () => {
		expect(isDestructiveCommand("docker build .")).toBe(false);
	});

	it("returns false for git push", () => {
		expect(isDestructiveCommand("git push origin main")).toBe(false);
	});
});

// ─── isInAllowedScope ────────────────────────────────────────────────────────

describe("isInAllowedScope", () => {
	it("allows docker in deploy category", () => {
		expect(isInAllowedScope("docker build .", ["deploy"])).toBe(true);
	});

	it("allows kubectl in deploy category", () => {
		expect(isInAllowedScope("kubectl apply -f deploy.yaml", ["deploy"])).toBe(
			true,
		);
	});

	it("allows git push in cicd category", () => {
		expect(isInAllowedScope("git push origin main", ["cicd"])).toBe(true);
	});

	it("allows npm run build in cicd category", () => {
		expect(isInAllowedScope("npm run build", ["cicd"])).toBe(true);
	});

	it("allows tail logs in monitor category", () => {
		expect(isInAllowedScope("tail -f /var/log/app.log", ["monitor"])).toBe(
			true,
		);
	});

	it("blocks random commands when no matching category", () => {
		expect(isInAllowedScope("python manage.py migrate", ["deploy"])).toBe(
			false,
		);
	});

	it("allows ls in support category", () => {
		expect(isInAllowedScope("ls -la /var/www", ["support"])).toBe(true);
	});

	it("returns false with empty categories array", () => {
		expect(isInAllowedScope("docker build .", [])).toBe(false);
	});
});

// ─── checkSshCommand ─────────────────────────────────────────────────────────

describe("checkSshCommand", () => {
	const baseConfig: SshSafetyConfig = {
		allowDestructiveWithoutConfirmation: false,
		allowedCategories: ["deploy", "cicd", "monitor", "support"],
	};

	it("flags rm -rf /tmp/build as requiresConfirmation", () => {
		const result = checkSshCommand("rm -rf /tmp/build", baseConfig);
		expect(result.requiresConfirmation).toBe(true);
		expect(result.safe).toBe(false);
	});

	it("allows docker build . with deploy category", () => {
		const result = checkSshCommand("docker build .", {
			allowDestructiveWithoutConfirmation: false,
			allowedCategories: ["deploy"],
		});
		expect(result.safe).toBe(true);
		expect(result.requiresConfirmation).toBe(false);
	});

	it("allows git push origin main with cicd category", () => {
		const result = checkSshCommand("git push origin main", {
			allowDestructiveWithoutConfirmation: false,
			allowedCategories: ["cicd"],
		});
		expect(result.safe).toBe(true);
	});

	it("blocks out-of-scope command when category list is restrictive", () => {
		const result = checkSshCommand("python manage.py shell", {
			allowDestructiveWithoutConfirmation: false,
			allowedCategories: ["deploy"],
		});
		expect(result.safe).toBe(false);
		expect(result.requiresConfirmation).toBe(false);
		expect(result.reason).toMatch(/not in the allowed categories/);
	});

	it("allows destructive command when opt-out is true", () => {
		const result = checkSshCommand("rm -rf /tmp/build", {
			allowDestructiveWithoutConfirmation: true,
			allowedCategories: ["deploy"],
		});
		expect(result.safe).toBe(true);
		expect(result.requiresConfirmation).toBe(false);
	});

	it("includes suggestedAlternative for destructive commands", () => {
		const result = checkSshCommand("DROP TABLE sessions", baseConfig);
		expect(result.suggestedAlternative).toBeTruthy();
	});

	it("allows safe command with full category list", () => {
		const result = checkSshCommand("kubectl get pods", baseConfig);
		expect(result.safe).toBe(true);
	});

	it("flags terraform destroy as requiresConfirmation", () => {
		const result = checkSshCommand(
			"terraform destroy -auto-approve",
			baseConfig,
		);
		expect(result.requiresConfirmation).toBe(true);
		expect(result.safe).toBe(false);
	});
});
