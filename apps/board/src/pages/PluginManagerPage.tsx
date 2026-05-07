import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Download, Package } from "lucide-react";
import { useState } from "react";
import {
	Badge,
	Button,
	Card,
	EmptyState,
	Input,
	PageHeader,
	Skeleton,
} from "../components/ui";
import { instanceSettings } from "../lib/api";

interface InstalledPlugin {
	id: string;
	name: string;
	version: string;
	description: string;
	isEnabled: boolean;
	config: Record<string, string>;
}

const MARKETPLACE_PLUGINS = [
	{
		id: "setra-github",
		name: "GitHub",
		description:
			"Sync issues and PRs with GitHub. Create issues from PRs and track agent work.",
		version: "1.0.0",
	},
	{
		id: "setra-jira",
		name: "Jira",
		description:
			"Two-way sync with Jira for mirrored issues and status updates.",
		version: "1.0.0",
	},
	{
		id: "setra-linear",
		name: "Linear",
		description: "Sync issues with Linear projects and keep status up to date.",
		version: "1.0.0",
	},
	{
		id: "setra-slack",
		name: "Slack",
		description:
			"Send agent notifications to Slack and surface approval requests.",
		version: "1.0.0",
	},
	{
		id: "setra-pagerduty",
		name: "PagerDuty",
		description:
			"Trigger incidents when critical agent errors or SLA breaches occur.",
		version: "0.9.0",
	},
	{
		id: "setra-datadog",
		name: "Datadog",
		description: "Export metrics, token usage, and cost data to Datadog.",
		version: "0.9.0",
	},
	{
		id: "setra-sentry",
		name: "Sentry",
		description:
			"Capture runtime errors and exceptions for debugging and reliability tracking.",
		version: "0.8.0",
	},
] as const;

const PLUGIN_FIELDS: Record<
	string,
	Array<{ key: string; label: string; type?: string }>
> = {
	"setra-github": [
		{ key: "token", label: "GitHub Token", type: "password" },
		{ key: "org", label: "Organization", type: "text" },
		{ key: "repo", label: "Repository (optional)", type: "text" },
	],
	"setra-slack": [
		{ key: "webhookUrl", label: "Webhook URL", type: "password" },
		{ key: "channel", label: "Channel", type: "text" },
	],
	"setra-jira": [
		{ key: "host", label: "Jira Host", type: "text" },
		{ key: "projectToken", label: "Project Token", type: "password" },
		{ key: "project", label: "Project Key", type: "text" },
	],
	"setra-linear": [
		{ key: "apiKey", label: "API Key", type: "password" },
		{ key: "teamId", label: "Team ID", type: "text" },
	],
};

function PluginConfigPanel({ plugin }: { plugin: InstalledPlugin }) {
	const qc = useQueryClient();
	const fields = PLUGIN_FIELDS[plugin.id] ?? null;
	const [formValues, setFormValues] = useState<Record<string, string>>(
		plugin.config,
	);
	const saveConfig = useMutation({
		mutationFn: (config: Record<string, string>) =>
			instanceSettings.plugins.configure(plugin.id, config),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["plugins"] }),
	});

	function handleChange(key: string, value: string) {
		setFormValues((prev) => ({ ...prev, [key]: value }));
	}

	const entries = fields
		? fields.map(
				(field) =>
					[
						field.key,
						formValues[field.key] ?? "",
						field.label,
						field.type,
					] as const,
			)
		: Object.entries(formValues).map(
				([key, value]) => [key, value, key, "text"] as const,
			);

	return (
		<div className="space-y-3 border-t border-border/30 pt-4">
			{entries.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No configuration options.
				</p>
			) : (
				entries.map(([key, value, label, type]) => (
					<Input
						key={key}
						label={label}
						type={type}
						value={value}
						onChange={(e) => handleChange(key, e.target.value)}
					/>
				))
			)}
			<Button
				type="button"
				onClick={() => saveConfig.mutate(formValues)}
				loading={saveConfig.isPending}
				className="w-full md:w-auto"
			>
				Save configuration
			</Button>
		</div>
	);
}

function InstalledPluginCard({ plugin }: { plugin: InstalledPlugin }) {
	const qc = useQueryClient();
	const [configOpen, setConfigOpen] = useState(false);
	const toggle = useMutation({
		mutationFn: (enabled: boolean) =>
			instanceSettings.plugins.toggle(plugin.id, enabled),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["plugins"] }),
	});
	const uninstall = useMutation({
		mutationFn: () => instanceSettings.plugins.uninstall(plugin.id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["plugins"] }),
	});

	return (
		<Card>
			<div className="space-y-4">
				<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
					<div className="flex items-start gap-3">
						<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-setra-600/20">
							<Package className="h-5 w-5 text-setra-300" aria-hidden="true" />
						</div>
						<div className="space-y-1">
							<div className="flex flex-wrap items-center gap-2">
								<p className="text-sm font-medium text-foreground">
									{plugin.name}
								</p>
								<Badge variant={plugin.isEnabled ? "success" : "default"}>
									v{plugin.version}
								</Badge>
							</div>
							<p className="text-sm text-muted-foreground">
								{plugin.description}
							</p>
						</div>
					</div>
					<Button
						type="button"
						variant={plugin.isEnabled ? "primary" : "secondary"}
						size="sm"
						onClick={() => toggle.mutate(!plugin.isEnabled)}
						loading={toggle.isPending}
					>
						{plugin.isEnabled ? "Enabled" : "Enable"}
					</Button>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => setConfigOpen((value) => !value)}
						icon={
							configOpen ? (
								<ChevronDown className="h-4 w-4" aria-hidden="true" />
							) : (
								<ChevronRight className="h-4 w-4" aria-hidden="true" />
							)
						}
					>
						{configOpen ? "Hide config" : "Configure"}
					</Button>
					<Button
						type="button"
						variant="danger"
						size="sm"
						onClick={() => uninstall.mutate()}
						loading={uninstall.isPending}
					>
						Uninstall
					</Button>
				</div>
				{configOpen ? <PluginConfigPanel plugin={plugin} /> : null}
			</div>
		</Card>
	);
}

function MarketplaceCard({
	plugin,
}: { plugin: (typeof MARKETPLACE_PLUGINS)[number] }) {
	const qc = useQueryClient();
	const install = useMutation({
		mutationFn: () => instanceSettings.plugins.install(plugin.id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["plugins"] }),
	});

	return (
		<Card>
			<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
				<div className="flex items-start gap-3">
					<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/40">
						<Package
							className="h-5 w-5 text-muted-foreground"
							aria-hidden="true"
						/>
					</div>
					<div className="space-y-1">
						<div className="flex flex-wrap items-center gap-2">
							<p className="text-sm font-medium text-foreground">
								{plugin.name}
							</p>
							<Badge>v{plugin.version}</Badge>
						</div>
						<p className="text-sm text-muted-foreground">
							{plugin.description}
						</p>
					</div>
				</div>
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={() => install.mutate()}
					loading={install.isPending}
					icon={<Download className="h-4 w-4" aria-hidden="true" />}
				>
					Install
				</Button>
			</div>
		</Card>
	);
}

export function PluginManagerPage() {
	const { data: installed = [], isLoading } = useQuery({
		queryKey: ["plugins"],
		queryFn: () => instanceSettings.plugins.list(),
	});

	const installedIds = new Set(installed.map((p) => p.id));
	const availableMarket = MARKETPLACE_PLUGINS.filter(
		(p) => !installedIds.has(p.id),
	);

	return (
		<div className="space-y-8">
			<PageHeader
				title="Plugins"
				subtitle="Extend setra with integrations and workflow tools."
				actions={<Badge variant="info">{installed.length} installed</Badge>}
			/>

			<section className="space-y-3">
				<h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/60">
					Installed
				</h2>
				{isLoading ? (
					<div className="space-y-3">
						<Skeleton variant="rect" height="120px" />
						<Skeleton variant="rect" height="120px" />
					</div>
				) : installed.length === 0 ? (
					<EmptyState
						icon={<Package className="h-10 w-10" aria-hidden="true" />}
						title="No plugins installed"
						description="Browse the marketplace below to add your first plugin."
					/>
				) : (
					<div className="space-y-3">
						{installed.map((plugin) => (
							<InstalledPluginCard key={plugin.id} plugin={plugin} />
						))}
					</div>
				)}
			</section>

			{availableMarket.length > 0 ? (
				<section className="space-y-3">
					<h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground/60">
						Marketplace
					</h2>
					<div className="space-y-3">
						{availableMarket.map((plugin) => (
							<MarketplaceCard key={plugin.id} plugin={plugin} />
						))}
					</div>
				</section>
			) : null}
		</div>
	);
}
