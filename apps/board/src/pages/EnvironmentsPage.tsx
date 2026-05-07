import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderKanban, Pencil, Plus, Server, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
	Badge,
	Button,
	EmptyState,
	Input,
	Modal,
	PageHeader,
	Select,
} from "../components/ui";
import {
	type Environment,
	type EnvironmentInput,
	type Project,
	api,
} from "../lib/api";

type EnvironmentFormState = {
	name: string;
	type: "local" | "ssh" | "docker";
	host: string;
	port: string;
	username: string;
	authType: "key" | "password" | "agent";
	keyPath: string;
	secretRef: string;
	projectId: string;
	dockerImage: string;
	dockerNetwork: string;
	notes: string;
};

type SecretOption = Awaited<ReturnType<typeof api.secrets.list>>[number];

const defaultFormState: EnvironmentFormState = {
	name: "",
	type: "local",
	host: "",
	port: "22",
	username: "",
	authType: "agent",
	keyPath: "",
	secretRef: "",
	projectId: "",
	dockerImage: "",
	dockerNetwork: "",
	notes: "",
};

function environmentToForm(environment: Environment): EnvironmentFormState {
	return {
		name: environment.name,
		type:
			environment.ground_type === "ssh" || environment.ground_type === "docker"
				? environment.ground_type
				: "local",
		host: environment.host,
		port: String(environment.port ?? 22),
		username: environment.username,
		authType: environment.auth_type ?? "agent",
		keyPath: environment.key_path ?? "",
		secretRef: environment.secret_ref ?? "",
		projectId: environment.project_id ?? "",
		dockerImage: environment.docker_image ?? "",
		dockerNetwork: environment.docker_network ?? "",
		notes: environment.notes ?? "",
	};
}

function buildEnvironmentPayload(form: EnvironmentFormState): EnvironmentInput {
	const payload: EnvironmentInput = {
		name: form.name.trim(),
		type: form.type,
		notes: form.notes.trim() || undefined,
		projectId: form.projectId || undefined,
	};

	if (form.type === "ssh") {
		payload.host = form.host.trim() || undefined;
		payload.port = Number(form.port) || 22;
		payload.username = form.username.trim() || undefined;
		payload.authType = form.authType;
		payload.keyPath =
			form.authType === "key" ? form.keyPath.trim() || undefined : undefined;
		payload.secretRef = form.secretRef || undefined;
	}

	if (form.type === "docker") {
		payload.dockerImage = form.dockerImage.trim() || undefined;
		payload.dockerNetwork = form.dockerNetwork.trim() || undefined;
	}

	return payload;
}

function formatEnvironmentSummary(environment: Environment): string {
	switch (environment.ground_type) {
		case "ssh":
			return `${environment.username || "user"}@${environment.host}:${environment.port}`;
		case "docker":
			return environment.docker_image || "Docker container";
		default:
			return "Local company environment";
	}
}

function typeLabel(type: Environment["ground_type"]): string {
	switch (type) {
		case "ssh":
			return "SSH";
		case "docker":
			return "Docker";
		case "database":
			return "Database";
		default:
			return "Local";
	}
}

function EnvironmentCard({
	environment,
	project,
	onEdit,
	onDelete,
	isDeleting,
}: {
	environment: Environment;
	project?: Project | undefined;
	onEdit: () => void;
	onDelete: () => void;
	isDeleting: boolean;
}) {
	return (
		<div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
			<div className="flex items-start justify-between gap-3">
				<div className="space-y-2">
					<div className="flex items-center gap-2">
						<h3 className="text-sm font-semibold text-white">
							{environment.name}
						</h3>
						<Badge variant="info">{typeLabel(environment.ground_type)}</Badge>
						{project ? <Badge>{project.name}</Badge> : null}
					</div>
					<p className="text-sm text-zinc-400">
						{formatEnvironmentSummary(environment)}
					</p>
					{environment.ground_type === "ssh" ? (
						<div className="flex flex-wrap gap-2 text-xs text-zinc-400">
							<Badge>{environment.auth_type}</Badge>
							{environment.secret_ref ? (
								<Badge>secret:{environment.secret_ref}</Badge>
							) : null}
							{environment.key_path ? (
								<Badge>key:{environment.key_path}</Badge>
							) : null}
						</div>
					) : null}
					{environment.ground_type === "docker" &&
					environment.docker_network ? (
						<p className="text-xs text-zinc-500">
							Network: {environment.docker_network}
						</p>
					) : null}
					{environment.notes ? (
						<p className="text-sm text-zinc-500">{environment.notes}</p>
					) : null}
				</div>
				<div className="flex items-center gap-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onEdit}
						icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
					>
						Edit
					</Button>
					<Button
						type="button"
						variant="danger"
						size="sm"
						onClick={onDelete}
						loading={isDeleting}
						icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
					>
						Delete
					</Button>
				</div>
			</div>
		</div>
	);
}

function EnvironmentModal({
	open,
	onClose,
	onSubmit,
	isPending,
	projects,
	secrets,
	initial,
}: {
	open: boolean;
	onClose: () => void;
	onSubmit: (data: EnvironmentInput) => void;
	isPending: boolean;
	projects: Project[];
	secrets: SecretOption[];
	initial?: Environment | undefined;
}) {
	const [form, setForm] = useState<EnvironmentFormState>(
		initial ? environmentToForm(initial) : defaultFormState,
	);
	const isEdit = Boolean(initial);
	const payload = buildEnvironmentPayload(form);
	const canSubmit =
		form.name.trim().length > 0 &&
		(form.type !== "ssh" || Boolean(payload.host && payload.username)) &&
		(form.type !== "docker" || Boolean(payload.dockerImage));

	function updateField<K extends keyof EnvironmentFormState>(
		key: K,
		value: EnvironmentFormState[K],
	) {
		setForm((current) => ({ ...current, [key]: value }));
	}

	return (
		<Modal
			open={open}
			onClose={onClose}
			title={isEdit ? "Edit environment" : "Create environment"}
			size="lg"
			actions={
				<>
					<Button type="button" variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button
						type="button"
						onClick={() => onSubmit(payload)}
						loading={isPending}
						disabled={!canSubmit}
					>
						{isEdit ? "Save changes" : "Create environment"}
					</Button>
				</>
			}
		>
			<div className="grid gap-4 md:grid-cols-2">
				<Input
					label="Name"
					value={form.name}
					onChange={(event) => updateField("name", event.target.value)}
					placeholder="Production SSH"
				/>
				<Select
					label="Type"
					value={form.type}
					onChange={(event) =>
						updateField(
							"type",
							event.target.value as EnvironmentFormState["type"],
						)
					}
				>
					<option value="local">Local</option>
					<option value="ssh">SSH</option>
					<option value="docker">Docker</option>
				</Select>
				<Select
					label="Project"
					value={form.projectId}
					onChange={(event) => updateField("projectId", event.target.value)}
					helperText="Leave empty to share across the whole company."
				>
					<option value="">Company-wide</option>
					{projects.map((project) => (
						<option key={project.id} value={project.id}>
							{project.name}
						</option>
					))}
				</Select>
				<div className="space-y-1.5 md:col-span-2">
					<label
						className="text-sm font-medium text-zinc-100"
						htmlFor="environment-notes"
					>
						Notes
					</label>
					<textarea
						id="environment-notes"
						value={form.notes}
						onChange={(event) => updateField("notes", event.target.value)}
						placeholder="Shared staging shell for deployment verification"
						className="min-h-24 w-full rounded-md border border-zinc-700 bg-zinc-900/70 px-3 py-2 text-sm text-white outline-none transition placeholder:text-zinc-500 focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
					/>
				</div>

				{form.type === "ssh" ? (
					<>
						<Input
							label="Host"
							value={form.host}
							onChange={(event) => updateField("host", event.target.value)}
							placeholder="example.internal"
						/>
						<Input
							label="Port"
							type="number"
							value={form.port}
							onChange={(event) => updateField("port", event.target.value)}
							placeholder="22"
						/>
						<Input
							label="Username"
							value={form.username}
							onChange={(event) => updateField("username", event.target.value)}
							placeholder="ubuntu"
						/>
						<Select
							label="Auth type"
							value={form.authType}
							onChange={(event) =>
								updateField(
									"authType",
									event.target.value as EnvironmentFormState["authType"],
								)
							}
						>
							<option value="agent">Agent</option>
							<option value="key">Key</option>
							<option value="password">Password</option>
						</Select>
						{form.authType === "key" ? (
							<Input
								label="Key path"
								value={form.keyPath}
								onChange={(event) => updateField("keyPath", event.target.value)}
								placeholder="~/.ssh/id_ed25519"
							/>
						) : null}
						<Select
							label="Secret reference"
							value={form.secretRef}
							onChange={(event) => updateField("secretRef", event.target.value)}
							helperText="Uses a company secret by name for password or PEM content."
						>
							<option value="">None</option>
							{secrets.map((secret) => (
								<option key={secret.id} value={secret.name}>
									{secret.name}
								</option>
							))}
						</Select>
					</>
				) : null}

				{form.type === "docker" ? (
					<>
						<Input
							label="Docker image"
							value={form.dockerImage}
							onChange={(event) =>
								updateField("dockerImage", event.target.value)
							}
							placeholder="node:20-alpine"
						/>
						<Input
							label="Docker network"
							value={form.dockerNetwork}
							onChange={(event) =>
								updateField("dockerNetwork", event.target.value)
							}
							placeholder="setra_default"
						/>
					</>
				) : null}
			</div>
		</Modal>
	);
}

export function EnvironmentsPage() {
	const qc = useQueryClient();
	const [modalOpen, setModalOpen] = useState(false);
	const [editingEnvironment, setEditingEnvironment] = useState<Environment>();

	const { data: environments = [], isLoading } = useQuery({
		queryKey: ["environments"],
		queryFn: () => api.environments.list(),
	});
	const { data: projects = [] } = useQuery({
		queryKey: ["projects"],
		queryFn: () => api.projects.list(),
	});
	const { data: secrets = [] } = useQuery({
		queryKey: ["secrets"],
		queryFn: () => api.secrets.list(),
	});

	const createMutation = useMutation({
		mutationFn: (data: EnvironmentInput) => api.environments.create(data),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["environments"] });
			setModalOpen(false);
			setEditingEnvironment(undefined);
		},
	});
	const updateMutation = useMutation({
		mutationFn: ({ id, data }: { id: string; data: EnvironmentInput }) =>
			api.environments.update(id, data),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: ["environments"] });
			setModalOpen(false);
			setEditingEnvironment(undefined);
		},
	});
	const deleteMutation = useMutation({
		mutationFn: (id: string) => api.environments.delete(id),
		onSuccess: () => void qc.invalidateQueries({ queryKey: ["environments"] }),
	});

	const projectMap = useMemo(
		() => new Map(projects.map((project) => [project.id, project])),
		[projects],
	);
	const grouped = useMemo(() => {
		const companyWide = environments.filter(
			(environment) => !environment.project_id,
		);
		const perProject = environments
			.filter((environment) => environment.project_id)
			.reduce<Map<string, Environment[]>>((groups, environment) => {
				const projectId = environment.project_id as string;
				const current = groups.get(projectId) ?? [];
				current.push(environment);
				groups.set(projectId, current);
				return groups;
			}, new Map());
		return {
			companyWide,
			perProject: [...perProject.entries()].sort((a, b) => {
				const aName = projectMap.get(a[0])?.name ?? a[0];
				const bName = projectMap.get(b[0])?.name ?? b[0];
				return aName.localeCompare(bName);
			}),
		};
	}, [environments, projectMap]);

	function openCreate() {
		setEditingEnvironment(undefined);
		setModalOpen(true);
	}

	function openEdit(environment: Environment) {
		setEditingEnvironment(environment);
		setModalOpen(true);
	}

	function submitEnvironment(data: EnvironmentInput) {
		if (editingEnvironment) {
			updateMutation.mutate({ id: editingEnvironment.id, data });
			return;
		}
		createMutation.mutate(data);
	}

	return (
		<div className="mx-auto w-full max-w-6xl space-y-6">
			<PageHeader
				title="Environments"
				subtitle="Manage company-wide and project-specific execution environments."
				actions={
					<>
						<Badge variant="info">{environments.length} configured</Badge>
						<Button
							type="button"
							onClick={openCreate}
							icon={<Plus className="h-4 w-4" aria-hidden="true" />}
						>
							Add environment
						</Button>
					</>
				}
			/>

			{isLoading ? (
				<div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-6 py-12 text-center text-sm text-zinc-400">
					Loading environments…
				</div>
			) : environments.length === 0 ? (
				<EmptyState
					icon={<Server className="h-10 w-10" aria-hidden="true" />}
					title="No environments configured"
					description="Create a shared company environment or scope one to a single project."
					action={
						<Button
							type="button"
							onClick={openCreate}
							icon={<Plus className="h-4 w-4" aria-hidden="true" />}
						>
							Create environment
						</Button>
					}
				/>
			) : (
				<div className="space-y-6">
					<section className="space-y-3">
						<div className="flex items-center gap-2">
							<Server className="h-4 w-4 text-zinc-400" aria-hidden="true" />
							<h2 className="text-sm font-semibold text-white">Company-wide</h2>
							<Badge>{grouped.companyWide.length}</Badge>
						</div>
						{grouped.companyWide.length === 0 ? (
							<div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 px-4 py-6 text-sm text-zinc-500">
								No shared environments yet.
							</div>
						) : (
							<div className="grid gap-4 xl:grid-cols-2">
								{grouped.companyWide.map((environment) => (
									<EnvironmentCard
										key={environment.id}
										environment={environment}
										onEdit={() => openEdit(environment)}
										onDelete={() => deleteMutation.mutate(environment.id)}
										isDeleting={
											deleteMutation.isPending &&
											deleteMutation.variables === environment.id
										}
									/>
								))}
							</div>
						)}
					</section>

					{grouped.perProject.map(([projectId, items]) => (
						<section key={projectId} className="space-y-3">
							<div className="flex items-center gap-2">
								<FolderKanban
									className="h-4 w-4 text-zinc-400"
									aria-hidden="true"
								/>
								<h2 className="text-sm font-semibold text-white">
									{projectMap.get(projectId)?.name ?? "Unknown project"}
								</h2>
								<Badge>{items.length}</Badge>
							</div>
							<div className="grid gap-4 xl:grid-cols-2">
								{items.map((environment) => (
									<EnvironmentCard
										key={environment.id}
										environment={environment}
										project={projectMap.get(projectId)}
										onEdit={() => openEdit(environment)}
										onDelete={() => deleteMutation.mutate(environment.id)}
										isDeleting={
											deleteMutation.isPending &&
											deleteMutation.variables === environment.id
										}
									/>
								))}
							</div>
						</section>
					))}
				</div>
			)}

			<EnvironmentModal
				key={editingEnvironment?.id ?? "new"}
				open={modalOpen}
				onClose={() => {
					setModalOpen(false);
					setEditingEnvironment(undefined);
				}}
				onSubmit={submitEnvironment}
				isPending={createMutation.isPending || updateMutation.isPending}
				projects={projects}
				secrets={secrets}
				initial={editingEnvironment}
			/>
		</div>
	);
}
