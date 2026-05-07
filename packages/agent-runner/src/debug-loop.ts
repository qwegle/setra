import { execSync } from "node:child_process";

export interface DebugLoopOptions {
	command: string;
	maxIterations: number;
	projectRoot: string;
	onIteration?: (iteration: number, output: string, success: boolean) => void;
	onFix?: (iteration: number, description: string) => void;
}

export interface DebugLoopResult {
	success: boolean;
	iterations: number;
	finalOutput: string;
	fixes: string[];
}

export async function runDebugLoop(
	options: DebugLoopOptions,
	agentInvoke: (errorOutput: string, iteration: number) => Promise<string>,
): Promise<DebugLoopResult> {
	const { command, maxIterations, projectRoot, onIteration, onFix } = options;
	const fixes: string[] = [];
	let lastOutput = "";

	for (let iteration = 1; iteration <= maxIterations; iteration++) {
		let output: string;
		let success: boolean;

		try {
			output = execSync(command, {
				cwd: projectRoot,
				encoding: "utf-8",
				timeout: 120_000,
				stdio: ["pipe", "pipe", "pipe"],
			});
			success = true;
		} catch (error: unknown) {
			const execError = error as {
				stdout?: string | Buffer;
				stderr?: string | Buffer;
			};
			output =
				`${toUtf8(execError.stdout)}\n${toUtf8(execError.stderr)}`.trim();
			success = false;
		}

		lastOutput = output;
		onIteration?.(iteration, output, success);

		if (success) {
			return {
				success: true,
				iterations: iteration,
				finalOutput: output,
				fixes,
			};
		}

		const fixDescription = await agentInvoke(output, iteration);
		fixes.push(fixDescription);
		onFix?.(iteration, fixDescription);
	}

	return {
		success: false,
		iterations: maxIterations,
		finalOutput: lastOutput,
		fixes,
	};
}

function toUtf8(value: string | Buffer | undefined): string {
	if (typeof value === "string") {
		return value;
	}
	if (value instanceof Buffer) {
		return value.toString("utf-8");
	}
	return "";
}
