/**
 * OnboardingFlow.tsx — Paperclip-style two-screen onboarding.
 *
 * Replaces the 2,362-line OnboardingWizard for first-run users. The legacy
 * wizard is still exported for the project-creation variant and as a fallback
 * (operator can click "Configure manually" on screen 1).
 *
 * Screen 1: Connect a coding CLI
 *   - Live status badges for the five first-class adapters via /api/cli-status
 *     (polled every 2s while the page is mounted).
 *   - Each card shows install/version state + a "Use this" or
 *     "Copy install command" primary action.
 *   - A small "Configure manually (legacy)" link drops back to the old wizard
 *     for users who really need API-key paste.
 *
 * Screen 2: Meet your CEO
 *   - Auto-creates a workspace + CEO agent bound to the chosen adapter.
 *   - Single text box for "what should the CEO work on first" with a sensible
 *     placeholder. No 7-line scaffold, no template picker.
 *
 * Persistence: on completion, sets company_settings.preferred_cli to the
 * picked CLI and flips legacy_api_keys_enabled to false. Fires the existing
 * onCompanyCreated callback so AppShell wiring (sidebar registration,
 * navigation) is unchanged.
 */

import {
	ArrowRight,
	Check,
	ChevronLeft,
	Copy,
	Loader2,
	RefreshCw,
	X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, companySettings, type CliStatus } from "../lib/api";

interface OnboardingFlowProps {
	onClose?: () => void;
	onCompanyCreated?: (company: {
		id: string;
		name: string;
		issuePrefix: string;
		brandColor?: string;
		type?: string;
		size?: string;
		order: number;
	}) => void;
	/** Drop back to the legacy wizard (for power users with API-key needs). */
	onUseLegacyWizard?: () => void;
}

const CLI_DESCRIPTIONS: Record<string, string> = {
	claude: "Anthropic's official Claude Code CLI. Handles its own auth — no API key needed.",
	codex: "OpenAI's Codex CLI. Logs in via your OpenAI account.",
	gemini: "Google's Gemini CLI. Logs in via Google account or GEMINI_API_KEY.",
	opencode: "Open-source coding agent. Self-hosted; pick any backend.",
	cursor: "Cursor CLI agent. Reuses your Cursor IDE login.",
};

const POLL_MS = 2000;

export function OnboardingFlow({
	onClose,
	onCompanyCreated,
	onUseLegacyWizard,
}: OnboardingFlowProps) {
	const [screen, setScreen] = useState<1 | 2>(1);
	const [statuses, setStatuses] = useState<CliStatus[]>([]);
	const [polling, setPolling] = useState(false);
	const [pickedCli, setPickedCli] = useState<string | null>(null);
	const [copied, setCopied] = useState<string | null>(null);
	const [companyName, setCompanyName] = useState("");
	const [firstTask, setFirstTask] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [err, setErr] = useState<string | null>(null);
	const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

	useEffect(() => {
		let cancelled = false;
		const fetchOnce = async (force = false) => {
			try {
				const { adapters } = await api.cliStatus.list({ force });
				if (!cancelled) setStatuses(adapters);
			} catch (e) {
				if (!cancelled)
					setErr(e instanceof Error ? e.message : "Failed to detect CLIs");
			}
		};
		void fetchOnce(true);
		pollTimer.current = setInterval(() => void fetchOnce(false), POLL_MS);
		return () => {
			cancelled = true;
			if (pollTimer.current) clearInterval(pollTimer.current);
		};
	}, []);

	const installedCount = useMemo(
		() => statuses.filter((s) => s.installed).length,
		[statuses],
	);

	const handleRecheck = async () => {
		setPolling(true);
		try {
			const { adapters } = await api.cliStatus.list({ force: true });
			setStatuses(adapters);
		} finally {
			setPolling(false);
		}
	};

	const handleCopy = async (cmd: string, id: string) => {
		try {
			await navigator.clipboard.writeText(cmd);
			setCopied(id);
			setTimeout(() => setCopied(null), 1500);
		} catch {
			/* clipboard blocked — silent */
		}
	};

	const handleContinue = () => {
		if (!pickedCli) return;
		setErr(null);
		setScreen(2);
	};

	const handleFinish = async () => {
		if (!pickedCli || !companyName.trim()) return;
		setSubmitting(true);
		setErr(null);
		try {
			const company = await api.companies.create({
				name: companyName.trim(),
				type: "startup",
				size: "0-10",
			});
			// Persist preferred CLI + flip the legacy API-key UI off.
			try {
				await companySettings.update({
					preferredCli: pickedCli,
					legacyApiKeysEnabled: false,
				});
			} catch {
				/* non-fatal: the user can re-toggle in Settings */
			}
			// Fire the existing AppShell wiring (sidebar registration, nav).
			onCompanyCreated?.({
				...company,
				type: "startup",
				size: "0-10",
				order: 0,
			});
			// Best-effort first-issue creation. We don't block onboarding on this.
			if (firstTask.trim()) {
				try {
					await fetch("/api/issues", {
						method: "POST",
						headers: {
							"content-type": "application/json",
							"x-company-id": company.id,
						},
						body: JSON.stringify({
							title: firstTask.trim().slice(0, 200),
							status: "todo",
							priority: "medium",
						}),
					});
				} catch {
					/* ignore — operator can create from the board */
				}
			}
			onClose?.();
		} catch (e) {
			setErr(e instanceof Error ? e.message : "Failed to create workspace");
		} finally {
			setSubmitting(false);
		}
	};

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur">
			<div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-card border border-border rounded-xl shadow-2xl">
				<button
					type="button"
					onClick={onClose}
					className="absolute top-4 right-4 p-2 rounded hover:bg-accent text-muted-foreground"
					aria-label="Close onboarding"
				>
					<X className="w-4 h-4" />
				</button>

				{screen === 1 && (
					<Screen1
						statuses={statuses}
						pickedCli={pickedCli}
						setPickedCli={setPickedCli}
						polling={polling}
						onRecheck={handleRecheck}
						onCopy={handleCopy}
						copied={copied}
						installedCount={installedCount}
						onContinue={handleContinue}
						onUseLegacyWizard={onUseLegacyWizard}
						err={err}
					/>
				)}

				{screen === 2 && (
					<Screen2
						pickedCli={pickedCli ?? ""}
						pickedCliLabel={
							statuses.find((s) => s.id === pickedCli)?.label ?? pickedCli ?? ""
						}
						companyName={companyName}
						setCompanyName={setCompanyName}
						firstTask={firstTask}
						setFirstTask={setFirstTask}
						onBack={() => setScreen(1)}
						onFinish={handleFinish}
						submitting={submitting}
						err={err}
					/>
				)}
			</div>
		</div>
	);
}

function Screen1(props: {
	statuses: CliStatus[];
	pickedCli: string | null;
	setPickedCli: (id: string) => void;
	polling: boolean;
	onRecheck: () => void;
	onCopy: (cmd: string, id: string) => void;
	copied: string | null;
	installedCount: number;
	onContinue: () => void;
	onUseLegacyWizard?: () => void;
	err: string | null;
}) {
	const {
		statuses,
		pickedCli,
		setPickedCli,
		polling,
		onRecheck,
		onCopy,
		copied,
		installedCount,
		onContinue,
		onUseLegacyWizard,
		err,
	} = props;

	return (
		<div className="p-8 space-y-6">
			<div>
				<div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
					Step 1 of 2
				</div>
				<h2 className="text-2xl font-semibold">Connect a coding CLI</h2>
				<p className="text-sm text-muted-foreground mt-2 max-w-xl">
					Setra runs your local AI coding CLIs as a team of agents. No API
					keys to paste — each CLI handles its own login.
				</p>
			</div>

			<div className="flex items-center justify-between text-xs text-muted-foreground">
				<span>
					{installedCount} of {statuses.length || 5} detected on this machine
				</span>
				<button
					type="button"
					onClick={onRecheck}
					disabled={polling}
					className="flex items-center gap-1 px-2 py-1 rounded hover:bg-accent"
				>
					{polling ? (
						<Loader2 className="w-3 h-3 animate-spin" />
					) : (
						<RefreshCw className="w-3 h-3" />
					)}
					Recheck
				</button>
			</div>

			<div className="grid gap-3">
				{statuses.map((s) => {
					const picked = pickedCli === s.id;
					return (
						<button
							key={s.id}
							type="button"
							disabled={!s.installed}
							onClick={() => s.installed && setPickedCli(s.id)}
							className={`w-full text-left p-4 rounded-lg border transition ${
								picked
									? "border-primary bg-primary/5"
									: s.installed
										? "border-border hover:border-foreground/40"
										: "border-border/50 opacity-70"
							}`}
						>
							<div className="flex items-start justify-between gap-4">
								<div className="flex-1">
									<div className="flex items-center gap-2">
										<span className="font-medium">{s.label}</span>
										<StatusBadge installed={s.installed} version={s.version} />
									</div>
									<div className="text-xs text-muted-foreground mt-1">
										{CLI_DESCRIPTIONS[s.id] ?? `CLI: ${s.bin}`}
									</div>
									{!s.installed && (
										<div className="mt-3 flex items-center gap-2">
											<code className="text-xs bg-muted px-2 py-1 rounded font-mono flex-1 overflow-x-auto">
												{s.installCommand}
											</code>
											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													onCopy(s.installCommand, s.id);
												}}
												className="p-1.5 rounded hover:bg-accent text-muted-foreground"
												title="Copy install command"
											>
												{copied === s.id ? (
													<Check className="w-3.5 h-3.5 text-green-600" />
												) : (
													<Copy className="w-3.5 h-3.5" />
												)}
											</button>
										</div>
									)}
								</div>
								{picked && (
									<div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground shrink-0">
										<Check className="w-3.5 h-3.5" />
									</div>
								)}
							</div>
						</button>
					);
				})}
				{statuses.length === 0 && (
					<div className="text-sm text-muted-foreground text-center py-8">
						Detecting installed CLIs…
					</div>
				)}
			</div>

			{err && (
				<div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded">
					{err}
				</div>
			)}

			<div className="flex items-center justify-between pt-4 border-t border-border">
				{onUseLegacyWizard ? (
					<button
						type="button"
						onClick={onUseLegacyWizard}
						className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
					>
						Configure manually (legacy)
					</button>
				) : (
					<span />
				)}
				<button
					type="button"
					onClick={onContinue}
					disabled={!pickedCli}
					className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90"
				>
					Continue
					<ArrowRight className="w-4 h-4" />
				</button>
			</div>
		</div>
	);
}

function Screen2(props: {
	pickedCli: string;
	pickedCliLabel: string;
	companyName: string;
	setCompanyName: (s: string) => void;
	firstTask: string;
	setFirstTask: (s: string) => void;
	onBack: () => void;
	onFinish: () => void;
	submitting: boolean;
	err: string | null;
}) {
	const {
		pickedCli,
		pickedCliLabel,
		companyName,
		setCompanyName,
		firstTask,
		setFirstTask,
		onBack,
		onFinish,
		submitting,
		err,
	} = props;

	return (
		<div className="p-8 space-y-6">
			<div>
				<div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">
					Step 2 of 2
				</div>
				<h2 className="text-2xl font-semibold">Meet your CEO</h2>
				<p className="text-sm text-muted-foreground mt-2">
					Setra creates a CEO agent bound to{" "}
					<span className="font-medium text-foreground">{pickedCliLabel}</span>{" "}
					— it will hire and direct other agents on your behalf.
				</p>
			</div>

			<div className="space-y-4">
				<div>
					<label
						htmlFor="onboarding-workspace-name"
						className="block text-sm font-medium mb-1"
					>
						Workspace name
					</label>
					<input
						id="onboarding-workspace-name"
						type="text"
						value={companyName}
						onChange={(e) => setCompanyName(e.target.value)}
						placeholder="My Workspace"
						className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
						autoFocus
					/>
				</div>

				<div>
					<label
						htmlFor="onboarding-first-task"
						className="block text-sm font-medium mb-1"
					>
						First task for your CEO{" "}
						<span className="text-muted-foreground font-normal">
							(optional)
						</span>
					</label>
					<textarea
						id="onboarding-first-task"
						value={firstTask}
						onChange={(e) => setFirstTask(e.target.value)}
						placeholder="e.g. Audit our codebase and propose a 90-day product roadmap."
						rows={3}
						className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
					/>
				</div>

				<div className="text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg flex items-start gap-2">
					<span>
						The CEO will use {pickedCliLabel}. You can switch the CLI any time
						from the top bar — model selection happens inside the CLI itself.
					</span>
				</div>
			</div>

			{err && (
				<div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded">
					{err}
				</div>
			)}

			<div className="flex items-center justify-between pt-4 border-t border-border">
				<button
					type="button"
					onClick={onBack}
					disabled={submitting}
					className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
				>
					<ChevronLeft className="w-4 h-4" />
					Back
				</button>
				<button
					type="button"
					onClick={onFinish}
					disabled={submitting || !companyName.trim() || !pickedCli}
					className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90"
				>
					{submitting ? (
						<>
							<Loader2 className="w-4 h-4 animate-spin" />
							Creating workspace…
						</>
					) : (
						<>
							Create workspace and meet CEO
							<ArrowRight className="w-4 h-4" />
						</>
					)}
				</button>
			</div>
		</div>
	);
}

function StatusBadge({
	installed,
	version,
}: {
	installed: boolean;
	version: string | null;
}) {
	if (!installed) {
		return (
			<span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
				Not installed
			</span>
		);
	}
	if (version) {
		return (
			<span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-green-500/10 text-green-700 dark:text-green-400">
				Installed v{version}
			</span>
		);
	}
	return (
		<span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-400">
			Detected
		</span>
	);
}

export default OnboardingFlow;
