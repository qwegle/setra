import { buildCommandRegistry } from "./registry.js";
import type { ResolvedCommand } from "./types.js";

export function resolveSlashCommand(
	text: string,
	cwd: string,
): ResolvedCommand {
	if (!text.startsWith("/")) return { handled: false };

	const withoutSlash = text.slice(1).trim();
	if (!withoutSlash) return { handled: false };

	const spaceIdx = withoutSlash.indexOf(" ");
	const commandName =
		spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx);
	const args = spaceIdx === -1 ? "" : withoutSlash.slice(spaceIdx + 1).trim();

	const registry = buildCommandRegistry(cwd);
	const entry = registry.find(
		(cmd) => cmd.name === commandName || cmd.aliases.includes(commandName),
	);

	if (!entry) return { handled: false };

	if (entry.action) {
		const resolved: ResolvedCommand = {
			handled: true,
			commandName: entry.name,
			action: {
				type: entry.action.type,
			},
		};
		if (entry.action.passArguments) {
			resolved.action = { type: entry.action.type, argument: args };
		}
		return resolved;
	}

	if (entry.template) {
		const prompt = entry.template.replace(/\$ARGUMENTS/g, args);
		return { handled: true, commandName: entry.name, prompt };
	}

	return { handled: true, commandName: entry.name };
}
