/**
 * network-gate.ts — runtime network egress guard.
 *
 * Offline-mode is a hard no-network promise: a customer running in offline
 * mode (e.g. an air-gapped enterprise install) must not see any agent code
 * path quietly hit a cloud endpoint. The governance.ts check only blocks
 * MODEL SELECTION; this gate runs at the actual fetch() call site.
 *
 * "Localhost" is allow-listed because Ollama, custom OpenAI-compatible
 * endpoints, and the setra control-plane itself all run there.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export function assertEgressAllowed(
	url: string,
	mode: "online" | "offline",
): void {
	if (mode === "online") return;
	let host: string;
	try {
		host = new URL(url).hostname.toLowerCase();
	} catch {
		throw new Error(`assertEgressAllowed: invalid URL: ${url}`);
	}
	if (LOCAL_HOSTS.has(host)) return;
	if (host.endsWith(".local")) return;
	throw new Error(
		`Offline mode: network egress to "${host}" is blocked. ` +
			`Only localhost / *.local hosts are allowed.`,
	);
}
