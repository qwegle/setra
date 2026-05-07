// packages/modules/src/registry.ts
// Module loader + sandboxed execution environment
//
// Loads setra modules from the local module installation directory,
// verifies Ed25519 signatures, and executes in a Node.js vm.SandboxContext
// with an allowlisted setra API surface.
//
// Security model:
//   1. Ed25519 signature over artifactSha256 is verified before any code runs
//   2. Modules run in vm.SandboxContext — no access to fs, process, or net
//   3. dangerousPermissions require explicit org admin approval at install time
//      (enforced by module.install tRPC procedure, stored in installations table)
//   4. The setra API injected into the sandbox is capability-based:
//      only approved scopes are exposed to the module
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vm from "node:vm";
import type { SetraModuleManifest } from "@setra/types";

// Canonical setra module registry public key (Ed25519)
// Modules signed by any other key are rejected unless SETRA_DEV_MODE=true
const REGISTRY_PUBLIC_KEY_HEX =
	process.env.SETRA_REGISTRY_PUBLIC_KEY ??
	"0000000000000000000000000000000000000000000000000000000000000000"; // replaced in build

export interface LoadedModule {
	manifest: SetraModuleManifest;
	exports: Record<string, unknown>;
	unload: () => void;
}

export interface ModuleAPI {
	/** Execute a shell command inside the agent's sandbox (requires execute permission) */
	run?: (
		cmd: string,
	) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
	/** Perform an HTTP request (requires network permission) */
	fetch?: (url: string, options?: RequestInit) => Promise<Response>;
	/** Read/write the plot's KV store */
	store?: {
		get: (key: string) => Promise<string | null>;
		set: (key: string, value: string) => Promise<void>;
		del: (key: string) => Promise<void>;
	};
	/** Emit structured output (always available) */
	emit: (event: string, data: unknown) => void;
	/** Log to the run's output stream (always available) */
	log: (message: string) => void;
}

export class ModuleRegistry {
	private readonly installDir: string;
	private readonly loaded = new Map<string, LoadedModule>();
	private readonly devMode: boolean;

	constructor(installDir: string) {
		this.installDir = installDir;
		this.devMode = process.env.SETRA_DEV_MODE === "true";
	}

	/**
	 * Load a module by its slug@version identifier.
	 * Verifies signature, creates sandbox, and returns the module's exports.
	 */
	async load(
		slug: string,
		version: string,
		api: ModuleAPI,
	): Promise<LoadedModule> {
		const cacheKey = `${slug}@${version}`;
		if (this.loaded.has(cacheKey)) {
			return this.loaded.get(cacheKey)!;
		}

		const moduleDir = path.join(this.installDir, slug, version);
		const manifestPath = path.join(moduleDir, "setra.module.json");
		const entryPath = path.join(moduleDir, "index.js");

		const [manifestJson, code] = await Promise.all([
			fs.readFile(manifestPath, "utf-8"),
			fs.readFile(entryPath, "utf-8"),
		]);

		const manifest: SetraModuleManifest = JSON.parse(manifestJson);

		// Verify Ed25519 signature over artifact SHA-256
		if (!this.devMode) {
			await this.verifySignature(manifest);
		}

		const exports = await this.execute(code, manifest, api);
		const loaded: LoadedModule = {
			manifest,
			exports,
			unload: () => this.loaded.delete(cacheKey),
		};

		this.loaded.set(cacheKey, loaded);
		return loaded;
	}

	private async verifySignature(manifest: SetraModuleManifest): Promise<void> {
		if (!manifest.publisherSignature || !manifest.artifactSha256) {
			throw new Error(
				`Module ${manifest.slug} is missing required signature fields`,
			);
		}

		const publicKeyBytes = Buffer.from(REGISTRY_PUBLIC_KEY_HEX, "hex");
		const publicKey = crypto.createPublicKey({
			key: publicKeyBytes,
			format: "der",
			type: "spki",
		});

		const signatureBytes = Buffer.from(
			manifest.publisherSignature,
			"base64url",
		);
		const messageBytes = Buffer.from(manifest.artifactSha256, "hex");

		const valid = crypto.verify(null, messageBytes, publicKey, signatureBytes);
		if (!valid) {
			throw new Error(
				`Module ${manifest.slug}@${manifest.version} has an invalid signature. ` +
					"This module may have been tampered with.",
			);
		}
	}

	private async execute(
		code: string,
		manifest: SetraModuleManifest,
		api: ModuleAPI,
	): Promise<Record<string, unknown>> {
		const exports: Record<string, unknown> = {};
		const module = { exports };

		// Build capability-scoped sandbox based on approved permissions
		const sandbox = this.buildSandbox(manifest, api, module, exports);

		const script = new vm.Script(code, {
			filename: `${manifest.slug}@${manifest.version}/index.js`,
			lineOffset: 0,
		});

		const context = vm.createContext(sandbox, {
			name: `setra-module:${manifest.slug}`,
			codeGeneration: {
				strings: false, // block eval()
				wasm: false, // block WebAssembly
			},
		});

		// 5-second synchronous execution budget
		script.runInContext(context, { timeout: 5_000 });

		return module.exports as Record<string, unknown>;
	}

	private buildSandbox(
		manifest: SetraModuleManifest,
		api: ModuleAPI,
		module: { exports: unknown },
		exports: Record<string, unknown>,
	): vm.Context {
		const permissions = new Set([
			...(manifest.permissions ?? []),
			...(manifest.dangerousPermissions ?? []),
		]);

		const sandbox: Record<string, unknown> = {
			module,
			exports,
			// Always available
			setra: {
				emit: api.emit,
				log: api.log,
				manifest: {
					slug: manifest.slug,
					version: manifest.version,
					name: manifest.name,
				},
			},
			console: {
				log: (...args: unknown[]) => api.log(args.map(String).join(" ")),
				error: (...args: unknown[]) =>
					api.log(`[error] ${args.map(String).join(" ")}`),
				warn: (...args: unknown[]) =>
					api.log(`[warn] ${args.map(String).join(" ")}`),
			},
			// Safe globals
			JSON,
			Math,
			Date,
			parseInt,
			parseFloat,
			isNaN,
			isFinite,
			encodeURIComponent,
			decodeURIComponent,
			setTimeout: undefined, // blocked — async not supported in sandbox
			setInterval: undefined,
			clearTimeout: undefined,
			clearInterval: undefined,
		};

		// Gated capabilities
		if (permissions.has("network:outbound") && api.fetch) {
			(sandbox.setra as Record<string, unknown>)["fetch"] = api.fetch;
		}

		if (permissions.has("shell:exec") && api.run) {
			(sandbox.setra as Record<string, unknown>)["run"] = api.run;
		}

		if (permissions.has("filesystem:workspace") && api.store) {
			(sandbox.setra as Record<string, unknown>)["store"] = api.store;
		}

		return sandbox;
	}

	/** Unload all modules (called on process shutdown) */
	unloadAll(): void {
		for (const mod of this.loaded.values()) {
			mod.unload();
		}
		this.loaded.clear();
	}
}
