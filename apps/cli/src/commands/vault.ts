import chalk from "chalk";
import {
	deleteVaultEntryLocal,
	getServerBaseUrl,
	getVaultEntryLocal,
	isServerReachable,
	listVaultEntriesLocal,
	maskSecret,
	resolveProjectId,
	setVaultEntryLocal,
} from "./runtime-support.js";

export async function vaultListCommand(opts: {
	project?: string;
	reveal?: boolean;
}): Promise<void> {
	const projectId = await resolveProjectId(opts.project);
	const baseUrl = getServerBaseUrl();
	const entries = await ((await isServerReachable(baseUrl))
		? fetchVaultJson<Array<{ key: string; value: string; updatedAt: string }>>(
				buildVaultPath(projectId),
			)
		: listVaultEntriesLocal(projectId ?? undefined));

	if (entries.length === 0) {
		console.log(chalk.gray("No secrets found."));
		return;
	}

	console.log(chalk.bold("\n  setra vault\n"));
	console.log(
		chalk.gray(
			`${"KEY".padEnd(28)}${"SCOPE".padEnd(18)}${"VALUE".padEnd(18)}UPDATED`,
		),
	);
	for (const entry of entries) {
		const scope = projectId ? `project:${projectId}` : "company";
		const value = opts.reveal ? entry.value : maskSecret(entry.value);
		console.log(
			`${chalk.cyan(entry.key.padEnd(28))}${scope.padEnd(18)}${value.padEnd(18)}${chalk.gray(entry.updatedAt.slice(0, 19).replace("T", " "))}`,
		);
	}
	console.log();
}

export async function vaultSetCommand(
	key: string,
	value: string,
	opts: { project?: string },
): Promise<void> {
	const projectId = await resolveProjectId(opts.project);
	const baseUrl = getServerBaseUrl();
	if (await isServerReachable(baseUrl)) {
		await fetchVaultJson(buildVaultPath(projectId), {
			method: "POST",
			body: JSON.stringify({ key, value }),
		});
	} else {
		await setVaultEntryLocal(key, value, projectId ?? undefined);
	}
	console.log(chalk.green(`Stored secret ${key}`));
}

export async function vaultGetCommand(
	key: string,
	opts: { project?: string; reveal?: boolean },
): Promise<void> {
	const projectId = await resolveProjectId(opts.project);
	const baseUrl = getServerBaseUrl();
	const entry = await ((await isServerReachable(baseUrl))
		? fetchVaultJson<{ key: string; value: string; updatedAt: string } | null>(
				`${buildVaultPath(projectId)}/${encodeURIComponent(key)}`,
			)
		: getVaultEntryLocal(key, projectId ?? undefined));

	if (!entry) {
		console.error(chalk.red(`Secret not found: ${key}`));
		process.exit(1);
	}

	const value = opts.reveal ? entry.value : maskSecret(entry.value);
	console.log(`${chalk.cyan(key)} = ${value}`);
}

export async function vaultDeleteCommand(
	key: string,
	opts: { project?: string },
): Promise<void> {
	const projectId = await resolveProjectId(opts.project);
	const baseUrl = getServerBaseUrl();
	let deleted = false;
	if (await isServerReachable(baseUrl)) {
		const result = await fetchVaultJson<{ deleted: boolean }>(
			`${buildVaultPath(projectId)}/${encodeURIComponent(key)}`,
			{ method: "DELETE" },
		);
		deleted = result.deleted;
	} else {
		deleted = await deleteVaultEntryLocal(key, projectId ?? undefined);
	}
	if (!deleted) {
		console.error(chalk.red(`Secret not found: ${key}`));
		process.exit(1);
	}
	console.log(chalk.green(`Deleted secret ${key}`));
}

function buildVaultPath(projectId: string | null): string {
	return projectId ? `/api/projects/${projectId}/vault` : "/api/vault";
}

async function fetchVaultJson<T>(path: string, init?: RequestInit): Promise<T> {
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
