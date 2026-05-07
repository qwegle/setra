/**
 * GcpVertexAdapter — Gemini and Claude models via Google Cloud Vertex AI.
 *
 * Vertex AI is Google's enterprise AI platform. Unlike the Gemini Developer API,
 * Vertex AI gives you:
 *   - Data residency (us-central1, europe-west4, asia-south1 for India, etc.)
 *   - VPC Service Controls — no data leaves your VPC
 *   - IAM roles + Workload Identity Federation
 *   - GCP billing (committed use discounts, existing GCP credits)
 *   - Claude models via Model Garden (same Claude, GCP billing + residency)
 *   - SLA-backed uptime
 *
 * Auth (in priority order):
 *   1. Workload Identity Federation on GKE/Cloud Run (zero config)
 *   2. GOOGLE_APPLICATION_CREDENTIALS → path to service account JSON
 *   3. `gcloud auth application-default login` (dev machines)
 *
 * Required env vars:
 *   GCP_PROJECT_ID          — your GCP project e.g. "my-company-prod"
 *   GCP_REGION              — e.g. "us-central1" or "asia-south1" (India)
 *   GOOGLE_APPLICATION_CREDENTIALS — path to service account key JSON
 *
 * Model format on Vertex:
 *   Gemini:  gemini-2.5-pro  (same name as AI Studio)
 *   Claude:  claude-sonnet-4@20251022  (Model Garden versioned names)
 *
 * Endpoint pattern:
 *   https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/publishers/google/models/{model}:streamGenerateContent
 */

import type { AgentAdapter } from "../adapter.js";
import type { Plot, Run, SpawnOptions, TokenUsage } from "../types.js";

const VERTEX_RATE_LIMIT_PATTERNS: readonly RegExp[] = [
	/RESOURCE_EXHAUSTED/i,
	/quota[\s_]?exceeded/i,
	/rate[\s_-]?limit/i,
	/\b429\b/,
	/\b503\b/,
	/too[\s_]many[\s_]requests/i,
] as const;

export class GcpVertexAdapter implements AgentAdapter {
	readonly name = "gcp-vertex" as const;
	readonly displayName = "GCP Vertex AI";
	readonly supportsModels = [
		"gemini-2.5-pro",
		"gemini-2.0-flash",
		"gemini-2.0-flash-lite",
		"claude-sonnet-4@20251022",
		"code-gecko@002",
	] as const;
	readonly defaultModel = "gemini-2.5-pro";

	async isAvailable(): Promise<boolean> {
		const hasProject = !!process.env["GCP_PROJECT_ID"];
		const hasCreds = !!process.env["GOOGLE_APPLICATION_CREDENTIALS"];

		// Check Workload Identity on GKE
		if (!hasCreds && hasProject) {
			try {
				const res = await fetch(
					"http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
					{
						headers: { "Metadata-Flavor": "Google" },
						signal: AbortSignal.timeout(500),
					},
				);
				return res.ok;
			} catch {
				return false;
			}
		}

		return hasProject && hasCreds;
	}

	buildCommand(plot: Plot, run: Run, _mcpConfigPath: string): SpawnOptions {
		const model = this.resolveModel(run.model);
		const project = process.env["GCP_PROJECT_ID"] ?? "";
		const region = process.env["GCP_REGION"] ?? "us-central1";

		return {
			cmd: "__api__",
			args: [this.name, model, run.task],
			env: {
				SETRA_PLOT_ID: plot.id,
				SETRA_RUN_ID: run.id,
				SETRA_AGENT: this.name,
				SETRA_MODEL: model,
				SETRA_GCP_PROJECT: project,
				SETRA_GCP_REGION: region,
			},
			cwd: plot.worktreePath,
		};
	}

	buildSystemPromptArgs(_systemPrompt: string): string[] {
		return [];
	}

	buildMcpArgs(_mcpConfigPath: string): string[] {
		return [];
	}

	parseTokenUsage(output: string): TokenUsage | null {
		const match = output.match(
			/__usage__\s+prompt=(\d+)\s+completion=(\d+)(?:\s+cache_read=(\d+))?(?:\s+cache_write=(\d+))?/,
		);
		if (!match) return null;
		return {
			promptTokens: Number.parseInt(match[1] ?? "0", 10),
			completionTokens: Number.parseInt(match[2] ?? "0", 10),
			cacheReadTokens: Number.parseInt(match[3] ?? "0", 10),
			cacheWriteTokens: Number.parseInt(match[4] ?? "0", 10),
		};
	}

	detectRateLimit(output: string): boolean {
		return VERTEX_RATE_LIMIT_PATTERNS.some((p) => p.test(output));
	}

	parseCostUSD(_output: string): number | null {
		return null;
	}

	detectCompletion(output: string): boolean {
		return /\bTask complete\b|\bDone\b|__done__|\[DONE\]/.test(output);
	}

	private resolveModel(requested: string | null | undefined): string {
		if (!requested || requested === "auto") return this.defaultModel;
		if (
			this.supportsModels.includes(
				requested as (typeof this.supportsModels)[number],
			)
		) {
			return requested;
		}
		return this.defaultModel;
	}
}

export const gcpVertexAdapter = new GcpVertexAdapter();
