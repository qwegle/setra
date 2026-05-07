import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { type ProjectSecret, api } from "../../lib/api";
import { Button, Modal } from "../ui";
import { REPLIT } from "./types";

interface VaultPanelProps {
	projectId: string;
	onToast?: (message: string, type?: "ok" | "err") => void;
}

export function VaultPanel({ projectId, onToast }: VaultPanelProps) {
	const qc = useQueryClient();
	const projectSecretsQuery = useQuery<ProjectSecret[]>({
		queryKey: ["project-secrets", projectId],
		queryFn: () => api.projectSecrets.list(projectId),
		enabled: Boolean(projectId),
	});
	const vaultSecretsQuery = useQuery({
		queryKey: ["vault-secrets"],
		queryFn: () => api.secrets.list(),
		enabled: true,
	});
	const [projectSecretForm, setProjectSecretForm] = useState({
		key: "",
		value: "",
	});
	const [vaultForm, setVaultForm] = useState({
		name: "",
		description: "",
		value: "",
	});
	const [projectSecretDeleteKey, setProjectSecretDeleteKey] = useState<
		string | null
	>(null);
	const [vaultDeleteId, setVaultDeleteId] = useState<string | null>(null);
	const [projectSecretOpen, setProjectSecretOpen] = useState(false);
	const [vaultOpen, setVaultOpen] = useState(false);

	const upsertProjectSecretMut = useMutation({
		mutationFn: () =>
			api.projectSecrets.create(
				projectId,
				projectSecretForm.key.trim(),
				projectSecretForm.value,
			),
		onSuccess: async () => {
			setProjectSecretOpen(false);
			setProjectSecretForm({ key: "", value: "" });
			onToast?.("Project secret saved");
			await qc.invalidateQueries({ queryKey: ["project-secrets", projectId] });
		},
		onError: (error) =>
			onToast?.(
				error instanceof Error ? error.message : "Failed to save secret",
				"err",
			),
	});
	const deleteProjectSecretMut = useMutation({
		mutationFn: (keyName: string) =>
			api.projectSecrets.remove(projectId, keyName),
		onSuccess: async () => {
			setProjectSecretDeleteKey(null);
			onToast?.("Project secret deleted");
			await qc.invalidateQueries({ queryKey: ["project-secrets", projectId] });
		},
		onError: (error) =>
			onToast?.(
				error instanceof Error ? error.message : "Failed to delete secret",
				"err",
			),
	});
	const createVaultMut = useMutation({
		mutationFn: () =>
			api.secrets.create({
				name: vaultForm.name.trim(),
				description: vaultForm.description.trim(),
				value: vaultForm.value,
			}),
		onSuccess: async () => {
			setVaultOpen(false);
			setVaultForm({ name: "", description: "", value: "" });
			onToast?.("Vault secret saved");
			await qc.invalidateQueries({ queryKey: ["vault-secrets"] });
		},
		onError: (error) =>
			onToast?.(
				error instanceof Error ? error.message : "Failed to save Vault secret",
				"err",
			),
	});
	const deleteVaultMut = useMutation({
		mutationFn: (id: string) => api.secrets.delete(id),
		onSuccess: async () => {
			setVaultDeleteId(null);
			onToast?.("Vault secret deleted");
			await qc.invalidateQueries({ queryKey: ["vault-secrets"] });
		},
		onError: (error) =>
			onToast?.(
				error instanceof Error
					? error.message
					: "Failed to delete Vault secret",
				"err",
			),
	});

	return (
		<div className="grid h-full min-h-0 gap-4 overflow-auto p-4 lg:grid-cols-2">
			<section
				className="rounded-lg border"
				style={{ borderColor: REPLIT.border, backgroundColor: REPLIT.panel }}
			>
				<div
					className="flex items-center justify-between border-b px-3 py-2"
					style={{ borderColor: REPLIT.border }}
				>
					<div>
						<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9DA2A6]">
							Project secrets
						</p>
						<p className="mt-1 text-xs text-[#5F6B7A]">
							Secrets available only to this project.
						</p>
					</div>
					<button
						type="button"
						onClick={() => setProjectSecretOpen(true)}
						className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs text-[#4EA1FF] hover:bg-[#0E1525]"
					>
						<Plus className="h-3.5 w-3.5" /> Add
					</button>
				</div>
				<div className="space-y-2 p-3">
					{(projectSecretsQuery.data ?? []).length === 0 ? (
						<p className="text-sm text-[#9DA2A6]">
							No project secrets configured yet.
						</p>
					) : null}
					{(projectSecretsQuery.data ?? []).map((secret) => (
						<div
							key={secret.id}
							className="rounded-md border px-3 py-3"
							style={{
								borderColor: REPLIT.border,
								backgroundColor: REPLIT.background,
							}}
						>
							<div className="flex items-center gap-2">
								<KeyRound className="h-4 w-4 text-[#9DA2A6]" />
								<p className="truncate font-mono text-sm text-white">
									{secret.key}
								</p>
								<button
									type="button"
									onClick={() => setProjectSecretDeleteKey(secret.key)}
									className="ml-auto rounded p-1 text-[#9DA2A6] hover:bg-white/5 hover:text-[#FF8A80]"
								>
									<Trash2 className="h-3.5 w-3.5" />
								</button>
							</div>
							<p className="mt-2 truncate font-mono text-xs text-[#5F6B7A]">
								{secret.maskedValue}
							</p>
						</div>
					))}
				</div>
			</section>

			<section
				className="rounded-lg border"
				style={{ borderColor: REPLIT.border, backgroundColor: REPLIT.panel }}
			>
				<div
					className="flex items-center justify-between border-b px-3 py-2"
					style={{ borderColor: REPLIT.border }}
				>
					<div>
						<p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9DA2A6]">
							Company vault
						</p>
						<p className="mt-1 text-xs text-[#5F6B7A]">
							Shared secure values for your workspace.
						</p>
					</div>
					<button
						type="button"
						onClick={() => setVaultOpen(true)}
						className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-xs text-[#4EA1FF] hover:bg-[#0E1525]"
					>
						<Plus className="h-3.5 w-3.5" /> Add
					</button>
				</div>
				<div className="space-y-2 p-3">
					{(vaultSecretsQuery.data ?? []).length === 0 ? (
						<p className="text-sm text-[#9DA2A6]">No vault secrets yet.</p>
					) : null}
					{(vaultSecretsQuery.data ?? []).map((secret) => (
						<div
							key={secret.id}
							className="rounded-md border px-3 py-3"
							style={{
								borderColor: REPLIT.border,
								backgroundColor: REPLIT.background,
							}}
						>
							<div className="flex items-center gap-2">
								<KeyRound className="h-4 w-4 text-[#9DA2A6]" />
								<p className="truncate font-mono text-sm text-white">
									{secret.name}
								</p>
								<button
									type="button"
									onClick={() => setVaultDeleteId(secret.id)}
									className="ml-auto rounded p-1 text-[#9DA2A6] hover:bg-white/5 hover:text-[#FF8A80]"
								>
									<Trash2 className="h-3.5 w-3.5" />
								</button>
							</div>
							{secret.description ? (
								<p className="mt-2 text-xs text-[#5F6B7A]">
									{secret.description}
								</p>
							) : null}
						</div>
					))}
				</div>
			</section>

			<Modal
				open={projectSecretOpen}
				onClose={() => setProjectSecretOpen(false)}
				title="Add project secret"
				actions={
					<>
						<Button
							type="button"
							variant="ghost"
							onClick={() => setProjectSecretOpen(false)}
						>
							Cancel
						</Button>
						<Button
							type="button"
							loading={upsertProjectSecretMut.isPending}
							disabled={
								!projectSecretForm.key.trim() || !projectSecretForm.value.trim()
							}
							onClick={() => upsertProjectSecretMut.mutate()}
						>
							Save
						</Button>
					</>
				}
			>
				<div className="space-y-4">
					<input
						value={projectSecretForm.key}
						onChange={(event) =>
							setProjectSecretForm((current) => ({
								...current,
								key: event.target.value
									.toUpperCase()
									.replace(/[^A-Z0-9_]/g, ""),
							}))
						}
						placeholder="API_KEY"
						className="h-11 w-full rounded-md border bg-[#0E1525] px-3 font-mono text-sm text-white outline-none"
						style={{ borderColor: REPLIT.border }}
					/>
					<input
						type="password"
						value={projectSecretForm.value}
						onChange={(event) =>
							setProjectSecretForm((current) => ({
								...current,
								value: event.target.value,
							}))
						}
						placeholder="Secret value"
						className="h-11 w-full rounded-md border bg-[#0E1525] px-3 font-mono text-sm text-white outline-none"
						style={{ borderColor: REPLIT.border }}
					/>
				</div>
			</Modal>

			<Modal
				open={vaultOpen}
				onClose={() => setVaultOpen(false)}
				title="Add vault secret"
				actions={
					<>
						<Button
							type="button"
							variant="ghost"
							onClick={() => setVaultOpen(false)}
						>
							Cancel
						</Button>
						<Button
							type="button"
							loading={createVaultMut.isPending}
							disabled={!vaultForm.name.trim() || !vaultForm.value.trim()}
							onClick={() => createVaultMut.mutate()}
						>
							Save
						</Button>
					</>
				}
			>
				<div className="space-y-4">
					<input
						value={vaultForm.name}
						onChange={(event) =>
							setVaultForm((current) => ({
								...current,
								name: event.target.value
									.toUpperCase()
									.replace(/[^A-Z0-9_]/g, ""),
							}))
						}
						placeholder="OPENAI_API_KEY"
						className="h-11 w-full rounded-md border bg-[#0E1525] px-3 font-mono text-sm text-white outline-none"
						style={{ borderColor: REPLIT.border }}
					/>
					<input
						value={vaultForm.description}
						onChange={(event) =>
							setVaultForm((current) => ({
								...current,
								description: event.target.value,
							}))
						}
						placeholder="Describe what this secret is for"
						className="h-11 w-full rounded-md border bg-[#0E1525] px-3 text-sm text-white outline-none"
						style={{ borderColor: REPLIT.border }}
					/>
					<input
						type="password"
						value={vaultForm.value}
						onChange={(event) =>
							setVaultForm((current) => ({
								...current,
								value: event.target.value,
							}))
						}
						placeholder="Secret value"
						className="h-11 w-full rounded-md border bg-[#0E1525] px-3 font-mono text-sm text-white outline-none"
						style={{ borderColor: REPLIT.border }}
					/>
				</div>
			</Modal>

			<Modal
				open={Boolean(projectSecretDeleteKey)}
				onClose={() => setProjectSecretDeleteKey(null)}
				title="Delete project secret"
				actions={
					<>
						<Button
							type="button"
							variant="ghost"
							onClick={() => setProjectSecretDeleteKey(null)}
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="danger"
							loading={deleteProjectSecretMut.isPending}
							onClick={() =>
								projectSecretDeleteKey &&
								deleteProjectSecretMut.mutate(projectSecretDeleteKey)
							}
						>
							Delete
						</Button>
					</>
				}
			>
				<p className="text-sm text-[#9DA2A6]">
					Delete{" "}
					<span className="font-semibold text-white">
						{projectSecretDeleteKey}
					</span>{" "}
					from this project?
				</p>
			</Modal>

			<Modal
				open={Boolean(vaultDeleteId)}
				onClose={() => setVaultDeleteId(null)}
				title="Delete vault secret"
				actions={
					<>
						<Button
							type="button"
							variant="ghost"
							onClick={() => setVaultDeleteId(null)}
						>
							Cancel
						</Button>
						<Button
							type="button"
							variant="danger"
							loading={deleteVaultMut.isPending}
							onClick={() =>
								vaultDeleteId && deleteVaultMut.mutate(vaultDeleteId)
							}
						>
							Delete
						</Button>
					</>
				}
			>
				<p className="text-sm text-[#9DA2A6]">
					Remove this secret from the company vault?
				</p>
			</Modal>
		</div>
	);
}
