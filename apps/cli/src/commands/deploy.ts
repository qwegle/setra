import chalk from "chalk";
import ora from "ora";
import {
	type DeploymentStatus,
	getDeploymentStatusLocal,
	getServerBaseUrl,
	isServerReachable,
	resolveProjectId,
	startDeploymentLocal,
} from "./runtime-support.js";

export async function deployCommand(opts: {
	env: string;
	project?: string;
}): Promise<void> {
	const projectId = await resolveProjectId(opts.project);
	if (!projectId) {
		console.error(chalk.red("No active project found."));
		process.exit(1);
	}

	const baseUrl = getServerBaseUrl();
	const spinner = ora(`Deploying ${projectId} to ${opts.env}...`).start();
	let deployment = await ((await isServerReachable(baseUrl))
		? fetchDeployJson<DeploymentStatus>(`/api/projects/${projectId}/deploy`, {
				method: "POST",
				body: JSON.stringify({ env: opts.env }),
			})
		: startDeploymentLocal({ projectId, environment: opts.env }));

	while (deployment.status === "running") {
		spinner.text = `Deploying ${projectId} · ${deployment.currentStage}`;
		await sleep(1_000);
		deployment = await ((await isServerReachable(baseUrl))
			? fetchDeployJson<DeploymentStatus>(`/api/deploy/${deployment.id}`)
			: getDeploymentStatusLocal(deployment.id));
	}

	spinner.succeed(`Deployment finished (${deployment.environment})`);
	if (deployment.url) {
		console.log(chalk.green(`URL: ${deployment.url}`));
	}
}

async function fetchDeployJson<T>(
	path: string,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(new URL(path, getServerBaseUrl()), {
		...init,
		headers: {
			"Content-Type": "application/json",
			...(init?.headers ?? {}),
		},
	});
	if (!response.ok) {
		throw new Error((await response.text()) || response.statusText);
	}
	return (await response.json()) as T;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
