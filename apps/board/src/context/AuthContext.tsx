import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { request } from "../lib/api";

const AUTH_TOKEN_KEY = "setra:auth-token";
const SELECTED_COMPANY_KEY = "setra:selectedCompanyId";

export interface AuthUser {
	id: string;
	email: string;
	name: string | null;
	companyId: string;
	role: "owner" | "admin" | "member";
}

interface AuthResponse {
	token: string;
	user: AuthUser;
	company?: {
		id: string;
	};
	needsCompany?: boolean;
}

export interface RegisterInput {
	firstName: string;
	lastName: string;
	email: string;
	phone: string;
	password: string;
	securityQuestion: string;
	securityAnswer: string;
	acceptedTerms: boolean;
}

interface AuthContextValue {
	user: AuthUser | null;
	isAuthenticated: boolean;
	needsCompany: boolean;
	isAdmin: boolean;
	isLoading: boolean;
	login: (email: string, password: string) => Promise<AuthUser>;
	register: (input: RegisterInput) => Promise<AuthResponse>;
	setActiveCompany: (companyId: string) => void;
	refreshSession: (token: string) => Promise<void>;
	logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredToken(): string | null {
	try {
		const token = localStorage.getItem(AUTH_TOKEN_KEY)?.trim();
		return token ? token : null;
	} catch {
		return null;
	}
}

function persistSelectedCompany(companyId: string) {
	localStorage.setItem(SELECTED_COMPANY_KEY, JSON.stringify(companyId));
}

function clearStoredSession() {
	try {
		localStorage.removeItem(AUTH_TOKEN_KEY);
		localStorage.removeItem(SELECTED_COMPANY_KEY);
	} catch {
		// Ignore storage errors and fall back to in-memory state.
	}
}

export function AuthProvider({ children }: { children: ReactNode }) {
	const navigate = useNavigate();
	const [user, setUser] = useState<AuthUser | null>(null);
	const [needsCompany, setNeedsCompany] = useState(false);
	const [isLoading, setIsLoading] = useState(true);

	const storeSession = useCallback((payload: AuthResponse) => {
		localStorage.setItem(AUTH_TOKEN_KEY, payload.token);
		if (payload.user.companyId) persistSelectedCompany(payload.user.companyId);
		setUser(payload.user);
		setNeedsCompany(payload.needsCompany === true || !payload.user.companyId);
	}, []);

	useEffect(() => {
		let cancelled = false;
		const token = readStoredToken();

		if (!token) {
			setIsLoading(false);
			return;
		}

		void request<{ user: AuthUser }>("/auth/me")
			.then(({ user: nextUser }) => {
				if (cancelled) return;
				if (nextUser.companyId) persistSelectedCompany(nextUser.companyId);
				setUser(nextUser);
				setNeedsCompany(!nextUser.companyId);
			})
			.catch(() => {
				if (cancelled) return;
				clearStoredSession();
				setUser(null);
			})
			.finally(() => {
				if (!cancelled) setIsLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const login = useCallback(
		async (email: string, password: string) => {
			const payload = await request<AuthResponse>("/auth/login", {
				method: "POST",
				body: JSON.stringify({ email, password }),
			});
			storeSession(payload);
			return payload.user;
		},
		[storeSession],
	);

	const register = useCallback(
		async (input: RegisterInput) => {
			const payload = await request<AuthResponse>("/auth/register", {
				method: "POST",
				body: JSON.stringify(input),
			});
			storeSession(payload);
			return payload;
		},
		[storeSession],
	);

	const setActiveCompany = useCallback((companyId: string) => {
		persistSelectedCompany(companyId);
		setUser((prev) => (prev ? { ...prev, companyId } : prev));
		setNeedsCompany(!companyId);
	}, []);

	const refreshSession = useCallback(async (token: string) => {
		localStorage.setItem(AUTH_TOKEN_KEY, token);
		const { user: nextUser } = await request<{ user: AuthUser }>("/auth/me");
		if (nextUser.companyId) persistSelectedCompany(nextUser.companyId);
		setUser(nextUser);
		setNeedsCompany(!nextUser.companyId);
	}, []);

	const logout = useCallback(async () => {
		try {
			if (readStoredToken()) {
				await request<{ ok: boolean }>("/auth/logout", { method: "POST" });
			}
		} catch {
			// Local logout should still succeed if the session is already invalid.
		} finally {
			clearStoredSession();
			setUser(null);
			setNeedsCompany(false);
			navigate("/login", { replace: true });
		}
	}, [navigate]);

	const value = useMemo<AuthContextValue>(
		() => ({
			user,
			isAuthenticated: user !== null,
			needsCompany,
			isAdmin: user?.role === "owner" || user?.role === "admin",
			isLoading,
			login,
			register,
			setActiveCompany,
			refreshSession,
			logout,
		}),
		[
			isLoading,
			login,
			logout,
			needsCompany,
			refreshSession,
			register,
			setActiveCompany,
			user,
		],
	);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error("useAuth must be used within AuthProvider");
	return ctx;
}
