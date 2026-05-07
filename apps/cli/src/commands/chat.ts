import readline from "node:readline";
import chalk from "chalk";
import {
	buildChatResponse,
	getServerBaseUrl,
	isServerReachable,
	resolveProjectId,
} from "./runtime-support.js";

export async function chatCommand(opts: {
	agent: string;
	project?: string;
}): Promise<void> {
	const projectId = await resolveProjectId(opts.project);
	if (!projectId) {
		console.error(chalk.red("No active project found."));
		return;
	}

	const baseUrl = getServerBaseUrl();
	if (!(await isServerReachable(baseUrl))) {
		console.error(chalk.red(`setra server is not running at ${baseUrl}`));
		console.error(chalk.gray("Start it with: setra serve"));
		return;
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: chalk.cyan(`${opts.agent}> `),
	});

	console.log(chalk.bold("Interactive agent chat"));
	console.log(chalk.gray(`project: ${projectId}`));
	console.log(chalk.gray("Type exit or press Ctrl+C to quit.\n"));
	const cleanup = () => {
		rl.close();
		process.stdout.write("\n");
		process.exit(0);
	};
	process.once("SIGINT", cleanup);
	process.once("SIGTERM", cleanup);

	rl.prompt();
	for await (const input of rl) {
		const message = input.trim();
		if (!message) {
			rl.prompt();
			continue;
		}
		if (message.toLowerCase() === "exit") break;

		process.stdout.write(chalk.green("\nassistant\n"));
		try {
			const response = await fetch(
				new URL(`/api/projects/${projectId}/chat`, baseUrl),
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						message,
						agentSlug: opts.agent,
					}),
				},
			);
			if (!response.ok || !response.body) {
				throw new Error(await safeReadText(response));
			}
			await streamChatBody(response.body);
		} catch (error) {
			const fallback = buildChatResponse({
				projectId,
				agentSlug: opts.agent,
				message,
			});
			for (const line of fallback.split("\n")) {
				console.log(formatMarkdownLine(line));
			}
			console.log(chalk.yellow(`\n(server error: ${formatError(error)})`));
		}
		console.log();
		rl.prompt();
	}

	process.off("SIGINT", cleanup);
	process.off("SIGTERM", cleanup);
	rl.close();
}

async function streamChatBody(
	stream: ReadableStream<Uint8Array>,
): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split(/\r?\n/);
		buffer = lines.pop() ?? "";
		for (const line of lines) {
			console.log(formatMarkdownLine(line));
		}
	}
	const finalText = buffer.trim();
	if (finalText) console.log(formatMarkdownLine(finalText));
}

function formatMarkdownLine(line: string): string {
	if (!line.trim()) return "";
	if (line.startsWith("## ")) return chalk.cyan.bold(line.slice(3));
	if (line.startsWith("# ")) return chalk.blue.bold(line.slice(2));
	if (line.startsWith("- ")) return `${chalk.gray("•")} ${line.slice(2)}`;
	return line.replace(/\*\*(.+?)\*\*/g, (_, text: string) => chalk.bold(text));
}

async function safeReadText(response: Response): Promise<string> {
	try {
		return (
			(await response.text()) || `${response.status} ${response.statusText}`
		);
	} catch {
		return `${response.status} ${response.statusText}`;
	}
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
