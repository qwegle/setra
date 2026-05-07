/**
 * AwsBedrockAdapter — Claude, Llama, Nova via AWS Bedrock.
 *
 * AWS Bedrock is Amazon's managed AI service. It gives access to foundation
 * models (Claude, Llama, Titan, Nova) via standard AWS credentials.
 *
 * Why use Bedrock vs direct Anthropic API?
 *   - Data stays in your AWS region (eu-west-1, ap-south-1, etc.)
 *   - Billed through AWS — single invoice, existing EA/credits
 *   - SOC2, HIPAA, ISO27001 compliance via AWS
 *   - IAM roles (no API keys on EC2/ECS/Lambda)
 *   - AWS PrivateLink — traffic never leaves your VPC
 *
 * Auth (in priority order):
 *   1. IAM instance role (on EC2/ECS — zero config)
 *   2. AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION env vars
 *   3. ~/.aws/credentials profile
 *
 * Required env vars:
 *   AWS_REGION          — e.g. "us-east-1" or "ap-south-1" (Odisha/India → ap-south-1)
 *   AWS_ACCESS_KEY_ID   — IAM access key (or use instance role)
 *   AWS_SECRET_ACCESS_KEY
 *   BEDROCK_ENDPOINT    — optional; override for PrivateLink/VPC endpoint
 *
 * Model ID format:  anthropic.claude-sonnet-4-5  /  meta.llama3-3-70b-instruct-v1
 * API:  POST https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/invoke-with-response-stream
 */

import type { AgentAdapter } from "../adapter.js";
import type { Plot, Run, SpawnOptions, TokenUsage } from "../types.js";

const BEDROCK_RATE_LIMIT_PATTERNS: readonly RegExp[] = [
	/ThrottlingException/i,
	/ServiceQuotaExceededException/i,
	/TooManyRequestsException/i,
	/rate[\s_-]?limit/i,
	/\b429\b/,
	/capacity/i,
] as const;

export class AwsBedrockAdapter implements AgentAdapter {
	readonly name = "aws-bedrock" as const;
	readonly displayName = "AWS Bedrock";
	readonly supportsModels = [
		"anthropic.claude-opus-4",
		"anthropic.claude-sonnet-4-5",
		"anthropic.claude-haiku-4",
		"meta.llama3-3-70b-instruct-v1",
		"meta.llama3-1-8b-instruct-v1",
		"amazon.nova-pro-v1",
		"amazon.nova-lite-v1",
	] as const;
	readonly defaultModel = "anthropic.claude-sonnet-4-5";

	async isAvailable(): Promise<boolean> {
		// Available if: (access key set OR IAM role detectable) AND region set
		const hasKey = !!process.env["AWS_ACCESS_KEY_ID"];
		const hasRegion = !!process.env["AWS_REGION"];

		// Try detecting IAM instance role via IMDS
		if (!hasKey && hasRegion) {
			try {
				const res = await fetch(
					"http://169.254.169.254/latest/meta-data/iam/security-credentials/",
					{ signal: AbortSignal.timeout(500) },
				);
				return res.ok;
			} catch {
				return false;
			}
		}

		return hasKey && hasRegion;
	}

	buildCommand(plot: Plot, run: Run, _mcpConfigPath: string): SpawnOptions {
		const model = this.resolveModel(run.model);
		const region = process.env["AWS_REGION"] ?? "us-east-1";
		const endpoint =
			process.env["BEDROCK_ENDPOINT"] ??
			`https://bedrock-runtime.${region}.amazonaws.com`;

		return {
			cmd: "__api__",
			args: [this.name, model, run.task],
			env: {
				SETRA_PLOT_ID: plot.id,
				SETRA_RUN_ID: run.id,
				SETRA_AGENT: this.name,
				SETRA_MODEL: model,
				SETRA_BEDROCK_ENDPOINT: endpoint,
				SETRA_AWS_REGION: region,
			},
			cwd: plot.worktreePath,
		};
	}

	buildSystemPromptArgs(_systemPrompt: string): string[] {
		return []; // API adapter — system prompt set in request body
	}

	buildMcpArgs(_mcpConfigPath: string): string[] {
		return [];
	}

	parseTokenUsage(output: string): TokenUsage | null {
		// Bedrock response includes usage in the final chunk:
		// "__usage__ prompt=1000 completion=234 cache_read=0 cache_write=0"
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
		return BEDROCK_RATE_LIMIT_PATTERNS.some((p) => p.test(output));
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

export const awsBedrockAdapter = new AwsBedrockAdapter();
