import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	ArrowRight,
	Bot,
	Coins,
	FolderKanban,
	FolderOpen,
	GitBranch,
	Globe,
	Pencil,
	Plus,
	ScrollText,
	Trash2,
} from "lucide-react";
import {
	type ChangeEvent,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";
import { Link } from "react-router-dom";
import {
	Badge,
	Button,
	Card,
	EmptyState,
	Input,
	Modal,
	PageHeader,
	Skeleton,
} from "../components/ui";
import { type Project, type ProjectRule, api } from "../lib/api";
import { cn, formatCost, timeAgo } from "../lib/utils";

const DEFAULT_RULE_TEMPLATE = `---
globs: ["src/**/*.ts"]
---

# Rule Title
- Add project-specific guidance here
`;

function ProjectFormFields({
	name,
	description,
	workspacePath,
	repoUrl,
	requirements,
	dbType,
	dbConnectionString,
	onNameChange,
	onDescriptionChange,
	onWorkspacePathChange,
	onRepoUrlChange,
	onRequirementsChange,
	onDbTypeChange,
	onDbConnectionStringChange,
	onBrowse,
	folderInputRef,
	onFolderPicked,
	showBrowse,
}: {
	name: string;
	description: string;
	workspacePath: string;
	repoUrl: string;
	requirements: string;
	dbType: string;
	dbConnectionString: string;
	onNameChange: (value: string) => void;
	onDescriptionChange: (value: string) => void;
	onWorkspacePathChange: (value: string) => void;
	onRepoUrlChange: (value: string) => void;
	onRequirementsChange: (value: string) => void;
	onDbTypeChange: (value: string) => void;
	onDbConnectionStringChange: (value: string) => void;
	onBrowse?: () => void;
	folderInputRef?: RefObject<HTMLInputElement>;
	onFolderPicked?: (e: ChangeEvent<HTMLInputElement>) => void;
	showBrowse?: boolean;
}) {
	return (
		<div className="space-y-4">
			<Input
				autoFocus
				label="Project name"
				value={name}
				onChange={(e) => onNameChange(e.target.value)}
				placeholder="e.g. Backend API"
			/>
			<div className="space-y-1.5">
				<label
					className="text-sm font-medium text-[#2b2418]"
					htmlFor="project-description"
				>
					Description
				</label>
				<textarea
					id="project-description"
					value={description}
					onChange={(e) => onDescriptionChange(e.target.value)}
					placeholder="What is this project about?"
					rows={3}
					className="w-full rounded-md border border-[#d9c6a3] bg-[#faf3e3]/70 px-3 py-2 text-sm text-[#2b2418] outline-none transition focus-visible:border-[#c9a25f] focus-visible:ring-2 focus-visible:ring-[#e2c787] focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 placeholder:text-[#8a7a5c]"
				/>
			</div>
			<div className="space-y-1.5">
				<label
					className="text-sm font-medium text-[#2b2418]"
					htmlFor="project-requirements"
				>
					Requirements Document
				</label>
				<textarea
					id="project-requirements"
					value={requirements}
					onChange={(e) => onRequirementsChange(e.target.value)}
					placeholder="Describe what this project should accomplish..."
					rows={6}
					className="w-full rounded-md border border-[#d9c6a3] bg-[#faf3e3]/70 px-3 py-2 text-sm text-[#2b2418] outline-none transition focus-visible:border-[#c9a25f] focus-visible:ring-2 focus-visible:ring-[#e2c787] focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 placeholder:text-[#8a7a5c]"
				/>
				<p className="text-xs text-[#6f6044]">
					Describe what this project should accomplish. The CEO agent will read
					this to create a plan and tasks.
				</p>
			</div>
			<div className="space-y-1.5">
				<label
					className="text-sm font-medium text-[#2b2418]"
					htmlFor="project-workspace"
				>
					Workspace folder
				</label>
				<div className="flex flex-col gap-2 md:flex-row">
					<Input
						id="project-workspace"
						value={workspacePath}
						onChange={(e) => onWorkspacePathChange(e.target.value)}
						placeholder="/Users/you/code/my-project"
						className="font-mono flex-1 min-w-0"
					/>
					{showBrowse && onBrowse ? (
						<Button
							type="button"
							variant="secondary"
							onClick={onBrowse}
							icon={<FolderOpen className="h-4 w-4" aria-hidden="true" />}
							className="w-full md:w-auto"
						>
							Browse
						</Button>
					) : null}
				</div>
				{showBrowse && folderInputRef && onFolderPicked ? (
					<input
						ref={folderInputRef}
						type="file"
						className="hidden"
						// @ts-expect-error Chromium / Electron directory input
						webkitdirectory=""
						directory=""
						onChange={onFolderPicked}
					/>
				) : null}
				<p className="text-xs text-[#6f6044]">
					When set, agents working on this project stay scoped to this folder.
				</p>
			</div>
			<Input
				label="Repository URL"
				value={repoUrl}
				onChange={(e) => onRepoUrlChange(e.target.value)}
				placeholder="https://github.com/org/repo"
				className="font-mono"
			/>
			<p className="-mt-3 text-xs text-[#6f6044]">
				Optional. Auto-detected from workspace git remote if not set.
			</p>
			{/* Database */}
			<div className="space-y-1.5">
				<label className="text-sm font-medium text-[#2b2418]">
					Database <span className="text-[#8a7a5c]">(optional)</span>
				</label>
				<select
					value={dbType}
					onChange={(e) => onDbTypeChange(e.target.value)}
					className="w-full rounded-md border border-[#d9c6a3] bg-[#faf3e3] px-3 py-2 text-sm text-[#2b2418] outline-none"
				>
					<option value="">No database yet</option>
					<option value="postgres">PostgreSQL / NeonDB</option>
					<option value="mysql">MySQL / PlanetScale</option>
					<option value="mongodb">MongoDB / Atlas</option>
					<option value="sqlite">SQLite (local)</option>
					<option value="mssql">Microsoft SQL Server</option>
				</select>
				{dbType && (
					<textarea
						value={dbConnectionString}
						onChange={(e) => onDbConnectionStringChange(e.target.value)}
						rows={2}
						placeholder={
							dbType === "mongodb"
								? "mongodb+srv://user:pass@cluster.mongodb.net/db"
								: "postgres://user:pass@host:5432/dbname"
						}
						className="w-full rounded-md border border-[#d9c6a3] bg-[#faf3e3]/70 px-3 py-2 font-mono text-sm text-[#2b2418] outline-none placeholder:text-[#8a7a5c]"
					/>
				)}
				<p className="text-xs text-[#6f6044]">
					You can also connect a database later from the project's Database tab.
				</p>
			</div>
		</div>
	);
}

function blankRule(name = "global.md") {
	return {
		name,
		content:
			name === "global.md"
				? "# Global Rules\n- Add shared instructions for this project\n"
				: DEFAULT_RULE_TEMPLATE,
	};
}

const PLAN_STATUS_BADGES = {
	draft: { label: "Plan Draft", variant: "warning" as const },
	approved: { label: "Plan Approved", variant: "success" as const },
	in_progress: { label: "In Progress", variant: "info" as const },
	completed: { label: "Completed", variant: "success" as const },
};

export function ProjectsPage() {
	const qc = useQueryClient();
	const [showCreate, setShowCreate] = useState(false);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [workspacePath, setWorkspacePath] = useState("");
	const [repoUrl, setRepoUrl] = useState("");
	const [requirements, setRequirements] = useState("");
	const [dbType, setDbType] = useState("");
	const [dbConnectionString, setDbConnectionString] = useState("");
	const [editingProject, setEditingProject] = useState<Project | null>(null);
	const [editName, setEditName] = useState("");
	const [editDescription, setEditDescription] = useState("");
	const [editWorkspacePath, setEditWorkspacePath] = useState("");
	const [editRepoUrl, setEditRepoUrl] = useState("");
	const [editRequirements, setEditRequirements] = useState("");
	const [selectedRuleName, setSelectedRuleName] = useState<string | null>(null);
	const [ruleName, setRuleName] = useState("global.md");
	const [ruleContent, setRuleContent] = useState(blankRule().content);
	const folderInputRef = useRef<HTMLInputElement | null>(null);

	function resetRuleEditor() {
		setSelectedRuleName(null);
		setRuleName("global.md");
		setRuleContent(blankRule().content);
	}

	function loadRule(rule: Pick<ProjectRule, "name" | "content">) {
		setSelectedRuleName(rule.name);
		setRuleName(rule.name);
		setRuleContent(rule.content);
	}

	async function handleBrowse() {
		// Use native Electron dialog if available (returns absolute path)
		const setra = (
			window as unknown as {
				setra?: { app?: { pickFolder?: () => Promise<string | null> } };
			}
		).setra;
		if (setra?.app?.pickFolder) {
			const folder = await setra.app.pickFolder();
			if (folder) {
				if (editingProject) {
					setEditWorkspacePath(folder);
				} else {
					setWorkspacePath(folder);
				}
			}
			return;
		}
		// Fallback: use server-side native OS dialog (osascript / zenity)
		try {
			const res = await api.runtime.pickFolder();
			if (res.ok && res.path) {
				if (editingProject) {
					setEditWorkspacePath(res.path);
				} else {
					setWorkspacePath(res.path);
				}
				return;
			}
		} catch {
			// If server pick fails, fall through to file input
		}
		folderInputRef.current?.click();
	}

	function handleFolderPicked(e: ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;
		let picked = "";
		const electronPath = (file as unknown as { path?: string }).path;
		if (electronPath) {
			// In Electron, file.path is absolute like "/Users/x/project/src/a.ts"
			// and webkitRelativePath is "project/src/a.ts". Strip the relative
			// portion to recover the selected directory's absolute path.
			const rel = file.webkitRelativePath;
			if (rel) {
				// Remove the relative path (including leading dir name) from the end
				const dirName = rel.split("/")[0] ?? "";
				const idx = electronPath.lastIndexOf(`/${dirName}`);
				if (dirName && idx >= 0) {
					picked = electronPath.slice(0, idx + 1 + dirName.length);
				} else {
					// Fallback: strip last segment
					const sep = electronPath.includes("\\") ? "\\" : "/";
					const last = electronPath.lastIndexOf(sep);
					picked = last > 0 ? electronPath.slice(0, last) : electronPath;
				}
			} else {
				const sep = electronPath.includes("\\") ? "\\" : "/";
				const last = electronPath.lastIndexOf(sep);
				picked = last > 0 ? electronPath.slice(0, last) : electronPath;
			}
		} else {
			// Browser fallback — webkitRelativePath is relative only, prompt user
			const rel = file.webkitRelativePath || file.name;
			const dirName = rel.split("/")[0] ?? "";
			// Can't derive absolute path in pure browser; use folder name as hint
			picked = dirName;
		}
		// Update the correct form depending on context
		if (editingProject) {
			setEditWorkspacePath(picked);
		} else {
			setWorkspacePath(picked);
		}
		e.target.value = "";
	}

	const { data: projects = [], isLoading } = useQuery({
		queryKey: ["projects"],
		queryFn: api.projects.list,
	});

	const { data: rules = [], isLoading: isRulesLoading } = useQuery({
		queryKey: ["project-rules", editingProject?.id],
		enabled: Boolean(editingProject?.workspacePath),
		queryFn: () => api.projects.rules.list(editingProject!.id),
	});

	useEffect(() => {
		if (!editingProject) {
			resetRuleEditor();
			return;
		}
		const selected = rules.find((rule) => rule.name === selectedRuleName);
		if (selected) return;
		if (rules.length > 0) {
			loadRule(rules[0]!);
			return;
		}
		resetRuleEditor();
	}, [editingProject, rules, selectedRuleName]);

	const createMut = useMutation({
		mutationFn: async () => {
			const project = await api.projects.create({
				name: name.trim(),
				...(description.trim() ? { description: description.trim() } : {}),
				...(workspacePath.trim()
					? { workspacePath: workspacePath.trim() }
					: {}),
				...(repoUrl.trim() ? { repoUrl: repoUrl.trim() } : {}),
				...(requirements.trim() ? { requirements: requirements.trim() } : {}),
			});
			if (dbConnectionString.trim() && dbType) {
				await api.projectDb
					.connect(project.id, {
						connectionString: dbConnectionString.trim(),
						type: dbType as
							| "postgres"
							| "mysql"
							| "mongodb"
							| "sqlite"
							| "mssql",
					})
					.catch(() => {
						/* non-fatal */
					});
			}
			return project;
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["projects"] });
			setShowCreate(false);
			setName("");
			setDescription("");
			setWorkspacePath("");
			setRepoUrl("");
			setRequirements("");
			setDbType("");
			setDbConnectionString("");
		},
	});

	const updateMut = useMutation({
		mutationFn: () => {
			if (!editingProject) throw new Error("No project selected");
			return api.projects.update(editingProject.id, {
				name: editName.trim(),
				description: editDescription.trim() ? editDescription.trim() : null,
				workspacePath: editWorkspacePath.trim()
					? editWorkspacePath.trim()
					: null,
				repoUrl: editRepoUrl.trim() ? editRepoUrl.trim() : null,
				requirements: editRequirements.trim() ? editRequirements.trim() : "",
			});
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["projects"] });
			setEditingProject(null);
			setEditName("");
			setEditDescription("");
			setEditWorkspacePath("");
			setEditRequirements("");
			resetRuleEditor();
		},
	});

	const saveRuleMut = useMutation({
		mutationFn: () => {
			if (!editingProject) throw new Error("No project selected");
			return api.projects.rules.upsert(editingProject.id, ruleName.trim(), {
				content: ruleContent,
			});
		},
		onSuccess: (savedRule) => {
			qc.invalidateQueries({ queryKey: ["project-rules", editingProject?.id] });
			loadRule(savedRule);
		},
	});

	const deleteRuleMut = useMutation({
		mutationFn: () => {
			if (!editingProject) throw new Error("No project selected");
			return api.projects.rules.delete(editingProject.id, ruleName);
		},
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["project-rules", editingProject?.id] });
			resetRuleEditor();
		},
	});

	function openEdit(project: Project) {
		setEditingProject(project);
		setEditName(project.name);
		setEditDescription(project.description ?? "");
		setEditWorkspacePath(project.workspacePath ?? "");
		setEditRepoUrl(project.repoUrl ?? "");
		setEditRequirements(project.requirements ?? "");
		resetRuleEditor();
	}

	function handleCreate() {
		if (!name.trim() || createMut.isPending) return;
		createMut.mutate();
	}

	function closeEditModal() {
		setEditingProject(null);
		setEditName("");
		setEditDescription("");
		setEditWorkspacePath("");
		setEditRepoUrl("");
		setEditRequirements("");
		resetRuleEditor();
	}

	const hasWorkspace = Boolean(editingProject?.workspacePath);
	const selectedExistingRule = rules.find((rule) => rule.name === ruleName);

	return (
		<div className="space-y-6">
			<PageHeader
				title="Projects"
				subtitle="Create and manage projects to organize issues and deploy agents."
				actions={
					<div className="flex items-center gap-2">
						{!isLoading ? (
							<Badge variant="info">{projects.length} total</Badge>
						) : null}
						<Button
							type="button"
							onClick={() => setShowCreate(true)}
							icon={<Plus className="h-4 w-4" aria-hidden="true" />}
						>
							New Project
						</Button>
					</div>
				}
			/>

			{isLoading ? (
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
					{Array.from({ length: 6 }).map((_, i) => (
						<Skeleton key={i} variant="rect" height="176px" />
					))}
				</div>
			) : null}

			{!isLoading && projects.length === 0 ? (
				<EmptyState
					icon={<FolderKanban className="h-10 w-10" aria-hidden="true" />}
					title="No projects yet"
					description="Create your first project to start organizing issues and deploying agents."
					action={
						<Button
							type="button"
							onClick={() => setShowCreate(true)}
							icon={<Plus className="h-4 w-4" aria-hidden="true" />}
						>
							Create your first project
						</Button>
					}
				/>
			) : null}

			{!isLoading && projects.length > 0 ? (
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
					{projects.map((project) => (
						<Card
							key={project.id}
							className="h-full transition-colors hover:border-setra-600/40"
						>
							<div className="flex h-full flex-col gap-4">
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<h3 className="truncate text-base font-semibold text-[#2b2418]">
												{project.name}
											</h3>
											{project.gitInitialized ? (
												<Badge variant="success">Git</Badge>
											) : project.workspacePath ? (
												<Badge variant="warning">No repo</Badge>
											) : null}
											{project.requirements?.trim() ? (
												<Badge variant="info">📋 Has Requirements</Badge>
											) : null}
											{project.planStatus && project.planStatus !== "none" ? (
												<Badge
													variant={
														PLAN_STATUS_BADGES[project.planStatus].variant
													}
												>
													{PLAN_STATUS_BADGES[project.planStatus].label}
												</Badge>
											) : null}
										</div>
										<p className="text-xs text-[#8a7a5c]">{project.slug}</p>
									</div>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										onClick={() => openEdit(project)}
										aria-label={`Edit ${project.name}`}
										icon={<Pencil className="h-4 w-4" aria-hidden="true" />}
									/>
								</div>

								<p className="text-sm text-[#6f6044]">
									{project.description || "No description provided yet."}
								</p>

								<div className="grid grid-cols-1 gap-2 text-sm text-[#6f6044] md:grid-cols-2">
									<div className="flex items-center gap-2">
										<FolderKanban className="h-4 w-4" aria-hidden="true" />
										<span>{project.issueCount} issues</span>
									</div>
									<div className="flex items-center gap-2">
										<Bot className="h-4 w-4" aria-hidden="true" />
										<span
											className={cn(
												project.activeAgentCount > 0 &&
													"text-accent-green font-medium",
											)}
										>
											{project.activeAgentCount} active
										</span>
									</div>
									<div className="flex items-center gap-2">
										<Coins className="h-4 w-4" aria-hidden="true" />
										<span>{formatCost(project.totalCostUsd)}</span>
									</div>
									{project.workspacePath ? (
										<div className="flex items-center gap-2 truncate md:col-span-2">
											<FolderOpen className="h-4 w-4" aria-hidden="true" />
											<span className="truncate font-mono text-xs">
												{project.workspacePath}
											</span>
										</div>
									) : (
										<div className="flex items-center gap-2 text-accent-orange md:col-span-2">
											<AlertTriangle className="h-4 w-4" aria-hidden="true" />
											<span>
												Workspace missing — code actions need a workspace path.
											</span>
										</div>
									)}
									{project.repoUrl && (
										<div className="flex items-center gap-2 truncate md:col-span-2">
											<Globe
												className="h-4 w-4 text-[#8a7a5c]"
												aria-hidden="true"
											/>
											<a
												href={project.repoUrl}
												target="_blank"
												rel="noreferrer"
												className="truncate font-mono text-xs text-setra-400 hover:underline"
											>
												{project.repoUrl.replace(/^https?:\/\//, "")}
											</a>
										</div>
									)}
									{project.defaultBranch && (
										<div className="flex items-center gap-2 truncate">
											<GitBranch
												className="h-4 w-4 text-[#8a7a5c]"
												aria-hidden="true"
											/>
											<span className="font-mono text-xs">
												{project.defaultBranch}
											</span>
										</div>
									)}
								</div>

								<div className="mt-auto flex items-center justify-between border-t border-border/20 pt-3 text-xs text-[#8a7a5c]">
									<span>Created {timeAgo(project.createdAt)}</span>
									<Link
										to={`/projects/${project.id}`}
										className="inline-flex items-center gap-1 text-setra-300 transition-colors hover:text-setra-200"
									>
										Open project
										<ArrowRight className="h-4 w-4" aria-hidden="true" />
									</Link>
								</div>
							</div>
						</Card>
					))}
				</div>
			) : null}

			<Modal
				open={showCreate}
				onClose={() => {
					setShowCreate(false);
					setName("");
					setDescription("");
					setWorkspacePath("");
					setRequirements("");
				}}
				title="New Project"
				actions={
					<>
						<Button
							type="button"
							variant="secondary"
							onClick={() => setShowCreate(false)}
						>
							Cancel
						</Button>
						<Button
							type="button"
							onClick={handleCreate}
							loading={createMut.isPending}
							disabled={!name.trim()}
						>
							Create
						</Button>
					</>
				}
			>
				<ProjectFormFields
					name={name}
					description={description}
					workspacePath={workspacePath}
					repoUrl={repoUrl}
					requirements={requirements}
					dbType={dbType}
					dbConnectionString={dbConnectionString}
					onNameChange={setName}
					onDescriptionChange={setDescription}
					onWorkspacePathChange={setWorkspacePath}
					onRepoUrlChange={setRepoUrl}
					onRequirementsChange={setRequirements}
					onDbTypeChange={setDbType}
					onDbConnectionStringChange={setDbConnectionString}
					onBrowse={handleBrowse}
					folderInputRef={folderInputRef}
					onFolderPicked={handleFolderPicked}
					showBrowse
				/>
				{createMut.isError ? (
					<p className="text-sm text-accent-red">
						Failed to create project. Please try again.
					</p>
				) : null}
			</Modal>

			<Modal
				open={Boolean(editingProject)}
				onClose={closeEditModal}
				title="Edit Project"
				size="lg"
				actions={
					<>
						<Button type="button" variant="secondary" onClick={closeEditModal}>
							Cancel
						</Button>
						<Button
							type="button"
							onClick={() => updateMut.mutate()}
							loading={updateMut.isPending}
							disabled={!editName.trim()}
						>
							Save
						</Button>
					</>
				}
			>
				<ProjectFormFields
					name={editName}
					description={editDescription}
					workspacePath={editWorkspacePath}
					repoUrl={editRepoUrl}
					requirements={editRequirements}
					dbType=""
					dbConnectionString=""
					onNameChange={setEditName}
					onDescriptionChange={setEditDescription}
					onWorkspacePathChange={setEditWorkspacePath}
					onRepoUrlChange={setEditRepoUrl}
					onRequirementsChange={setEditRequirements}
					onDbTypeChange={() => {}}
					onDbConnectionStringChange={() => {}}
					onBrowse={handleBrowse}
					folderInputRef={folderInputRef}
					onFolderPicked={handleFolderPicked}
					showBrowse
				/>
				{updateMut.isError ? (
					<p className="text-sm text-accent-red">
						Failed to update project details.
					</p>
				) : null}

				<div className="rounded-lg border border-[#e5d6b8] bg-[#fdfaf3]/40 p-4">
					<div className="flex flex-col gap-3 border-b border-[#e5d6b8] pb-4 md:flex-row md:items-center md:justify-between">
						<div>
							<div className="flex items-center gap-2">
								<ScrollText
									className="h-4 w-4 text-setra-300"
									aria-hidden="true"
								/>
								<h3 className="text-sm font-semibold text-[#2b2418]">Rules</h3>
							</div>
							<p className="mt-1 text-xs text-[#6f6044]">
								Manage{" "}
								<code className="rounded bg-[#faf3e3] px-1 py-0.5">
									.setra/rules/*.md
								</code>{" "}
								for this project.
							</p>
						</div>
						<div className="flex gap-2">
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={() => {
									const nextName = `rule-${rules.length + 1}.md`;
									setSelectedRuleName(null);
									setRuleName(nextName);
									setRuleContent(blankRule(nextName).content);
								}}
							>
								New Rule
							</Button>
							<Button
								type="button"
								variant="danger"
								size="sm"
								onClick={() => deleteRuleMut.mutate()}
								disabled={!selectedExistingRule}
								loading={deleteRuleMut.isPending}
								icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
							>
								Delete
							</Button>
						</div>
					</div>

					{!hasWorkspace ? (
						<p className="pt-4 text-sm text-accent-orange">
							Save a workspace path on the project before creating rules in{" "}
							<code className="rounded bg-[#faf3e3] px-1 py-0.5">
								.setra/rules
							</code>
							.
						</p>
					) : (
						<div className="grid gap-4 pt-4 md:grid-cols-[220px,1fr]">
							<div className="space-y-2">
								<p className="text-xs uppercase tracking-wide text-[#8a7a5c]">
									Rule files
								</p>
								{isRulesLoading ? (
									<Skeleton variant="rect" height="112px" />
								) : rules.length > 0 ? (
									<div className="space-y-2">
										{rules.map((rule) => (
											<button
												key={rule.name}
												type="button"
												onClick={() => loadRule(rule)}
												className={cn(
													"w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
													rule.name === ruleName
														? "border-setra-500 bg-[#faf3e3] text-[#2b2418]"
														: "border-[#e5d6b8] bg-[#fdfaf3]/60 text-[#4b3f2d] hover:border-[#d9c6a3]",
												)}
											>
												<div className="truncate font-medium">{rule.name}</div>
												<div className="truncate text-xs text-[#8a7a5c]">
													{rule.glob ?? "Always applied"}
												</div>
											</button>
										))}
									</div>
								) : (
									<p className="text-sm text-[#8a7a5c]">
										No rules yet. Create global.md to start.
									</p>
								)}
							</div>

							<div className="space-y-3">
								<Input
									label="Rule file name"
									value={ruleName}
									onChange={(e) => setRuleName(e.target.value)}
									placeholder="global.md"
									className="font-mono"
								/>
								<div className="space-y-1.5">
									<label
										className="text-sm font-medium text-[#2b2418]"
										htmlFor="project-rule-content"
									>
										Rule content
									</label>
									<textarea
										id="project-rule-content"
										value={ruleContent}
										onChange={(e) => setRuleContent(e.target.value)}
										rows={14}
										className="w-full rounded-md border border-[#d9c6a3] bg-[#faf3e3]/70 px-3 py-2 font-mono text-xs text-[#2b2418] outline-none transition focus-visible:border-[#c9a25f] focus-visible:ring-2 focus-visible:ring-[#e2c787] focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 placeholder:text-[#8a7a5c]"
									/>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<Button
										type="button"
										onClick={() => saveRuleMut.mutate()}
										loading={saveRuleMut.isPending}
										disabled={!ruleName.trim() || !ruleContent.trim()}
									>
										Save Rule
									</Button>
									<Badge variant="info">
										{selectedExistingRule
											? "Editing existing rule"
											: "New rule"}
									</Badge>
								</div>
								{saveRuleMut.isError ? (
									<p className="text-sm text-accent-red">
										Could not save this rule.
									</p>
								) : null}
								{deleteRuleMut.isError ? (
									<p className="text-sm text-accent-red">
										Could not delete this rule.
									</p>
								) : null}
							</div>
						</div>
					)}
				</div>
			</Modal>
		</div>
	);
}
