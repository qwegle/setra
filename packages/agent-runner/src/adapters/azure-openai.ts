/**
 * AzureOpenAIAdapter — GPT-4o, o1, o3 models via Azure OpenAI Service.
 *
 * Azure OpenAI is Microsoft's managed deployment of OpenAI models. Benefits:
 *   - Data residency — process in your Azure region (eastus, westeurope, etc.)
 *   - Microsoft Enterprise Agreement (EA) billing
 *   - Private endpoints — traffic stays in your Azure VNet
 *   - Content filtering and abuse monitoring (required in some gov contracts)
 *   - SOC2, ISO27001, HIPAA, FedRAMP (US govt) compliance
 *   - Active Directory / Entra ID auth (Managed Identity — no keys needed)
 *
 * Auth (in priority order):
 *   1. Azure Managed Identity on Azure VMs/AKS (zero config)
 *   2. AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT env vars
 *
 * Required env vars:
 *   AZURE_OPENAI_API_KEY    — your Azure OpenAI resource key
 *   AZURE_OPENAI_ENDPOINT   — e.g. "https://mycompany.openai.azure.com/"
 *   AZURE_OPENAI_API_VERSION — e.g. "2025-01-01-preview" (default)
 *
 * IMPORTANT — Deployment names:
 *   Azure requires you to "deploy" a model with a custom name in the portal.
 *   setra uses the model ID as the deployment name by convention, but users
 *   can override in Settings → Providers → Azure → Deployment Names.
 *
 *   Default mapping:
 *     "azure/gpt-4o"        → deployment "gpt-4o"
 *     "azure/gpt-4o-mini"   → deployment "gpt-4o-mini"
 *     "azure/o1"            → deployment "o1"
 *     "azure/o3-mini"       → deployment "o3-mini"
 */

import type { AgentAdapter } from "../adapter.js";
import type { Plot, Run, SpawnOptions, TokenUsage } from "../types.js";

const AZURE_RATE_LIMIT_PATTERNS: readonly RegExp[] = [
	/RateLimitReached/i,
	/requests_per_minute/i,
	/tokens_per_minute/i,
	/rate[\s_-]?limit/i,
	/\b429\b/,
	/quota[\s_]?exceeded/i,
	/DeploymentNotFound/i, // misconfigured deployment — show clear error
] as const;

const DEFAULT_API_VERSION = "2025-01-01-preview";

export class AzureOpenAIAdapter implements AgentAdapter {
	readonly name = "azure-openai" as const;
	readonly displayName = "Azure OpenAI";
	readonly supportsModels = [
		"azure/gpt-4o",
		"azure/gpt-4o-mini",
		"azure/o1",
		"azure/o3-mini",
		"azure/gpt-4-turbo",
	] as const;
	readonly defaultModel = "azure/gpt-4o";

	async isAvailable(): Promise<boolean> {
		const hasKey = !!process.env["AZURE_OPENAI_API_KEY"];
		const hasEndpoint = !!process.env["AZURE_OPENAI_ENDPOINT"];

		// Try Managed Identity (Azure-hosted machines)
		if (!hasKey && !hasEndpoint) {
			try {
				const res = await fetch(
					"http://169.254.169.254/metadata/identity/oauth2/token?api-version=2018-02-01&resource=https://cognitiveservices.azure.com/",
					{
						headers: { Metadata: "true" },
						signal: AbortSignal.timeout(500),
					},
				);
				return res.ok;
			} catch {
				return false;
			}
		}

		return hasKey && hasEndpoint;
	}

	buildCommand(plot: Plot, run: Run, _mcpConfigPath: string): SpawnOptions {
		const model = this.resolveModel(run.model);
		const endpoint = process.env["AZURE_OPENAI_ENDPOINT"] ?? "";
		const apiVersion =
			process.env["AZURE_OPENAI_API_VERSION"] ?? DEFAULT_API_VERSION;
		// Strip "azure/" prefix to get the deployment name
		const deployment = model.startsWith("azure/") ? model.slice(6) : model;

		return {
			cmd: "__api__",
			args: [this.name, model, run.task],
			env: {
				SETRA_PLOT_ID: plot.id,
				SETRA_RUN_ID: run.id,
				SETRA_AGENT: this.name,
				SETRA_MODEL: model,
				SETRA_AZURE_ENDPOINT: endpoint,
				SETRA_AZURE_API_VERSION: apiVersion,
				SETRA_AZURE_DEPLOYMENT: deployment,
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
		return AZURE_RATE_LIMIT_PATTERNS.some((p) => p.test(output));
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

export const azureOpenAIAdapter = new AzureOpenAIAdapter();
