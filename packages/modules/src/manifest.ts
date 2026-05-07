// packages/modules/src/manifest.ts
// Manifest validator for setra modules
// Used by setra-dev CLI (validate command) and the module.install tRPC procedure
import { z } from "zod";

// ─── Permission schemas ────────────────────────────────────────────────────────
const SafePermissionSchema = z.enum([
	"storage",
	"network",
	"execute",
	"git",
	"secrets",
	"mcp",
]);

const DangerousPermissionSchema = z.enum([
	"host_network",
	"root",
	"bypass_secrets_redaction",
]);

// ─── Hook schemas ────────────────────────────────────────────────────────────
const HookSchema = z.object({
	event: z.string().min(1),
	handler: z.string().min(1),
	timeout: z.number().int().positive().optional(),
});

// ─── MCP server schema ───────────────────────────────────────────────────────
const MCPServerSchema = z.object({
	name: z.string().min(1),
	command: z.string().min(1),
	args: z.array(z.string()).optional(),
	env: z.record(z.string()).optional(),
	transport: z.enum(["stdio", "http"]).default("stdio"),
});

// ─── Tool schema ─────────────────────────────────────────────────────────────
const ToolSchema = z.object({
	name: z.string().regex(/^[a-z][a-z0-9_]*$/, "Tool names must be snake_case"),
	description: z.string().min(1).max(256),
	inputSchema: z.record(z.unknown()),
});

// ─── Full manifest schema ─────────────────────────────────────────────────────
export const SetraModuleManifestSchema = z.object({
	// Required identity fields
	slug: z
		.string()
		.regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens")
		.min(2)
		.max(64),
	name: z.string().min(1).max(64),
	version: z
		.string()
		.regex(/^\d+\.\d+\.\d+$/, "Version must follow semver (x.y.z)"),
	description: z.string().min(1).max(256),

	// Publisher
	publisher: z.string().min(1).max(64),
	license: z.string().min(1).max(64),
	homepage: z.string().url().optional(),
	repository: z.string().url().optional(),

	// Permissions
	permissions: z.array(SafePermissionSchema).default([]),
	dangerousPermissions: z.array(DangerousPermissionSchema).default([]),

	// Capabilities
	hooks: z.array(HookSchema).optional(),
	mcpServers: z.array(MCPServerSchema).optional(),
	tools: z.array(ToolSchema).optional(),

	// Runtime
	minSetraVersion: z
		.string()
		.regex(/^\d+\.\d+\.\d+$/, "Must follow semver")
		.optional(),
	main: z.string().default("index.js"),

	// Integrity
	artifactSha256: z
		.string()
		.regex(/^[0-9a-f]{64}$/, "Must be a hex-encoded SHA-256")
		.optional(),
	publisherSignature: z.string().optional(),
});

export type SetraModuleManifest = z.infer<typeof SetraModuleManifestSchema>;

// ─── Validation ───────────────────────────────────────────────────────────────

export interface ValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
}

export function validateManifest(raw: unknown): ValidationResult {
	const result = SetraModuleManifestSchema.safeParse(raw);
	const warnings: string[] = [];

	if (!result.success) {
		return {
			valid: false,
			errors: result.error.issues.map(
				(i) => `${i.path.join(".")}: ${i.message}`,
			),
			warnings,
		};
	}

	const manifest = result.data;

	// Warnings (non-fatal)
	if (!manifest.homepage) {
		warnings.push(
			"No homepage URL — users won't be able to find more info about your module",
		);
	}
	if (!manifest.repository) {
		warnings.push("No repository URL — consider open-sourcing your module");
	}
	if (manifest.dangerousPermissions.length > 0) {
		warnings.push(
			`Dangerous permissions requested: ${manifest.dangerousPermissions.join(", ")}. ` +
				"These require explicit org admin approval before installation.",
		);
	}
	if (!manifest.artifactSha256 || !manifest.publisherSignature) {
		warnings.push(
			"Module is unsigned. Sign it with `setra-dev publish` before submitting to the registry.",
		);
	}

	return { valid: true, errors: [], warnings };
}
