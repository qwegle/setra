import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	CheckCircle,
	Clock,
	Code2,
	Database,
	Globe,
	MoreHorizontal,
	Pencil,
	Play,
	Plus,
	Search,
	Shield,
	Tag,
	Trash2,
	Wrench,
} from "lucide-react";
import { useState } from "react";
import { Badge, Button, Input, PageHeader } from "../components/ui";
import { api } from "../lib/api";

interface Skill {
	id: string;
	name: string;
	slug: string;
	description: string;
	category: "code" | "web" | "security" | "data" | "custom";
	trigger: string; // natural language pattern that activates this skill
	prompt: string; // injected into agent context when triggered
	isActive: boolean;
	usageCount: number;
	lastUsedAt: string | null;
	createdAt: string;
}

const CATEGORY_META = {
	code: { label: "Code", icon: Code2, color: "text-setra-400" },
	web: { label: "Web", icon: Globe, color: "text-accent-cyan" },
	security: { label: "Security", icon: Shield, color: "text-accent-orange" },
	data: { label: "Data", icon: Database, color: "text-accent-green" },
	custom: { label: "Custom", icon: Wrench, color: "text-muted-foreground" },
};

export function SkillsPage() {
	const qc = useQueryClient();
	const [search, setSearch] = useState("");
	const [filterCat, setFilterCat] = useState<string>("all");
	const [page, setPage] = useState(1);
	const [pageSize, setPageSize] = useState(20);
	const [showNew, setShowNew] = useState(false);
	const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
	const [newSkill, setNewSkill] = useState({
		name: "",
		description: "",
		category: "code" as Skill["category"],
		trigger: "",
		prompt: "",
		isActive: true,
		slug: "",
	});

	const {
		data: skillsPage,
		isLoading,
		isError,
		error,
	} = useQuery({
		queryKey: ["skills", page, pageSize, search, filterCat],
		queryFn: () =>
			api.skills.list({
				page,
				pageSize,
				search,
				category: filterCat,
			}),
		placeholderData: (prev) => prev,
	});
	const skills = (skillsPage?.items ?? []) as Skill[];

	const toggleMut = useMutation({
		mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
			api.skills.toggle(id, isActive),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
	});

	const createMut = useMutation({
		mutationFn: (
			body: Omit<Skill, "id" | "usageCount" | "lastUsedAt" | "createdAt">,
		) => api.skills.create(body),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["skills"] });
			setShowNew(false);
			setNewSkill({
				name: "",
				description: "",
				category: "code",
				trigger: "",
				prompt: "",
				isActive: true,
				slug: "",
			});
		},
	});
	const updateMut = useMutation({
		mutationFn: (body: {
			id: string;
			data: Partial<
				Omit<Skill, "id" | "usageCount" | "lastUsedAt" | "createdAt">
			>;
		}) => api.skills.update(body.id, body.data),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["skills"] });
			setShowNew(false);
			setEditingSkillId(null);
			setNewSkill({
				name: "",
				description: "",
				category: "code",
				trigger: "",
				prompt: "",
				isActive: true,
				slug: "",
			});
		},
	});
	const deleteMut = useMutation({
		mutationFn: (id: string) => api.skills.delete(id),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
	});

	const activeCount = skills.filter((s) => s.isActive).length;

	return (
		<div className="flex flex-col h-full overflow-hidden gap-4">
			<PageHeader
				title="Skills"
				subtitle={`${activeCount} active on this page · ${skillsPage?.total ?? 0} total — reusable agent capabilities injected on demand.`}
				actions={
					<div className="flex items-center gap-2">
						<Badge variant="info">{filterCat}</Badge>
						<Button
							onClick={() => {
								setEditingSkillId(null);
								setNewSkill({
									name: "",
									description: "",
									category: "code",
									trigger: "",
									prompt: "",
									isActive: true,
									slug: "",
								});
								setShowNew(true);
							}}
							icon={<Plus className="h-4 w-4" aria-hidden="true" />}
						>
							New Skill
						</Button>
					</div>
				}
			/>

			{/* Filters */}
			<div className="flex items-center gap-3 px-6 py-3 border-b border-border/30">
				<div className="flex-1 max-w-xs">
					<Input
						label="Search skills"
						value={search}
						onChange={(e) => {
							setSearch(e.target.value);
							setPage(1);
						}}
						placeholder="Search skills…"
					/>
				</div>
				<div className="flex items-center gap-1">
					{["all", ...Object.keys(CATEGORY_META)].map((cat) => (
						<button
							key={cat}
							onClick={() => {
								setFilterCat(cat);
								setPage(1);
							}}
							className={`px-2.5 py-1 rounded text-xs transition-colors capitalize ${
								filterCat === cat
									? "bg-setra-600/20 text-setra-300 border border-setra-600/30"
									: "text-muted-foreground hover:text-foreground"
							}`}
						>
							{cat}
						</button>
					))}
				</div>
			</div>

			{/* Skills grid */}
			<div className="flex-1 overflow-y-auto p-6">
				<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
					{skills.map((skill) => {
						const meta = CATEGORY_META[skill.category];
						const Icon = meta.icon;
						return (
							<div
								key={skill.id}
								className={`glass rounded-xl p-4 flex flex-col gap-3 border transition-colors ${
									skill.isActive
										? "border-border/50"
										: "border-border/20 opacity-60"
								}`}
							>
								<div className="flex items-start justify-between">
									<div className="flex items-center gap-2">
										<div className="flex items-center justify-center w-7 h-7 rounded-md bg-muted/60">
											<Icon className={`w-3.5 h-3.5 ${meta.color}`} />
										</div>
										<div>
											<p className="text-sm font-medium text-foreground leading-tight">
												{skill.name}
											</p>
											<span className="text-[10px] font-mono text-muted-foreground/60">
												{skill.slug}
											</span>
										</div>
									</div>
									<details className="relative">
										<summary className="list-none cursor-pointer text-muted-foreground/40 hover:text-muted-foreground transition-colors">
											<MoreHorizontal className="w-4 h-4" />
										</summary>
										<div className="absolute right-0 mt-1 w-28 rounded-md border border-border/50 bg-card shadow-xl z-10">
											<button
												type="button"
												onClick={() => {
													setEditingSkillId(skill.id);
													setNewSkill({
														name: skill.name,
														slug: skill.slug,
														description: skill.description ?? "",
														category: skill.category,
														trigger: skill.trigger ?? "",
														prompt: skill.prompt ?? "",
														isActive: skill.isActive,
													});
													setShowNew(true);
												}}
												className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-left text-foreground hover:bg-muted/50"
											>
												<Pencil className="w-3.5 h-3.5" /> Edit
											</button>
											<button
												type="button"
												onClick={() => {
													if (window.confirm(`Delete skill "${skill.name}"?`)) {
														deleteMut.mutate(skill.id);
													}
												}}
												className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-left text-accent-red hover:bg-muted/50"
											>
												<Trash2 className="w-3.5 h-3.5" /> Delete
											</button>
										</div>
									</details>
								</div>

								<p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
									{skill.description}
								</p>

								{/* Trigger tags */}
								<div className="flex flex-wrap gap-1">
									{skill.trigger.split(",").map((t) => (
										<span
											key={t}
											className="flex items-center gap-1 px-1.5 py-0.5 bg-muted/50 rounded text-[10px] text-muted-foreground/70"
										>
											<Tag className="w-2.5 h-2.5" />
											{t.trim()}
										</span>
									))}
								</div>

								{/* Prompt preview */}
								<pre className="text-[10px] font-mono text-muted-foreground/50 bg-[#fdfaf3]/50 rounded p-2 line-clamp-2 whitespace-pre-wrap">
									{skill.prompt}
								</pre>

								<div className="flex items-center justify-between mt-auto pt-1">
									<div className="flex items-center gap-3 text-[10px] text-muted-foreground/50">
										<span className="flex items-center gap-1">
											<Play className="w-2.5 h-2.5" />
											{skill.usageCount} uses
										</span>
										{skill.lastUsedAt && (
											<span className="flex items-center gap-1">
												<Clock className="w-2.5 h-2.5" />
												{new Date(skill.lastUsedAt).toLocaleDateString()}
											</span>
										)}
									</div>
									<button
										onClick={() =>
											toggleMut.mutate({
												id: skill.id,
												isActive: !skill.isActive,
											})
										}
										className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${
											skill.isActive
												? "bg-accent-green/10 text-accent-green hover:bg-accent-green/20"
												: "bg-muted/50 text-muted-foreground hover:bg-muted"
										}`}
									>
										<CheckCircle className="w-3 h-3" />
										{skill.isActive ? "Active" : "Inactive"}
									</button>
								</div>
							</div>
						);
					})}

					{isLoading && (
						<div className="col-span-3 flex flex-col items-center justify-center py-16 text-muted-foreground/50">
							<Wrench className="w-8 h-8 mb-3 animate-pulse" />
							<p className="text-sm">Loading skills…</p>
						</div>
					)}
					{isError && !isLoading && (
						<div className="col-span-3 flex flex-col items-center justify-center py-16 text-accent-red">
							<p className="text-sm">
								Failed to load skills:{" "}
								{error instanceof Error ? error.message : String(error)}
							</p>
						</div>
					)}
					{!isLoading &&
						!isError &&
						skills.length === 0 &&
						(skillsPage?.total ?? 0) === 0 && (
							<div className="col-span-3 flex flex-col items-center justify-center py-16 text-muted-foreground/70 gap-3">
								<Wrench className="w-8 h-8" />
								<p className="text-sm">No skills yet</p>
								<button
									type="button"
									onClick={() => setShowNew(true)}
									className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-setra-600 hover:bg-setra-500 text-[#2b2418] text-xs font-medium transition-colors"
								>
									<Plus className="w-3.5 h-3.5" /> Create your first skill
								</button>
							</div>
						)}
					{!isLoading &&
						!isError &&
						skills.length === 0 &&
						(skillsPage?.total ?? 0) > 0 && (
							<div className="col-span-3 flex flex-col items-center justify-center py-16 text-muted-foreground/50">
								<Wrench className="w-8 h-8 mb-3" />
								<p className="text-sm">No skills found</p>
							</div>
						)}
				</div>
				<div className="mt-5 flex items-center justify-between border-t border-border/30 pt-3">
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<span>Rows per page</span>
						<select
							value={pageSize}
							onChange={(e) => {
								setPageSize(Number(e.target.value));
								setPage(1);
							}}
							className="bg-muted/50 border border-border/50 rounded px-2 py-1 text-xs"
						>
							<option value={20}>20</option>
							<option value={30}>30</option>
						</select>
					</div>
					<div className="flex items-center gap-2">
						<span className="text-xs text-muted-foreground">
							Page {skillsPage?.page ?? page} / {skillsPage?.totalPages ?? 1}
						</span>
						<button
							type="button"
							onClick={() => setPage((p) => Math.max(1, p - 1))}
							disabled={(skillsPage?.page ?? page) <= 1}
							className="px-2 py-1 text-xs rounded border border-border/50 text-muted-foreground hover:text-foreground disabled:opacity-40"
						>
							Prev
						</button>
						<button
							type="button"
							onClick={() =>
								setPage((p) => {
									const max = skillsPage?.totalPages ?? 1;
									return Math.min(max, p + 1);
								})
							}
							disabled={
								(skillsPage?.page ?? page) >= (skillsPage?.totalPages ?? 1)
							}
							className="px-2 py-1 text-xs rounded border border-border/50 text-muted-foreground hover:text-foreground disabled:opacity-40"
						>
							Next
						</button>
					</div>
				</div>
			</div>

			{/* New skill modal */}
			{showNew && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-[#fdfaf3]/80 backdrop-blur-sm">
					<div className="glass rounded-xl border border-border/60 w-full max-w-lg p-6 flex flex-col gap-4">
						<h2 className="text-base font-semibold text-foreground">
							{editingSkillId ? "Edit Skill" : "New Skill"}
						</h2>

						{[
							{ label: "Name", key: "name", placeholder: "TypeScript Expert" },
							{ label: "Slug", key: "slug", placeholder: "ts-expert" },
							{
								label: "Trigger keywords",
								key: "trigger",
								placeholder: "typescript, types",
							},
						].map(({ label, key, placeholder }) => (
							<div key={key} className="flex flex-col gap-1">
								<label className="text-xs text-muted-foreground">{label}</label>
								<input
									value={
										(newSkill as unknown as Record<string, string>)[key] ?? ""
									}
									onChange={(e) =>
										setNewSkill((p) => ({ ...p, [key]: e.target.value }))
									}
									placeholder={placeholder}
									className="px-3 py-1.5 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-setra-500"
								/>
							</div>
						))}

						<div className="flex flex-col gap-1">
							<label className="text-xs text-muted-foreground">Category</label>
							<select
								value={newSkill.category}
								onChange={(e) =>
									setNewSkill((p) => ({
										...p,
										category: e.target.value as Skill["category"],
									}))
								}
								className="px-3 py-1.5 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground focus:outline-none focus:border-setra-500"
							>
								{Object.entries(CATEGORY_META).map(([k, v]) => (
									<option key={k} value={k}>
										{v.label}
									</option>
								))}
							</select>
						</div>

						<div className="flex flex-col gap-1">
							<label className="text-xs text-muted-foreground">
								Description
							</label>
							<input
								value={newSkill.description}
								onChange={(e) =>
									setNewSkill((p) => ({ ...p, description: e.target.value }))
								}
								placeholder="What does this skill do?"
								className="px-3 py-1.5 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-setra-500"
							/>
						</div>

						<div className="flex flex-col gap-1">
							<label className="text-xs text-muted-foreground">
								Prompt injection
							</label>
							<textarea
								value={newSkill.prompt}
								onChange={(e) =>
									setNewSkill((p) => ({ ...p, prompt: e.target.value }))
								}
								placeholder="You are a… This text is injected into the agent's context when triggered."
								rows={4}
								className="px-3 py-1.5 bg-muted/50 border border-border/50 rounded-md text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-setra-500 font-mono resize-none"
							/>
						</div>

						<div className="flex gap-2 justify-end pt-1">
							<button
								onClick={() => {
									setShowNew(false);
									setEditingSkillId(null);
								}}
								className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
							>
								Cancel
							</button>
							<button
								onClick={() => {
									if (editingSkillId) {
										updateMut.mutate({ id: editingSkillId, data: newSkill });
										return;
									}
									createMut.mutate(newSkill);
								}}
								disabled={
									!newSkill.name ||
									!newSkill.prompt ||
									createMut.isPending ||
									updateMut.isPending
								}
								className="px-4 py-1.5 bg-setra-600 hover:bg-setra-500 disabled:opacity-40 text-[#2b2418] text-sm rounded-md transition-colors"
							>
								{editingSkillId
									? updateMut.isPending
										? "Saving…"
										: "Save Changes"
									: createMut.isPending
										? "Creating…"
										: "Create Skill"}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
