/**
 * Sentinel — MITRE ATT&CK technique registry and finding tagger.
 * Local lookup table of 25 techniques — no external API required.
 * All descriptions written in setra's voice.
 */

import type { Finding, MitreAttack } from "./types.js";

// ─────────────────────────────────────────────────────────────────────────────
// Technique registry
// ─────────────────────────────────────────────────────────────────────────────

export const MITRE_TECHNIQUES: Record<string, MitreAttack> = {
	T1595: {
		techniqueId: "T1595",
		name: "Active Scanning",
		tactic: "Reconnaissance",
		description:
			"Adversaries probe a target's network perimeter through automated scanning — enumerating open ports, " +
			"services, and reachable infrastructure — before selecting attack paths. Sentinel flags port scan " +
			"and service-enumeration activity here.",
		mitigationIds: ["M1056"],
	},
	T1592: {
		techniqueId: "T1592",
		name: "Gather Victim Host Information",
		tactic: "Reconnaissance",
		description:
			"Collecting operating system versions, hardware details, installed software, and network configuration " +
			"of target hosts. This intelligence shapes later exploitation decisions and is often obtained passively " +
			"through banner grabbing and certificate analysis.",
		mitigationIds: ["M1056"],
	},
	T1589: {
		techniqueId: "T1589",
		name: "Gather Victim Identity Information",
		tactic: "Reconnaissance",
		description:
			"Harvesting email addresses, employee names, credentials, and organisational identifiers from public " +
			"sources such as breach datasets, LinkedIn, and corporate websites. Used to craft targeted phishing " +
			"and credential stuffing attacks.",
		mitigationIds: ["M1056", "M1017"],
	},
	T1590: {
		techniqueId: "T1590",
		name: "Gather Victim Network Information",
		tactic: "Reconnaissance",
		description:
			"Mapping a target's IP space, DNS infrastructure, WHOIS records, and network topology before launching " +
			"an attack. This includes passive observation of BGP routes and active DNS enumeration.",
		mitigationIds: ["M1056"],
	},
	T1598: {
		techniqueId: "T1598",
		name: "Phishing for Information",
		tactic: "Reconnaissance",
		description:
			"Sending deceptive communications to extract credentials or sensitive data without deploying malware. " +
			"Unlike execution-phase phishing, the objective here is reconnaissance — tricking a target into " +
			"revealing information rather than running a payload.",
		mitigationIds: ["M1017", "M1054"],
	},
	T1190: {
		techniqueId: "T1190",
		name: "Exploit Public-Facing Application",
		tactic: "Initial Access",
		description:
			"Taking advantage of a vulnerability in an internet-exposed application — web server, VPN gateway, " +
			"or API endpoint — to gain a foothold. Common vectors include SQL injection, remote code execution " +
			"in CMSes, and authentication bypasses in management panels.",
		mitigationIds: ["M1048", "M1051", "M1016"],
	},
	T1078: {
		techniqueId: "T1078",
		name: "Valid Accounts",
		tactic: "Initial Access",
		description:
			"Using legitimate credentials — obtained through phishing, credential stuffing, or default passwords " +
			"— to access target systems. Because normal authentication is used, this technique is difficult to " +
			"detect without behavioural baselines.",
		mitigationIds: ["M1036", "M1032", "M1017"],
	},
	T1133: {
		techniqueId: "T1133",
		name: "External Remote Services",
		tactic: "Initial Access",
		description:
			"Accessing an organisation's internal network through externally reachable services such as VPN, " +
			"RDP, SSH, or Citrix. Adversaries exploit weak credentials, unpatched vulnerabilities, or stolen " +
			"session tokens on these perimeter services.",
		mitigationIds: ["M1035", "M1032", "M1042"],
	},
	T1059: {
		techniqueId: "T1059",
		name: "Command and Scripting Interpreter",
		tactic: "Execution",
		description:
			"Leveraging built-in scripting environments — Bash, PowerShell, Python, or JavaScript — to execute " +
			"attacker-controlled code on a compromised host. These interpreters are trusted by the OS, making " +
			"detection harder than for standalone executables.",
		mitigationIds: ["M1038", "M1026", "M1049"],
	},
	T1203: {
		techniqueId: "T1203",
		name: "Exploitation for Client Execution",
		tactic: "Execution",
		description:
			"Triggering a vulnerability in a client-side application — browser, PDF reader, or email client — " +
			"that results in arbitrary code execution when a user opens a malicious document or visits a " +
			"crafted URL.",
		mitigationIds: ["M1050", "M1048"],
	},
	T1053: {
		techniqueId: "T1053",
		name: "Scheduled Task / Job",
		tactic: "Persistence",
		description:
			"Abusing OS task schedulers (cron, Windows Task Scheduler, systemd timers) to execute malicious code " +
			"at regular intervals or on system events. A reliable persistence mechanism that survives reboots and " +
			"process termination.",
		mitigationIds: ["M1026", "M1018"],
	},
	T1098: {
		techniqueId: "T1098",
		name: "Account Manipulation",
		tactic: "Persistence",
		description:
			"Modifying account credentials, adding SSH keys, or escalating privileges of an existing account " +
			"to maintain long-term access. This includes planting authorised_keys, resetting passwords, and " +
			"assigning administrative roles.",
		mitigationIds: ["M1026", "M1032", "M1030"],
	},
	T1552: {
		techniqueId: "T1552",
		name: "Unsecured Credentials",
		tactic: "Credential Access",
		description:
			"Locating credentials stored without adequate protection — in plaintext configuration files, " +
			"environment variables, code repositories, or browser password stores. A common finding in " +
			"developer environments where convenience overrides security hygiene.",
		mitigationIds: ["M1047", "M1026", "M1027"],
	},
	T1555: {
		techniqueId: "T1555",
		name: "Credentials from Password Stores",
		tactic: "Credential Access",
		description:
			"Extracting saved passwords from OS keychains, browser stores, or credential manager databases. " +
			"Requires local access but yields high-value credentials that may grant lateral movement.",
		mitigationIds: ["M1051", "M1026"],
	},
	T1110: {
		techniqueId: "T1110",
		name: "Brute Force",
		tactic: "Credential Access",
		description:
			"Systematically attempting password combinations against an authentication service. Includes " +
			"traditional brute force, dictionary attacks, credential stuffing from breach data, and password " +
			"spraying to avoid account lockouts.",
		mitigationIds: ["M1036", "M1032", "M1018"],
	},
	T1212: {
		techniqueId: "T1212",
		name: "Exploitation for Credential Access",
		tactic: "Credential Access",
		description:
			"Exploiting software vulnerabilities — memory corruption, injection flaws, or deserialization bugs " +
			"— specifically to extract credentials from running processes or protected stores rather than for " +
			"initial code execution.",
		mitigationIds: ["M1048", "M1051"],
	},
	T1021: {
		techniqueId: "T1021",
		name: "Remote Services",
		tactic: "Lateral Movement",
		description:
			"Using legitimate remote access protocols — SSH, RDP, SMB, WinRM — to move between hosts once " +
			"inside a network. Valid credentials or session tokens make this traffic indistinguishable from " +
			"normal administration without endpoint telemetry.",
		mitigationIds: ["M1035", "M1027", "M1026"],
	},
	T1550: {
		techniqueId: "T1550",
		name: "Use Alternate Authentication Material",
		tactic: "Lateral Movement",
		description:
			"Authenticating with token material — Kerberos tickets, NTLM hashes, cloud access tokens — instead " +
			"of plaintext passwords. Pass-the-hash and pass-the-ticket attacks fall here; they require no " +
			"password cracking.",
		mitigationIds: ["M1051", "M1018", "M1026"],
	},
	T1041: {
		techniqueId: "T1041",
		name: "Exfiltration Over C2 Channel",
		tactic: "Exfiltration",
		description:
			"Sending stolen data back to the adversary over the same channel used for command-and-control, " +
			"blending exfiltration into seemingly normal traffic. Data is often compressed and encrypted to " +
			"evade DLP solutions.",
		mitigationIds: ["M1031", "M1037", "M1057"],
	},
	T1048: {
		techniqueId: "T1048",
		name: "Exfiltration Over Alternative Protocol",
		tactic: "Exfiltration",
		description:
			"Tunnelling stolen data through DNS queries, ICMP packets, or other protocols that are rarely " +
			"inspected by perimeter controls. DNS exfiltration is particularly stealthy because DNS traffic " +
			"is seldom blocked outright.",
		mitigationIds: ["M1037", "M1031"],
	},
	T1071: {
		techniqueId: "T1071",
		name: "Application Layer Protocol",
		tactic: "Command and Control",
		description:
			"Using standard application protocols — HTTP/S, DNS, SMTP, SFTP — for command-and-control to " +
			"blend malicious traffic with legitimate network activity. Encrypted channels make content " +
			"inspection ineffective without TLS termination.",
		mitigationIds: ["M1031", "M1037"],
	},
	T1083: {
		techniqueId: "T1083",
		name: "File and Directory Discovery",
		tactic: "Discovery",
		description:
			"Enumerating the file system to understand the target environment — locating configuration files, " +
			"source code, credential stores, and backup archives. Automated tools crawl directory trees and " +
			"prioritise high-value paths.",
		mitigationIds: ["M1022"],
	},
	T1082: {
		techniqueId: "T1082",
		name: "System Information Discovery",
		tactic: "Discovery",
		description:
			"Collecting OS version, architecture, hostname, installed software, and kernel details to select " +
			"appropriate exploits and privilege escalation paths. Typically an early post-compromise step.",
		mitigationIds: ["M1022"],
	},
	T1046: {
		techniqueId: "T1046",
		name: "Network Service Discovery",
		tactic: "Discovery",
		description:
			"Probing the internal network for listening services to identify additional attack targets and " +
			"pivot opportunities. This mirrors external reconnaissance but occurs from inside the perimeter " +
			"where more services are exposed.",
		mitigationIds: ["M1031", "M1030"],
	},
	T1486: {
		techniqueId: "T1486",
		name: "Data Encrypted for Impact",
		tactic: "Impact",
		description:
			"Encrypting files, databases, or entire volumes to deny the organisation access to its own data — " +
			"the core ransomware technique. Recovery depends on having clean, tested, offline backups.",
		mitigationIds: ["M1053", "M1040"],
	},
};

// ─────────────────────────────────────────────────────────────────────────────
// Keyword-to-technique mapping
// ─────────────────────────────────────────────────────────────────────────────

type KeywordEntry = { keywords: string[]; techniqueIds: string[] };

const KEYWORD_MAP: KeywordEntry[] = [
	{
		keywords: ["port scan", "nmap", "open port", "service enumeration"],
		techniqueIds: ["T1595", "T1046"],
	},
	{
		keywords: ["banner", "version", "fingerprint", "service version"],
		techniqueIds: ["T1592", "T1082"],
	},
	{
		keywords: ["dns", "subdomain", "mx record", "nameserver", "zone"],
		techniqueIds: ["T1590", "T1595"],
	},
	{
		keywords: ["whois", "rdap", "registrar", "cert transparency"],
		techniqueIds: ["T1590"],
	},
	{
		keywords: [
			"breach",
			"leaked credential",
			"haveibeenpwned",
			"credential dump",
		],
		techniqueIds: ["T1589"],
	},
	{
		keywords: ["sql injection", "sqli", "string concatenation", "raw query"],
		techniqueIds: ["T1190"],
	},
	{
		keywords: [
			"xss",
			"cross-site scripting",
			"innerhtml",
			"dangerouslysetinnerhtml",
			"eval",
		],
		techniqueIds: ["T1190", "T1059"],
	},
	{
		keywords: [
			"rce",
			"remote code execution",
			"code injection",
			"deserialization",
			"pickle",
		],
		techniqueIds: ["T1190", "T1203"],
	},
	{
		keywords: ["default credential", "default password", "default login"],
		techniqueIds: ["T1078"],
	},
	{
		keywords: [
			"hardcoded secret",
			"api key",
			"private key",
			"jwt secret",
			"token",
			"database url",
		],
		techniqueIds: ["T1552"],
	},
	{
		keywords: ["password in config", "plaintext password", "env var secret"],
		techniqueIds: ["T1552"],
	},
	{
		keywords: ["ssh", "rdp", "vpn", "remote access"],
		techniqueIds: ["T1133", "T1021"],
	},
	{
		keywords: [
			"brute force",
			"credential stuffing",
			"password spray",
			"login attempt",
		],
		techniqueIds: ["T1110"],
	},
	{
		keywords: ["directory traversal", "path traversal", "lfi", "rfi"],
		techniqueIds: ["T1083"],
	},
	{
		keywords: ["open redirect", "unvalidated redirect"],
		techniqueIds: ["T1190"],
	},
	{
		keywords: ["csp missing", "no content-security-policy", "security header"],
		techniqueIds: ["T1190"],
	},
	{
		keywords: [
			"tls",
			"ssl",
			"weak cipher",
			"expired certificate",
			"deprecated protocol",
		],
		techniqueIds: ["T1190"],
	},
	{
		keywords: ["docker", "dockerfile", "container root", "privileged"],
		techniqueIds: ["T1059"],
	},
	{
		keywords: ["npm audit", "vulnerable dependency", "cve"],
		techniqueIds: ["T1190"],
	},
	{
		keywords: ["scheduled task", "cron", "systemd timer"],
		techniqueIds: ["T1053"],
	},
	{
		keywords: ["dns exfil", "data exfil", "data leak"],
		techniqueIds: ["T1048", "T1041"],
	},
];

/**
 * Maps finding title and description keywords to relevant MITRE ATT&CK technique IDs.
 * Returns deduplicated technique IDs sorted by specificity.
 */
export function tagFindingWithMitre(finding: Partial<Finding>): string[] {
	const text =
		`${finding.title ?? ""} ${finding.description ?? ""}`.toLowerCase();
	const matched = new Set<string>();

	for (const { keywords, techniqueIds } of KEYWORD_MAP) {
		if (keywords.some((kw) => text.includes(kw))) {
			for (const id of techniqueIds) matched.add(id);
		}
	}

	return [...matched].sort();
}

/**
 * Returns the official MITRE ATT&CK Navigator URL for a technique ID.
 */
export function getMitreUrl(techniqueId: string): string {
	// Handle sub-techniques (T1234.001 → T1234/001)
	const normalised = techniqueId.replace(".", "/");
	return `https://attack.mitre.org/techniques/${normalised}/`;
}
