import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Target } from "lucide-react";
import { useId, useState } from "react";
import { GoalTree } from "../components/GoalTree";
import {
	Button,
	Card,
	EmptyState,
	Input,
	Modal,
	PageHeader,
	Select,
	Skeleton,
} from "../components/ui";
import { useCompany } from "../context/CompanyContext";
import { type Goal, api } from "../lib/api";

function buildTree(goals: Goal[]): Goal[] {
	const map = new Map<string, Goal>();
	const roots: Goal[] = [];

	goals.forEach((goal) => map.set(goal.id, { ...goal, children: [] }));

	map.forEach((goal) => {
		if (goal.parentGoalId && map.has(goal.parentGoalId)) {
			map.get(goal.parentGoalId)?.children?.push(goal);
		} else {
			roots.push(goal);
		}
	});

	return roots;
}

export function GoalsPage() {
	const queryClient = useQueryClient();
	const { selectedCompanyId } = useCompany();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [parentId, setParentId] = useState<string | null>(null);
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [formError, setFormError] = useState("");
	const descriptionId = useId();
	const descriptionErrorId = `${descriptionId}-error`;

	const {
		data: goals = [],
		isLoading,
		isError,
	} = useQuery({
		queryKey: ["goals", selectedCompanyId ?? "all"],
		queryFn: () => api.goals.list(selectedCompanyId ?? undefined),
	});

	const tree = buildTree(goals);

	const createMutation = useMutation({
		mutationFn: (data: {
			title: string;
			description?: string;
			parentGoalId?: string;
		}) =>
			api.goals.create({
				...data,
				...(selectedCompanyId ? { companyId: selectedCompanyId } : {}),
			}),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: ["goals"] });
			setDialogOpen(false);
			setTitle("");
			setDescription("");
			setParentId(null);
			setFormError("");
		},
		onError: (error: Error) => setFormError(error.message),
	});

	const statusMutation = useMutation({
		mutationFn: ({ id, status }: { id: string; status: Goal["status"] }) =>
			api.goals.update(id, { status }),
		onSuccess: () =>
			void queryClient.invalidateQueries({ queryKey: ["goals"] }),
	});

	function openAddChild(goalId: string) {
		setParentId(goalId);
		setDialogOpen(true);
	}

	function resetForm() {
		setParentId(null);
		setTitle("");
		setDescription("");
		setFormError("");
	}

	function handleCreate() {
		if (!title.trim()) {
			setFormError("Title is required.");
			return;
		}

		createMutation.mutate({
			title: title.trim(),
			...(description.trim() ? { description: description.trim() } : {}),
			...(parentId ? { parentGoalId: parentId } : {}),
		});
	}

	return (
		<div className="flex h-full flex-col">
			<div className="border-b border-[#e5d6b8] px-6 py-6">
				<PageHeader
					title="Goals"
					subtitle="Track company goals and nested sub-goals in one place."
					actions={
						<Button
							type="button"
							onClick={() => {
								resetForm();
								setDialogOpen(true);
							}}
							icon={<Plus className="h-4 w-4" aria-hidden="true" />}
						>
							New Goal
						</Button>
					}
				/>
			</div>

			<div className="flex-1 overflow-y-auto px-6 py-6">
				{isLoading && (
					<div className="space-y-3">
						<Skeleton count={5} />
					</div>
				)}

				{isError && (
					<Card>
						<p className="text-sm text-red-400">Failed to load goals.</p>
					</Card>
				)}

				{!isLoading && !isError && goals.length === 0 && (
					<EmptyState
						icon={<Target className="h-10 w-10" aria-hidden="true" />}
						title="No goals yet"
						description="Create your first goal to start organizing work across the team."
						action={
							<Button
								type="button"
								onClick={() => {
									resetForm();
									setDialogOpen(true);
								}}
								icon={<Plus className="h-4 w-4" aria-hidden="true" />}
							>
								Create your first goal
							</Button>
						}
					/>
				)}

				{!isLoading && !isError && goals.length > 0 && (
					<Card>
						<GoalTree
							goals={tree}
							onStatusChange={(id, status) =>
								statusMutation.mutate({ id, status })
							}
							onAddChild={openAddChild}
						/>
					</Card>
				)}
			</div>

			<Modal
				open={dialogOpen}
				onClose={() => setDialogOpen(false)}
				title={parentId ? "Add Sub-goal" : "New Goal"}
				actions={
					<>
						<Button
							type="button"
							variant="secondary"
							onClick={() => setDialogOpen(false)}
						>
							Cancel
						</Button>
						<Button
							type="button"
							onClick={handleCreate}
							loading={createMutation.isPending}
						>
							Create Goal
						</Button>
					</>
				}
			>
				{parentId && (
					<p className="text-sm text-[#6f6044]" aria-live="polite">
						Adding under{" "}
						<span className="font-medium text-[#3b3224]">
							{goals.find((goal) => goal.id === parentId)?.title}
						</span>
					</p>
				)}
				<Input
					autoFocus
					label="Title"
					value={title}
					onChange={(event) => setTitle(event.target.value)}
					onKeyDown={(event) => event.key === "Enter" && handleCreate()}
					placeholder="Goal title"
					error={formError || undefined}
				/>
				<div className="space-y-1.5">
					<label
						htmlFor={descriptionId}
						className="text-sm font-medium text-[#2b2418]"
					>
						Description
					</label>
					<textarea
						id={descriptionId}
						value={description}
						onChange={(event) => setDescription(event.target.value)}
						placeholder="Optional description"
						rows={3}
						aria-describedby={formError ? descriptionErrorId : undefined}
						className="w-full rounded-md border border-[#d9c6a3] bg-[#faf3e3]/70 px-3 py-2 text-sm text-[#2b2418] outline-none transition focus-visible:ring-2 focus-visible:ring-[#e2c787] focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 placeholder:text-[#8a7a5c]"
					/>
				</div>
				{!parentId && goals.length > 0 && (
					<Select
						label="Parent goal"
						value={parentId ?? ""}
						onChange={(event) => setParentId(event.target.value || null)}
					>
						<option value="">None (top-level)</option>
						{goals.map((goal) => (
							<option key={goal.id} value={goal.id}>
								{goal.title}
							</option>
						))}
					</Select>
				)}
				{formError && formError !== "Title is required." && (
					<p id={descriptionErrorId} className="text-sm text-red-400">
						{formError}
					</p>
				)}
			</Modal>
		</div>
	);
}
