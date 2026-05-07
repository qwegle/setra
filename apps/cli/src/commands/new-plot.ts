import { getDb, getRawDb, schema } from "@setra/db";
import chalk from "chalk";

interface NewPlotOptions {
	name: string;
	agent: string;
	description?: string;
}

export async function newPlotCommand(opts: NewPlotOptions): Promise<void> {
	let db;
	try {
		db = getDb();
	} catch {
		console.error(chalk.red("No setra database. Run: setra init"));
		process.exit(1);
	}

	const id = crypto.randomUUID();
	const branch = `setra/plot-${id}`;
	const now = new Date().toISOString();

	// Try to find the active project from cwd — check board_projects first (raw SQL to get all columns), then legacy
	const cwd = process.cwd();
	const rawDb = getRawDb();
	const boardProjs = rawDb
		.prepare(
			"SELECT id, repo_path AS repoPath, workspace_path AS workspacePath FROM board_projects",
		)
		.all() as Array<{
		id: string;
		repoPath: string | null;
		workspacePath: string | null;
	}>;
	const legacyProjects = db.select().from(schema.projects).all();
	const allProjects = [
		...boardProjs.map((p) => ({
			id: p.id,
			repoPath: p.repoPath ?? p.workspacePath,
		})),
		...legacyProjects.map((p) => ({ id: p.id, repoPath: p.repoPath })),
	];
	const project = allProjects.find(
		(p) => p.repoPath && cwd.toLowerCase().startsWith(p.repoPath.toLowerCase()),
	);

	if (!project) {
		console.error(chalk.red("No setra project found for this directory."));
		console.error(
			chalk.gray(
				"Add this repo in the setra desktop app or create a project first.",
			),
		);
		process.exit(1);
	}

	// Ensure a legacy `projects` row exists for this project (needed for FK on plots table).
	// If the match came from board_projects, upsert a mirrored entry.
	const legacyExists = legacyProjects.find((p) => p.id === project.id);
	if (!legacyExists) {
		const boardRow = rawDb
			.prepare(
				"SELECT name, repo_path, default_branch FROM board_projects WHERE id = ?",
			)
			.get(project.id) as
			| {
					name: string;
					repo_path: string | null;
					default_branch: string | null;
			  }
			| undefined;
		rawDb
			.prepare(
				`INSERT OR IGNORE INTO projects (id, name, repo_path, default_branch, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			)
			.run(
				project.id,
				boardRow?.name ?? "project",
				project.repoPath ?? "",
				boardRow?.default_branch ?? "main",
				now,
				now,
			);
	}

	const resolvedBaseBranch = (() => {
		const lp = db
			.select()
			.from(schema.projects)
			.all()
			.find((p) => p.id === project.id);
		return lp?.defaultBranch ?? "main";
	})();

	db.insert(schema.plots)
		.values({
			id,
			name: opts.name,
			projectId: project.id,
			branch,
			baseBranch: resolvedBaseBranch,
			description: opts.description ?? null,
			agentTemplate: JSON.stringify({ name: opts.agent, agent: opts.agent }),
			createdAt: now,
			updatedAt: now,
		})
		.run();

	console.log(chalk.green(`✓ Plot created: ${opts.name}`));
	console.log(chalk.gray(`  id:     ${id}`));
	console.log(chalk.gray(`  branch: ${branch}`));
	console.log();
	console.log(`Start a run: ${chalk.cyan(`setra run --plot ${id}`)}`);
}
