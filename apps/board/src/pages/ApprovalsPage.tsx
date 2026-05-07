import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { CheckSquare, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { ApprovalCard } from "../components/ApprovalCard";
import {
	Button,
	Card,
	EmptyState,
	PageHeader,
	Skeleton,
} from "../components/ui";
import { type Plan, api } from "../lib/api";

type Tab = "pending" | "all";

function SkeletonCard() {
	return (
		<Card>
			<div className="space-y-3">
				<div className="flex items-center gap-2">
					<Skeleton variant="circle" width="16px" height="16px" />
					<Skeleton width="128px" />
					<div className="ml-auto">
						<Skeleton width="48px" />
					</div>
				</div>
				<Skeleton count={2} />
				<div className="flex justify-end gap-2 pt-1">
					<Skeleton variant="rect" width="64px" height="28px" />
					<Skeleton variant="rect" width="64px" height="28px" />
				</div>
			</div>
		</Card>
	);
}

function PlanCard({
	plan,
	onApprove,
	onReject,
	isLoading,
}: {
	plan: Plan;
	onApprove: () => void;
	onReject: () => void;
	isLoading: boolean;
}) {
	const completed = plan.subtasks.filter(
		(subtask) => subtask.status === "done",
	).length;
	return (
		<Card>
			<div className="space-y-4">
				<div className="flex items-start gap-3">
					<CheckSquare className="mt-0.5 h-4 w-4 text-setra-300" />
					<div className="min-w-0 flex-1 space-y-1">
						<p className="text-xs font-semibold uppercase tracking-wide text-setra-300">
							Plan {plan.status.replace("_", " ")}
						</p>
						<h3 className="text-sm font-semibold text-foreground">
							{plan.title}
						</h3>
						<p className="text-sm text-muted-foreground/80">{plan.approach}</p>
						<p className="text-xs text-muted-foreground/60">
							{completed} / {plan.subtasks.length} subtasks complete
						</p>
					</div>
				</div>
				<div className="space-y-2 rounded-lg border border-border/40 bg-muted/10 p-3">
					{plan.subtasks.map((subtask) => (
						<div key={subtask.id} className="text-sm text-foreground/90">
							<div className="flex flex-wrap items-center gap-2">
								<span className="font-medium">{subtask.title}</span>
								<span className="text-xs text-muted-foreground/60">
									{subtask.assignTo} · {subtask.status.replace("_", " ")}
								</span>
							</div>
							<p className="mt-1 text-xs text-muted-foreground/70">
								{subtask.description}
							</p>
						</div>
					))}
				</div>
				{plan.status === "pending_approval" && (
					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={onReject}
							disabled={isLoading}
						>
							Reject
						</Button>
						<Button
							type="button"
							size="sm"
							onClick={onApprove}
							disabled={isLoading}
						>
							Approve plan
						</Button>
					</div>
				)}
			</div>
		</Card>
	);
}

export function ApprovalsPage() {
	const [tab, setTab] = useState<Tab>("pending");
	const [errors, setErrors] = useState<Record<string, string>>({});
	const qc = useQueryClient();

	const {
		data: approvals = [],
		isLoading,
		isError,
	} = useQuery({
		queryKey: ["approvals", tab],
		queryFn: () => api.approvals.list(tab === "pending" ? "pending" : "all"),
	});
	const { data: plans = [] } = useQuery({
		queryKey: ["plans", tab],
		queryFn: () =>
			api.plans.list(
				tab === "pending" ? { status: "pending_approval" } : undefined,
			),
	});

	const pendingCount = approvals.filter((a) => a.status === "pending").length;
	const pendingPlans = plans.filter(
		(plan) => plan.status === "pending_approval",
	);
	const visiblePlans = tab === "pending" ? pendingPlans : plans;

	const invalidate = () => {
		qc.invalidateQueries({ queryKey: ["approvals"] });
		qc.invalidateQueries({ queryKey: ["plans"] });
		qc.invalidateQueries({ queryKey: ["issue"] });
	};

	const approveMutation = useMutation({
		mutationFn: (id: string) => api.approvals.approve(id),
		onSuccess: (_data, id) => {
			qc.setQueryData(
				["approvals", tab],
				approvals.filter((approval) => approval.id !== id),
			);
			invalidate();
			setErrors((current) => {
				const next = { ...current };
				delete next[id];
				return next;
			});
		},
		onError: (err: Error, id) => {
			setErrors((current) => ({ ...current, [id]: err.message }));
		},
	});

	const rejectMutation = useMutation({
		mutationFn: (id: string) => api.approvals.reject(id),
		onSuccess: (_data, id) => {
			qc.setQueryData(
				["approvals", tab],
				approvals.filter((approval) => approval.id !== id),
			);
			invalidate();
			setErrors((current) => {
				const next = { ...current };
				delete next[id];
				return next;
			});
		},
		onError: (err: Error, id) => {
			setErrors((current) => ({ ...current, [id]: err.message }));
		},
	});

	const approvePlanMutation = useMutation({
		mutationFn: (id: string) => api.plans.approve(id),
		onSuccess: () => invalidate(),
		onError: (err: Error, id) => {
			setErrors((current) => ({ ...current, [id]: err.message }));
		},
	});
	const rejectPlanMutation = useMutation({
		mutationFn: ({ id, feedback }: { id: string; feedback?: string }) =>
			api.plans.reject(id, feedback),
		onSuccess: () => invalidate(),
		onError: (err: Error, variables) => {
			setErrors((current) => ({ ...current, [variables.id]: err.message }));
		},
	});

	const tabs: { id: Tab; label: string }[] = [
		{
			id: "pending",
			label:
				pendingCount + pendingPlans.length > 0
					? `Pending ${pendingCount + pendingPlans.length}`
					: "Pending",
		},
		{ id: "all", label: "All" },
	];

	const showEmpty = approvals.length === 0 && visiblePlans.length === 0;

	return (
		<div className="flex h-full flex-col gap-6">
			<PageHeader
				title="Approvals"
				subtitle="Review pending plans, approvals, and execution requests."
				actions={
					<div className="flex flex-wrap gap-2">
						{tabs.map((item) => (
							<Button
								key={item.id}
								type="button"
								variant={tab === item.id ? "primary" : "ghost"}
								size="sm"
								onClick={() => setTab(item.id)}
							>
								{item.label}
							</Button>
						))}
					</div>
				}
			/>

			<div className="mx-auto w-full max-w-3xl space-y-4">
				{isLoading && (
					<>
						<SkeletonCard />
						<SkeletonCard />
						<SkeletonCard />
					</>
				)}

				{isError && !isLoading && (
					<Card>
						<p className="text-sm text-accent-red">Failed to load approvals.</p>
					</Card>
				)}

				{visiblePlans.length > 0 && (
					<div className="space-y-3">
						<p className="text-xs font-semibold uppercase tracking-wide text-setra-300">
							{tab === "pending" ? "Plans awaiting approval" : "Plans"}
						</p>
						{visiblePlans.map((plan) => (
							<div key={plan.id}>
								{errors[plan.id] && (
									<p className="mb-1 text-xs text-accent-red">
										{errors[plan.id]}
									</p>
								)}
								<PlanCard
									plan={plan}
									onApprove={() => approvePlanMutation.mutate(plan.id)}
									onReject={() => {
										const feedback = window.prompt(
											"Optional feedback for the CEO",
											"",
										);
										if (feedback === null) return;
										rejectPlanMutation.mutate({ id: plan.id, feedback });
									}}
									isLoading={
										(approvePlanMutation.isPending &&
											approvePlanMutation.variables === plan.id) ||
										(rejectPlanMutation.isPending &&
											rejectPlanMutation.variables?.id === plan.id)
									}
								/>
							</div>
						))}
					</div>
				)}

				{!isLoading && !isError && showEmpty && (
					<EmptyState
						icon={<ShieldCheck className="h-10 w-10" aria-hidden="true" />}
						title="All clear"
						description="There are no approvals waiting for review right now."
					/>
				)}

				{!isLoading && !isError && approvals.length > 0 && (
					<AnimatePresence>
						{approvals.map((approval) => (
							<motion.div
								key={approval.id}
								layout
								initial={{ opacity: 0, y: -8 }}
								animate={{ opacity: 1, y: 0 }}
								exit={{ opacity: 0, x: 60, height: 0 }}
								transition={{ duration: 0.2 }}
							>
								{errors[approval.id] && (
									<p className="mb-1 text-xs text-accent-red">
										{errors[approval.id]}
									</p>
								)}
								<ApprovalCard
									approval={approval}
									onApprove={() => approveMutation.mutate(approval.id)}
									onReject={() => rejectMutation.mutate(approval.id)}
									isLoading={
										(approveMutation.isPending &&
											approveMutation.variables === approval.id) ||
										(rejectMutation.isPending &&
											rejectMutation.variables === approval.id)
									}
								/>
							</motion.div>
						))}
					</AnimatePresence>
				)}
			</div>
		</div>
	);
}
