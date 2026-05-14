/**
 * IntegrationsPage — management UI for external integrations and secrets.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Calendar,
	CheckCircle,
	Eye,
	EyeOff,
	GitBranch,
	Key,
	LoaderCircle,
	Mail,
	MessageSquare,
	Plus,
	Send,
	Shield,
	Trash2,
	Webhook,
	XCircle,
	Zap,
} from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api";
import { cn } from "../lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Integration {
	id: string;
	type: string;
	name: string;
	status: "active" | "inactive" | "error" | "disconnected";
	config: Record<string, string>;
	config_json?: string;
	last_triggered_at: string | null;
	created_at: string;
	updated_at?: string | null;
}

interface GitHubVerificationResult {
	valid: boolean;
	user: {
		login: string;
		avatar_url: string;
		name: string | null;
	};
	repos: Array<{
		full_name: string;
		private: boolean;
		default_branch: string;
	}>;
}

interface Secret {
	id: string;
	name: string;
	description: string | null;
	value_hint: string | null;
	created_at: string;
	updated_at: string | null;
}

interface WebhookEvent {
	id: string;
	integration_id: string;
	company_id: string;
	direction: "inbound" | "outbound";
	event_name: string | null;
	target_url: string | null;
	payload: string | null;
	status: string;
	issue_id: string | null;
	response_status: number | null;
	error_message: string | null;
	created_at: string;
}

interface CalendarPreviewEvent {
	title: string;
	start: string | null;
	end: string | null;
	link: string | null;
}

// ─── Integration metadata ─────────────────────────────────────────────────────

const integrationMeta: Record<
	string,
	{ icon: React.ElementType; color: string; description: string }
> = {
	slack: {
		icon: MessageSquare,
		color: "text-accent-green",
		description: "Post agent updates, receive slash commands",
	},
	telegram: {
		icon: Send,
		color: "text-setra-400",
		description: "Control agents from your phone",
	},
	discord: {
		icon: MessageSquare,
		color: "text-accent-purple",
		description: "Agent notifications in your server",
	},
	github: {
		icon: GitBranch,
		color: "text-foreground",
		description: "Issues, PRs, branches, checkpoints",
	},
	webhook: {
		icon: Webhook,
		color: "text-accent-yellow",
		description: "Custom HTTP endpoint for any service",
	},
	resend: {
		icon: Mail,
		color: "text-accent-orange",
		description: "Send email reports and alerts via Resend",
	},
	google_calendar: {
		icon: Calendar,
		color: "text-accent-cyan",
		description: "Schedule agent runs from calendar events",
	},
	jira: {
		icon: Shield,
		color: "text-setra-300",
		description: "Sync issues bidirectionally with Jira",
	},
	linear: {
		icon: Zap,
		color: "text-accent-purple",
		description: "Sync with Linear projects and issues",
	},
};

const ALL_TYPES = Object.keys(integrationMeta);

// Per-type fields shown in the connect form
const typeFields: Record<
	string,
	Array<{ key: string; label: string; placeholder: string }>
> = {
	slack: [
		{
			key: "webhook_url",
			label: "Webhook URL",
			placeholder: "https://hooks.slack.com/services/...",
		},
	],
	telegram: [
		{ key: "bot_token", label: "Bot token", placeholder: "123456:ABC-..." },
	],
	discord: [
		{
			key: "webhook_url",
			label: "Webhook URL",
			placeholder: "https://discord.com/api/webhooks/...",
		},
	],
	github: [
		{ key: "token", label: "Personal access token", placeholder: "ghp_..." },
	],
	webhook: [],
	resend: [
		{ key: "api_key", label: "API key", placeholder: "re_..." },
		{
			key: "from_email",
			label: "From email",
			placeholder: "agent@example.com",
		},
	],
	google_calendar: [],
	jira: [
		{
			key: "url",
			label: "Jira URL",
			placeholder: "https://yourorg.atlassian.net",
		},
		{ key: "api_token", label: "API token", placeholder: "..." },
		{ key: "email", label: "Email", placeholder: "you@example.com" },
	],
	linear: [{ key: "api_key", label: "API key", placeholder: "lin_api_..." }],
};

const statusDot: Record<string, string> = {
	active: "bg-accent-green",
	inactive: "bg-muted-foreground",
	error: "bg-destructive",
	disconnected: "bg-muted-foreground",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
	return new Date(iso).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function formatDateTime(iso: string | null | undefined) {
	if (!iso) return "—";
	return new Date(iso).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function summarizePayload(payload: string | null) {
	if (!payload) return "No payload";
	try {
		const parsed = JSON.parse(payload) as unknown;
		const json = JSON.stringify(parsed);
		return json.length > 120 ? `${json.slice(0, 117)}...` : json;
	} catch {
		return payload.length > 120 ? `${payload.slice(0, 117)}...` : payload;
	}
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TabBar({
	tabs,
	active,
	onChange,
}: {
	tabs: string[];
	active: string;
	onChange: (t: string) => void;
}) {
	return (
		<div className="flex gap-1 p-1 glass rounded-lg w-fit">
			{tabs.map((t) => (
				<button
					key={t}
					type="button"
					onClick={() => onChange(t)}
					className={cn(
						"px-4 py-1.5 text-sm rounded-md transition-colors font-medium",
						active === t
							? "bg-setra-600 text-[#2b2418]"
							: "text-muted-foreground hover:text-foreground hover:bg-muted/30",
					)}
				>
					{t}
				</button>
			))}
		</div>
	);
}

function InputField({
	label,
	placeholder,
	value,
	onChange,
	type = "text",
	disabled = false,
}: {
	label: string;
	placeholder: string;
	value: string;
	onChange: (v: string) => void;
	type?: string;
	disabled?: boolean;
}) {
	return (
		<div>
			<label className="block text-xs text-muted-foreground mb-1">
				{label}
			</label>
			<input
				type={type}
				placeholder={placeholder}
				value={value}
				disabled={disabled}
				onChange={(e) => onChange(e.target.value)}
				className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-setra-600 transition-colors disabled:opacity-60"
			/>
		</div>
	);
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<label className="block text-xs text-muted-foreground mb-1">
				{label}
			</label>
			<div className="w-full rounded-md border border-border bg-muted/20 px-3 py-2 text-sm break-all">
				{value || "—"}
			</div>
		</div>
	);
}

function SelectField({
	label,
	value,
	onChange,
	options,
}: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	options: Array<{ value: string; label: string }>;
}) {
	return (
		<div>
			<label className="block text-xs text-muted-foreground mb-1">
				{label}
			</label>
			<select
				value={value}
				onChange={(e) => onChange(e.target.value)}
				className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-setra-600 transition-colors"
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</div>
	);
}

// ─── Tab 1: Integrations ──────────────────────────────────────────────────────

function IntegrationsTab() {
	const qc = useQueryClient();
	const [adding, setAdding] = useState<string | null>(null);
	const [editingIntegration, setEditingIntegration] =
		useState<Integration | null>(null);
	const [formConfig, setFormConfig] = useState<Record<string, string>>({});
	const [formName, setFormName] = useState("");
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
	const [calendarPreviewRequested, setCalendarPreviewRequested] =
		useState(false);

	const {
		data: integrations = [],
		isLoading: integrationsLoading,
		isError: integrationsError,
		error: integrationsErrorObj,
	} = useQuery<Integration[]>({
		queryKey: ["integrations"],
		queryFn: () => api.integrations.list() as Promise<Integration[]>,
		refetchInterval: 30_000,
	});

	const modalType = editingIntegration?.type ?? adding;
	const isEditingModal = editingIntegration !== null;
	const inboundUrl =
		modalType === "webhook" &&
		editingIntegration &&
		typeof window !== "undefined"
			? `${window.location.origin}/api/webhooks/${editingIntegration.id}/incoming`
			: "";

	const {
		data: webhookEvents = [],
		isLoading: webhookEventsLoading,
		isError: webhookEventsError,
		error: webhookEventsErrorObj,
	} = useQuery<WebhookEvent[]>({
		queryKey: ["webhook-events"],
		queryFn: () => api.webhooks.events() as Promise<WebhookEvent[]>,
		enabled: modalType === "webhook" && isEditingModal,
		refetchInterval: modalType === "webhook" && isEditingModal ? 30_000 : false,
	});

	const {
		data: calendarPreview,
		isFetching: calendarPreviewLoading,
		isError: calendarPreviewError,
		error: calendarPreviewErrorObj,
		refetch: refetchCalendarPreview,
	} = useQuery<{ events: CalendarPreviewEvent[] }>({
		queryKey: [
			"calendar-events",
			editingIntegration?.id,
			editingIntegration?.updated_at,
		],
		queryFn: () => api.integrations.calendar.events(),
		enabled:
			modalType === "google_calendar" &&
			calendarPreviewRequested &&
			editingIntegration?.status === "active",
		retry: false,
	});

	function closeModal() {
		setAdding(null);
		setEditingIntegration(null);
		setFormConfig({});
		setFormName("");
		setCalendarPreviewRequested(false);
	}

	function openAdding(type: string) {
		setAdding(type);
		setEditingIntegration(null);
		setFormConfig(type === "webhook" ? { direction: "both" } : {});
		setFormName(type.replace(/_/g, " "));
		setCalendarPreviewRequested(false);
	}

	function openManage(integration: Integration) {
		setAdding(null);
		setEditingIntegration(integration);
		setFormName(integration.name);
		setFormConfig({
			...(integration.config ?? {}),
			...(integration.type === "webhook"
				? { direction: integration.config.direction || "both" }
				: {}),
		});
		setCalendarPreviewRequested(integration.type === "google_calendar");
	}

	const addMutation = useMutation({
		mutationFn: (body: {
			type: string;
			name: string;
			config: Record<string, string>;
		}) => api.integrations.create(body) as Promise<Integration>,
		onSuccess: (row) => {
			qc.invalidateQueries({ queryKey: ["integrations"] });
			setFormName(row.name);
			setFormConfig({ ...(row.config ?? {}) });
			if (row.type === "webhook" || row.type === "google_calendar") {
				setAdding(null);
				setEditingIntegration(row);
				setCalendarPreviewRequested(row.type === "google_calendar");
				return;
			}
			closeModal();
		},
	});

	const saveMutation = useMutation({
		mutationFn: ({
			id,
			config,
		}: { id: string; config: Record<string, string> }) =>
			api.integrations.update(id, { config }) as Promise<Integration>,
		onSuccess: (row) => {
			qc.invalidateQueries({ queryKey: ["integrations"] });
			setEditingIntegration(row);
			setFormConfig({ ...(row.config ?? {}) });
		},
	});

	const toggleMutation = useMutation({
		mutationFn: ({ id, status }: { id: string; status: string }) =>
			api.integrations.update(id, { status }),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["integrations"] }),
	});

	const deleteMutation = useMutation({
		mutationFn: (id: string) => api.integrations.delete(id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["integrations"] });
			setConfirmDelete(null);
			if (editingIntegration?.id === confirmDelete) {
				closeModal();
			}
		},
	});

	const configured = new Set(integrations.map((i) => i.type));
	const webhookEventItems = webhookEvents
		.filter((event) => event.integration_id === editingIntegration?.id)
		.slice(0, 10);
	const previewEvents = (calendarPreview?.events ?? []).slice(0, 5);
	const standardFields = modalType ? (typeFields[modalType] ?? []) : [];
	const isSaving = addMutation.isPending || saveMutation.isPending;

	function handleSubmit() {
		if (!modalType) return;
		if (editingIntegration) {
			saveMutation.mutate({ id: editingIntegration.id, config: formConfig });
			return;
		}
		addMutation.mutate({
			type: modalType,
			name: formName || modalType,
			config: formConfig,
		});
	}

	return (
		<div className="space-y-6">
			{integrationsLoading && (
				<div className="glass rounded-xl p-4 text-xs text-muted-foreground">
					Loading integrations…
				</div>
			)}
			{integrationsError && (
				<div className="glass rounded-xl p-4 text-xs text-accent-red border border-destructive/30">
					Failed to load integrations:{" "}
					{integrationsErrorObj instanceof Error
						? integrationsErrorObj.message
						: String(integrationsErrorObj)}
				</div>
			)}
			<div className="glass rounded-xl p-5 border border-setra-600/30 flex items-start gap-4">
				<div className="p-2 rounded-lg bg-setra-600/15 text-setra-400 shrink-0">
					<Zap className="w-5 h-5" />
				</div>
				<div>
					<p className="text-sm font-semibold mb-1">Background mode</p>
					<p className="text-xs text-muted-foreground leading-relaxed max-w-xl">
						Setra runs as a background process. When a Slack message or webhook
						fires, agents wake up, handle the task, and post results back.
						Agents only consume tokens when triggered.
					</p>
					<div className="flex items-center gap-2 mt-3">
						<span
							className={cn(
								"status-dot",
								integrationsError ? "bg-amber-500" : "bg-accent-green",
							)}
						/>
						<span className="text-xs text-muted-foreground">
							{integrationsError
								? "Server unreachable — retrying"
								: integrationsLoading
									? "Connecting"
									: "Server reachable · listening for events"}
						</span>
					</div>
				</div>
			</div>

			{integrations.length > 0 && (
				<div className="glass rounded-xl p-5">
					<h2 className="text-sm font-semibold mb-4">Connected</h2>
					<div className="space-y-2">
						{integrations.map((intg) => {
							const meta = integrationMeta[intg.type];
							const Icon = meta?.icon ?? Webhook;
							return (
								<div
									key={intg.id}
									className="flex items-center gap-4 py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors group"
								>
									<Icon
										className={cn(
											"w-4 h-4 shrink-0",
											meta?.color ?? "text-muted-foreground",
										)}
									/>
									<div className="flex-1 min-w-0">
										<p className="text-sm font-medium">{intg.name}</p>
										<p className="text-xs text-muted-foreground">
											{meta?.description}
											{intg.last_triggered_at && (
												<>
													{" "}
													· last triggered {formatDate(intg.last_triggered_at)}
												</>
											)}
										</p>
									</div>
									<span
										className={cn(
											"status-dot shrink-0",
											statusDot[intg.status] ?? "bg-muted-foreground",
										)}
									/>
									<span className="text-xs text-muted-foreground capitalize w-20">
										{intg.status}
									</span>
									<button
										type="button"
										onClick={(event) => {
											event.stopPropagation();
											openManage(intg);
										}}
										className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-setra-400 hover:text-setra-300"
									>
										Configure
									</button>
									<button
										type="button"
										title={intg.status === "active" ? "Deactivate" : "Activate"}
										onClick={(event) => {
											event.stopPropagation();
											toggleMutation.mutate({
												id: intg.id,
												status:
													intg.status === "active" ? "inactive" : "active",
											});
										}}
										className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground"
									>
										{intg.status === "active" ? (
											<XCircle className="w-4 h-4" />
										) : (
											<CheckCircle className="w-4 h-4 text-accent-green" />
										)}
									</button>
									<button
										type="button"
										title="Remove integration"
										onClick={(event) => {
											event.stopPropagation();
											setConfirmDelete(intg.id);
										}}
										className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
									>
										<Trash2 className="w-4 h-4" />
									</button>
								</div>
							);
						})}
					</div>
				</div>
			)}

			<div className="glass rounded-xl p-5">
				<h2 className="text-sm font-semibold mb-4">Available integrations</h2>
				<div className="grid grid-cols-2 gap-3">
					{ALL_TYPES.map((type) => {
						const meta = integrationMeta[type]!;
						const Icon = meta.icon;
						const isConfigured = configured.has(type);
						return (
							<div
								key={type}
								className={cn(
									"flex items-start gap-3 p-4 rounded-lg border transition-all",
									isConfigured
										? "border-border/30 opacity-60 cursor-default"
										: "border-border/50 hover:border-setra-600/40 cursor-pointer hover:bg-muted/20",
								)}
								onClick={() => !isConfigured && openAdding(type)}
							>
								<Icon className={cn("w-4 h-4 mt-0.5 shrink-0", meta.color)} />
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2 mb-0.5">
										<p className="text-sm font-medium capitalize">
											{type.replace(/_/g, " ")}
										</p>
										{isConfigured && (
											<CheckCircle className="w-3.5 h-3.5 text-accent-green" />
										)}
									</div>
									<p className="text-xs text-muted-foreground">
										{meta.description}
									</p>
								</div>
								{!isConfigured && (
									<Plus className="w-4 h-4 text-muted-foreground/50 shrink-0 mt-0.5" />
								)}
							</div>
						);
					})}
				</div>
			</div>

			{modalType && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-[#fdfaf3]/60 backdrop-blur-sm">
					<div className="glass rounded-xl p-6 w-full max-w-xl animate-slide-in-up">
						<div className="flex items-center gap-3 mb-1">
							{(() => {
								const Icon = integrationMeta[modalType]?.icon ?? Webhook;
								return (
									<Icon
										className={cn("w-4 h-4", integrationMeta[modalType]?.color)}
									/>
								);
							})()}
							<h3 className="text-sm font-semibold capitalize">
								{isEditingModal ? "Manage" : "Add"}{" "}
								{modalType.replace(/_/g, " ")}
							</h3>
						</div>
						<p className="text-xs text-muted-foreground mb-4 ml-7">
							{integrationMeta[modalType]?.description}
						</p>
						<div className="space-y-3 mb-5 max-h-[70vh] overflow-y-auto pr-1">
							{isEditingModal ? (
								<ReadOnlyField label="Display name" value={formName} />
							) : (
								<InputField
									label="Display name"
									placeholder={modalType.replace(/_/g, " ")}
									value={formName}
									onChange={setFormName}
								/>
							)}

							{modalType === "webhook" ? (
								<>
									{isEditingModal && (
										<ReadOnlyField label="Inbound URL" value={inboundUrl} />
									)}
									<InputField
										label="Outbound URL"
										placeholder="https://hooks.example.com/..."
										value={formConfig.url ?? ""}
										onChange={(value) =>
											setFormConfig((prev) => ({ ...prev, url: value }))
										}
									/>
									<InputField
										label="Secret"
										placeholder="Optional shared secret"
										value={formConfig.secret ?? ""}
										type="password"
										onChange={(value) =>
											setFormConfig((prev) => ({ ...prev, secret: value }))
										}
									/>
									<SelectField
										label="Direction"
										value={formConfig.direction ?? "both"}
										onChange={(value) =>
											setFormConfig((prev) => ({ ...prev, direction: value }))
										}
										options={[
											{ value: "inbound_only", label: "Inbound only" },
											{ value: "outbound_only", label: "Outbound only" },
											{ value: "both", label: "Both" },
										]}
									/>
									<p className="text-xs text-muted-foreground">
										Inbound requests signed with your secret must send an
										<code className="mx-1">x-webhook-signature</code>
										HMAC header.
									</p>
									<div className="rounded-lg border border-border/50 p-3 space-y-2 bg-muted/10">
										<div className="flex items-center justify-between gap-3">
											<h4 className="text-xs font-semibold">
												Recent webhook events
											</h4>
											<span className="text-[11px] text-muted-foreground">
												Last 10
											</span>
										</div>
										{!isEditingModal ? (
											<p className="text-xs text-muted-foreground">
												Connect this webhook to unlock the inbound URL and event
												log.
											</p>
										) : webhookEventsLoading ? (
											<p className="text-xs text-muted-foreground">
												Loading events…
											</p>
										) : webhookEventsError ? (
											<p className="text-xs text-accent-red">
												{webhookEventsErrorObj instanceof Error
													? webhookEventsErrorObj.message
													: "Failed to load webhook events."}
											</p>
										) : webhookEventItems.length === 0 ? (
											<p className="text-xs text-muted-foreground">
												No events received yet.
											</p>
										) : (
											<div className="space-y-2">
												{webhookEventItems.map((event) => (
													<div
														key={event.id}
														className="rounded-md border border-border/40 p-2 text-xs"
													>
														<div className="flex items-center justify-between gap-3">
															<span className="font-medium capitalize">
																{event.direction} · {event.status}
															</span>
															<span className="text-muted-foreground">
																{formatDateTime(event.created_at)}
															</span>
														</div>
														<p className="text-muted-foreground mt-1">
															{event.event_name ||
																summarizePayload(event.payload)}
														</p>
														{event.error_message && (
															<p className="text-accent-red mt-1">
																{event.error_message}
															</p>
														)}
													</div>
												))}
											</div>
										)}
									</div>
								</>
							) : modalType === "google_calendar" ? (
								<>
									<InputField
										label="Calendar ID"
										placeholder="primary or team@example.com"
										value={formConfig.calendar_id ?? ""}
										onChange={(value) =>
											setFormConfig((prev) => ({ ...prev, calendar_id: value }))
										}
									/>
									<InputField
										label="API key"
										placeholder="Optional Google API key"
										value={formConfig.api_key ?? ""}
										type="password"
										onChange={(value) =>
											setFormConfig((prev) => ({ ...prev, api_key: value }))
										}
									/>
									<p className="text-xs text-muted-foreground">
										For public calendars, just enter the Calendar ID. For
										private calendars, also add a Google API key.
									</p>
									<div className="rounded-lg border border-border/50 p-3 space-y-3 bg-muted/10">
										<div className="flex items-center justify-between gap-3">
											<div>
												<h4 className="text-xs font-semibold">
													Upcoming events preview
												</h4>
												<p className="text-[11px] text-muted-foreground mt-1">
													Shows the next 5 events from the next 7 days.
												</p>
											</div>
											<button
												type="button"
												onClick={() => {
													setCalendarPreviewRequested(true);
													void refetchCalendarPreview();
												}}
												disabled={
													!isEditingModal ||
													editingIntegration?.status !== "active"
												}
												className="px-3 py-1.5 text-xs rounded-md bg-setra-600 hover:bg-setra-500 text-[#2b2418] transition-colors disabled:opacity-50"
											>
												Test connection
											</button>
										</div>
										{!isEditingModal ? (
											<p className="text-xs text-muted-foreground">
												Connect this calendar first, then test the connection.
											</p>
										) : editingIntegration?.status !== "active" ? (
											<p className="text-xs text-muted-foreground">
												Activate this integration to test the calendar feed.
											</p>
										) : calendarPreviewLoading ? (
											<p className="text-xs text-muted-foreground">
												Fetching events…
											</p>
										) : calendarPreviewError ? (
											<p className="text-xs text-accent-red">
												{calendarPreviewErrorObj instanceof Error
													? calendarPreviewErrorObj.message
													: "Failed to fetch calendar events."}
											</p>
										) : previewEvents.length === 0 ? (
											<p className="text-xs text-muted-foreground">
												No upcoming events found.
											</p>
										) : (
											<div className="space-y-2">
												{previewEvents.map((event) => (
													<div
														key={`${event.title}-${event.start}`}
														className="rounded-md border border-border/40 p-2 text-xs"
													>
														<div className="font-medium">{event.title}</div>
														<div className="text-muted-foreground mt-1">
															{formatDateTime(event.start)}
															{event.end
																? ` → ${formatDateTime(event.end)}`
																: ""}
														</div>
														{event.link && (
															<a
																href={event.link}
																target="_blank"
																rel="noreferrer"
																className="inline-block mt-1 text-setra-400 hover:text-setra-300"
															>
																Open in Google Calendar
															</a>
														)}
													</div>
												))}
											</div>
										)}
									</div>
								</>
							) : (
								standardFields.map((field) => (
									<InputField
										key={field.key}
										label={field.label}
										placeholder={field.placeholder}
										value={formConfig[field.key] ?? ""}
										onChange={(value) =>
											setFormConfig((prev) => ({ ...prev, [field.key]: value }))
										}
									/>
								))
							)}
						</div>
						<div className="flex gap-2 justify-end">
							<button
								type="button"
								onClick={closeModal}
								className="px-3 py-1.5 text-sm rounded-md hover:bg-muted/50 text-muted-foreground transition-colors"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleSubmit}
								disabled={isSaving}
								className="px-3 py-1.5 text-sm rounded-md bg-setra-600 hover:bg-setra-500 text-[#2b2418] transition-colors disabled:opacity-50"
							>
								{isSaving
									? isEditingModal
										? "Saving…"
										: "Connecting…"
									: isEditingModal
										? "Save changes"
										: "Connect"}
							</button>
						</div>
					</div>
				</div>
			)}

			{confirmDelete && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-[#fdfaf3]/60 backdrop-blur-sm">
					<div className="glass rounded-xl p-6 w-full max-w-sm animate-slide-in-up">
						<h3 className="text-sm font-semibold mb-2">Remove integration?</h3>
						<p className="text-xs text-muted-foreground mb-5">
							This will delete the integration and all its configuration. This
							cannot be undone.
						</p>
						<div className="flex gap-2 justify-end">
							<button
								type="button"
								onClick={() => setConfirmDelete(null)}
								className="px-3 py-1.5 text-sm rounded-md hover:bg-muted/50 text-muted-foreground transition-colors"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => deleteMutation.mutate(confirmDelete)}
								disabled={deleteMutation.isPending}
								className="px-3 py-1.5 text-sm rounded-md bg-destructive hover:bg-destructive/80 text-[#2b2418] transition-colors disabled:opacity-50"
							>
								{deleteMutation.isPending ? "Removing…" : "Remove"}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

// ─── Tab 2: Secrets ───────────────────────────────────────────────────────────

export function SecretsTab() {
	const qc = useQueryClient();
	const [showModal, setShowModal] = useState(false);
	const [editingSecret, setEditingSecret] = useState<Secret | null>(null);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [value, setValue] = useState("");
	const [showValue, setShowValue] = useState(false);
	const [savedMessage, setSavedMessage] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

	const {
		data: secrets = [],
		isLoading: secretsLoading,
		isError: secretsError,
	} = useQuery<Secret[]>({
		queryKey: ["secrets"],
		queryFn: () => api.secrets.list() as Promise<Secret[]>,
	});

	function resetForm() {
		setShowModal(false);
		setEditingSecret(null);
		setName("");
		setDescription("");
		setValue("");
		setShowValue(false);
	}

	function openCreateModal() {
		setSavedMessage(null);
		setEditingSecret(null);
		setName("");
		setDescription("");
		setValue("");
		setShowValue(false);
		setShowModal(true);
	}

	function openUpdateModal(secret: Secret) {
		setSavedMessage(null);
		setEditingSecret(secret);
		setName(secret.name);
		setDescription(secret.description ?? "");
		setValue("");
		setShowValue(false);
		setShowModal(true);
	}

	const addMutation = useMutation({
		mutationFn: (body: { name: string; description: string; value: string }) =>
			api.secrets.create(body),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["secrets"] });
			setSavedMessage("Value saved.");
			resetForm();
		},
	});

	const updateMutation = useMutation({
		mutationFn: ({ id, body }: { id: string; body: { value: string } }) =>
			api.secrets.update(id, body),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["secrets"] });
			setSavedMessage("Value saved.");
			resetForm();
		},
	});

	const deleteMutation = useMutation({
		mutationFn: (id: string) => api.secrets.delete(id),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["secrets"] });
			setConfirmDelete(null);
		},
	});

	const isEditing = editingSecret !== null;
	const isSaving = addMutation.isPending || updateMutation.isPending;

	return (
		<div className="space-y-6">
			<div className="glass rounded-xl p-5">
				<div className="mb-4 flex items-center justify-between gap-4">
					<div>
						<h2 className="text-sm font-semibold">Password Manager</h2>
						<p className="mt-1 text-xs text-muted-foreground">
							Securely store passwords, API keys, tokens, and credentials for
							your workspace.
						</p>
						{savedMessage && (
							<div className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent-green">
								<CheckCircle className="w-3.5 h-3.5" />
								{savedMessage}
							</div>
						)}
					</div>
					<button
						type="button"
						onClick={openCreateModal}
						className="flex items-center gap-1.5 rounded-md bg-setra-600 px-3 py-1.5 text-xs text-[#2b2418] transition-colors hover:bg-setra-500"
					>
						<Plus className="h-3.5 w-3.5" /> Add Password
					</button>
				</div>

				{secretsLoading ? (
					<p className="text-xs text-muted-foreground py-4 text-center">
						Loading…
					</p>
				) : secretsError ? (
					<p className="py-4 text-center text-xs text-accent-red">
						Failed to load saved passwords.
					</p>
				) : secrets.length === 0 ? (
					<p className="py-4 text-center text-xs text-muted-foreground">
						No saved passwords yet. Add passwords, API keys, and tokens to
						reference them safely in agent tasks.
					</p>
				) : (
					<div className="space-y-2">
						{secrets.map((s) => (
							<div
								key={s.id}
								className="flex items-center gap-4 py-2 px-3 rounded-lg hover:bg-muted/30 transition-colors group"
							>
								<Key className="w-4 h-4 shrink-0 text-setra-400" />
								<div className="flex-1 min-w-0">
									<p className="text-sm font-medium font-mono">{s.name}</p>
									{s.description && (
										<p className="text-xs text-muted-foreground">
											{s.description}
										</p>
									)}
								</div>
								{s.value_hint && (
									<span className="text-xs font-mono text-muted-foreground bg-muted/30 px-2 py-0.5 rounded">
										{s.value_hint}
									</span>
								)}
								<span className="text-xs text-muted-foreground">
									{formatDate(s.created_at)}
								</span>
								<button
									type="button"
									onClick={() => openUpdateModal(s)}
									className="opacity-0 group-hover:opacity-100 transition-opacity text-xs text-setra-400 hover:text-setra-300"
								>
									Update value
								</button>
								<button
									type="button"
									onClick={() => setConfirmDelete(s.id)}
									className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
								>
									<Trash2 className="w-4 h-4" />
								</button>
							</div>
						))}
					</div>
				)}
			</div>

			{showModal && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-[#fdfaf3]/60 backdrop-blur-sm">
					<div className="glass w-full max-w-md animate-slide-in-up rounded-xl p-6">
						<h3 className="mb-4 text-sm font-semibold">
							{isEditing ? "Update saved password" : "Add Password"}
						</h3>
						<div className="space-y-3 mb-5">
							{isEditing ? (
								<div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
									<p className="text-sm font-medium font-mono">{name}</p>
									{description && (
										<p className="text-xs text-muted-foreground mt-1">
											{description}
										</p>
									)}
								</div>
							) : (
								<>
									<InputField
										label="Name"
										placeholder="GITHUB_TOKEN"
										value={name}
										onChange={setName}
									/>
									<InputField
										label="Description (optional)"
										placeholder="GitHub PAT for issue management"
										value={description}
										onChange={setDescription}
									/>
								</>
							)}
							<div>
								<label className="mb-1 block text-xs text-muted-foreground">
									Password / Token
								</label>
								<div className="relative">
									<input
										type={showValue ? "text" : "password"}
										placeholder={
											isEditing
												? "Paste updated password or token…"
												: "Paste password or token…"
										}
										value={value}
										onChange={(e) => setValue(e.target.value)}
										className="w-full bg-input border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-setra-600 transition-colors pr-9"
									/>
									<button
										type="button"
										onClick={() => setShowValue((v) => !v)}
										className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
									>
										{showValue ? (
											<EyeOff className="w-4 h-4" />
										) : (
											<Eye className="w-4 h-4" />
										)}
									</button>
								</div>
								<p className="text-xs text-muted-foreground mt-1">
									Values are encrypted at rest. Only a masked hint is shown in
									the UI.
								</p>
							</div>
						</div>
						<div className="flex gap-2 justify-end">
							<button
								type="button"
								onClick={resetForm}
								className="px-3 py-1.5 text-sm rounded-md hover:bg-muted/50 text-muted-foreground transition-colors"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() =>
									isEditing && editingSecret
										? updateMutation.mutate({
												id: editingSecret.id,
												body: { value },
											})
										: addMutation.mutate({ name, description, value })
								}
								disabled={(!isEditing && !name) || !value || isSaving}
								className="px-3 py-1.5 text-sm rounded-md bg-setra-600 hover:bg-setra-500 text-[#2b2418] transition-colors disabled:opacity-50"
							>
								{isSaving
									? "Saving…"
									: isEditing
										? "Save password"
										: "Save password"}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Delete confirmation */}
			{confirmDelete && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-[#fdfaf3]/60 backdrop-blur-sm">
					<div className="glass w-full max-w-sm animate-slide-in-up rounded-xl p-6">
						<h3 className="mb-2 text-sm font-semibold">Delete password?</h3>
						<p className="mb-5 text-xs text-muted-foreground">
							This will permanently delete the saved password. Any agent tasks
							referencing it will fail.
						</p>
						<div className="flex gap-2 justify-end">
							<button
								type="button"
								onClick={() => setConfirmDelete(null)}
								className="px-3 py-1.5 text-sm rounded-md hover:bg-muted/50 text-muted-foreground transition-colors"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={() => deleteMutation.mutate(confirmDelete)}
								disabled={deleteMutation.isPending}
								className="px-3 py-1.5 text-sm rounded-md bg-destructive hover:bg-destructive/80 text-[#2b2418] transition-colors disabled:opacity-50"
							>
								{deleteMutation.isPending ? "Deleting…" : "Delete"}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

// ─── Page root ────────────────────────────────────────────────────────────────

export function IntegrationsPage() {
	return (
		<div className="max-w-4xl space-y-6">
			<IntegrationsTab />
		</div>
	);
}
