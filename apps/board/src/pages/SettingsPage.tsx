import {
	useMutation,
	useQueries,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	AlertCircle,
	CheckCircle,
	Clock,
	Cpu,
	ExternalLink,
	Eye,
	EyeOff,
	ImageIcon,
	Info,
	Key,
	type LucideIcon,
	Palette,
	Shield,
	Sparkles,
	Terminal,
	Zap,
} from "lucide-react";
import {
	type ChangeEvent,
	type ReactNode,
	type Ref,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Badge,
	Button,
	Card,
	Input,
	PageHeader,
	Select,
	Skeleton,
} from "../components/ui";
import { useCompany } from "../context/CompanyContext";
import { api, request } from "../lib/api";
import { cn } from "../lib/utils";
import { SecretsTab } from "./IntegrationsPage";

type ServerSettings = {
	defaultModel: string;
	smallModel: string;
	budget: { dailyUsd: number; perRunUsd: number; alertAt: number };
	governance: {
		deployMode: string;
		autoApprove: boolean;
		reviewRisk: string;
		approvalActions?: string[];
	};
	autonomy?: { autoDispatchEnabled: boolean; maxParallelRuns: number };
	appearance?: {
		theme: "dark" | "light" | "system";
		fontFamily: string;
		fontSize: number;
		uiScale: number;
		sidebarPosition: "left" | "right";
	};
	webSearchEnabled?: boolean;
	isOfflineOnly?: boolean;
	hasAnthropicKey: boolean;
	hasOpenaiKey: boolean;
	hasOpenrouterKey: boolean;
	hasGroqKey: boolean;
	hasGeminiKey?: boolean;
	hasTogetherKey: boolean;
	hasTavilyKey: boolean;
	hasBraveKey: boolean;
	hasSerperKey: boolean;
	keys?: {
		anthropic?: string;
		openai?: string;
		openrouter?: string;
		groq?: string;
		gemini?: string;
		together?: string;
		tavily?: string;
		brave?: string;
		serper?: string;
	};
};

type ModelEntry = { id: string; label: string; provider: string; tier: string };
type ModelsResponse = { models: ModelEntry[]; defaultModel: string };
type ProviderCatalogModel = {
	id: string;
	name?: string;
	displayName?: string;
	provider?: string;
	size?: number;
};
type ProviderDisplayModel = {
	id: string;
	label: string;
	provider: ProviderId;
	disabled: boolean;
	disabledReason?: string | undefined;
};
type MemoryModelStatus = {
	downloaded: boolean;
	downloading: boolean;
	modelId: string;
	path: string;
	message?: string;
	error?: string | null;
};
type ProviderId =
	| "anthropic"
	| "openai"
	| "gemini"
	| "openrouter"
	| "groq"
	| "ollama";

type TabId = (typeof tabs)[number]["id"];

type PasswordFieldProps = {
	id: string;
	label: string;
	helperText: string;
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	serverSaved?: boolean;
	error?: string | undefined;
	inputRef?: Ref<HTMLInputElement>;
};

type SettingToggleProps = {
	id: string;
	label: string;
	description: string;
	checked: boolean;
	onChange: (value: boolean) => void;
	disabled?: boolean | undefined;
};

const PROVIDERS: Array<{
	id: ProviderId;
	label: string;
	requiresKey: boolean;
}> = [
	{ id: "anthropic", label: "Anthropic", requiresKey: true },
	{ id: "openai", label: "OpenAI", requiresKey: true },
	{ id: "gemini", label: "Gemini", requiresKey: true },
	{ id: "openrouter", label: "OpenRouter", requiresKey: true },
	{ id: "groq", label: "Groq", requiresKey: true },
	{ id: "ollama", label: "Ollama (Offline Mode)", requiresKey: false },
];

const tabs = [
	{ id: "general", label: "General", icon: Info },
	{ id: "aiProviders", label: "AI Providers", icon: Cpu },
	{ id: "secrets", label: "Password Manager", icon: Key },
	{ id: "governance", label: "Governance", icon: Shield },
	{ id: "autonomy", label: "Autonomy", icon: Zap },
	{ id: "appearance", label: "Appearance", icon: Palette },
] as const;

function useLocalSetting<T>(key: string, defaultValue: T): [T, (v: T) => void] {
	const [value, setValue] = useState<T>(() => {
		try {
			const stored = localStorage.getItem(`setra:${key}`);
			return stored !== null ? (JSON.parse(stored) as T) : defaultValue;
		} catch {
			return defaultValue;
		}
	});

	const set = (v: T) => {
		setValue(v);
		try {
			localStorage.setItem(`setra:${key}`, JSON.stringify(v));
			if (key.startsWith("appearance:")) {
				window.dispatchEvent(new Event("setra:appearance-change"));
			}
		} catch {
			/* noop */
		}
	};

	return [value, set];
}

function LoadingSkeleton() {
	return (
		<div className="space-y-6">
			<Card>
				<div className="space-y-3">
					<Skeleton width="180px" />
					<Skeleton variant="rect" height="42px" count={3} />
				</div>
			</Card>
			<Card>
				<div className="grid gap-4 md:grid-cols-2">
					<div className="space-y-3">
						<Skeleton width="140px" />
						<Skeleton variant="rect" height="42px" />
					</div>
					<div className="space-y-3">
						<Skeleton width="160px" />
						<Skeleton variant="rect" height="42px" />
					</div>
					<div className="space-y-3">
						<Skeleton width="150px" />
						<Skeleton variant="rect" height="42px" />
					</div>
					<div className="space-y-3">
						<Skeleton width="170px" />
						<Skeleton variant="rect" height="42px" />
					</div>
				</div>
			</Card>
			<Card>
				<Skeleton variant="rect" height="88px" count={2} />
			</Card>
		</div>
	);
}

function SectionIntro({
	icon: Icon,
	title,
	description,
}: {
	icon: LucideIcon;
	title: string;
	description: string;
}) {
	return (
		<div className="flex items-start gap-3">
			<div className="rounded-lg bg-blue-500/10 p-2 text-blue-300">
				<Icon className="h-4 w-4" aria-hidden="true" />
			</div>
			<div className="space-y-1">
				<h2 className="text-base font-semibold text-white">{title}</h2>
				<p className="text-sm text-zinc-400">{description}</p>
			</div>
		</div>
	);
}

function PasswordField({
	id,
	label,
	helperText,
	value,
	onChange,
	placeholder,
	serverSaved,
	error,
	inputRef,
}: PasswordFieldProps) {
	const [show, setShow] = useState(false);

	return (
		<div className="space-y-2">
			<div className="relative">
				<Input
					ref={inputRef}
					id={id}
					label={label}
					helperText={helperText}
					error={error}
					type={show ? "text" : "password"}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					placeholder={placeholder}
					className="pr-10 font-mono"
					autoComplete="off"
				/>
				<button
					type="button"
					onClick={() => setShow((current) => !current)}
					className="absolute right-3 top-[2.35rem] text-zinc-400 transition-colors hover:text-zinc-200"
					aria-label={show ? `Hide ${label}` : `Show ${label}`}
				>
					{show ? (
						<EyeOff className="h-4 w-4" aria-hidden="true" />
					) : (
						<Eye className="h-4 w-4" aria-hidden="true" />
					)}
				</button>
			</div>
			{serverSaved && !value && (
				<div role="status" aria-live="polite">
					<Badge variant="success">
						<CheckCircle className="h-3 w-3" aria-hidden="true" />
						Key saved on server
					</Badge>
				</div>
			)}
		</div>
	);
}

function SettingToggle({
	id,
	label,
	description,
	checked,
	onChange,
	disabled,
}: SettingToggleProps) {
	const labelId = `${id}-label`;
	const descriptionId = `${id}-description`;

	return (
		<div className="flex items-start justify-between gap-4 rounded-lg border border-zinc-700/50 bg-zinc-900/30 p-4">
			<div className="space-y-1">
				<p id={labelId} className="text-sm font-medium text-white">
					{label}
				</p>
				<p id={descriptionId} className="text-sm text-zinc-400">
					{description}
				</p>
			</div>
			<button
				type="button"
				role="switch"
				id={id}
				aria-checked={checked}
				aria-labelledby={labelId}
				aria-describedby={descriptionId}
				disabled={disabled}
				onClick={() => onChange(!checked)}
				className={cn(
					"relative inline-flex h-6 w-11 shrink-0 rounded-full border border-transparent transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50",
					checked ? "bg-blue-600" : "bg-zinc-700",
				)}
			>
				<span
					className={cn(
						"inline-block h-5 w-5 translate-y-[1px] rounded-full bg-white shadow transition-transform",
						checked ? "translate-x-5" : "translate-x-0.5",
					)}
				/>
			</button>
		</div>
	);
}

function ProviderToggle({
	provider,
	enabled,
	disabled,
	description,
	statusLabel,
	statusVariant,
	onToggle,
}: {
	provider: (typeof PROVIDERS)[number];
	enabled: boolean;
	disabled?: boolean;
	description: string;
	statusLabel: string;
	statusVariant: "default" | "success" | "warning" | "danger" | "info";
	onToggle: () => void;
}) {
	const labelId = `${provider.id}-provider-label`;
	const descriptionId = `${provider.id}-provider-description`;

	return (
		<div className="flex items-start justify-between gap-4 rounded-lg border border-zinc-700/50 bg-zinc-900/30 p-4">
			<div className="space-y-1">
				<p id={labelId} className="text-sm font-medium text-white">
					{provider.label}
				</p>
				<p id={descriptionId} className="text-xs text-zinc-400">
					{description}
				</p>
			</div>
			<div className="flex items-center gap-3">
				<Badge variant={statusVariant}>{statusLabel}</Badge>
				<button
					type="button"
					role="switch"
					id={`${provider.id}-toggle`}
					aria-checked={enabled}
					aria-labelledby={labelId}
					aria-describedby={descriptionId}
					disabled={disabled}
					onClick={onToggle}
					className={cn(
						"relative inline-flex h-6 w-11 shrink-0 rounded-full border border-transparent transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-50",
						enabled ? "bg-blue-600" : "bg-zinc-700",
					)}
				>
					<span
						className={cn(
							"inline-block h-5 w-5 translate-y-[1px] rounded-full bg-white shadow transition-transform",
							enabled ? "translate-x-5" : "translate-x-0.5",
						)}
					/>
				</button>
			</div>
		</div>
	);
}

function ReadOnlyField({
	id,
	label,
	helperText,
	value,
}: {
	id: string;
	label: string;
	helperText: string;
	value: string;
}) {
	return (
		<Input
			id={id}
			label={label}
			helperText={helperText}
			value={value}
			readOnly
			className="text-zinc-300"
		/>
	);
}

function SaveState({ saved, isError }: { saved: boolean; isError: boolean }) {
	return (
		<div aria-live="polite" className="min-h-6 text-sm">
			{saved ? (
				<span className="inline-flex items-center gap-1.5 text-green-300">
					<CheckCircle className="h-4 w-4" aria-hidden="true" />
					Saved
				</span>
			) : null}
			{!saved && isError ? (
				<span className="inline-flex items-center gap-1.5 text-red-400">
					<AlertCircle className="h-4 w-4" aria-hidden="true" />
					Failed to save
				</span>
			) : null}
		</div>
	);
}

function renderModelOptions(
	options: Array<
		ModelEntry | string | { id: string; label: string; disabled?: boolean }
	>,
) {
	return options.map((option) => {
		if (typeof option === "string") {
			return (
				<option key={option} value={option}>
					{option}
				</option>
			);
		}

		return (
			<option
				key={option.id}
				value={option.id}
				disabled={"disabled" in option ? option.disabled : undefined}
			>
				{option.label}
			</option>
		);
	});
}

export function SettingsPage() {
	const [saved, setSaved] = useState(false);
	const urlTab = new URLSearchParams(window.location.search).get("tab");
	const initialTab =
		urlTab && tabs.some((t) => t.id === urlTab) ? (urlTab as TabId) : "general";
	const [activeTab, setActiveTab] = useState<TabId>(initialTab);
	const providersHydratedRef = useRef(false);
	const qc = useQueryClient();
	const { selectedCompany, selectedCompanyId } = useCompany();
	const desktopApi = (
		window as Window & {
			setra?: {
				memory?: {
					getModelStatus: () => Promise<MemoryModelStatus>;
					downloadModel: () => Promise<MemoryModelStatus>;
				};
			};
		}
	).setra;

	const settingsQuery = useQuery<ServerSettings>({
		queryKey: ["settings"],
		queryFn: () => request<ServerSettings>("/settings"),
	});
	const modelsQuery = useQuery<ModelsResponse>({
		queryKey: ["settings-models"],
		queryFn: () => request<ModelsResponse>("/settings/models"),
	});
	const localModelsProbe = useQuery({
		queryKey: ["settings-ollama-probe"],
		queryFn: async () => {
			const providers =
				await request<Array<{ id: string; configured: boolean }>>(
					"/llm/providers",
				);
			const ollama = providers.find((p) => p.id === "ollama");
			if (!ollama?.configured) throw new Error("Ollama not running");
			return true;
		},
		retry: false,
	});
	const memoryModelQuery = useQuery<MemoryModelStatus>({
		queryKey: ["memory-model-status"],
		queryFn: () =>
			desktopApi?.memory?.getModelStatus?.() ??
			Promise.resolve({
				downloaded: false,
				downloading: false,
				modelId: "Xenova/all-MiniLM-L6-v2",
				path: "~/.setra/models/Xenova/all-MiniLM-L6-v2",
				message:
					"Desktop memory controls are only available inside the Setra desktop app.",
				error: null,
			}),
		staleTime: 5_000,
		retry: false,
	});

	const serverSettings = settingsQuery.data;
	const modelsData = modelsQuery.data;
	const isInitialLoading = settingsQuery.isPending || modelsQuery.isPending;
	const ollamaAvailable = localModelsProbe.isPending
		? false
		: !localModelsProbe.isError;
	const modelOptions: ModelEntry[] = modelsData?.models ?? [];

	const { data: cliStatus } = useQuery({
		queryKey: ["cli-status"],
		queryFn: api.runtime.cliStatus,
		staleTime: 30_000,
		retry: false,
	});

	const [anthropicKey, setAnthropicKey] = useLocalSetting(
		"apiKey.anthropic",
		"",
	);
	const [openaiKey, setOpenaiKey] = useLocalSetting("apiKey.openai", "");
	const [geminiKey, setGeminiKey] = useLocalSetting("apiKey.gemini", "");
	const [groqKey, setGroqKey] = useLocalSetting("apiKey.groq", "");
	const [openrouterKey, setOpenrouterKey] = useLocalSetting(
		"apiKey.openrouter",
		"",
	);
	const [tavilyKey, setTavilyKey] = useLocalSetting("apiKey.tavily", "");
	const [braveKey, setBraveKey] = useLocalSetting("apiKey.brave", "");
	const [serperKey, setSerperKey] = useLocalSetting("apiKey.serper", "");
	const [enabledProviders, setEnabledProviders] = useState<
		Record<ProviderId, boolean>
	>({
		anthropic: false,
		openai: false,
		gemini: false,
		openrouter: false,
		groq: false,
		ollama: ollamaAvailable,
	});
	const [defaultModel, setDefaultModel] = useLocalSetting(
		"model.default",
		"claude-sonnet-4-6",
	);
	const [smallModel, setSmallModel] = useLocalSetting(
		"model.small",
		"claude-haiku-4-5",
	);
	const [deployMode, setDeployMode] = useLocalSetting<
		"manual" | "semi" | "auto"
	>("governance.deployMode", "manual");
	const [autoApprove, setAutoApprove] = useLocalSetting(
		"governance.autoApprove",
		false,
	);
	const [reviewRisk, setReviewRisk] = useLocalSetting<
		"low" | "medium" | "high"
	>("governance.reviewRisk", "medium");
	const [autoDispatchEnabled, setAutoDispatchEnabled] = useLocalSetting(
		"autonomy.autoDispatchEnabled",
		true,
	);
	const [continuousModeAll, setContinuousModeAll] = useLocalSetting(
		"governance.continuousModeAll",
		false,
	);
	const [continuousInterval, setContinuousInterval] = useLocalSetting(
		"governance.continuousInterval",
		5,
	);
	const [webSearchEnabled, setWebSearchEnabled] = useLocalSetting(
		"ai.webSearchEnabled",
		true,
	);
	const [maxParallelRuns, setMaxParallelRuns] = useLocalSetting(
		"autonomy.maxParallelRuns",
		7,
	);
	const [approvalActions, setApprovalActions] = useLocalSetting<
		Record<string, boolean>
	>("autonomy.approvalActions", {
		task_start: true,
		pr_merge: true,
		agent_hire: true,
		deploy: true,
	});
	const [fontSize, setFontSize] = useLocalSetting<number>(
		"appearance:fontSize",
		13,
	);
	const [fontFamily, setFontFamily] = useLocalSetting<string>(
		"appearance:fontFamily",
		"JetBrains Mono, monospace",
	);
	const [theme, setTheme] = useLocalSetting<"dark" | "light" | "system">(
		"appearance:theme",
		"dark",
	);
	const [uiScale, setUiScale] = useLocalSetting<number>(
		"appearance:uiScale",
		100,
	);
	const [sidebarPosition, setSidebarPosition] = useLocalSetting<
		"left" | "right"
	>("appearance:sidebarPosition", "left");
	const [companyLogo, setCompanyLogo] = useState("");
	const [logoError, setLogoError] = useState<string | null>(null);
	const anthropicKeyRef = useRef<HTMLInputElement>(null);
	const openaiKeyRef = useRef<HTMLInputElement>(null);
	const geminiKeyRef = useRef<HTMLInputElement>(null);
	const groqKeyRef = useRef<HTMLInputElement>(null);
	const openrouterKeyRef = useRef<HTMLInputElement>(null);
	const savedTimerRef = useRef<ReturnType<typeof setTimeout>>();
	useEffect(() => () => clearTimeout(savedTimerRef.current), []);
	const [providerWarnings, setProviderWarnings] = useState<
		Partial<Record<ProviderId, string>>
	>({});
	const providerModelQueries = useQueries({
		queries: PROVIDERS.map((provider) => ({
			queryKey: ["settings-provider-models", provider.id],
			queryFn: () => api.runtime.modelsForProvider(provider.id),
			staleTime: 30_000,
			retry: false,
			enabled: provider.id !== "ollama" || ollamaAvailable,
		})),
	});
	const providerCatalogById = PROVIDERS.reduce<
		Record<ProviderId, ProviderCatalogModel[]>
	>(
		(accumulator, provider, index) => {
			accumulator[provider.id] =
				(providerModelQueries[index]?.data as
					| ProviderCatalogModel[]
					| undefined) ?? [];
			return accumulator;
		},
		{
			anthropic: [],
			openai: [],
			gemini: [],
			openrouter: [],
			groq: [],
			ollama: [],
		},
	);
	const ollamaModelsQuery = providerModelQueries[PROVIDERS.length - 1];
	const savedProviderKeys = {
		anthropic: Boolean(serverSettings?.hasAnthropicKey),
		openai: Boolean(serverSettings?.hasOpenaiKey),
		gemini: Boolean(serverSettings?.hasGeminiKey),
		openrouter: Boolean(serverSettings?.hasOpenrouterKey),
		groq: Boolean(serverSettings?.hasGroqKey),
	} as const;
	const clearProviderWarning = (providerId: ProviderId) => {
		setProviderWarnings((previous) => {
			const next = { ...previous };
			delete next[providerId];
			return next;
		});
	};
	const focusProviderKeyField = (providerId: Exclude<ProviderId, "ollama">) => {
		const refMap = {
			anthropic: anthropicKeyRef,
			openai: openaiKeyRef,
			gemini: geminiKeyRef,
			groq: groqKeyRef,
			openrouter: openrouterKeyRef,
		} as const;
		const ref = refMap[providerId];
		ref.current?.focus();
		ref.current?.select();
	};
	const requireSavedKey = (provider: (typeof PROVIDERS)[number]) => {
		setProviderWarnings((previous) => ({
			...previous,
			[provider.id]: `Add and save an API key before using ${provider.label}.`,
		}));
		if (provider.id !== "ollama") focusProviderKeyField(provider.id);
	};
	const normalizeOllamaModelId = (value: string) =>
		value.startsWith("ollama:") ? value.slice("ollama:".length) : value;
	const formatCatalogLabel = (model: ProviderCatalogModel) => {
		if (model.displayName) return model.displayName;
		if (model.name) return model.name;
		return model.id.startsWith("ollama:") ? model.id.slice(7) : model.id;
	};
	const getProviderModels = (provider: (typeof PROVIDERS)[number]) => {
		if (provider.id === "ollama") {
			const baseModels = modelOptions
				.filter((model) => model.provider === "ollama")
				.map<ProviderDisplayModel>((model) => ({
					id: model.id,
					label: model.label,
					provider: "ollama",
					disabled: false,
				}));
			const downloadedNames = new Set(
				providerCatalogById.ollama.map((model) =>
					normalizeOllamaModelId(model.name ?? model.id),
				),
			);
			const hasLocalInventory = ollamaModelsQuery?.isSuccess;
			const mergedBase = baseModels.map((model) => {
				const isDownloaded = hasLocalInventory
					? downloadedNames.has(normalizeOllamaModelId(model.id))
					: ollamaAvailable;
				return {
					...model,
					label:
						hasLocalInventory && !isDownloaded
							? `${model.label} (not downloaded)`
							: model.label,
					disabled: !ollamaAvailable || !isDownloaded,
					disabledReason: !ollamaAvailable
						? "Ollama is not running"
						: hasLocalInventory && !isDownloaded
							? "Model not downloaded"
							: undefined,
				};
			});
			const extraDownloaded = providerCatalogById.ollama
				.filter(
					(model) =>
						!mergedBase.some(
							(existing) =>
								normalizeOllamaModelId(existing.id) ===
								normalizeOllamaModelId(model.name ?? model.id),
						),
				)
				.map<ProviderDisplayModel>((model) => ({
					id: model.id.startsWith("ollama:")
						? model.id
						: `ollama:${model.name ?? model.id}`,
					label: `${formatCatalogLabel(model)} · Local`,
					provider: "ollama",
					disabled: !ollamaAvailable,
					disabledReason: !ollamaAvailable
						? "Ollama is not running"
						: undefined,
				}));
			return [...mergedBase, ...extraDownloaded];
		}

		const hasSavedKey = savedProviderKeys[provider.id];
		const fallbackModels = modelOptions.filter(
			(model) => model.provider === provider.id,
		);
		const sourceModels = providerCatalogById[provider.id].length
			? providerCatalogById[provider.id].map((model) => ({
					id: model.id,
					label: formatCatalogLabel(model),
					provider: provider.id,
					tier: "catalog",
				}))
			: fallbackModels;
		return sourceModels.map<ProviderDisplayModel>((model) => ({
			id: model.id,
			label: model.label,
			provider: provider.id,
			disabled: !hasSavedKey,
			disabledReason: !hasSavedKey ? "API key required" : undefined,
		}));
	};
	const providerModels = PROVIDERS.reduce<
		Record<ProviderId, ProviderDisplayModel[]>
	>(
		(accumulator, provider) => {
			accumulator[provider.id] = getProviderModels(provider);
			return accumulator;
		},
		{
			anthropic: [],
			openai: [],
			gemini: [],
			openrouter: [],
			groq: [],
			ollama: [],
		},
	);
	const modelLabelById = new Map<string, string>(
		Object.values(providerModels)
			.flat()
			.map((model) => [model.id, model.label]),
	);
	const selectableModelOptions = Object.values(providerModels)
		.flat()
		.filter(
			(model) =>
				enabledProviders[model.provider] &&
				!model.disabled &&
				(!serverSettings?.isOfflineOnly || model.provider === "ollama"),
		)
		.map((model) => ({ id: model.id, label: model.label }));
	const buildModelSelectOptions = (currentValue: string) => {
		const options: Array<{ id: string; label: string; disabled?: boolean }> = [
			...selectableModelOptions,
		];
		if (!options.some((option) => option.id === currentValue)) {
			const known = modelLabelById.get(currentValue);
			const note = known
				? `${known} (saved — provider key missing)`
				: `${currentValue} (saved — provider key missing)`;
			options.unshift({
				id: currentValue,
				label: note,
				disabled: true,
			});
		}
		return options;
	};
	const defaultModelSelectOptions = buildModelSelectOptions(defaultModel);
	const smallModelSelectOptions = buildModelSelectOptions(smallModel);

	useEffect(() => {
		const root = document.documentElement;
		const applyTheme = (prefersDark: boolean) => {
			root.classList.toggle("dark", prefersDark);
			root.classList.toggle("light", !prefersDark);
		};
		if (theme === "system") {
			const mq = window.matchMedia("(prefers-color-scheme: dark)");
			applyTheme(mq.matches);
			const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
			mq.addEventListener("change", handler);
			return () => mq.removeEventListener("change", handler);
		}
		root.classList.toggle("dark", theme === "dark");
		root.classList.toggle("light", theme === "light");
		return undefined;
	}, [theme]);

	useEffect(() => {
		setCompanyLogo(selectedCompany?.logoUrl ?? "");
		setLogoError(null);
	}, [selectedCompany?.id, selectedCompany?.logoUrl]);

	useEffect(() => {
		if (!serverSettings) return;
		if (serverSettings.defaultModel)
			setDefaultModel(serverSettings.defaultModel);
		if (serverSettings.smallModel) setSmallModel(serverSettings.smallModel);
		if (serverSettings.governance) {
			setDeployMode(
				serverSettings.governance.deployMode as "manual" | "semi" | "auto",
			);
			setAutoApprove(serverSettings.governance.autoApprove);
			setReviewRisk(
				serverSettings.governance.reviewRisk as "low" | "medium" | "high",
			);
		}
		if (serverSettings.autonomy) {
			setAutoDispatchEnabled(serverSettings.autonomy.autoDispatchEnabled);
			setMaxParallelRuns(serverSettings.autonomy.maxParallelRuns);
		}
		if (serverSettings.appearance) {
			setTheme(serverSettings.appearance.theme);
			setFontFamily(serverSettings.appearance.fontFamily);
			setFontSize(serverSettings.appearance.fontSize);
			setUiScale(serverSettings.appearance.uiScale);
			setSidebarPosition(serverSettings.appearance.sidebarPosition);
		}
		setWebSearchEnabled(serverSettings.webSearchEnabled ?? true);

		const keys = serverSettings.keys ?? {};
		if (!anthropicKey && keys.anthropic) setAnthropicKey(keys.anthropic);
		if (!openaiKey && keys.openai) setOpenaiKey(keys.openai);
		if (!geminiKey && keys.gemini) setGeminiKey(keys.gemini);
		if (!groqKey && keys.groq) setGroqKey(keys.groq);
		if (!openrouterKey && keys.openrouter) setOpenrouterKey(keys.openrouter);
		if (!tavilyKey && keys.tavily) setTavilyKey(keys.tavily);
		if (!braveKey && keys.brave) setBraveKey(keys.brave);
		if (!serperKey && keys.serper) setSerperKey(keys.serper);

		if (!providersHydratedRef.current) {
			setEnabledProviders((previous) => ({
				...previous,
				anthropic: Boolean(serverSettings.hasAnthropicKey),
				openai: Boolean(serverSettings.hasOpenaiKey),
				gemini: Boolean(serverSettings.hasGeminiKey),
				openrouter: Boolean(serverSettings.hasOpenrouterKey),
				groq: Boolean(serverSettings.hasGroqKey),
				ollama: ollamaAvailable,
			}));
			providersHydratedRef.current = true;
		} else if (!ollamaAvailable) {
			setEnabledProviders((previous) => ({ ...previous, ollama: false }));
		}
	}, [serverSettings, ollamaAvailable]);

	useEffect(() => {
		setEnabledProviders((previous) => ({
			...previous,
			anthropic: previous.anthropic || anthropicKey.trim().length > 0,
			openai: previous.openai || openaiKey.trim().length > 0,
			gemini: previous.gemini || geminiKey.trim().length > 0,
			openrouter: previous.openrouter || openrouterKey.trim().length > 0,
			groq: previous.groq || groqKey.trim().length > 0,
			ollama: ollamaAvailable && previous.ollama,
		}));
	}, [
		anthropicKey,
		openaiKey,
		geminiKey,
		groqKey,
		openrouterKey,
		ollamaAvailable,
	]);

	const saveSettings = useMutation({
		mutationFn: async () => {
			await request("/settings", {
				method: "POST",
				body: JSON.stringify({
					anthropicApiKey: anthropicKey || undefined,
					openaiApiKey: openaiKey || undefined,
					geminiApiKey: geminiKey || undefined,
					groqApiKey: groqKey || undefined,
					openrouterApiKey: openrouterKey || undefined,
					tavilyApiKey: tavilyKey || undefined,
					braveApiKey: braveKey || undefined,
					serperApiKey: serperKey || undefined,
					webSearchEnabled,
					defaultModel,
					smallModel,
					governance: {
						deployMode,
						autoApprove,
						reviewRisk,
						approvalActions: autoApprove
							? []
							: Object.entries(approvalActions)
									.filter(([, v]) => v)
									.map(([k]) => k),
					},
					autonomy: { autoDispatchEnabled, maxParallelRuns },
					appearance: {
						theme,
						fontFamily,
						fontSize,
						uiScale,
						sidebarPosition,
					},
				}),
			});

			if (selectedCompanyId && companyLogo) {
				try {
					await request(`/companies/${selectedCompanyId}/logo`, {
						method: "POST",
						body: JSON.stringify({ logo: companyLogo }),
					});
				} catch {
					// Logo save is non-critical — don't fail the whole save
				}
			}

			if (continuousModeAll) {
				await request("/agents/roster/mode/all", {
					method: "PATCH",
					body: JSON.stringify({
						run_mode: "continuous",
						continuous_interval_ms: continuousInterval * 60_000,
					}),
				});
			}
		},
		onSuccess: () => {
			setSaved(true);
			setLogoError(null);
			setProviderWarnings({});
			clearTimeout(savedTimerRef.current);
			savedTimerRef.current = setTimeout(() => setSaved(false), 2500);
			// Force-enable providers whose keys were just saved
			setEnabledProviders((prev) => ({
				...prev,
				anthropic: prev.anthropic || anthropicKey.trim().length > 0,
				openai: prev.openai || openaiKey.trim().length > 0,
				gemini: prev.gemini || geminiKey.trim().length > 0,
				groq: prev.groq || groqKey.trim().length > 0,
				openrouter: prev.openrouter || openrouterKey.trim().length > 0,
			}));
			void qc.invalidateQueries({ queryKey: ["settings"] });
			void qc.invalidateQueries({ queryKey: ["settings-models"] });
			void qc.invalidateQueries({ queryKey: ["settings-provider-models"] });
			void qc.invalidateQueries({ queryKey: ["llm-status"] });
			void qc.invalidateQueries({ queryKey: ["agents"] });
			void qc.invalidateQueries({ queryKey: ["companies"] });
		},
	});

	const handleCompanyLogoChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0];
			event.target.value = "";
			if (!file) return;
			if (!file.type.startsWith("image/")) {
				setLogoError("Please choose a PNG, JPG, SVG, or WebP image.");
				return;
			}
			if (file.size > 512 * 1024) {
				setLogoError("Logo must be 512KB or smaller.");
				return;
			}
			const reader = new FileReader();
			reader.onload = () => {
				setCompanyLogo(typeof reader.result === "string" ? reader.result : "");
				setLogoError(null);
			};
			reader.onerror = () => setLogoError("Could not read that image file.");
			reader.readAsDataURL(file);
		},
		[],
	);

	const [installingCli, setInstallingCli] = useState<string | null>(null);
	const [loggingInCli, setLoggingInCli] = useState<string | null>(null);
	const [installingOllama, setInstallingOllama] = useState(false);
	const [cliError, setCliError] = useState<string | null>(null);
	const handleInstallCli = async (tool: "codex" | "claude" | "copilot") => {
		setInstallingCli(tool);
		setCliError(null);
		try {
			await api.runtime.installCli(tool);
			void qc.invalidateQueries({ queryKey: ["cli-status"] });
		} catch (err) {
			setCliError(
				`Failed to install ${tool}: ${err instanceof Error ? err.message : "unknown error"}`,
			);
		} finally {
			setInstallingCli(null);
		}
	};
	const handleLoginCli = async (tool: "codex" | "claude" | "copilot") => {
		setLoggingInCli(tool);
		setCliError(null);
		try {
			await api.runtime.loginCli(tool);
		} catch (err) {
			setCliError(
				`Login for ${tool} may have failed: ${err instanceof Error ? err.message : "check terminal"}`,
			);
		} finally {
			setLoggingInCli(null);
			void qc.invalidateQueries({ queryKey: ["cli-status"] });
		}
	};

	const downloadMemoryModel = useMutation({
		mutationFn: async () => {
			const result = await desktopApi?.memory?.downloadModel?.();
			if (!result) throw new Error("Desktop API unavailable");
			return result;
		},
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["memory-model-status"] });
		},
	});
	const memoryModelStatus = memoryModelQuery.data;

	const semanticMemoryCard = (
		<Card
			actions={
				<Badge
					variant={
						memoryModelStatus?.downloaded
							? "success"
							: memoryModelStatus?.downloading
								? "warning"
								: "default"
					}
				>
					{memoryModelStatus?.downloaded
						? "Ready"
						: memoryModelStatus?.downloading
							? "Downloading"
							: "Not installed"}
				</Badge>
			}
		>
			<div className="space-y-6">
				<SectionIntro
					icon={Cpu}
					title="Semantic Memory"
					description="Vector memory allows agents to recall context from past runs. Download the embedding model to enable it."
				/>
				<div className="space-y-3 text-sm text-zinc-400">
					<p>
						{memoryModelStatus?.message ??
							"Download the local model when you want semantic memory enabled."}
					</p>
					<p className="font-mono text-xs text-zinc-500">
						{memoryModelStatus?.path ??
							"~/.setra/models/Xenova/all-MiniLM-L6-v2"}
					</p>
					{memoryModelStatus?.error ? (
						<p className="text-red-400">{memoryModelStatus.error}</p>
					) : null}
				</div>
				<div className="flex flex-wrap gap-3">
					<Button
						onClick={() => downloadMemoryModel.mutate()}
						disabled={
							!desktopApi?.memory ||
							downloadMemoryModel.isPending ||
							memoryModelStatus?.downloading ||
							memoryModelStatus?.downloaded
						}
					>
						{memoryModelStatus?.downloaded
							? "Downloaded"
							: downloadMemoryModel.isPending || memoryModelStatus?.downloading
								? "Downloading…"
								: "Download model"}
					</Button>
				</div>
			</div>
		</Card>
	);

	const aiProvidersCards = (
		<div className="space-y-6">
			<Card
				actions={
					<Badge variant={ollamaAvailable ? "success" : "danger"}>
						{ollamaAvailable
							? "Ollama ready — offline mode available"
							: "Ollama not installed — offline mode unavailable"}
					</Badge>
				}
			>
				<div className="space-y-6">
					<SectionIntro
						icon={Cpu}
						title="AI Providers"
						description="Connect cloud models, manage offline Ollama access, and choose which providers are active for this workspace."
					/>
					{serverSettings?.isOfflineOnly && (
						<div className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-200">
							Offline mode — only local Ollama models are available.
						</div>
					)}
					<div className="grid gap-4 xl:grid-cols-2">
						{PROVIDERS.map((provider) => {
							const enabled = enabledProviders[provider.id];
							const hasSavedKey =
								provider.id === "ollama"
									? false
									: savedProviderKeys[provider.id];
							const localKeyMap: Record<string, string> = {
								anthropic: anthropicKey,
								openai: openaiKey,
								gemini: geminiKey,
								groq: groqKey,
								openrouter: openrouterKey,
							};
							const hasLocalKey =
								provider.id !== "ollama" &&
								Boolean(localKeyMap[provider.id]?.trim());
							const hasAnyKey = hasSavedKey || hasLocalKey;
							const statusVariant =
								provider.id === "ollama"
									? ollamaAvailable
										? "success"
										: "danger"
									: enabled
										? hasAnyKey
											? "success"
											: "warning"
										: "default";
							const statusLabel =
								provider.id === "ollama"
									? ollamaAvailable
										? "Ready — offline mode"
										: "Not installed"
									: enabled
										? hasSavedKey
											? "Ready"
											: hasLocalKey
												? "Ready — click Save"
												: "Key required"
										: "Disabled";
							const offlineCloudProvider = Boolean(
								serverSettings?.isOfflineOnly && provider.id !== "ollama",
							);
							const description =
								provider.id === "ollama"
									? "Local models that run fully on this machine."
									: offlineCloudProvider
										? "Offline mode is on. Cloud models stay hidden from selectors until you leave offline mode."
										: "Add and save an API key to unlock models from this provider.";
							const models = providerModels[provider.id];
							return (
								<Card key={provider.id} className="space-y-4">
									<ProviderToggle
										provider={provider}
										enabled={enabled}
										disabled={provider.id === "ollama" && !ollamaAvailable}
										description={description}
										statusLabel={statusLabel}
										statusVariant={statusVariant}
										onToggle={() => {
											if (!enabled) {
												const localKeyMap: Record<string, string> = {
													anthropic: anthropicKey,
													openai: openaiKey,
													gemini: geminiKey,
													groq: groqKey,
													openrouter: openrouterKey,
												};
												const hasLocalKey = Boolean(
													localKeyMap[provider.id]?.trim(),
												);
												if (
													provider.requiresKey &&
													!hasSavedKey &&
													!hasLocalKey
												) {
													requireSavedKey(provider);
													return;
												}
												if (provider.id === "ollama" && !ollamaAvailable) {
													setProviderWarnings((previous) => ({
														...previous,
														ollama:
															"Install and start Ollama to use offline mode.",
													}));
													return;
												}
											}
											clearProviderWarning(provider.id);
											setEnabledProviders((previous) => ({
												...previous,
												[provider.id]: !previous[provider.id],
											}));
										}}
									/>
									{provider.id === "anthropic" && (
										<PasswordField
											inputRef={anthropicKeyRef}
											id="anthropic-key"
											label="API key"
											helperText="Used for all Claude models."
											value={anthropicKey}
											onChange={(value) => {
												setAnthropicKey(value);
												clearProviderWarning("anthropic");
											}}
											placeholder={
												serverSettings?.hasAnthropicKey
													? "•••••••• (key saved on server)"
													: "sk-ant-api03-…"
											}
											serverSaved={Boolean(serverSettings?.hasAnthropicKey)}
											error={providerWarnings.anthropic}
										/>
									)}
									{provider.id === "openai" && (
										<PasswordField
											inputRef={openaiKeyRef}
											id="openai-key"
											label="API key"
											helperText="GPT-4o, GPT-5.x, and OpenAI reasoning models."
											value={openaiKey}
											onChange={(value) => {
												setOpenaiKey(value);
												clearProviderWarning("openai");
											}}
											placeholder={
												serverSettings?.hasOpenaiKey
													? "•••••••• (key saved on server)"
													: "sk-proj-…"
											}
											serverSaved={Boolean(serverSettings?.hasOpenaiKey)}
											error={providerWarnings.openai}
										/>
									)}
									{provider.id === "gemini" && (
										<PasswordField
											inputRef={geminiKeyRef}
											id="gemini-key"
											label="API key"
											helperText="Google Gemini model access."
											value={geminiKey}
											onChange={(value) => {
												setGeminiKey(value);
												clearProviderWarning("gemini");
											}}
											placeholder={
												serverSettings?.hasGeminiKey
													? "•••••••• (key saved on server)"
													: "AIza…"
											}
											serverSaved={Boolean(serverSettings?.hasGeminiKey)}
											error={providerWarnings.gemini}
										/>
									)}
									{provider.id === "groq" && (
										<PasswordField
											inputRef={groqKeyRef}
											id="groq-key"
											label="API key"
											helperText="Ultra-fast inference models."
											value={groqKey}
											onChange={(value) => {
												setGroqKey(value);
												clearProviderWarning("groq");
											}}
											placeholder={
												serverSettings?.hasGroqKey
													? "•••••••• (key saved on server)"
													: "gsk_…"
											}
											serverSaved={Boolean(serverSettings?.hasGroqKey)}
											error={providerWarnings.groq}
										/>
									)}
									{provider.id === "openrouter" && (
										<PasswordField
											inputRef={openrouterKeyRef}
											id="openrouter-key"
											label="API key"
											helperText="Route to any supported model through OpenRouter."
											value={openrouterKey}
											onChange={(value) => {
												setOpenrouterKey(value);
												clearProviderWarning("openrouter");
											}}
											placeholder={
												serverSettings?.hasOpenrouterKey
													? "•••••••• (key saved on server)"
													: "sk-or-v1-…"
											}
											serverSaved={Boolean(serverSettings?.hasOpenrouterKey)}
											error={providerWarnings.openrouter}
										/>
									)}
									{provider.id === "ollama" && !ollamaAvailable && (
										<div className="space-y-3 rounded-lg border border-zinc-700/50 bg-zinc-900/20 p-4">
											<p className="text-sm text-zinc-300">
												Install Ollama to unlock local offline models on this
												machine.
											</p>
											<div className="flex flex-wrap gap-3">
												<button
													type="button"
													onClick={async () => {
														setInstallingOllama(true);
														setCliError(null);
														try {
															await api.runtime.installOllama();
															void qc.invalidateQueries({
																queryKey: ["settings-ollama-probe"],
															});
															void qc.invalidateQueries({
																queryKey: [
																	"settings-provider-models",
																	"ollama",
																],
															});
														} catch (err) {
															setCliError(
																`Failed to install Ollama: ${err instanceof Error ? err.message : "unknown error"}`,
															);
														} finally {
															setInstallingOllama(false);
														}
													}}
													disabled={installingOllama}
													className="text-xs font-medium px-4 py-2 rounded border border-setra-500/40 bg-setra-600/10 text-setra-300 hover:bg-setra-600/20 transition-colors disabled:opacity-50"
												>
													{installingOllama
														? "Installing…"
														: "Install Ollama (one-click)"}
												</button>
												<a
													href="https://ollama.com/download"
													target="_blank"
													rel="noreferrer"
													className="text-xs font-medium px-4 py-2 rounded border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
												>
													Download manually ↗
												</a>
											</div>
											{providerWarnings.ollama && (
												<p className="text-sm text-red-400">
													{providerWarnings.ollama}
												</p>
											)}
										</div>
									)}
									<div className="space-y-2">
										<div className="flex items-center justify-between gap-3">
											<p className="text-sm font-medium text-white">
												Available models
											</p>
											<p className="text-xs text-zinc-500">
												Click a model to make it the default.
											</p>
										</div>
										<div className="flex flex-wrap gap-2">
											{models.map((model) => {
												const looksDisabled = offlineCloudProvider
													? true
													: provider.requiresKey
														? !hasSavedKey
														: model.disabled;
												return (
													<button
														key={model.id}
														type="button"
														onClick={() => {
															if (offlineCloudProvider) {
																setProviderWarnings((previous) => ({
																	...previous,
																	[provider.id]:
																		"Offline mode only allows local Ollama models.",
																}));
																return;
															}
															if (provider.requiresKey && !hasSavedKey) {
																requireSavedKey(provider);
																return;
															}
															if (model.disabled) {
																setProviderWarnings((previous) => ({
																	...previous,
																	[provider.id]:
																		model.disabledReason ===
																		"Model not downloaded"
																			? `Download ${model.label.replace(" (not downloaded)", "")} in Ollama before selecting it.`
																			: "Start Ollama to use local models.",
																}));
																return;
															}
															clearProviderWarning(provider.id);
															setEnabledProviders((previous) => ({
																...previous,
																[provider.id]: true,
															}));
															setDefaultModel(model.id);
														}}
														className={cn(
															"rounded-full border px-3 py-1.5 text-xs transition-colors",
															defaultModel === model.id && !looksDisabled
																? "border-blue-500/50 bg-blue-500/15 text-blue-200"
																: looksDisabled
																	? "border-zinc-800 bg-zinc-900/50 text-zinc-500"
																	: "border-zinc-700 bg-zinc-900/40 text-zinc-200 hover:border-zinc-500 hover:text-white",
														)}
														title={model.disabledReason}
														aria-disabled={looksDisabled}
													>
														{model.label}
													</button>
												);
											})}
										</div>
										{providerWarnings[provider.id] &&
											provider.id === "ollama" &&
											ollamaAvailable && (
												<p className="text-sm text-amber-300">
													{providerWarnings[provider.id]}
												</p>
											)}
									</div>
								</Card>
							);
						})}
					</div>
					{cliError && (
						<p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
							{cliError}
						</p>
					)}
				</div>
			</Card>
			<Card>
				<div className="space-y-6">
					<SectionIntro
						icon={Terminal}
						title="CLI tools"
						description="Use your existing ChatGPT Plus, Claude Pro, or GitHub Copilot subscription instead of API keys. Once a CLI is installed and logged in, agents with the matching adapter can run without a separate key."
					/>
					<div className="space-y-3">
						{(
							[
								{
									key: "codex",
									label: "Codex CLI (OpenAI)",
									note: "Drives GPT-5.x agents using your ChatGPT subscription.",
								},
								{
									key: "claude",
									label: "Claude Code (Anthropic)",
									note: "Drives Claude agents using your Claude Pro or Max plan.",
								},
								{
									key: "copilot",
									label: "GitHub Copilot CLI",
									note: "Drives Copilot agents using your GitHub Copilot subscription.",
								},
							] as const
						).map((tool) => {
							const entry = cliStatus?.[tool.key];
							const isInstalling = installingCli === tool.key;
							const isLoggingIn = loggingInCli === tool.key;
							return (
								<div
									key={tool.key}
									className="flex flex-col gap-3 rounded-lg border border-border/50 bg-muted/10 p-4 sm:flex-row sm:items-center sm:justify-between"
								>
									<div className="flex items-start gap-3">
										<Terminal className="mt-0.5 h-4 w-4 text-muted-foreground" />
										<div>
											<div className="text-sm font-medium text-foreground">
												{tool.label}
											</div>
											<p className="text-xs text-muted-foreground">
												{tool.note}
											</p>
											<p className="mt-1 text-[11px] text-muted-foreground">
												{!entry
													? "Status unavailable."
													: !entry.installed
														? "Not installed."
														: entry.loggedIn
															? `Installed${entry.version ? ` (${entry.version})` : ""} — logged in.`
															: `Installed${entry.version ? ` (${entry.version})` : ""} — login required.`}
											</p>
										</div>
									</div>
									<div className="flex flex-wrap items-center gap-2">
										{!entry?.installed ? (
											<button
												type="button"
												onClick={() => handleInstallCli(tool.key)}
												disabled={installingCli !== null}
												className="rounded border border-setra-500/40 bg-setra-600/10 px-3 py-1 text-xs font-medium text-setra-300 transition-colors hover:bg-setra-600/20 disabled:opacity-50"
											>
												{isInstalling ? "Installing…" : "Install"}
											</button>
										) : !entry.loggedIn ? (
											<button
												type="button"
												onClick={() => handleLoginCli(tool.key)}
												disabled={loggingInCli !== null}
												className="rounded border border-amber-400/40 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/20 disabled:opacity-50"
											>
												{isLoggingIn ? "Opening login…" : "Login"}
											</button>
										) : (
											<span className="rounded border border-accent-green/30 px-2 py-0.5 text-[11px] uppercase tracking-wider text-accent-green">
												connected
											</span>
										)}
									</div>
								</div>
							);
						})}
					</div>
					{cliError && <p className="text-sm text-red-400">{cliError}</p>}
				</div>
			</Card>
			<Card>
				<div className="space-y-6">
					<SectionIntro
						icon={Sparkles}
						title="Default selections"
						description="Powers the in-app Assistant chat (top-right panel) and lightweight summaries. Hired agents pick their own adapter — including any CLI you've connected — under Agents → Roster."
					/>
					<div className="grid gap-4 md:grid-cols-2">
						<Select
							id="default-model"
							label="Default model"
							helperText="Used by the Assistant chat. Requires a saved API key for the matching provider."
							value={defaultModel}
							onChange={(event) => setDefaultModel(event.target.value)}
						>
							{renderModelOptions(defaultModelSelectOptions)}
						</Select>
						<Select
							id="small-model"
							label="Small model"
							helperText="Used for classification, summaries, and briefs."
							value={smallModel}
							onChange={(event) => setSmallModel(event.target.value)}
						>
							{renderModelOptions(smallModelSelectOptions)}
						</Select>
					</div>
					{cliStatus &&
						(cliStatus.codex.loggedIn ||
							cliStatus.claude.loggedIn ||
							cliStatus.copilot.loggedIn) && (
							<p className="text-xs text-muted-foreground">
								CLI subscriptions detected (
								{[
									cliStatus.codex.loggedIn && "Codex",
									cliStatus.claude.loggedIn && "Claude",
									cliStatus.copilot.loggedIn && "Copilot",
								]
									.filter(Boolean)
									.join(", ")}
								). They are not selectable here — assign them to a hired agent
								under Agents → Roster to use them.
							</p>
						)}
					{selectableModelOptions.length === 0 && (
						<p className="text-sm text-zinc-400">
							No model is currently selectable. Add and save an API key above,
							or use a local Ollama model.
						</p>
					)}
				</div>
			</Card>
			<Card>
				<div className="space-y-6">
					<SectionIntro
						icon={Sparkles}
						title="Web search keys"
						description="DuckDuckGo remains available as a free fallback even without extra keys."
					/>
					<SettingToggle
						id="web-search-enabled"
						label="Enable web search for agents"
						description="Allow agents to search the web during their runs. Requires at least one search API key, or uses DuckDuckGo as a free fallback."
						checked={webSearchEnabled}
						onChange={setWebSearchEnabled}
						disabled={serverSettings?.isOfflineOnly}
					/>
					<div className="grid gap-4 md:grid-cols-2">
						<PasswordField
							id="tavily-key"
							label="Tavily"
							helperText="Best quality search — tavily.com."
							value={tavilyKey}
							onChange={setTavilyKey}
							placeholder={
								serverSettings?.hasTavilyKey
									? "•••••••• (key saved on server)"
									: "tvly-…"
							}
							serverSaved={Boolean(serverSettings?.hasTavilyKey)}
						/>
						<PasswordField
							id="brave-key"
							label="Brave Search"
							helperText="Privacy-focused search — api.search.brave.com."
							value={braveKey}
							onChange={setBraveKey}
							placeholder={
								serverSettings?.hasBraveKey
									? "•••••••• (key saved on server)"
									: "BSA…"
							}
							serverSaved={Boolean(serverSettings?.hasBraveKey)}
						/>
						<PasswordField
							id="serper-key"
							label="Serper"
							helperText="Google results with a free tier — serper.dev."
							value={serperKey}
							onChange={setSerperKey}
							placeholder={
								serverSettings?.hasSerperKey
									? "•••••••• (key saved on server)"
									: "…"
							}
							serverSaved={Boolean(serverSettings?.hasSerperKey)}
						/>
					</div>
				</div>
			</Card>
		</div>
	);

	const governanceCards = (
		<div className="space-y-6">
			<Card>
				<div className="space-y-6">
					<SectionIntro
						icon={Shield}
						title="Governance"
						description="Control deployment autonomy and the minimum review risk threshold."
					/>
					<div className="grid gap-4 md:grid-cols-2">
						<Select
							id="deploy-mode"
							label="Deploy mode"
							helperText="Controls how much agents can do autonomously."
							value={deployMode}
							onChange={(event) =>
								setDeployMode(event.target.value as "manual" | "semi" | "auto")
							}
						>
							<option value="manual">
								Manual — all actions require approval
							</option>
							<option value="semi">
								Semi-auto — low-risk actions auto-proceed
							</option>
							<option value="auto">
								Auto — agents act freely within budget
							</option>
						</Select>
						<Select
							id="review-risk"
							label="Review risk floor"
							helperText="Items at or above this risk level always require review."
							value={reviewRisk}
							onChange={(event) =>
								setReviewRisk(event.target.value as "low" | "medium" | "high")
							}
						>
							<option value="low">Low (review everything)</option>
							<option value="medium">Medium</option>
							<option value="high">High only</option>
						</Select>
					</div>
				</div>
			</Card>
		</div>
	);

	const approvalActionLabels: Record<string, { label: string; desc: string }> =
		{
			task_start: {
				label: "Task Start",
				desc: "Require approval before agents begin working on assigned tasks.",
			},
			pr_merge: {
				label: "PR Merge",
				desc: "Require approval before agents merge pull requests.",
			},
			agent_hire: {
				label: "Agent Hiring",
				desc: "Require approval when an agent (e.g. CEO) creates new agents.",
			},
			deploy: {
				label: "Deployment",
				desc: "Require approval before agents deploy code to production.",
			},
		};

	const autonomyCards = (
		<div className="space-y-6">
			<Card>
				<div className="space-y-6">
					<SectionIntro
						icon={Zap}
						title="Auto-Approve"
						description="Control which actions agents can perform without human approval."
					/>
					<SettingToggle
						id="auto-approve-all"
						label="Auto-approve everything"
						description="Skip the approval queue for all agent actions. When off, you can choose which actions need approval."
						checked={autoApprove}
						onChange={setAutoApprove}
					/>
					{!autoApprove && (
						<div className="space-y-3 rounded-lg border border-zinc-800 p-4">
							<p className="text-xs font-medium text-muted-foreground">
								Require approval for:
							</p>
							{Object.entries(approvalActionLabels).map(
								([key, { label, desc }]) => (
									<SettingToggle
										key={key}
										id={`approval-${key}`}
										label={label}
										description={desc}
										checked={approvalActions[key] ?? true}
										onChange={(v) =>
											setApprovalActions({ ...approvalActions, [key]: v })
										}
									/>
								),
							)}
						</div>
					)}
				</div>
			</Card>
			<Card>
				<div className="space-y-6">
					<SectionIntro
						icon={Sparkles}
						title="Autonomous Dispatch"
						description="Configure whether Setra automatically picks up backlog items and how many runs can happen at once."
					/>
					<SettingToggle
						id="auto-dispatch"
						label="Auto-dispatch"
						description="Let the dispatcher automatically pick up backlog and todo issues."
						checked={autoDispatchEnabled}
						onChange={setAutoDispatchEnabled}
					/>
					<Input
						id="max-parallel-runs"
						label="Max parallel runs"
						helperText="Workspace-wide cap used when automatic scheduling is turned on."
						type="number"
						min={1}
						max={50}
						step={1}
						value={maxParallelRuns}
						onChange={(event) => setMaxParallelRuns(Number(event.target.value))}
					/>
				</div>
			</Card>
			<Card>
				<div className="space-y-6">
					<SectionIntro
						icon={Clock}
						title="24/7 Continuous Mode"
						description="When enabled, all agents run continuously — they'll automatically restart after completing tasks and look for new work."
					/>
					<SettingToggle
						id="continuous-mode-all"
						label="Enable 24/7 mode for all agents"
						description="Sets all agents to continuous run mode. They'll automatically pick up and work on tasks around the clock."
						checked={continuousModeAll}
						onChange={setContinuousModeAll}
					/>
					{continuousModeAll && (
						<Input
							id="continuous-interval"
							label="Check interval (minutes)"
							helperText="How often idle agents check for new work."
							type="number"
							min={1}
							max={60}
							value={continuousInterval}
							onChange={(event) =>
								setContinuousInterval(Number(event.target.value))
							}
						/>
					)}
				</div>
			</Card>
			{semanticMemoryCard}
		</div>
	);

	const appearanceCards = (
		<div className="space-y-6">
			<Card>
				<div className="space-y-6">
					<SectionIntro
						icon={Palette}
						title="Appearance"
						description="Adjust the theme, typography, and layout defaults used in the board."
					/>
					<div className="grid gap-4 md:grid-cols-2">
						<Select
							id="theme"
							label="Theme"
							helperText="Color scheme for the interface."
							value={theme}
							onChange={(event) =>
								setTheme(event.target.value as "dark" | "light" | "system")
							}
						>
							<option value="dark">Dark</option>
							<option value="light">Light</option>
							<option value="system">System</option>
						</Select>
						<Select
							id="font-family"
							label="Font family"
							helperText="Typography used across the interface."
							value={fontFamily}
							onChange={(event) => setFontFamily(event.target.value)}
						>
							<optgroup label="Sans-serif (Enterprise)">
								<option value="Inter, system-ui, sans-serif">Inter</option>
								<option value="Poppins, system-ui, sans-serif">Poppins</option>
								<option value="'Plus Jakarta Sans', system-ui, sans-serif">
									Plus Jakarta Sans
								</option>
								<option value="'DM Sans', system-ui, sans-serif">
									DM Sans
								</option>
								<option value="Outfit, system-ui, sans-serif">Outfit</option>
								<option value="Satoshi, system-ui, sans-serif">Satoshi</option>
								<option value="Geist, system-ui, sans-serif">Geist</option>
								<option value="'IBM Plex Sans', system-ui, sans-serif">
									IBM Plex Sans
								</option>
								<option value="Roboto, system-ui, sans-serif">Roboto</option>
								<option value="Lato, system-ui, sans-serif">Lato</option>
								<option value="Nunito, system-ui, sans-serif">Nunito</option>
								<option value="system-ui, sans-serif">System Default</option>
							</optgroup>
							<optgroup label="Monospace">
								<option value="JetBrains Mono, monospace">
									JetBrains Mono
								</option>
								<option value="'Geist Mono', monospace">Geist Mono</option>
								<option value="Fira Code, monospace">Fira Code</option>
								<option value="Source Code Pro, monospace">
									Source Code Pro
								</option>
								<option value="Cascadia Code, monospace">Cascadia Code</option>
								<option value="Monaco, monospace">Monaco</option>
								<option value="Menlo, monospace">Menlo</option>
								<option value="Consolas, monospace">Consolas</option>
							</optgroup>
						</Select>
						<Input
							id="font-size"
							label="Font size"
							helperText="Editor and terminal font size in pixels."
							type="number"
							min={10}
							max={24}
							step={1}
							value={fontSize}
							onChange={(event) => setFontSize(Number(event.target.value))}
						/>
						<Input
							id="ui-scale"
							label="UI scale"
							helperText="Scale the overall interface in percent."
							type="number"
							min={80}
							max={120}
							step={5}
							value={uiScale}
							onChange={(event) => setUiScale(Number(event.target.value))}
						/>
						<Select
							id="sidebar-position"
							label="Sidebar position"
							helperText="Where the main navigation appears."
							value={sidebarPosition}
							onChange={(event) =>
								setSidebarPosition(event.target.value as "left" | "right")
							}
						>
							<option value="left">Left</option>
							<option value="right">Right</option>
						</Select>
					</div>
				</div>
			</Card>
			<Card>
				<div className="space-y-4">
					<SectionIntro
						icon={ImageIcon}
						title="Company Logo"
						description="Upload your company logo. It will appear anywhere the current workspace avatar is shown."
					/>
					<div className="flex items-center gap-4">
						{companyLogo ? (
							<img
								src={companyLogo}
								alt={`${selectedCompany?.name ?? "Company"} logo`}
								className="h-16 w-16 rounded-lg border border-border/30 bg-surface-2 p-1 object-contain"
							/>
						) : (
							<div className="flex h-16 w-16 items-center justify-center rounded-lg border border-border/30 bg-surface-2 text-muted-foreground">
								<ImageIcon className="h-6 w-6" />
							</div>
						)}
						<div className="flex flex-col gap-2">
							<label className="cursor-pointer text-sm text-accent-blue hover:underline">
								<input
									type="file"
									accept="image/png,image/jpeg,image/svg+xml,image/webp"
									className="hidden"
									onChange={handleCompanyLogoChange}
								/>
								Upload logo
							</label>
							<p className="text-xs text-muted-foreground">
								Max 512KB. PNG, JPG, SVG, or WebP.
							</p>
							{companyLogo ? (
								<button
									type="button"
									onClick={() => {
										setCompanyLogo("");
										setLogoError(null);
									}}
									className="text-left text-xs text-red-400 hover:underline"
								>
									Remove
								</button>
							) : null}
						</div>
					</div>
					{logoError ? (
						<p className="text-sm text-red-400">{logoError}</p>
					) : null}
				</div>
			</Card>
			<Card
				title="Preview"
				subtitle="A quick sample using your current typography settings."
			>
				<pre
					style={{ fontSize: `${fontSize}px`, fontFamily }}
					className="overflow-x-auto rounded-lg border border-zinc-700/50 bg-zinc-900/40 p-4 text-zinc-300"
				>
					{"const hello = () => {\n  console.log('Hello, setra!');\n};"}
				</pre>
			</Card>
		</div>
	);

	const generalCards = (
		<div className="space-y-6">
			<Card>
				<div className="space-y-6">
					<SectionIntro
						icon={Info}
						title="Connection"
						description="This board connects to the local Setra backend for live data, settings, and agent updates."
					/>
					<div className="grid gap-4 md:grid-cols-2">
						<ReadOnlyField
							id="server-url"
							label="Server URL"
							helperText="Current board origin."
							value={window.location.origin}
						/>
						<ReadOnlyField
							id="transport"
							label="Transport"
							helperText="How the board keeps a live connection open."
							value="SSE (Server-Sent Events, auto-reconnect)"
						/>
						<ReadOnlyField
							id="api-port"
							label="API port"
							helperText="The local port the Setra backend listens on."
							value="3141"
						/>
					</div>
				</div>
			</Card>
			<Card subtitle="A privacy-first AI clone trained on your style and observed work.">
				<a
					href="/clone"
					className="inline-flex items-center gap-2 text-sm font-medium text-blue-300 transition-colors hover:text-blue-200"
				>
					Open Build Your Clone
					<ExternalLink className="h-4 w-4" aria-hidden="true" />
				</a>
			</Card>
			<Card
				title="About Setra"
				subtitle="Installation and project metadata for this workspace."
			>
				<div className="grid gap-4 md:grid-cols-2">
					<ReadOnlyField
						id="app-version"
						label="Version"
						helperText="The app version currently installed on this machine."
						value="0.1.0"
					/>
					<ReadOnlyField
						id="license"
						label="License"
						helperText="The software license that applies to this installation."
						value="Apache 2.0"
					/>
					<div className="md:col-span-2">
						<ReadOnlyField
							id="github-url"
							label="GitHub"
							helperText="Project source code, releases, and issue tracking."
							value="https://github.com/qwegle/setra"
						/>
						<a
							href="https://github.com/qwegle/setra"
							target="_blank"
							rel="noreferrer"
							className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-blue-300 transition-colors hover:text-blue-200"
						>
							Open repository
							<ExternalLink className="h-4 w-4" aria-hidden="true" />
						</a>
					</div>
				</div>
			</Card>
		</div>
	);

	let content: ReactNode;
	if (isInitialLoading) {
		content = <LoadingSkeleton />;
	} else {
		switch (activeTab) {
			case "general":
				content = generalCards;
				break;
			case "aiProviders":
				content = aiProvidersCards;
				break;
			case "secrets":
				content = <SecretsTab />;
				break;
			case "governance":
				content = governanceCards;
				break;
			case "autonomy":
				content = autonomyCards;
				break;
			case "appearance":
				content = appearanceCards;
				break;
		}
	}

	return (
		<div className="flex h-full overflow-hidden">
			<aside className="w-56 shrink-0 border-r border-zinc-800/80 px-4 py-6">
				<nav aria-label="Settings sections" className="space-y-2">
					{tabs.map((tab) => {
						const Icon = tab.icon;
						return (
							<Button
								key={tab.id}
								type="button"
								variant={activeTab === tab.id ? "secondary" : "ghost"}
								size="md"
								onClick={() => setActiveTab(tab.id)}
								className={cn(
									"w-full justify-start",
									activeTab === tab.id &&
										"border border-blue-500/30 bg-blue-500/10",
								)}
								aria-pressed={activeTab === tab.id}
								icon={<Icon className="h-4 w-4" aria-hidden="true" />}
							>
								{tab.label}
							</Button>
						);
					})}
				</nav>
			</aside>
			<div
				className="flex-1 overflow-y-auto px-6 py-6"
				style={{ zoom: `${uiScale}%` }}
			>
				<div className="space-y-6">
					<PageHeader
						title="Settings"
						subtitle="Manage providers, budgets, governance, and interface preferences for this workspace."
						actions={
							<div className="flex flex-wrap items-center gap-3">
								<Badge variant="info">
									{tabs.find((tab) => tab.id === activeTab)?.label}
								</Badge>
								<Button
									type="button"
									onClick={() => saveSettings.mutate()}
									loading={saveSettings.isPending}
								>
									Save settings
								</Button>
							</div>
						}
					/>
					<SaveState saved={saved} isError={saveSettings.isError} />
					{content}
				</div>
			</div>
		</div>
	);
}
