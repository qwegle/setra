/**
 * NewIssueDialog — modal-based issue creator replacing the inline one-line
 * input in IssuesPage. Paperclip-style "everything in one form": title,
 * description (markdown-capable textarea), priority, status, assignee,
 * comma-separated labels.
 *
 * Returns the created Issue (or null on cancel) via onCreated; parent owns
 * cache invalidation. Submit on Cmd/Ctrl+Enter; Esc closes via Modal default.
 */
import { useEffect, useState } from "react";
import {
	type CreateIssueInput,
	type Issue,
	type IssuePriority,
	type IssueStatus,
	type RosterEntry,
	api,
} from "../lib/api";
import { Button, Input, Modal, Select } from "./ui";

const STATUS_OPTIONS: { value: IssueStatus; label: string }[] = [
	{ value: "backlog", label: "Backlog" },
	{ value: "todo", label: "Todo" },
	{ value: "in_progress", label: "In Progress" },
	{ value: "in_review", label: "In Review" },
	{ value: "done", label: "Done" },
	{ value: "blocked", label: "Blocked" },
	{ value: "cancelled", label: "Cancelled" },
];

const PRIORITY_OPTIONS: { value: IssuePriority; label: string }[] = [
	{ value: "none", label: "None" },
	{ value: "low", label: "Low" },
	{ value: "medium", label: "Medium" },
	{ value: "high", label: "High" },
	{ value: "urgent", label: "Urgent" },
];

export function NewIssueDialog({
	open,
	onClose,
	projectId,
	roster,
	defaultStatus = "backlog",
	onCreated,
}: {
	open: boolean;
	onClose: () => void;
	projectId: string;
	roster: RosterEntry[];
	defaultStatus?: IssueStatus;
	onCreated?: (issue: Issue) => void;
}) {
	const [title, setTitle] = useState("");
	const [description, setDescription] = useState("");
	const [priority, setPriority] = useState<IssuePriority>("medium");
	const [status, setStatus] = useState<IssueStatus>(defaultStatus);
	const [assignedAgentId, setAssignedAgentId] = useState<string>("");
	const [labels, setLabels] = useState("");
	const [submitting, setSubmitting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		setTitle("");
		setDescription("");
		setPriority("medium");
		setStatus(defaultStatus);
		setAssignedAgentId("");
		setLabels("");
		setError(null);
	}, [open, defaultStatus]);

	async function handleSubmit() {
		if (!title.trim()) {
			setError("Title is required");
			return;
		}
		setSubmitting(true);
		setError(null);
		try {
			const payload: CreateIssueInput = {
				projectId,
				title: title.trim(),
				status,
				priority,
			};
			if (description.trim()) payload.description = description.trim();
			if (assignedAgentId) payload.assignedAgentId = assignedAgentId;
			const created = await api.issues.create(payload);

			// Labels live on Issue.labels as a comma-separated string; persist
			// via the PATCH endpoint since CreateIssueInput has no labels field.
			const cleanLabels = labels
				.split(",")
				.map((l) => l.trim())
				.filter(Boolean)
				.join(",");
			let result = created;
			if (cleanLabels) {
				result = (await api.issues.update(created.id, {
					labels: cleanLabels,
				})) as Issue;
			}
			onCreated?.(result);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to create issue");
		} finally {
			setSubmitting(false);
		}
	}

	function onKeyDown(e: React.KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
			e.preventDefault();
			void handleSubmit();
		}
	}

	return (
		<Modal
			open={open}
			onClose={onClose}
			title="New issue"
			actions={
				<>
					<Button type="button" variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button
						type="button"
						onClick={() => void handleSubmit()}
						loading={submitting}
						disabled={!title.trim()}
					>
						{submitting ? "Creating…" : "Create issue"}
					</Button>
				</>
			}
		>
			<div className="space-y-3" onKeyDown={onKeyDown}>
				<Input
					label="Title"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
					placeholder="What needs to happen?"
					autoFocus
				/>

				<div>
					<label
						htmlFor="new-issue-description"
						className="block text-xs font-medium text-muted-foreground mb-1"
					>
						Description{" "}
						<span className="text-muted-foreground/60">(markdown)</span>
					</label>
					<textarea
						id="new-issue-description"
						value={description}
						onChange={(e) => setDescription(e.target.value)}
						placeholder="Add context, acceptance criteria, links…"
						rows={5}
						className="w-full rounded-md border border-border/40 bg-ground-900/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-accent-blue/50"
					/>
				</div>

				<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
					<Select
						label="Status"
						value={status}
						onChange={(e) => setStatus(e.target.value as IssueStatus)}
					>
						{STATUS_OPTIONS.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</Select>
					<Select
						label="Priority"
						value={priority}
						onChange={(e) => setPriority(e.target.value as IssuePriority)}
					>
						{PRIORITY_OPTIONS.map((o) => (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						))}
					</Select>
					<Select
						label="Assignee"
						value={assignedAgentId}
						onChange={(e) => setAssignedAgentId(e.target.value)}
					>
						<option value="">Unassigned</option>
						{roster.map((agent) => (
							<option
								key={agent.id}
								value={agent.agent_id ?? agent.id}
							>
								{agent.display_name}
							</option>
						))}
					</Select>
				</div>

				<Input
					label="Labels"
					value={labels}
					onChange={(e) => setLabels(e.target.value)}
					placeholder="bug, frontend, p1"
					helperText="Comma-separated"
				/>

				{error && (
					<p className="text-sm text-accent-red">{error}</p>
				)}
				<p className="text-[11px] text-muted-foreground/70">
					Tip: Press ⌘+Enter (Ctrl+Enter) to create.
				</p>
			</div>
		</Modal>
	);
}
