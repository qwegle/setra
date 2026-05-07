import fs from "fs";
import os from "os";
import path from "path";
import readline from "readline";
import { COMPANY_TEMPLATES, getTemplate } from "@setra/company";
import type { CompanyTemplate } from "@setra/company";
import chalk from "chalk";

const COMPANIES_DIR = path.join(os.homedir(), ".setra", "companies");

function ensureDir(dir: string) {
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
	return new Promise((resolve) => rl.question(question, resolve));
}

export async function runCompanyNew(): Promise<void> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	try {
		process.stdout.write("\n  ✦ setra Company Wizard\n\n");

		const nameRaw = await ask(rl, "  ? Company name [my-company]: ");
		const name = nameRaw.trim() || "my-company";

		process.stdout.write("\n  Available templates:\n\n");
		COMPANY_TEMPLATES.forEach((t, i) => {
			process.stdout.write(
				`  ${chalk.bold(String(i + 1))}. ${chalk.cyan(t.name)} — ${t.members.length} agents · $${t.totalCostBudgetUsd} budget\n` +
					`     ${chalk.dim(t.description)}\n\n`,
			);
		});

		const templateIndexRaw = await ask(rl, "  ? Select a template [1]: ");
		const templateIndex =
			(Number.parseInt(templateIndexRaw.trim(), 10) || 1) - 1;
		const selectedTemplate: CompanyTemplate =
			COMPANY_TEMPLATES[templateIndex] ?? COMPANY_TEMPLATES[0]!;

		const budgetRaw = await ask(
			rl,
			`  ? Total cost budget ($) [${selectedTemplate.totalCostBudgetUsd}]: `,
		);
		const totalCostBudgetUsd =
			Number.parseFloat(budgetRaw.trim()) ||
			selectedTemplate.totalCostBudgetUsd;

		const modelOverrideRaw = await ask(
			rl,
			"  ? Lead agent model override? [auto]: ",
		);
		const modelOverride = modelOverrideRaw.trim() || "auto";

		const members =
			modelOverride !== "auto"
				? selectedTemplate.members.map((m) =>
						m.slug === selectedTemplate.leadSlug
							? { ...m, model: modelOverride }
							: m,
					)
				: selectedTemplate.members;

		const company = {
			name,
			template: selectedTemplate.id,
			members,
			totalCostBudgetUsd,
			leadSlug: selectedTemplate.leadSlug,
			preSeededSkills: selectedTemplate.preSeededSkills,
			createdAt: new Date().toISOString(),
		};

		ensureDir(COMPANIES_DIR);
		const filePath = path.join(COMPANIES_DIR, `${name}.json`);
		fs.writeFileSync(filePath, JSON.stringify(company, null, 2));

		process.stdout.write(
			"\n  " + chalk.green("✓") + ` Company "${name}" created!\n\n`,
		);
		process.stdout.write("  Members:\n");
		members.forEach((m) => {
			process.stdout.write(
				`    • ${chalk.cyan(m.name)} (${m.role}) — ${m.model}\n`,
			);
		});
		process.stdout.write("\n  " + chalk.dim(`Saved to: ${filePath}`) + "\n");
		process.stdout.write(
			"\n  Run it: " +
				chalk.bold(`setra company run --name ${name} --task "..."`) +
				"\n\n",
		);
	} finally {
		rl.close();
	}
}

export async function runCompanyList(): Promise<void> {
	if (!fs.existsSync(COMPANIES_DIR)) {
		process.stdout.write("  No companies saved yet. Run: setra company new\n");
		return;
	}

	const files = fs
		.readdirSync(COMPANIES_DIR)
		.filter((f) => f.endsWith(".json"));
	if (files.length === 0) {
		process.stdout.write("  No companies saved yet. Run: setra company new\n");
		return;
	}

	process.stdout.write("\n  " + chalk.bold("Saved Companies") + "\n\n");
	process.stdout.write(
		"  " +
			chalk.dim(
				"Name".padEnd(24) +
					"Template".padEnd(20) +
					"Members".padEnd(10) +
					"Budget".padEnd(10) +
					"Created",
			) +
			"\n",
	);
	process.stdout.write("  " + chalk.dim("─".repeat(80)) + "\n");

	for (const file of files) {
		try {
			const data = JSON.parse(
				fs.readFileSync(path.join(COMPANIES_DIR, file), "utf8"),
			) as Record<string, unknown>;
			const name = String(data["name"] ?? "");
			const template = String(data["template"] ?? "");
			const members = Array.isArray(data["members"])
				? data["members"].length
				: 0;
			const budget =
				typeof data["totalCostBudgetUsd"] === "number"
					? `$${data["totalCostBudgetUsd"]}`
					: "";
			const created = data["createdAt"]
				? new Date(String(data["createdAt"])).toLocaleDateString()
				: "";
			process.stdout.write(
				"  " +
					chalk.cyan(name.padEnd(24)) +
					template.padEnd(20) +
					String(members).padEnd(10) +
					budget.padEnd(10) +
					created +
					"\n",
			);
		} catch {
			// skip malformed files
		}
	}
	process.stdout.write("\n");
}

export async function runCompanyTemplates(): Promise<void> {
	process.stdout.write("\n  " + chalk.bold("Company Templates") + "\n\n");

	for (const t of COMPANY_TEMPLATES) {
		const icon = categoryIcon(t.category);
		process.stdout.write(
			`  ${icon} ${chalk.bold.cyan(t.name)} ${chalk.dim(`[${t.id}]`)}\n` +
				`     ${t.description}\n` +
				`     ${chalk.dim(`Category: ${t.category} · ${t.members.length} agents · $${t.totalCostBudgetUsd} budget`)}\n` +
				`     Tags: ${t.tags.map((tag) => chalk.dim(tag)).join(", ")}\n`,
		);
		if (t.preSeededSkills.length > 0) {
			process.stdout.write(
				`     Pre-seeded skills: ${t.preSeededSkills.map((s) => chalk.yellow(s.name)).join(", ")}\n`,
			);
		}
		process.stdout.write("\n");
	}
}

export async function runCompanyRun(opts: {
	name: string;
	task: string;
}): Promise<void> {
	const filePath = path.join(COMPANIES_DIR, `${opts.name}.json`);
	if (!fs.existsSync(filePath)) {
		process.stderr.write(
			chalk.red(`  ✗ Company "${opts.name}" not found at ${filePath}\n`) +
				`  Run: setra company list\n`,
		);
		process.exit(1);
	}

	const company = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
		string,
		unknown
	>;

	process.stdout.write("\n  " + chalk.bold(`Company: ${opts.name}`) + "\n");
	process.stdout.write(`  Template: ${company["template"]}\n`);
	const members = Array.isArray(company["members"]) ? company["members"] : [];
	process.stdout.write(`  Members: ${members.length}\n`);
	process.stdout.write(`  Task: ${chalk.cyan(opts.task)}\n\n`);
	process.stdout.write(
		`  To run this company, use:\n` +
			`    ${chalk.bold(`setra team run -- ~/.setra/companies/${opts.name}.json`)}\n\n`,
	);
}

function categoryIcon(category: CompanyTemplate["category"]): string {
	const icons: Record<string, string> = {
		engineering: "⚙️",
		gtm: "💰",
		governance: "🏛️",
		support: "🎧",
		research: "🔬",
		custom: "🎨",
	};
	return icons[category] ?? "📋";
}
