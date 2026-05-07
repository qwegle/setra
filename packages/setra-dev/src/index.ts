#!/usr/bin/env node
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { validateManifest } from "@setra/modules/manifest";
// packages/setra-dev/src/index.ts
// setra-dev CLI — local module development tool
//
// Commands:
//   setra-dev init              Initialize a new setra module
//   setra-dev validate          Validate setra.module.json against the manifest schema
//   setra-dev build             Bundle module to dist/index.js
//   setra-dev publish           Sign + publish to the setra module registry
//   setra-dev dev               Start local development server (hot reload)
import { Command } from "commander";

const program = new Command();

program
	.name("setra-dev")
	.description("setra module development CLI")
	.version("0.1.0");

// ─── init ─────────────────────────────────────────────────────────────────────
program
	.command("init")
	.description("Initialize a new setra module in the current directory")
	.option("-n, --name <name>", "Module name (e.g. my-module)")
	.option("--publisher <publisher>", "Publisher slug (e.g. acme)")
	.action(async (opts) => {
		const name =
			opts.name ??
			path
				.basename(process.cwd())
				.replace(/[^a-z0-9-]/gi, "-")
				.toLowerCase();
		const publisher = opts.publisher ?? "local";

		const manifest = {
			slug: name,
			name: toTitleCase(name),
			version: "0.1.0",
			description: `A setra module`,
			publisher,
			license: "MIT",
			permissions: [],
			dangerousPermissions: [],
			main: "dist/index.js",
		};

		await fs.writeFile(
			"setra.module.json",
			JSON.stringify(manifest, null, 2) + "\n",
		);

		await fs.writeFile(
			"src/index.ts",
			`// setra module: ${name}\n// Called when the agent invokes a hook or tool from this module\n\nexport function onInstall() {\n  setra.log("Module ${name} installed");\n}\n`,
		);

		await fs.writeFile(
			"package.json",
			JSON.stringify(
				{
					name: `@setra-module/${name}`,
					version: "0.1.0",
					private: true,
					main: "dist/index.js",
					scripts: {
						build: "setra-dev build",
						validate: "setra-dev validate",
						publish: "setra-dev publish",
					},
					devDependencies: {
						"@setra/dev": "latest",
					},
				},
				null,
				2,
			) + "\n",
		);

		console.log(`✅ Initialized setra module: ${name}`);
		console.log(
			`   Edit src/index.ts and setra.module.json, then run:\n   setra-dev build && setra-dev validate`,
		);
	});

// ─── validate ─────────────────────────────────────────────────────────────────
program
	.command("validate")
	.description("Validate setra.module.json")
	.option("-f, --file <path>", "Path to manifest file", "setra.module.json")
	.action(async (opts) => {
		let raw: unknown;
		try {
			const text = await fs.readFile(opts.file, "utf-8");
			raw = JSON.parse(text);
		} catch (err) {
			console.error(`❌ Cannot read ${opts.file}: ${(err as Error).message}`);
			process.exit(1);
		}

		const result = validateManifest(raw);

		if (result.errors.length > 0) {
			console.error("❌ Validation failed:");
			for (const err of result.errors) {
				console.error(`   • ${err}`);
			}
			process.exit(1);
		}

		if (result.warnings.length > 0) {
			console.warn("⚠️  Warnings:");
			for (const warn of result.warnings) {
				console.warn(`   • ${warn}`);
			}
		}

		console.log("✅ Manifest is valid");
	});

// ─── build ────────────────────────────────────────────────────────────────────
program
	.command("build")
	.description("Bundle module entry point with esbuild")
	.option("--minify", "Minify output", false)
	.action(async (opts) => {
		const esbuild = await import("esbuild");

		const manifest = await readManifest();
		const entry =
			manifest.main?.replace("dist/", "src/").replace(".js", ".ts") ??
			"src/index.ts";

		await esbuild.build({
			entryPoints: [entry],
			bundle: true,
			platform: "node",
			target: "node20",
			format: "cjs",
			outfile: manifest.main ?? "dist/index.js",
			minify: opts.minify,
			external: [], // bundle everything — module must be self-contained
		});

		console.log(`✅ Built ${manifest.main ?? "dist/index.js"}`);
	});

// ─── publish ──────────────────────────────────────────────────────────────────
program
	.command("publish")
	.description("Sign the module artifact and publish to the setra registry")
	.requiredOption(
		"--api-key <key>",
		"setra API key (sk_live_...)",
		process.env.SETRA_API_KEY,
	)
	.option(
		"--api-url <url>",
		"setra API URL",
		process.env.SETRA_API_URL ?? "https://api.setra.sh",
	)
	.option(
		"--private-key <path>",
		"Ed25519 private key PEM file",
		"./signing.pem",
	)
	.action(async (opts) => {
		const manifest = await readManifest();

		// 1. Hash the artifact
		const artifactPath = manifest.main ?? "dist/index.js";
		const code = await fs.readFile(artifactPath);
		const sha256 = crypto.createHash("sha256").update(code).digest("hex");

		// 2. Sign with Ed25519
		let signature: string;
		try {
			const privateKeyPem = await fs.readFile(opts.privateKey, "utf-8");
			const privateKey = crypto.createPrivateKey(privateKeyPem);
			const sig = crypto.sign(null, Buffer.from(sha256, "hex"), privateKey);
			signature = sig.toString("base64url");
		} catch (err) {
			console.error(`❌ Failed to sign artifact: ${(err as Error).message}`);
			console.error(
				"   Generate an Ed25519 key pair with: openssl genpkey -algorithm Ed25519 -out signing.pem",
			);
			process.exit(1);
		}

		// 3. Update manifest with integrity fields
		manifest.artifactSha256 = sha256;
		manifest.publisherSignature = signature;
		await fs.writeFile(
			"setra.module.json",
			JSON.stringify(manifest, null, 2) + "\n",
		);

		// 4. Upload to registry
		const formData = new FormData();
		formData.append("manifest", JSON.stringify(manifest));
		formData.append(
			"artifact",
			new Blob([code], { type: "application/javascript" }),
			"index.js",
		);

		const resp = await fetch(`${opts.apiUrl}/api/trpc/module.publish`, {
			method: "POST",
			headers: { Authorization: `Bearer ${opts.apiKey}` },
			body: formData,
		});

		if (!resp.ok) {
			console.error(`❌ Publish failed (${resp.status}): ${await resp.text()}`);
			process.exit(1);
		}

		console.log(`✅ Published ${manifest.slug}@${manifest.version}`);
	});

// ─── dev (hot reload) ─────────────────────────────────────────────────────────
program
	.command("dev")
	.description("Start local development server with hot reload")
	.action(async () => {
		const esbuild = await import("esbuild");
		const manifest = await readManifest();
		const entry =
			manifest.main?.replace("dist/", "src/").replace(".js", ".ts") ??
			"src/index.ts";

		const ctx = await esbuild.context({
			entryPoints: [entry],
			bundle: true,
			platform: "node",
			target: "node20",
			format: "cjs",
			outfile: manifest.main ?? "dist/index.js",
		});

		await ctx.watch();
		console.log(`👁 Watching ${entry} for changes…`);
		console.log(
			"   Install the module in setra desktop with the local:// protocol to test.",
		);
	});

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function readManifest() {
	const text = await fs.readFile("setra.module.json", "utf-8").catch(() => {
		console.error(
			"❌ setra.module.json not found. Run `setra-dev init` first.",
		);
		process.exit(1);
	});
	return JSON.parse(text);
}

function toTitleCase(str: string) {
	return str.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

program.parse();
