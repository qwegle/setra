/**
 * CompanyContext — server-backed multi-tenant scope for the board UI.
 *
 * The companies list is fetched from the server (single source of truth).
 * Only `selectedCompanyId` is persisted to localStorage so the user's
 * choice survives reloads. When the selection changes we *nuke* the React
 * Query cache so no stale per-company data leaks across tenants.
 *
 * Architectural contract:
 *   - Every API call carries `x-company-id: <selectedCompanyId>` (handled
 *     by the `request()` wrapper in lib/api.ts which reads the same
 *     localStorage key).
 *   - Server middleware (`requireCompany`) rejects unscoped requests, so
 *     forgetting the header surfaces immediately as a 400.
 *   - Cache keys do not need to embed companyId because we wipe the cache
 *     on every switch — equivalent isolation, simpler call sites.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { api } from "../lib/api";

export interface Company {
	id: string;
	name: string;
	issuePrefix: string;
	logoUrl?: string | null;
	brandColor?: string;
	isOfflineOnly?: boolean;
	type?: "startup" | "agency" | "enterprise" | "government" | "personal";
	size?: "0-10" | "10-50" | "50-200" | "200-1000" | "1000+";
	hasLiveAgents?: boolean;
	hasUnreadInbox?: boolean;
	order: number;
}

interface CompanyContextValue {
	companies: Company[];
	selectedCompanyId: string | null;
	selectedCompany: Company | null;
	setSelectedCompanyId: (id: string | null) => void;
	switchCompany: (id: string) => Promise<void>;
	switchState: {
		active: boolean;
		fromName: string;
		toName: string;
	};
	addCompany: (company: Omit<Company, "order">) => void;
	removeCompany: (id: string) => void;
	reorderCompanies: (orderedIds: string[]) => void;
	refresh: () => void;
	loading: boolean;
	loadError: boolean;
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

const STORAGE_KEY_SELECTED = "setra:selectedCompanyId";

function loadSelectedFromStorage(): string | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY_SELECTED);
		if (raw === null) return null;
		const v = JSON.parse(raw) as unknown;
		return typeof v === "string" && v.length > 0 ? v : null;
	} catch {
		return null;
	}
}

export function CompanyProvider({ children }: { children: ReactNode }) {
	const qc = useQueryClient();

	// ── Server-backed companies list ────────────────────────────────────────
	// The server's /api/companies is the source of truth. We hydrate from
	// here and never write back to localStorage — clients across tabs see a
	// consistent list because everyone's reading the same DB.
	const {
		data: serverCompanies = [],
		isLoading,
		isError,
		refetch,
	} = useQuery({
		queryKey: ["companies"],
		queryFn: async () => {
			const rows = await api.companies.list();
			return rows.map((r, idx) => ({
				id: r.id,
				name: r.name,
				issuePrefix: r.issuePrefix,
				logoUrl: r.logoUrl ?? null,
				brandColor: r.brandColor,
				order: idx,
			})) as Company[];
		},
	});

	// ── Selected company id (persisted) ────────────────────────────────────
	const [selectedCompanyId, setSelectedCompanyIdState] = useState<
		string | null
	>(loadSelectedFromStorage);
	const [switchState, setSwitchState] = useState({
		active: false,
		fromName: "",
		toName: "",
	});

	// Validate selection against the server list; if stale, fall back to
	// the first available company.
	useEffect(() => {
		if (isLoading || isError) return;
		if (serverCompanies.length === 0) {
			if (selectedCompanyId !== null) setSelectedCompanyIdState(null);
			return;
		}
		const stillValid = selectedCompanyId
			? serverCompanies.some((c) => c.id === selectedCompanyId)
			: false;
		if (!stillValid) {
			const first = serverCompanies[0];
			if (first) setSelectedCompanyIdState(first.id);
		}
	}, [isError, isLoading, serverCompanies, selectedCompanyId]);

	// Persist selection.
	useEffect(() => {
		if (selectedCompanyId !== null) {
			localStorage.setItem(
				STORAGE_KEY_SELECTED,
				JSON.stringify(selectedCompanyId),
			);
		} else {
			localStorage.removeItem(STORAGE_KEY_SELECTED);
		}
	}, [selectedCompanyId]);

	// ── Setters ────────────────────────────────────────────────────────────
	const setSelectedCompanyId = useCallback(
		(id: string | null) => {
			setSelectedCompanyIdState((prev) => {
				// On a real switch, wipe the cache so the next render fetches
				// data scoped to the new tenant. Skip on no-op.
				if (prev !== id) {
					qc.removeQueries({
						// Keep the companies list — that's tenant-agnostic.
						predicate: (q) => {
							const k0 = q.queryKey[0];
							return k0 !== "companies";
						},
					});
				}
				return id;
			});
		},
		[qc],
	);

	const switchCompany = useCallback(
		async (id: string) => {
			if (!id || id === selectedCompanyId) return;
			const from =
				serverCompanies.find((c) => c.id === selectedCompanyId)?.name ??
				"Current company";
			const to =
				serverCompanies.find((c) => c.id === id)?.name ?? "Selected company";
			setSwitchState({ active: true, fromName: from, toName: to });

			setSelectedCompanyId(id);

			// Keep a polished transition: minimum 1s animation, max 5s wait.
			const MIN_MS = 1000;
			const MAX_MS = 5000;
			const refreshPromise = qc.refetchQueries({
				type: "active",
				predicate: (q) => q.queryKey[0] !== "companies",
			});
			const sleep = (ms: number) =>
				new Promise<void>((resolve) => setTimeout(resolve, ms));
			await sleep(MIN_MS);
			await Promise.race([
				refreshPromise.then(() => undefined).catch(() => undefined),
				sleep(MAX_MS - MIN_MS),
			]);

			setSwitchState({ active: false, fromName: "", toName: "" });
		},
		[qc, selectedCompanyId, serverCompanies, setSelectedCompanyId],
	);

	const addCompany = useCallback(
		(_company: Omit<Company, "order">) => {
			// Optimistic add is unnecessary — the create API persists server-side
			// and we just refetch the canonical list.
			void refetch();
		},
		[refetch],
	);

	const removeCompany = useCallback(
		(id: string) => {
			void refetch();
			// If we just deleted the active company, the validation effect above
			// will pick a new one on the next render.
			if (selectedCompanyId === id) setSelectedCompanyIdState(null);
		},
		[refetch, selectedCompanyId],
	);

	const reorderCompanies = useCallback((_orderedIds: string[]) => {
		// Server doesn't persist order yet; ignored. (Kept on the interface for
		// API-shape compatibility with the OrgRail drag-drop.)
	}, []);

	const selectedCompany =
		serverCompanies.find((c) => c.id === selectedCompanyId) ?? null;

	const contextValue = useMemo(
		() => ({
			companies: serverCompanies,
			selectedCompanyId,
			selectedCompany,
			setSelectedCompanyId,
			switchCompany,
			switchState,
			addCompany,
			removeCompany,
			reorderCompanies,
			refresh: () => void refetch(),
			loading: isLoading,
			loadError: isError,
		}),
		[
			serverCompanies,
			selectedCompanyId,
			selectedCompany,
			setSelectedCompanyId,
			switchCompany,
			switchState,
			addCompany,
			removeCompany,
			reorderCompanies,
			refetch,
			isLoading,
			isError,
		],
	);

	return (
		<CompanyContext.Provider value={contextValue}>
			{children}
		</CompanyContext.Provider>
	);
}

export function useCompany(): CompanyContextValue {
	const ctx = useContext(CompanyContext);
	if (!ctx) throw new Error("useCompany must be used within CompanyProvider");
	return ctx;
}
