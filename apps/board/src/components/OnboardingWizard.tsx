import {
	ArrowRight,
	Bot,
	Building2,
	Check,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	Code2,
	Cpu,
	Globe,
	HardDrive,
	Info,
	Layers,
	ListTodo,
	type LucideIcon,
	Megaphone,
	Rocket,
	Server,
	Terminal,
	Users,
	WifiOff,
	X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, llm, request } from "../lib/api";
import {
	ADAPTERS,
	AVAILABLE_SKILLS,
	TEAM_TEMPLATES,
} from "../lib/team-templates";
import { AsciiArtAnimation } from "./AsciiArtAnimation";

type Step = 1 | 2 | 3 | 4 | 5;

const DEFAULT_TASK_DESCRIPTION = `Create a practical plan for your first engineering contributor.

Outline:
- Responsibilities and success criteria
- Skills and tools needed
- Evaluation or interview steps
- Onboarding checklist

Deliver a structured plan the team can review and use.`;

const TEMPLATE_ICONS: Record<string, React.FC<{ className?: string }>> = {
	Code2: (p) => <Code2 {...p} />,
	Megaphone: (p) => <Megaphone {...p} />,
	Layers: (p) => <Layers {...p} />,
	Server: (p) => <Server {...p} />,
};

const ADAPTER_ICONS: Record<string, React.FC<{ className?: string }>> = {
	claude_local: (p) => <Cpu {...p} />,
	codex_local: (p) => <Terminal {...p} />,
	gemini_local: (p) => <Globe {...p} />,
	opencode_local: (p) => <Code2 {...p} />,
	openrouter: (p) => <Globe {...p} />,
	groq: (p) => <Cpu {...p} />,
	ollama: (p) => <HardDrive {...p} />,
	lmstudio: (p) => <HardDrive {...p} />,
	cursor: (p) => <Terminal {...p} />,
	http: (p) => <Globe {...p} />,
};

function StepDots({ current, total }: { current: Step; total: number }) {
	return (
		<div className="flex items-center gap-2 justify-center mb-8">
			{Array.from({ length: total }, (_, i) => {
				const step = (i + 1) as Step;
				const isDone = step < current;
				const isActive = step === current;
				return (
					<div
						key={step}
						className={`rounded-full transition-all duration-300 ${
							isActive
								? "w-6 h-2 bg-setra-600"
								: isDone
									? "w-2 h-2 bg-setra-400"
									: "w-2 h-2 bg-muted"
						}`}
					/>
				);
			})}
		</div>
	);
}

function Label({
	children,
	hint,
}: {
	children: React.ReactNode;
	hint?: string;
}) {
	return (
		<div className="mb-2 flex items-center gap-1.5">
			<p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
				{children}
			</p>
			{hint ? (
				<span
					title={hint}
					aria-label={hint}
					className="inline-flex items-center justify-center text-muted-foreground/50"
				>
					<Info className="w-3.5 h-3.5" />
				</span>
			) : null}
		</div>
	);
}

function Input({
	value,
	onChange,
	placeholder,
	required,
	autoFocus,
}: {
	value: string;
	onChange: (v: string) => void;
	placeholder?: string;
	required?: boolean;
	autoFocus?: boolean;
}) {
	return (
		<input
			type="text"
			value={value}
			onChange={(e) => onChange(e.target.value)}
			placeholder={placeholder}
			required={required}
			autoFocus={autoFocus}
			className="w-full bg-input border border-border/50 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-setra-500 focus:border-setra-500 transition-colors"
		/>
	);
}

function RadioOption({
	checked,
	onSelect,
	label,
}: {
	checked: boolean;
	onSelect: () => void;
	label: string;
}) {
	return (
		<button
			type="button"
			onClick={onSelect}
			className={`flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-all ${
				checked
					? "border-setra-500/60 bg-setra-600/10 text-foreground"
					: "border-border/50 bg-transparent text-muted-foreground hover:border-border hover:text-foreground"
			}`}
		>
			<span
				className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
					checked ? "border-setra-500" : "border-muted-foreground/40"
				}`}
			>
				{checked && <span className="w-2 h-2 rounded-full bg-setra-400" />}
			</span>
			{label}
		</button>
	);
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={on}
			onClick={onToggle}
			className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-setra-500 focus:ring-offset-2 focus:ring-offset-background ${
				on ? "bg-setra-600" : "bg-muted"
			}`}
		>
			<span
				className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition duration-200 ease-in-out ${
					on ? "translate-x-4" : "translate-x-0"
				}`}
			/>
		</button>
	);
}

function Step1({
	companyName,
	setCompanyName,
	companyGoal,
	setCompanyGoal,
	companyType,
	setCompanyType,
	companySize,
	setCompanySize,
	isOfflineOnly,
	setIsOfflineOnly,
	onNext,
	onCancel,
}: {
	companyName: string;
	setCompanyName: (v: string) => void;
	companyGoal: string;
	setCompanyGoal: (v: string) => void;
	companyType: string;
	setCompanyType: (v: string) => void;
	companySize: string;
	setCompanySize: (v: string) => void;
	isOfflineOnly: boolean;
	setIsOfflineOnly: (v: boolean) => void;
	onNext: () => void;
	onCancel?: () => void;
}) {
	const COMPANY_TYPES = [
		{ id: "startup", label: "Startup" },
		{ id: "agency", label: "Agency" },
		{ id: "enterprise", label: "Enterprise" },
		{ id: "government", label: "Government / NGO" },
		{ id: "personal", label: "Personal / Solo" },
	];

	const COMPANY_SIZES = [
		{ id: "0-10", label: "0 – 10" },
		{ id: "10-50", label: "10 – 50" },
		{ id: "50-200", label: "50 – 200" },
		{ id: "200-1000", label: "200 – 1000" },
		{ id: "1000+", label: "1000+" },
	];

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-3 mb-6">
				<div className="w-9 h-9 rounded-lg bg-setra-600/15 flex items-center justify-center">
					<Building2 className="w-5 h-5 text-setra-300" />
				</div>
				<div>
					<h2 className="text-lg font-semibold text-foreground">
						Set up your workspace
					</h2>
					<p className="text-xs text-muted-foreground">
						Choose a name and a few basics to get started.
					</p>
				</div>
			</div>

			<div className="space-y-4">
				<div>
					<Label>Workspace Name *</Label>
					<Input
						value={companyName}
						onChange={setCompanyName}
						placeholder="My Workspace"
						required
						autoFocus
					/>
				</div>

				<div>
					<Label>Workspace Goal</Label>
					<Input
						value={companyGoal}
						onChange={setCompanyGoal}
						placeholder="Build the best product in the market"
					/>
				</div>

				<div>
					<Label>Workspace Type</Label>
					<div className="grid grid-cols-2 gap-2">
						{COMPANY_TYPES.map((t) => (
							<RadioOption
								key={t.id}
								checked={companyType === t.id}
								onSelect={() => setCompanyType(t.id)}
								label={t.label}
							/>
						))}
					</div>
				</div>

				<div>
					<Label>Workspace Size</Label>
					<div className="flex flex-wrap gap-2">
						{COMPANY_SIZES.map((s) => (
							<RadioOption
								key={s.id}
								checked={companySize === s.id}
								onSelect={() => setCompanySize(s.id)}
								label={s.label}
							/>
						))}
					</div>
				</div>

				<div
					role="button"
					tabIndex={0}
					onClick={() => setIsOfflineOnly(!isOfflineOnly)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							setIsOfflineOnly(!isOfflineOnly);
						}
					}}
					className={`w-full flex items-center justify-between p-4 rounded-lg border transition-all ${
						isOfflineOnly
							? "border-setra-500/50 bg-setra-600/5"
							: "border-border/50 bg-transparent hover:bg-muted/20"
					}`}
				>
					<div className="flex items-center gap-3">
						<WifiOff
							className={`w-5 h-5 shrink-0 ${isOfflineOnly ? "text-setra-300" : "text-muted-foreground"}`}
						/>
						<div className="text-left">
							<p className="text-sm font-medium text-foreground">
								Offline-only workspace
							</p>
							<p className="text-xs text-muted-foreground mt-0.5">
								Agents will only use local models. No data sent to external
								APIs.
							</p>
						</div>
					</div>
					<Toggle
						on={isOfflineOnly}
						onToggle={() => setIsOfflineOnly(!isOfflineOnly)}
					/>
				</div>
			</div>

			<div className="flex items-center justify-between pt-2">
				<button
					type="button"
					onClick={onCancel}
					className="px-3 py-2 rounded-md border border-border/50 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
				>
					Back to dashboard
				</button>
				<button
					type="button"
					onClick={onNext}
					disabled={!companyName.trim()}
					className="flex items-center gap-2 px-4 py-2 rounded-md bg-setra-600 hover:bg-setra-500 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
				>
					Continue
					<ChevronRight className="w-4 h-4" />
				</button>
			</div>
		</div>
	);
}

function Step2({
	selectedTemplate,
	setSelectedTemplate,
	selectedSkills,
	setSelectedSkills,
	onBack,
	onNext,
}: {
	selectedTemplate: string | null;
	setSelectedTemplate: (v: string | null) => void;
	selectedSkills: Set<string>;
	setSelectedSkills: (v: Set<string>) => void;
	onBack: () => void;
	onNext: () => void;
}) {
	function toggleSkill(id: string) {
		const next = new Set(selectedSkills);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setSelectedSkills(next);
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-3 mb-6">
				<div className="w-9 h-9 rounded-lg bg-setra-600/15 flex items-center justify-center">
					<Users className="w-5 h-5 text-setra-300" />
				</div>
				<div>
					<h2 className="text-lg font-semibold text-foreground">
						Choose your starting team
					</h2>
					<p className="text-xs text-muted-foreground">
						Pick a template or build from scratch
					</p>
				</div>
			</div>

			<div>
				<Label>Team Template</Label>
				<p className="text-xs text-muted-foreground mb-3">
					A team template defines the AI agents that work on your projects. Each
					agent has a role (e.g. Engineer, QA, DevOps) and runs a specific AI
					model.
				</p>
				<div className="grid grid-cols-2 gap-2">
					{TEAM_TEMPLATES.map((t) => {
						const Icon =
							TEMPLATE_ICONS[t.icon] ?? (() => <Code2 className="w-5 h-5" />);
						const isSelected = selectedTemplate === t.id;
						return (
							<button
								key={t.id}
								type="button"
								onClick={() => setSelectedTemplate(t.id)}
								className={`flex flex-col items-start gap-2 p-3 rounded-lg border text-left transition-all ${
									isSelected
										? "ring-2 ring-setra-500 border-setra-500/50 bg-setra-600/10"
										: "border-border/50 hover:border-border hover:bg-muted/20"
								}`}
							>
								<div
									className={`w-8 h-8 rounded-md flex items-center justify-center ${
										isSelected ? "bg-setra-600/20" : "bg-muted"
									}`}
								>
									<Icon
										className={`w-4 h-4 ${isSelected ? "text-setra-300" : "text-muted-foreground"}`}
									/>
								</div>
								<div>
									<p className="text-sm font-medium text-foreground">
										{t.name}
									</p>
									<p className="text-xs text-muted-foreground">
										{t.description}
									</p>
								</div>
								<p className="text-[10px] text-muted-foreground/60">
									{t.agents.length} agent{t.agents.length !== 1 ? "s" : ""}
								</p>
							</button>
						);
					})}
				</div>

				<button
					type="button"
					onClick={() => setSelectedTemplate(null)}
					className={`mt-2 w-full py-2 text-sm rounded-md border transition-colors ${
						selectedTemplate === null
							? "border-setra-500/50 text-setra-300 bg-setra-600/10"
							: "border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/20"
					}`}
				>
					Build from scratch
				</button>
				{selectedTemplate === null && (
					<p className="mt-2 text-xs text-muted-foreground text-center">
						Build your own team by adding agents one by one in the next step.
					</p>
				)}
			</div>

			<div className="relative flex items-center gap-3 my-2">
				<div className="flex-1 h-px bg-border/50" />
				<span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 whitespace-nowrap">
					Attach skills to your first agent
				</span>
				<div className="flex-1 h-px bg-border/50" />
			</div>

			<div>
				<div className="grid grid-cols-3 gap-2">
					{AVAILABLE_SKILLS.map((skill) => {
						const checked = selectedSkills.has(skill.id);
						return (
							<button
								key={skill.id}
								type="button"
								onClick={() => toggleSkill(skill.id)}
								className={`flex items-start gap-2 p-2.5 rounded-lg border text-left transition-all ${
									checked
										? "border-setra-500/50 bg-setra-600/10"
										: "border-border/50 hover:border-border hover:bg-muted/20"
								}`}
							>
								<span
									className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center transition-colors ${
										checked
											? "bg-setra-600 border-setra-500"
											: "border-muted-foreground/40"
									}`}
								>
									{checked && <Check className="w-3 h-3 text-white" />}
								</span>
								<div className="min-w-0">
									<p className="text-xs font-medium text-foreground truncate">
										{skill.name}
									</p>
									<p className="text-[10px] text-muted-foreground truncate">
										{skill.description}
									</p>
								</div>
							</button>
						);
					})}
				</div>
			</div>

			<div className="flex items-center justify-between pt-2">
				<button
					type="button"
					onClick={onBack}
					className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-border/50 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
				>
					<ChevronLeft className="w-4 h-4" />
					Back
				</button>
				<button
					type="button"
					onClick={onNext}
					className="flex items-center gap-2 px-4 py-2 rounded-md bg-setra-600 hover:bg-setra-500 text-white text-sm font-medium transition-colors"
				>
					Continue
					<ChevronRight className="w-4 h-4" />
				</button>
			</div>
		</div>
	);
}

function ApiKeyInput({
	label,
	hint,
	placeholder,
	onKeySaved,
}: {
	label: string;
	hint: React.ReactNode;
	placeholder: string;
	onKeySaved?: (key: string) => void;
}) {
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [value, setValue] = useState("");
	function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
		const next = e.target.value;
		setValue(next);
		const key = next.trim();
		setError(null);
		if (!key) return;
		try {
			onKeySaved?.(key);
			setSaved(true);
			setTimeout(() => setSaved(false), 2000);
		} catch (err: unknown) {
			setError(err instanceof Error ? err.message : "Failed to capture key");
		}
	}
	return (
		<div className="p-3 rounded-lg border border-border/50 bg-muted/20 space-y-2">
			<div className="flex items-center justify-between">
				<p className="text-sm font-medium text-foreground">{label}</p>
				{saved && <span className="text-xs text-accent-green">✓ Saved</span>}
			</div>
			<p className="text-xs text-muted-foreground">{hint}</p>
			<input
				type="password"
				value={value}
				placeholder={placeholder}
				onChange={handleChange}
				className="w-full bg-input border border-border/50 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-setra-500 focus:border-setra-500 transition-colors"
			/>
			<p className="text-[11px] text-muted-foreground/70">
				Stored locally during setup, then saved to your workspace when you
				finish.
			</p>
			{error && <p className="text-xs text-accent-red">{error}</p>}
		</div>
	);
}

function Step3({
	agentName,
	setAgentName,
	adapterType,
	setAdapterType,
	model,
	setModel,
	systemPrompt,
	setSystemPrompt,
	companyName,
	companyGoal,
	isOfflineOnly,
	availableModels,
	refreshModels,
	envTestResult,
	setEnvTestResult,
	providerApiKeys,
	setProviderApiKey,
	ensureCompanyForTools,
	persistProviderKeys,
	onBack,
	onNext,
}: {
	agentName: string;
	setAgentName: (v: string) => void;
	adapterType: string;
	setAdapterType: (v: string) => void;
	model: string;
	setModel: (v: string) => void;
	systemPrompt: string;
	setSystemPrompt: (v: string) => void;
	companyName: string;
	companyGoal: string;
	isOfflineOnly: boolean;
	availableModels: {
		id: string;
		label: string;
		provider: string;
		tier: string;
	}[];
	refreshModels: () => Promise<void>;
	envTestResult: {
		ok: boolean;
		model?: string | undefined;
		error?: string | undefined;
	} | null;
	setEnvTestResult: (
		v: {
			ok: boolean;
			model?: string | undefined;
			error?: string | undefined;
		} | null,
	) => void;
	providerApiKeys: Partial<
		Record<"anthropic" | "openai" | "gemini" | "openrouter" | "groq", string>
	>;
	setProviderApiKey: (
		provider: "anthropic" | "openai" | "gemini" | "openrouter" | "groq",
		key: string,
	) => void;
	ensureCompanyForTools: () => Promise<string>;
	persistProviderKeys: (companyId: string) => Promise<void>;
	onBack: () => void;
	onNext: () => void;
}) {
	const [testing, setTesting] = useState(false);
	const [generatingPrompt, setGeneratingPrompt] = useState(false);
	const [promptError, setPromptError] = useState<string | null>(null);
	const [ollamaAvailable, setOllamaAvailable] = useState(true);
	const [cliStatus, setCliStatus] = useState<{
		codex: { installed: boolean; loggedIn: boolean; version: string | null };
		claude: { installed: boolean; loggedIn: boolean; version: string | null };
		copilot: { installed: boolean; loggedIn: boolean; version: string | null };
	} | null>(null);
	const [installingCli, setInstallingCli] = useState<string | null>(null);
	const [catalogModels, setCatalogModels] = useState<
		{ id: string; label: string; provider: string; tier: string }[]
	>([]);
	const lastAutoGeneratedKeyRef = useRef<string>("");
	const [enabledProviders, setEnabledProviders] = useState<
		Record<string, boolean>
	>({
		anthropic: false,
		openai: false,
		gemini: false,
		openrouter: false,
		groq: false,
		ollama: false,
	});

	const PROVIDER_TO_ADAPTER: Record<string, string> = {
		anthropic: "claude_local",
		openai: "codex_local",
		gemini: "gemini_local",
		openrouter: "openrouter",
		groq: "groq",
		ollama: "ollama",
	};

	const providers = isOfflineOnly
		? [
				{
					id: "ollama",
					name: "Ollama",
					requiresKey: false,
					available: ollamaAvailable,
				},
			]
		: [
				{
					id: "anthropic",
					name: "Anthropic",
					requiresKey: true,
					available: true,
				},
				{ id: "openai", name: "OpenAI", requiresKey: true, available: true },
				{
					id: "gemini",
					name: "Google Gemini",
					requiresKey: true,
					available: true,
				},
				{
					id: "openrouter",
					name: "OpenRouter",
					requiresKey: true,
					available: true,
				},
				{ id: "groq", name: "Groq", requiresKey: true, available: true },
				{
					id: "ollama",
					name: "Ollama",
					requiresKey: false,
					available: ollamaAvailable,
				},
			];

	useEffect(() => {
		let cancelled = false;
		llm
			.list()
			.then(() => {
				if (!cancelled) setOllamaAvailable(true);
			})
			.catch(() => {
				if (!cancelled) setOllamaAvailable(false);
			});
		// Also check CLI OAuth status
		api.runtime
			.cliStatus()
			.then((status) => {
				if (!cancelled) setCliStatus(status);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		api.llm
			.catalog()
			.then((rows) => {
				if (cancelled) return;
				setCatalogModels(
					rows.map((m) => ({
						id: m.id,
						label: m.displayName ?? m.id,
						provider: m.provider,
						tier: m.reasoningTier ?? "auto",
					})),
				);
			})
			.catch(() => {
				if (!cancelled) setCatalogModels([]);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		setEnabledProviders((prev) => {
			if (isOfflineOnly) {
				return {
					anthropic: false,
					openai: false,
					gemini: false,
					openrouter: false,
					groq: false,
					ollama: ollamaAvailable,
				};
			}
			return {
				...prev,
				ollama: ollamaAvailable ? Boolean(prev.ollama) : false,
			};
		});
	}, [availableModels, isOfflineOnly, ollamaAvailable]);

	// Resolve the active provider for the test endpoint based on either the
	// selected model (preferred) or the currently enabled provider set.
	const filteredServerModels = availableModels.filter(
		(m) =>
			enabledProviders[m.provider] &&
			(!isOfflineOnly || m.provider === "ollama"),
	);
	const filteredCatalogModels = catalogModels.filter(
		(m) =>
			enabledProviders[m.provider] &&
			(!isOfflineOnly || m.provider === "ollama"),
	);
	const filteredModels =
		filteredServerModels.length > 0
			? filteredServerModels
			: filteredCatalogModels;
	const selectedModel = filteredModels.find((m) => m.id === model);
	const activeProvider =
		selectedModel?.provider ??
		Object.entries(enabledProviders).find(([, on]) => on)?.[0] ??
		(isOfflineOnly ? "ollama" : "");
	const inlineProviderKey =
		activeProvider === "anthropic" ||
		activeProvider === "openai" ||
		activeProvider === "gemini" ||
		activeProvider === "openrouter" ||
		activeProvider === "groq"
			? (providerApiKeys[activeProvider]?.trim() ?? "")
			: "";
	const canContinue =
		Boolean(model) && (isOfflineOnly || envTestResult?.ok === true);
	const selectedAdapterConfig =
		ADAPTERS.find((adapter) => adapter.id === adapterType) ?? null;

	useEffect(() => {
		if (filteredModels.length === 0) {
			if (model) setModel("");
			return;
		}
		if (!model || !filteredModels.some((m) => m.id === model)) {
			setModel(filteredModels[0]?.id ?? "");
		}
	}, [filteredModels, model, setModel]);

	useEffect(() => {
		if (!selectedModel?.provider) return;
		const nextAdapter = PROVIDER_TO_ADAPTER[selectedModel.provider];
		if (nextAdapter && nextAdapter !== adapterType) setAdapterType(nextAdapter);
	}, [adapterType, selectedModel?.provider, setAdapterType]);

	async function handleTestEnv() {
		setTesting(true);
		setEnvTestResult(null);
		try {
			if (!activeProvider) {
				setEnvTestResult({ ok: false, error: "Choose an AI provider first." });
				return;
			}
			if (!isOfflineOnly && activeProvider !== "ollama") {
				const toolCompanyId = await ensureCompanyForTools();
				await persistProviderKeys(toolCompanyId);
				const res = await request<{
					ok: boolean;
					provider: string;
					model?: string;
					error?: string;
				}>(`/llm/providers/${encodeURIComponent(activeProvider)}/test`, {
					method: "POST",
					headers: { "x-company-id": toolCompanyId },
					body: JSON.stringify(
						inlineProviderKey ? { apiKey: inlineProviderKey } : {},
					),
				});
				setEnvTestResult({ ok: !!res.ok, model: res.model, error: res.error });
				return;
			}
			const res = await api.llm.providerTest(
				activeProvider,
				inlineProviderKey ? { apiKey: inlineProviderKey } : {},
			);
			setEnvTestResult({ ok: !!res.ok, model: res.model, error: res.error });
		} catch (err) {
			const message =
				err instanceof Error
					? err.message
					: "Could not connect to the server. Make sure it is running.";
			setEnvTestResult({ ok: false, error: message });
		} finally {
			setTesting(false);
		}
	}

	const handleAutoFillPrompt = useCallback(async () => {
		if (!agentName.trim()) {
			setPromptError("Set an agent name first");
			return;
		}
		setGeneratingPrompt(true);
		setPromptError(null);
		try {
			const toolCompanyId = await ensureCompanyForTools();
			await persistProviderKeys(toolCompanyId);
			const res = await request<{ instructions: string }>(
				"/agents/generate-instructions",
				{
					method: "POST",
					headers: { "x-company-id": toolCompanyId },
					body: JSON.stringify({
						role: agentName.trim(),
						...(companyGoal.trim() ? { companyGoal: companyGoal.trim() } : {}),
						...(companyName.trim() ? { companyName: companyName.trim() } : {}),
					}),
				},
			);
			setSystemPrompt(res.instructions);
		} catch (err) {
			const message =
				err instanceof Error
					? err.message
					: "Could not generate instructions right now.";
			setPromptError(message);
		} finally {
			setGeneratingPrompt(false);
		}
	}, [
		agentName,
		companyGoal,
		companyName,
		ensureCompanyForTools,
		persistProviderKeys,
		setSystemPrompt,
	]);

	useEffect(() => {
		const autofillKey = `${agentName.trim()}|${companyName.trim()}|${companyGoal.trim()}`;
		if (!envTestResult?.ok) return;
		if (systemPrompt.trim()) return;
		if (!agentName.trim()) return;
		if (lastAutoGeneratedKeyRef.current === autofillKey) return;
		lastAutoGeneratedKeyRef.current = autofillKey;
		void handleAutoFillPrompt();
	}, [
		agentName,
		companyGoal,
		companyName,
		envTestResult?.ok,
		handleAutoFillPrompt,
		systemPrompt,
	]);

	const handleInstallCli = async (tool: "codex" | "claude" | "copilot") => {
		setInstallingCli(tool);
		try {
			await api.runtime.installCli(tool);
			const status = await api.runtime.cliStatus();
			setCliStatus(status);
		} catch {
			// fail silently
		} finally {
			setInstallingCli(null);
		}
	};

	return (
		<div className="space-y-5">
			<div className="flex items-center gap-3 mb-6">
				<div className="w-9 h-9 rounded-lg bg-setra-600/15 flex items-center justify-center">
					<Bot className="w-5 h-5 text-setra-300" />
				</div>
				<div>
					<h2 className="text-lg font-semibold text-foreground">
						Configure your first agent
					</h2>
					<p className="text-xs text-muted-foreground">
						Enable providers, add keys, then pick a model
					</p>
				</div>
			</div>

			<div>
				<Label>Agent Name</Label>
				<Input value={agentName} onChange={setAgentName} placeholder="CEO" />
			</div>

			<div>
				<Label>Providers</Label>
				<div className="grid grid-cols-2 gap-2">
					{providers.map((p) => (
						<button
							key={p.id}
							type="button"
							onClick={() => {
								if (!p.available) return;
								setEnabledProviders((prev) => ({
									...prev,
									[p.id]: !prev[p.id],
								}));
								setEnvTestResult(null);
							}}
							className={`flex items-center justify-between p-3 rounded-lg border text-left transition-all ${
								enabledProviders[p.id]
									? "border-setra-500/50 bg-setra-600/10"
									: "border-border/50 hover:border-border hover:bg-muted/20"
							} ${!p.available ? "opacity-50 cursor-not-allowed" : ""}`}
						>
							<span className="text-sm font-medium text-foreground">
								{p.name}
							</span>
							<span
								className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
									!p.available
										? "text-muted-foreground border-border/40"
										: enabledProviders[p.id]
											? "text-accent-green border-accent-green/30"
											: "text-muted-foreground border-border/40"
								}`}
							>
								{!p.available
									? "unavailable"
									: enabledProviders[p.id]
										? "enabled"
										: "disabled"}
							</span>
						</button>
					))}
				</div>
				{!ollamaAvailable && (
					<p className="mt-2 text-xs text-muted-foreground/70">
						Ollama is not installed/running on this machine. Install and start
						it to use local models.
					</p>
				)}
			</div>

			{/* Provider keys */}
			{!isOfflineOnly && (
				<div>
					<Label hint="API keys let Setra connect to each AI provider you enable.">
						Provider API keys
					</Label>
					<div className="space-y-2">
						{enabledProviders.anthropic && (
							<ApiKeyInput
								label="Anthropic API Key"
								hint={
									<>
										Get yours at{" "}
										<a
											href="https://console.anthropic.com"
											target="_blank"
											rel="noreferrer"
											className="text-setra-400 hover:underline"
										>
											console.anthropic.com
										</a>
									</>
								}
								placeholder="sk-ant-api03-…"
								onKeySaved={(key) => {
									setProviderApiKey("anthropic", key);
									void refreshModels();
								}}
							/>
						)}
						{enabledProviders.openai && (
							<ApiKeyInput
								label="OpenAI API Key"
								hint={
									<>
										Get yours at{" "}
										<a
											href="https://platform.openai.com/api-keys"
											target="_blank"
											rel="noreferrer"
											className="text-setra-400 hover:underline"
										>
											platform.openai.com
										</a>
									</>
								}
								placeholder="sk-proj-…"
								onKeySaved={(key) => {
									setProviderApiKey("openai", key);
									void refreshModels();
								}}
							/>
						)}
						{enabledProviders.gemini && (
							<ApiKeyInput
								label="Gemini API Key"
								hint={
									<>
										Get yours at{" "}
										<a
											href="https://aistudio.google.com/apikey"
											target="_blank"
											rel="noreferrer"
											className="text-setra-400 hover:underline"
										>
											aistudio.google.com
										</a>
									</>
								}
								placeholder="AIza…"
								onKeySaved={(key) => {
									setProviderApiKey("gemini", key);
									void refreshModels();
								}}
							/>
						)}
						{enabledProviders.openrouter && (
							<ApiKeyInput
								label="OpenRouter API Key"
								hint={
									<>
										Get yours at{" "}
										<a
											href="https://openrouter.ai/keys"
											target="_blank"
											rel="noreferrer"
											className="text-setra-400 hover:underline"
										>
											openrouter.ai/keys
										</a>
									</>
								}
								placeholder="sk-or-v1-…"
								onKeySaved={(key) => {
									setProviderApiKey("openrouter", key);
									void refreshModels();
								}}
							/>
						)}
						{enabledProviders.groq && (
							<ApiKeyInput
								label="Groq API Key"
								hint={
									<>
										Get yours at{" "}
										<a
											href="https://console.groq.com/keys"
											target="_blank"
											rel="noreferrer"
											className="text-setra-400 hover:underline"
										>
											console.groq.com
										</a>
									</>
								}
								placeholder="gsk_…"
								onKeySaved={(key) => {
									setProviderApiKey("groq", key);
									void refreshModels();
								}}
							/>
						)}
					</div>
				</div>
			)}

			{/* CLI OAuth Login (subscription-based, no API key needed) */}
			{!isOfflineOnly && cliStatus && (
				<div>
					<Label hint="Use your ChatGPT Plus or Claude Max subscription — no API key needed.">
						CLI Login (OAuth)
					</Label>
					<div className="space-y-2">
						{/* Codex CLI */}
						<div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/10">
							<div className="flex items-center gap-2">
								<Terminal className="w-4 h-4 text-muted-foreground" />
								<div>
									<span className="text-sm font-medium text-foreground">
										Codex CLI (OpenAI)
									</span>
									<p className="text-[10px] text-muted-foreground">
										{cliStatus.codex.installed
											? cliStatus.codex.loggedIn
												? "✓ Logged in — GPT-5.x models included with ChatGPT Plus"
												: "Installed — run `codex login` in terminal"
											: "Not installed"}
									</p>
								</div>
							</div>
							{!cliStatus.codex.installed ? (
								<button
									type="button"
									onClick={() => handleInstallCli("codex")}
									disabled={installingCli !== null}
									className="text-[10px] font-medium px-2.5 py-1 rounded border border-setra-500/40 bg-setra-600/10 text-setra-300 hover:bg-setra-600/20 transition-colors disabled:opacity-50"
								>
									{installingCli === "codex" ? "Installing…" : "Install"}
								</button>
							) : (
								<span
									className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
										cliStatus.codex.loggedIn
											? "text-accent-green border-accent-green/30"
											: "text-amber-400 border-amber-400/30"
									}`}
								>
									{cliStatus.codex.loggedIn ? "connected" : "login needed"}
								</span>
							)}
						</div>

						{/* Claude CLI */}
						<div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/10">
							<div className="flex items-center gap-2">
								<Terminal className="w-4 h-4 text-muted-foreground" />
								<div>
									<span className="text-sm font-medium text-foreground">
										Claude Code (Anthropic)
									</span>
									<p className="text-[10px] text-muted-foreground">
										{cliStatus.claude.installed
											? cliStatus.claude.loggedIn
												? "✓ Logged in — Claude models included with Pro/Max plan"
												: "Installed — run `claude` in terminal to login"
											: "Not installed"}
									</p>
								</div>
							</div>
							{!cliStatus.claude.installed ? (
								<button
									type="button"
									onClick={() => handleInstallCli("claude")}
									disabled={installingCli !== null}
									className="text-[10px] font-medium px-2.5 py-1 rounded border border-setra-500/40 bg-setra-600/10 text-setra-300 hover:bg-setra-600/20 transition-colors disabled:opacity-50"
								>
									{installingCli === "claude" ? "Installing…" : "Install"}
								</button>
							) : (
								<span
									className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
										cliStatus.claude.loggedIn
											? "text-accent-green border-accent-green/30"
											: "text-amber-400 border-amber-400/30"
									}`}
								>
									{cliStatus.claude.loggedIn ? "connected" : "login needed"}
								</span>
							)}
						</div>

						{/* Copilot CLI */}
						<div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-muted/10">
							<div className="flex items-center gap-2">
								<Terminal className="w-4 h-4 text-muted-foreground" />
								<div>
									<span className="text-sm font-medium text-foreground">
										GitHub Copilot CLI
									</span>
									<p className="text-[10px] text-muted-foreground">
										{cliStatus.copilot.installed
											? cliStatus.copilot.loggedIn
												? "Logged in — uses your Copilot subscription"
												: "Installed — run `copilot` in terminal to login"
											: "Not installed"}
									</p>
								</div>
							</div>
							{!cliStatus.copilot.installed ? (
								<button
									type="button"
									onClick={() => handleInstallCli("copilot")}
									disabled={installingCli !== null}
									className="text-[10px] font-medium px-2.5 py-1 rounded border border-setra-500/40 bg-setra-600/10 text-setra-300 hover:bg-setra-600/20 transition-colors disabled:opacity-50"
								>
									{installingCli === "copilot" ? "Installing…" : "Install"}
								</button>
							) : (
								<span
									className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${
										cliStatus.copilot.loggedIn
											? "text-accent-green border-accent-green/30"
											: "text-amber-400 border-amber-400/30"
									}`}
								>
									{cliStatus.copilot.loggedIn ? "connected" : "login needed"}
								</span>
							)}
						</div>

						{(cliStatus.codex.loggedIn ||
							cliStatus.claude.loggedIn ||
							cliStatus.copilot.loggedIn) && (
							<p className="text-xs text-accent-green/80">
								CLI login detected — agents can use your subscription without an
								API key
							</p>
						)}
					</div>
				</div>
			)}

			{/* Unified model dropdown grouped by enabled providers */}
			{filteredModels.length > 0 ? (
				<div className="space-y-3">
					<div>
						<Label hint="A model is the AI engine this agent will use for its work.">
							Model
						</Label>
						<select
							value={model}
							onChange={(e) => setModel(e.target.value)}
							className="w-full bg-input border border-border/50 rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-setra-500 focus:border-setra-500 transition-colors"
						>
							{(
								[
									"anthropic",
									"openai",
									"gemini",
									"openrouter",
									"groq",
									"ollama",
								] as const
							).map((provider) => {
								const group = filteredModels.filter(
									(m) => m.provider === provider,
								);
								if (group.length === 0) return null;
								const labels: Record<string, string> = {
									anthropic: "Anthropic",
									openai: "OpenAI",
									gemini: "Google Gemini",
									openrouter: "OpenRouter",
									groq: "Groq",
									ollama: "Local (Ollama)",
								};
								return (
									<optgroup key={provider} label={labels[provider] ?? provider}>
										{group.map((m) => (
											<option key={m.id} value={m.id}>
												{m.label}
											</option>
										))}
									</optgroup>
								);
							})}
						</select>
					</div>

					<div>
						<Label hint="An adapter is the connector that links the agent to the selected provider or local runtime.">
							Adapter
						</Label>
						<div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2">
							<div className="flex items-center justify-between gap-3">
								<span className="text-sm font-medium text-foreground">
									{selectedAdapterConfig?.name ?? "Auto-detect"}
								</span>
								<span className="text-[10px] uppercase tracking-wider text-muted-foreground/60">
									Auto selected
								</span>
							</div>
							<p className="mt-1 text-xs text-muted-foreground">
								{selectedAdapterConfig?.description ??
									"We will pick the best adapter for this model."}
							</p>
						</div>
					</div>
				</div>
			) : (
				<p className="text-xs text-muted-foreground/70">
					No model is available yet. Enable a provider and add its API key
					(Ollama works without one).
				</p>
			)}

			{/* System prompt — optional. "Auto-fill from goal" calls the AI to
          draft a prompt for this role using the company name + goal. */}
			<div>
				<div className="flex items-center justify-between mb-1.5">
					<Label>
						System Instructions{" "}
						<span className="text-muted-foreground font-normal">
							(optional)
						</span>
					</Label>
					<button
						type="button"
						onClick={handleAutoFillPrompt}
						disabled={generatingPrompt || !agentName.trim()}
						className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-setra-300 hover:text-setra-200 hover:bg-setra-600/10 transition-colors disabled:opacity-40"
					>
						{generatingPrompt ? "Generating…" : "Auto-fill from goal"}
					</button>
				</div>
				<textarea
					value={systemPrompt}
					onChange={(e) => setSystemPrompt(e.target.value)}
					rows={4}
					placeholder={`You are the ${agentName.trim() || "agent"}…  (leave blank for a sensible default)`}
					className="w-full bg-input border border-border/50 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-setra-500 focus:border-setra-500 transition-colors resize-none font-mono"
				/>
				{promptError && (
					<p className="mt-1 text-xs text-accent-red">{promptError}</p>
				)}
			</div>

			<div>
				<button
					type="button"
					onClick={handleTestEnv}
					disabled={testing}
					className="flex items-center gap-2 px-3 py-2 rounded-md border border-border/50 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
				>
					<Terminal className="w-4 h-4" />
					{testing ? "Testing…" : "Test environment"}
				</button>

				{envTestResult?.ok && (
					<p className="mt-2 flex items-center gap-2 text-xs text-accent-green">
						<Check className="w-3 h-3" />
						Connected ✓
						{envTestResult.model ? ` (model: ${envTestResult.model})` : ""}
					</p>
				)}
				{envTestResult && !envTestResult.ok && (
					<p className="mt-2 text-xs text-accent-red">
						Could not connect: {envTestResult.error ?? "connection error"}
					</p>
				)}
			</div>

			<div className="flex items-center justify-between pt-2">
				<button
					type="button"
					onClick={onBack}
					className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-border/50 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
				>
					<ChevronLeft className="w-4 h-4" />
					Back
				</button>
				<button
					type="button"
					onClick={onNext}
					disabled={!canContinue}
					className="flex items-center gap-2 px-4 py-2 rounded-md bg-setra-600 hover:bg-setra-500 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				>
					Continue
					<ChevronRight className="w-4 h-4" />
				</button>
			</div>
			{!isOfflineOnly && !envTestResult?.ok && (
				<p className="text-xs text-muted-foreground/70">
					Complete <span className="text-foreground">Test environment</span>{" "}
					successfully to continue.
				</p>
			)}
		</div>
	);
}

function Step4({
	taskTitle,
	setTaskTitle,
	taskDescription,
	setTaskDescription,
	onBack,
	onLaunch,
	loading,
	error,
	launchStatus,
}: {
	taskTitle: string;
	setTaskTitle: (v: string) => void;
	taskDescription: string;
	setTaskDescription: (v: string) => void;
	onBack: () => void;
	onLaunch: () => void;
	loading: boolean;
	error: string | null;
	launchStatus?: string;
}) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	function handleDescChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
		setTaskDescription(e.target.value);
		const el = e.target;
		el.style.height = "auto";
		el.style.height = el.scrollHeight + "px";
	}

	return (
		<div className="space-y-5">
			<div className="flex items-center gap-3 mb-6">
				<div className="w-9 h-9 rounded-lg bg-setra-600/15 flex items-center justify-center">
					<ListTodo className="w-5 h-5 text-setra-300" />
				</div>
				<div>
					<h2 className="text-lg font-semibold text-foreground">
						Give your agent its first task
					</h2>
					<p className="text-xs text-muted-foreground">
						This issue will be assigned on launch
					</p>
				</div>
			</div>

			<div>
				<Label>Task Title *</Label>
				<Input
					value={taskTitle}
					onChange={setTaskTitle}
					placeholder="Describe the task…"
					required
				/>
			</div>

			<div>
				<Label>Task Description</Label>
				<textarea
					ref={textareaRef}
					value={taskDescription}
					onChange={handleDescChange}
					placeholder="Provide more context for the agent…"
					rows={6}
					className="w-full bg-input border border-border/50 rounded-md px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-setra-500 focus:border-setra-500 transition-colors resize-y overflow-y-auto max-h-[400px]"
				/>
			</div>

			{error && <p className="text-xs text-accent-red">{error}</p>}

			{loading && launchStatus && (
				<div className="flex items-center gap-2 px-3 py-2 rounded-md bg-setra-600/10 border border-setra-600/30">
					<span className="w-3.5 h-3.5 border-2 border-setra-300/30 border-t-setra-300 rounded-full animate-spin" />
					<span className="text-xs text-setra-200">{launchStatus}</span>
				</div>
			)}

			<div className="flex items-center justify-between pt-2">
				<button
					type="button"
					onClick={onBack}
					disabled={loading}
					className="flex items-center gap-1.5 px-3 py-2 rounded-md border border-border/50 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
				>
					<ChevronLeft className="w-4 h-4" />
					Back
				</button>
				<button
					type="button"
					onClick={onLaunch}
					disabled={!taskTitle.trim() || loading}
					className="flex items-center gap-2 px-4 py-2 rounded-md bg-setra-600 hover:bg-setra-500 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
				>
					{loading ? (
						<>
							<span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
							Setting up…
						</>
					) : (
						<>
							<Rocket className="w-4 h-4" />
							Finish setup
						</>
					)}
				</button>
			</div>
		</div>
	);
}

function Step5({
	companyName,
	onDone,
}: {
	companyName: string;
	onDone: () => void;
}) {
	const [animDone, setAnimDone] = useState(false);

	return (
		<div className="flex flex-col items-center justify-center min-h-[420px] gap-6">
			<AsciiArtAnimation
				companyName={companyName}
				onComplete={() => setAnimDone(true)}
			/>

			<button
				type="button"
				onClick={onDone}
				className={`flex items-center gap-2 px-5 py-2.5 rounded-md bg-setra-600 hover:bg-setra-500 text-white text-sm font-medium transition-all duration-500 ${
					animDone
						? "opacity-100 translate-y-0"
						: "opacity-0 translate-y-4 pointer-events-none"
				}`}
			>
				Open Dashboard
				<ArrowRight className="w-4 h-4" />
			</button>
		</div>
	);
}

type ProjectOnboardingStep = 1 | 2 | 3;

type ProjectWorkspaceType =
	| "engineering"
	| "marketing"
	| "research"
	| "general";

const PROJECT_WORKSPACE_TYPES: Array<{
	id: ProjectWorkspaceType;
	label: string;
	description: string;
	icon: LucideIcon;
}> = [
	{
		id: "engineering",
		label: "Engineering",
		description: "Ship code, coordinate builds, and manage technical delivery.",
		icon: Code2,
	},
	{
		id: "marketing",
		label: "Marketing",
		description: "Plan campaigns, content, and launch messaging.",
		icon: Megaphone,
	},
	{
		id: "research",
		label: "Research",
		description: "Collect findings, evaluate tools, and summarize insights.",
		icon: Globe,
	},
	{
		id: "general",
		label: "General",
		description: "Set up a flexible workspace for mixed team workflows.",
		icon: Layers,
	},
];

function ProjectOnboardingWizard({
	onClose,
	onCompanyCreated,
	onProjectCreated,
}: OnboardingWizardProps) {
	const [step, setStep] = useState<ProjectOnboardingStep>(1);
	const [workspaceType, setWorkspaceType] =
		useState<ProjectWorkspaceType>("engineering");
	const [projectName, setProjectName] = useState("");
	const [projectDescription, setProjectDescription] = useState("");
	// Seed the project with 1-3 starter tasks so the CEO has real work to
	// chew on as soon as onboarding finishes. Empty strings are filtered out.
	const [starterTasks, setStarterTasks] = useState<string[]>(["", "", ""]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!onClose) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);

	const selectedWorkspace =
		PROJECT_WORKSPACE_TYPES.find((item) => item.id === workspaceType) ??
		PROJECT_WORKSPACE_TYPES[0]!;

	const finish = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			let selectedCompanyId: string | null = null;
			try {
				const raw = localStorage.getItem("setra:selectedCompanyId");
				selectedCompanyId = raw ? (JSON.parse(raw) as string | null) : null;
			} catch {
				selectedCompanyId = null;
			}

			if (!selectedCompanyId && onCompanyCreated) {
				const companyName =
					projectName.trim() || `${selectedWorkspace.label} Workspace`;
				const company = await api.companies.create({
					name: companyName,
					type: "personal",
				});
				selectedCompanyId = company.id;
				localStorage.setItem(
					"setra:selectedCompanyId",
					JSON.stringify(company.id),
				);
				onCompanyCreated({
					...company,
					order: 0,
					type: "personal",
				});
			}

			const settingsRequest: RequestInit = {
				method: "POST",
				body: JSON.stringify({}),
			};
			if (selectedCompanyId) {
				settingsRequest.headers = { "x-company-id": selectedCompanyId };
			}
			// Touch /settings so the company-settings file exists; we no longer
			// force a model here (the workspace wizard already captured keys +
			// preferred model, and Setra auto-routes when one isn't set).
			await request("/settings", settingsRequest);

			const project = await api.projects.create({
				name: projectName.trim() || `${selectedWorkspace.label} Project`,
				...(projectDescription.trim()
					? { description: projectDescription.trim() }
					: {}),
			});

			// Seed the project with the starter tasks the user typed. Each
			// becomes a high-priority issue the CEO can immediately pick up
			// and decompose. Failures here must not block onboarding.
			const tasks = starterTasks
				.map((t) => t.trim())
				.filter((t) => t.length > 0);
			for (const title of tasks) {
				try {
					await api.issues.create({
						projectId: project.id,
						title,
						status: "todo",
						priority: "high",
					});
				} catch {
					/* per-task failure shouldn't fail the whole wizard */
				}
			}

			onProjectCreated?.({ id: project.id });
			onClose?.();
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Could not finish onboarding. Please try again.",
			);
		} finally {
			setLoading(false);
		}
	}, [
		onClose,
		onCompanyCreated,
		onProjectCreated,
		projectDescription,
		projectName,
		selectedWorkspace.label,
		starterTasks,
	]);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm overflow-y-auto py-8">
			<div className="w-full max-w-3xl mx-4 overflow-hidden rounded-xl border border-border/40 bg-[#0E1525] shadow-2xl max-h-[90vh] flex flex-col">
				<div className="border-b border-border/40 px-6 py-5">
					<div className="flex items-center justify-between gap-4">
						<div>
							<p className="text-xs uppercase tracking-[0.24em] text-muted-foreground/60">
								Get started
							</p>
							<h2 className="mt-2 text-2xl font-semibold text-white">
								Welcome to Setra
							</h2>
						</div>
						{onClose ? (
							<button
								type="button"
								onClick={onClose}
								className="rounded-md p-2 text-muted-foreground transition hover:bg-white/5 hover:text-white"
							>
								<X className="h-4 w-4" />
							</button>
						) : null}
					</div>
					<div className="mt-4 flex items-center gap-2">
						{([1, 2, 3] as const).map((item) => (
							<div
								key={item}
								className={`h-2 rounded-full transition-all ${
									step === item
										? "w-8 bg-setra-500"
										: step > item
											? "w-2 bg-setra-400"
											: "w-2 bg-muted"
								}`}
							/>
						))}
					</div>
				</div>

				<div className="space-y-6 px-6 py-6 overflow-y-auto flex-1 min-h-0">
					{step === 1 ? (
						<div className="space-y-5">
							<div>
								<p className="text-lg font-medium text-white">
									Choose your workspace type
								</p>
								<p className="mt-1 text-sm text-muted-foreground">
									We’ll tailor your starter experience around the kind of work
									you do most.
								</p>
							</div>
							<div className="grid gap-3 md:grid-cols-2">
								{PROJECT_WORKSPACE_TYPES.map((item) => {
									const Icon = item.icon;
									const active = workspaceType === item.id;
									return (
										<button
											key={item.id}
											type="button"
											onClick={() => setWorkspaceType(item.id)}
											className={`rounded-xl border p-4 text-left transition ${
												active
													? "border-setra-500 bg-setra-500/10"
													: "border-border/40 bg-white/[0.03] hover:border-setra-500/40"
											}`}
										>
											<div className="flex items-start gap-3">
												<div className="rounded-lg bg-white/5 p-2 text-setra-300">
													<Icon className="h-4 w-4" />
												</div>
												<div>
													<p className="font-medium text-white">{item.label}</p>
													<p className="mt-1 text-sm text-muted-foreground">
														{item.description}
													</p>
												</div>
											</div>
										</button>
									);
								})}
							</div>
						</div>
					) : null}

					{step === 2 ? (
						<div className="space-y-5">
							<div>
								<p className="text-lg font-medium text-white">
									Create your first project
								</p>
								<p className="mt-1 text-sm text-muted-foreground">
									Start with one project so your team has a home for files,
									tasks, and agents.
								</p>
							</div>
							<div className="space-y-3">
								<div>
									<label className="mb-1 block text-xs uppercase tracking-[0.18em] text-muted-foreground/60">
										Project name
									</label>
									<input
										value={projectName}
										onChange={(event) => setProjectName(event.target.value)}
										placeholder={`${selectedWorkspace.label} Project`}
										className="w-full rounded-lg border border-border/40 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-setra-500"
									/>
								</div>
								<div>
									<label className="mb-1 block text-xs uppercase tracking-[0.18em] text-muted-foreground/60">
										Description
									</label>
									<textarea
										value={projectDescription}
										onChange={(event) =>
											setProjectDescription(event.target.value)
										}
										placeholder="What do you want to build or coordinate first?"
										className="min-h-28 w-full rounded-lg border border-border/40 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-setra-500"
									/>
								</div>
							</div>
						</div>
					) : null}

					{step === 3 ? (
						<div className="space-y-5">
							<div>
								<p className="text-lg font-medium text-white">
									Add your first tasks
								</p>
								<p className="mt-1 text-sm text-muted-foreground">
									Drop in 1–3 things you want done. Your CEO agent will pick
									these up the moment setup finishes, break them into sub-tasks,
									and hire the specialists it needs from the agent pool. You can
									skip this and add tasks later.
								</p>
							</div>
							<div className="space-y-3">
								{starterTasks.map((value, idx) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: position is the identity here
									<div key={idx}>
										<label className="mb-1 block text-xs uppercase tracking-[0.18em] text-muted-foreground/60">
											Task {idx + 1}
											{idx === 0 ? " (recommended)" : " (optional)"}
										</label>
										<input
											value={value}
											onChange={(event) => {
												const next = [...starterTasks];
												next[idx] = event.target.value;
												setStarterTasks(next);
											}}
											placeholder={
												idx === 0
													? "e.g. Draft the architecture for our v1 API"
													: idx === 1
														? "e.g. Set up CI with lint, typecheck, and tests"
														: "e.g. Write the README and contributing guide"
											}
											className="w-full rounded-lg border border-border/40 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-setra-500"
										/>
									</div>
								))}
							</div>
							<div className="rounded-lg border border-setra-500/20 bg-setra-500/5 px-3 py-2 text-xs text-muted-foreground">
								<span className="text-setra-300">Tip:</span> only the CEO is
								provisioned at start. The CEO hires the rest of the team
								on-demand based on what each task actually needs.
							</div>
						</div>
					) : null}

					{error ? (
						<div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
							{error}
						</div>
					) : null}
				</div>

				<div className="flex items-center justify-between border-t border-border/40 px-6 py-4">
					<div className="text-sm text-muted-foreground">Step {step} of 3</div>
					<div className="flex items-center gap-3">
						{step > 1 ? (
							<button
								type="button"
								onClick={() =>
									setStep((current) => (current - 1) as ProjectOnboardingStep)
								}
								className="inline-flex items-center gap-2 rounded-lg border border-border/40 px-4 py-2 text-sm text-white transition hover:bg-white/5"
							>
								<ChevronLeft className="h-4 w-4" /> Back
							</button>
						) : null}
						<button
							type="button"
							onClick={() => {
								if (step < 3) {
									setStep((current) => (current + 1) as ProjectOnboardingStep);
									return;
								}
								void finish();
							}}
							disabled={loading}
							className="inline-flex items-center gap-2 rounded-lg bg-setra-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-setra-400 disabled:cursor-not-allowed disabled:opacity-60"
						>
							{step === 3 ? "Finish setup" : "Continue"}
							<ArrowRight className="h-4 w-4" />
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}

interface OnboardingWizardProps {
	variant?: "workspace" | "project";
	onClose?: () => void;
	onProjectCreated?: (project: { id: string }) => void;
	onCompanyCreated?: (company: {
		id: string;
		name: string;
		issuePrefix: string;
		brandColor?: string;
		type?: string;
		size?: string;
		order: number;
	}) => void;
}

function WorkspaceOnboardingWizard({
	onClose,
	onCompanyCreated,
}: OnboardingWizardProps) {
	const [step, setStep] = useState<Step>(1);

	// Step 1
	const [companyName, setCompanyName] = useState("");
	const [companyGoal, setCompanyGoal] = useState("");
	const [companyType, setCompanyType] = useState("startup");
	const [companySize, setCompanySize] = useState("0-10");
	const [isOfflineOnly, setIsOfflineOnly] = useState(false);

	// Step 2
	const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
	const [selectedSkills, setSelectedSkills] = useState<Set<string>>(
		new Set(["code-review", "pr-writing"]),
	);

	// Step 3
	const [agentName, setAgentName] = useState("CEO");
	const [adapterType, setAdapterType] = useState("auto");
	const [model, setModel] = useState("");
	const [systemPrompt, setSystemPrompt] = useState("");
	const [providerApiKeys, setProviderApiKeys] = useState<
		Partial<
			Record<"anthropic" | "openai" | "gemini" | "openrouter" | "groq", string>
		>
	>({});

	useEffect(() => {
		if (!onClose) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onClose]);
	const [envTestResult, setEnvTestResult] = useState<{
		ok: boolean;
		model?: string | undefined;
		error?: string | undefined;
	} | null>(null);

	// Step 4
	const [taskTitle, setTaskTitle] = useState(
		"Create the first engineering role brief and onboarding plan",
	);
	const [taskDescription, setTaskDescription] = useState(
		DEFAULT_TASK_DESCRIPTION,
	);

	// API-driven models
	const [availableModels, setAvailableModels] = useState<
		{ id: string; label: string; provider: string; tier: string }[]
	>([]);
	const [defaultApiModel, setDefaultApiModel] = useState("");

	const loadModels = useCallback(async () => {
		try {
			const data = await api.runtime.modelsCatalog();
			if (!data?.models) return;
			setAvailableModels(data.models);
			if (data.defaultModel) {
				setDefaultApiModel(data.defaultModel);
				setModel((prev) => prev || data.defaultModel);
			}
			return;
		} catch {
			// Fallback for pre-company onboarding: use public runtime catalog.
		}
		try {
			const fallback = await api.runtime.availableModels();
			const filtered = fallback
				.filter((m) => m.available)
				.map((m) => ({
					id: m.id,
					label: m.label ?? m.id,
					provider: m.provider,
					tier: "auto",
				}));
			if (filtered.length > 0) {
				setAvailableModels(filtered);
				setModel((prev) => prev || filtered[0]?.id || "");
			}
		} catch {
			// ignore — no models can be discovered
		}
	}, []);

	useEffect(() => {
		void loadModels();
	}, [loadModels]);

	// Created IDs / status
	const [createdCompanyId, setCreatedCompanyId] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [launchStatus, setLaunchStatus] = useState<string>("");

	function goTo(s: Step) {
		setStep(s);
		setError(null);
	}

	async function handleStep1Next() {
		if (!companyName.trim()) return;
		// Don't block onboarding progression on a network/server call in step 1.
		// Company creation happens at Launch in step 4 (and is retried there).
		goTo(2);
	}

	const ensureCompanyForTools = useCallback(async () => {
		if (createdCompanyId) return createdCompanyId;
		const company = await api.companies.create({
			name: companyName.trim(),
			...(companyGoal.trim() ? { goal: companyGoal.trim() } : {}),
			type: companyType,
			size: companySize,
			isOfflineOnly,
		});
		setCreatedCompanyId(company.id);
		try {
			localStorage.setItem(
				"setra:selectedCompanyId",
				JSON.stringify(company.id),
			);
		} catch {
			// ignore storage failures
		}
		return company.id;
	}, [
		companyGoal,
		companyName,
		companySize,
		companyType,
		createdCompanyId,
		isOfflineOnly,
	]);

	const persistProviderKeys = useCallback(
		async (companyId: string) => {
			const hasProviderKeys = Object.values(providerApiKeys).some(
				(v) => (v ?? "").trim().length > 0,
			);
			if (!hasProviderKeys) return;
			await request("/settings", {
				method: "POST",
				headers: { "x-company-id": companyId },
				body: JSON.stringify({
					...(providerApiKeys.anthropic?.trim()
						? { anthropicApiKey: providerApiKeys.anthropic.trim() }
						: {}),
					...(providerApiKeys.openai?.trim()
						? { openaiApiKey: providerApiKeys.openai.trim() }
						: {}),
					...(providerApiKeys.gemini?.trim()
						? { geminiApiKey: providerApiKeys.gemini.trim() }
						: {}),
					...(providerApiKeys.openrouter?.trim()
						? { openrouterApiKey: providerApiKeys.openrouter.trim() }
						: {}),
					...(providerApiKeys.groq?.trim()
						? { groqApiKey: providerApiKeys.groq.trim() }
						: {}),
					...(model ? { defaultModel: model } : {}),
				}),
			});
		},
		[model, providerApiKeys],
	);

	const handleLaunch = useCallback(async () => {
		if (!taskTitle.trim()) return;

		setLoading(true);
		setError(null);
		setLaunchStatus("Creating workspace…");

		try {
			const companyId = await ensureCompanyForTools();
			setLaunchStatus("Saving API keys…");
			await persistProviderKeys(companyId);

			onCompanyCreated?.({
				id: companyId,
				name: companyName.trim(),
				issuePrefix: companyName
					.trim()
					.slice(0, 3)
					.toUpperCase()
					.replace(/\s/g, ""),
				type: companyType as any,
				size: companySize as any,
				order: 0,
			});

			// Ensure a template exists for this agent name, then hire it. Without this,
			// the org tree and roster stay empty after onboarding.
			setLaunchStatus(`Setting up ${agentName.trim() || "your first agent"}…`);
			try {
				const templates = await api.agents.templates
					.list()
					.catch(() => [] as any[]);
				let template = templates.find(
					(t: any) => t.name?.toLowerCase() === agentName.trim().toLowerCase(),
				);
				if (!template) {
					template = await api.agents.templates
						.create({
							name: agentName.trim(),
							description: `${agentName.trim()} for ${companyName.trim()}`,
							agent: adapterType || "auto",
							...(model ? { model } : {}),
							systemPrompt:
								systemPrompt.trim() ||
								`You are the ${agentName.trim()} of ${companyName.trim()}. ` +
									(companyGoal.trim()
										? `The company goal is: ${companyGoal.trim()}. `
										: "") +
									`Coordinate work, delegate tasks, and keep the team moving.`,
							estimatedCostTier: "medium",
						})
						.catch(() => null);
				}
				if (template?.id) {
					await api.agents.roster
						.hire({
							templateId: template.id,
							displayName: agentName.trim(),
							reportsTo: null,
							companyId,
						})
						.catch(() => null);
				}
			} catch {
				// Non-fatal — onboarding still continues even if agent setup fails;
				// you can add one from the Agents page later.
			}

			// Create first project to house the issue (use company name)
			setLaunchStatus("Setting up your first project…");
			const project = await api.projects.create({
				name: companyName.trim(),
				...(companyGoal.trim() ? { description: companyGoal.trim() } : {}),
			});

			// Create the first issue
			setLaunchStatus("Assigning the first task…");
			await api.issues.create({
				projectId: project.id,
				title: taskTitle.trim(),
				...(taskDescription.trim()
					? { description: taskDescription.trim() }
					: {}),
				status: "todo",
				priority: "high",
			});

			setLaunchStatus("Done!");
			goTo(5);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "Something went wrong. Please try again.",
			);
		} finally {
			setLoading(false);
		}
	}, [
		taskTitle,
		taskDescription,
		createdCompanyId,
		companyName,
		companyGoal,
		companyType,
		companySize,
		isOfflineOnly,
		agentName,
		adapterType,
		model,
		systemPrompt,
		onCompanyCreated,
		providerApiKeys,
		ensureCompanyForTools,
		persistProviderKeys,
	]);

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm overflow-y-auto py-8">
			<div className="w-full max-w-2xl mx-4 glass rounded-xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
				{onClose && (
					<div className="flex justify-end px-4 pt-4 pb-0">
						<button
							type="button"
							aria-label="Close onboarding"
							onClick={onClose}
							className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
						>
							<X className="w-4 h-4" />
						</button>
					</div>
				)}
				{step !== 5 && (
					<div className="px-8 pt-4 pb-0">
						<StepDots current={step} total={5} />
					</div>
				)}

				<div className="px-8 pb-8 pt-4 overflow-y-auto flex-1 min-h-0">
					{step === 1 && (
						<Step1
							companyName={companyName}
							setCompanyName={setCompanyName}
							companyGoal={companyGoal}
							setCompanyGoal={setCompanyGoal}
							companyType={companyType}
							setCompanyType={setCompanyType}
							companySize={companySize}
							setCompanySize={setCompanySize}
							isOfflineOnly={isOfflineOnly}
							setIsOfflineOnly={setIsOfflineOnly}
							onNext={handleStep1Next}
							{...(onClose ? { onCancel: onClose } : {})}
						/>
					)}

					{step === 2 && (
						<Step2
							selectedTemplate={selectedTemplate}
							setSelectedTemplate={setSelectedTemplate}
							selectedSkills={selectedSkills}
							setSelectedSkills={setSelectedSkills}
							onBack={() => goTo(1)}
							onNext={() => goTo(3)}
						/>
					)}

					{step === 3 && (
						<Step3
							agentName={agentName}
							setAgentName={setAgentName}
							adapterType={adapterType}
							setAdapterType={setAdapterType}
							model={model}
							setModel={setModel}
							systemPrompt={systemPrompt}
							setSystemPrompt={setSystemPrompt}
							companyName={companyName}
							companyGoal={companyGoal}
							isOfflineOnly={isOfflineOnly}
							availableModels={availableModels}
							refreshModels={loadModels}
							envTestResult={envTestResult}
							setEnvTestResult={setEnvTestResult}
							providerApiKeys={providerApiKeys}
							setProviderApiKey={(provider, key) => {
								setProviderApiKeys((prev) => ({ ...prev, [provider]: key }));
								setEnvTestResult(null);
							}}
							ensureCompanyForTools={ensureCompanyForTools}
							persistProviderKeys={persistProviderKeys}
							onBack={() => goTo(2)}
							onNext={() => goTo(4)}
						/>
					)}

					{step === 4 && (
						<Step4
							taskTitle={taskTitle}
							setTaskTitle={setTaskTitle}
							taskDescription={taskDescription}
							setTaskDescription={setTaskDescription}
							onBack={() => goTo(3)}
							onLaunch={handleLaunch}
							loading={loading}
							error={error}
							launchStatus={launchStatus}
						/>
					)}

					{step === 5 && (
						<Step5 companyName={companyName} onDone={() => onClose?.()} />
					)}
				</div>
			</div>
		</div>
	);
}

export function OnboardingWizard(props: OnboardingWizardProps) {
	if (props.variant === "project") {
		return <ProjectOnboardingWizard {...props} />;
	}
	return <WorkspaceOnboardingWizard {...props} />;
}

export default OnboardingWizard;
