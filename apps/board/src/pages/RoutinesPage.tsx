import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Play, Plus, Repeat, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, EmptyState, PageHeader, Skeleton } from "../components/ui";
import { type RosterEntry, type Routine, api } from "../lib/api";
import { cn, timeAgo } from "../lib/utils";

const SCHEDULE_PRESETS = [
	{ label: "Every 5 min", cron: "*/5 * * * *" },
	{ label: "Every 15 min", cron: "*/15 * * * *" },
	{ label: "Hourly", cron: "0 * * * *" },
	{ label: "Every 6 hours", cron: "0 */6 * * *" },
	{ label: "Daily at 9 AM", cron: "0 9 * * *" },
	{ label: "Weekdays at 9 AM", cron: "0 9 * * 1-5" },
	{ label: "Weekly Monday", cron: "0 0 * * 1" },
];

function describeCron(expression: string): string {
	const presets = Object.fromEntries(
		SCHEDULE_PRESETS.map((preset) => [preset.cron, preset.label]),
	) as Record<string, string>;
	return presets[expression] ?? `Cron: ${expression}`;
}

interface RoutineFormState {
	name: string;
	description: string;
	schedule: string;
	agentId: string;
	prompt: string;
	isActive: boolean;
}

const DEFAULT_FORM: RoutineFormState = {
	name: "",
	description: "",
	schedule: SCHEDULE_PRESETS[0]?.cron ?? "*/5 * * * *",
	agentId: "",
	prompt: "",
	isActive: true,
};

function RoutineForm({
	form,
	onChange,
	agents,
	error,
}: {
	form: RoutineFormState;
	onChange: (next: RoutineFormState) => void;
	agents: Array<RosterEntry & { agent_id: string }>;
	error: string;
}) {
	const inputClass =
		"w-full rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-setra-400";
	const selectedPreset =
		SCHEDULE_PRESETS.find((preset) => preset.cron === form.schedule)?.cron ??
		"custom";

	const update = <K extends keyof RoutineFormState>(
		key: K,
		value: RoutineFormState[K],
	) => onChange({ ...form, [key]: value });

	return (
		<div className="space-y-4">
			<div className="space-y-1">
				<label className="text-xs text-muted-foreground">Name *</label>
				<input
					autoFocus
					value={form.name}
					onChange={(event) => update("name", event.target.value)}
					placeholder="Morning backlog sweep"
					className={inputClass}
				/>
			</div>

			<div className="space-y-1">
				<label className="text-xs text-muted-foreground">Description</label>
				<textarea
					rows={3}
					value={form.description}
					onChange={(event) => update("description", event.target.value)}
					placeholder="Optional context for the assigned agent"
					className={cn(inputClass, "resize-none")}
				/>
			</div>

			<div className="grid gap-3 sm:grid-cols-2">
				<div className="space-y-1">
					<label className="text-xs text-muted-foreground">
						Schedule preset
					</label>
					<select
						value={selectedPreset}
						onChange={(event) => {
							if (event.target.value === "custom") return;
							update("schedule", event.target.value);
						}}
						className={inputClass}
					>
						{SCHEDULE_PRESETS.map((preset) => (
							<option key={preset.cron} value={preset.cron}>
								{preset.label}
							</option>
						))}
						<option value="custom">Custom cron</option>
					</select>
				</div>

				<div className="space-y-1">
					<label className="text-xs text-muted-foreground">
						Cron expression *
					</label>
					<input
						value={form.schedule}
						onChange={(event) => update("schedule", event.target.value)}
						placeholder="0 9 * * 1-5"
						className={cn(inputClass, "font-mono text-xs")}
					/>
				</div>
			</div>

			{form.schedule.trim() && (
				<p className="text-xs text-muted-foreground">
					{describeCron(form.schedule.trim())}
				</p>
			)}

			<div className="space-y-1">
				<label className="text-xs text-muted-foreground">
					Assigned agent *
				</label>
				<select
					value={form.agentId}
					onChange={(event) => update("agentId", event.target.value)}
					className={inputClass}
				>
					<option value="">Select an agent…</option>
					{agents.map((agent) => (
						<option key={agent.agent_id} value={agent.agent_id}>
							{agent.display_name}
						</option>
					))}
				</select>
			</div>

			<div className="space-y-1">
				<label className="text-xs text-muted-foreground">Prompt</label>
				<textarea
					rows={4}
					value={form.prompt}
					onChange={(event) => update("prompt", event.target.value)}
					placeholder="What should this agent do when the routine fires?"
					className={cn(inputClass, "resize-none")}
				/>
			</div>

			<label className="flex items-center gap-2 text-sm text-foreground">
				<input
					type="checkbox"
					checked={form.isActive}
					onChange={(event) => update("isActive", event.target.checked)}
					className="h-4 w-4 rounded border-border/50 bg-muted/30"
				/>
				Routine is active
			</label>

			{error ? <p className="text-xs text-accent-red">{error}</p> : null}
		</div>
	);
}

export function RoutinesPage() {
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
	const [form, setForm] = useState<RoutineFormState>(DEFAULT_FORM);
	const [formError, setFormError] = useState("");

	const {
		data: routines = [],
		isLoading,
		isError,
	} = useQuery({
		queryKey: ["routines"],
		queryFn: api.routines.list,
	});

	const { data: roster = [] } = useQuery<RosterEntry[]>({
		queryKey: ["roster"],
		queryFn: () => api.agents.roster.list(),
	});

	const agents = useMemo(
		() =>
			roster.filter((agent): agent is RosterEntry & { agent_id: string } =>
				Boolean(agent.agent_id),
			),
		[roster],
	);

	const createMutation = useMutation({
		mutationFn: api.routines.create,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["routines"] });
			setDialogOpen(false);
			setEditingRoutine(null);
			setForm(DEFAULT_FORM);
			setFormError("");
		},
		onError: (error: Error) => setFormError(error.message),
	});

	const updateMutation = useMutation({
		mutationFn: ({ id, data }: { id: string; data: Partial<Routine> }) =>
			api.routines.update(id, data),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["routines"] });
			setDialogOpen(false);
			setEditingRoutine(null);
			setForm(DEFAULT_FORM);
			setFormError("");
		},
		onError: (error: Error) => setFormError(error.message),
	});

	const deleteMutation = useMutation({
		mutationFn: api.routines.delete,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["routines"] });
		},
	});

	const runMutation = useMutation({
		mutationFn: api.routines.run,
	});

	const toggleMutation = useMutation({
		mutationFn: api.routines.toggle,
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["routines"] });
		},
	});

	function openCreate() {
		setEditingRoutine(null);
		setForm(DEFAULT_FORM);
		setFormError("");
		setDialogOpen(true);
	}

	function openEdit(routine: Routine) {
		setEditingRoutine(routine);
		setForm({
			name: routine.name,
			description: routine.description ?? "",
			schedule: routine.schedule ?? "",
			agentId: routine.agentId ?? "",
			prompt: routine.prompt ?? "",
			isActive: routine.isActive,
		});
		setFormError("");
		setDialogOpen(true);
	}

	function handleSave() {
		if (!form.name.trim()) {
			setFormError("Name is required.");
			return;
		}
		if (!form.schedule.trim()) {
			setFormError("Schedule is required.");
			return;
		}
		if (!form.agentId) {
			setFormError("Assigned agent is required.");
			return;
		}

		const payload = {
			name: form.name.trim(),
			description: form.description.trim() || undefined,
			schedule: form.schedule.trim(),
			agentId: form.agentId,
			prompt: form.prompt.trim() || undefined,
			isActive: form.isActive,
		};

		if (editingRoutine) {
			updateMutation.mutate({
				id: editingRoutine.id,
				data: {
					name: payload.name,
					description: payload.description ?? null,
					schedule: payload.schedule,
					agentId: payload.agentId,
					prompt: payload.prompt ?? null,
					isActive: payload.isActive,
				},
			});
			return;
		}

		createMutation.mutate(payload);
	}

	const isSaving = createMutation.isPending || updateMutation.isPending;

	return (
		<div className="flex h-full flex-col">
			<div className="shrink-0 border-b border-border/50 px-6 pb-4 pt-6">
				<PageHeader
					title="Routines"
					subtitle="Schedule recurring agent work with simple cron expressions."
					actions={
						<Button onClick={openCreate} icon={<Plus className="h-4 w-4" />}>
							New Routine
						</Button>
					}
				/>
			</div>

			<div className="flex-1 overflow-auto px-6 py-4">
				{isLoading ? (
					<div className="space-y-3">
						{Array.from({ length: 4 }).map((_, index) => (
							<Skeleton key={index} variant="rect" height="56px" />
						))}
					</div>
				) : null}

				{isError ? (
					<p className="text-sm text-accent-red">Failed to load routines.</p>
				) : null}

				{!isLoading && !isError && routines.length === 0 ? (
					<EmptyState
						icon={<Repeat className="h-10 w-10" />}
						title="No routines yet"
						description="Create a routine to kick off scheduled work for an agent."
					/>
				) : null}

				{!isLoading && !isError && routines.length > 0 ? (
					<div className="overflow-hidden rounded-lg border border-border/50">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-border/50 bg-muted/20">
									<th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
										Name
									</th>
									<th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
										Schedule
									</th>
									<th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
										Agent
									</th>
									<th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
										Last triggered
									</th>
									<th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
										Active
									</th>
									<th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40">
										Actions
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border/30">
								{routines.map((routine) => {
									const isRunning =
										runMutation.isPending &&
										runMutation.variables === routine.id;
									const isDeleting =
										deleteMutation.isPending &&
										deleteMutation.variables === routine.id;
									const isToggling =
										toggleMutation.isPending &&
										toggleMutation.variables === routine.id;

									return (
										<tr
											key={routine.id}
											className="transition-colors hover:bg-muted/20"
										>
											<td className="px-4 py-3 align-top">
												<p className="font-medium text-foreground">
													{routine.name}
												</p>
												{routine.description ? (
													<p className="mt-1 text-xs text-muted-foreground">
														{routine.description}
													</p>
												) : null}
											</td>
											<td className="px-4 py-3 align-top">
												<p className="font-mono text-xs text-muted-foreground/70">
													{routine.schedule ?? "—"}
												</p>
												{routine.schedule ? (
													<p className="mt-1 text-xs text-muted-foreground">
														{describeCron(routine.schedule)}
													</p>
												) : null}
											</td>
											<td className="px-4 py-3 align-top text-xs text-muted-foreground">
												{routine.agentName ?? "Unassigned"}
											</td>
											<td className="px-4 py-3 align-top text-xs text-muted-foreground">
												{routine.lastTriggeredAt
													? timeAgo(routine.lastTriggeredAt)
													: "Never"}
											</td>
											<td className="px-4 py-3 align-top">
												<button
													type="button"
													onClick={() => toggleMutation.mutate(routine.id)}
													disabled={isToggling}
													className={cn(
														"inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
														routine.isActive
															? "border-accent-green/20 bg-accent-green/15 text-accent-green"
															: "border-border/50 bg-muted/30 text-muted-foreground",
													)}
												>
													<span
														className={cn(
															"h-1.5 w-1.5 rounded-full",
															routine.isActive
																? "bg-accent-green"
																: "bg-muted-foreground/50",
														)}
													/>
													{routine.isActive ? "Active" : "Inactive"}
												</button>
											</td>
											<td className="px-4 py-3 align-top">
												<div className="flex items-center gap-1">
													<button
														type="button"
														onClick={() => runMutation.mutate(routine.id)}
														disabled={isRunning}
														title="Run now"
														className="rounded p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted/50 hover:text-setra-300"
													>
														{isRunning ? (
															<Loader2 className="h-3.5 w-3.5 animate-spin" />
														) : (
															<Play className="h-3.5 w-3.5" />
														)}
													</button>
													<button
														type="button"
														onClick={() => openEdit(routine)}
														title="Edit"
														className="rounded p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted/50 hover:text-foreground"
													>
														<Pencil className="h-3.5 w-3.5" />
													</button>
													<button
														type="button"
														onClick={() => deleteMutation.mutate(routine.id)}
														disabled={isDeleting}
														title="Delete"
														className="rounded p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted/50 hover:text-accent-red"
													>
														{isDeleting ? (
															<Loader2 className="h-3.5 w-3.5 animate-spin" />
														) : (
															<Trash2 className="h-3.5 w-3.5" />
														)}
													</button>
												</div>
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>
				) : null}
			</div>

			<Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
				<Dialog.Portal>
					<Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
					<Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-full max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border/50 bg-card p-6 shadow-2xl">
						<div className="mb-4 flex items-center justify-between">
							<Dialog.Title className="text-sm font-semibold text-foreground">
								{editingRoutine ? "Edit Routine" : "New Routine"}
							</Dialog.Title>
							<Dialog.Close asChild>
								<button
									type="button"
									className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
								>
									<X className="h-4 w-4" />
								</button>
							</Dialog.Close>
						</div>

						<RoutineForm
							form={form}
							onChange={setForm}
							agents={agents}
							error={formError}
						/>

						<div className="mt-5 flex items-center justify-end gap-2">
							<Dialog.Close asChild>
								<button
									type="button"
									className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
								>
									Cancel
								</button>
							</Dialog.Close>
							<button
								type="button"
								onClick={handleSave}
								disabled={isSaving}
								className="inline-flex items-center gap-1.5 rounded-md border border-setra-600/20 bg-setra-600/15 px-4 py-1.5 text-sm text-setra-300 transition-colors hover:bg-setra-600/25 disabled:opacity-50"
							>
								{isSaving ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : null}
								Save Routine
							</button>
						</div>
					</Dialog.Content>
				</Dialog.Portal>
			</Dialog.Root>
		</div>
	);
}
