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
}

interface AuthContextValue {
	user: AuthUser | null;
	isAuthenticated: boolean;
	isAdmin: boolean;
	isLoading: boolean;
	login: (email: string, password: string) => Promise<AuthUser>;
	register: (
		email: string,
		password: string,
		name: string,
		companyName: string,
	) => Promise<AuthUser>;
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
	const [isLoading, setIsLoading] = useState(true);

	const storeSession = useCallback((payload: AuthResponse) => {
		localStorage.setItem(AUTH_TOKEN_KEY, payload.token);
		persistSelectedCompany(payload.user.companyId);
		setUser(payload.user);
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
				persistSelectedCompany(nextUser.companyId);
				setUser(nextUser);
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
		async (
			email: string,
			password: string,
			name: string,
			companyName: string,
		) => {
			const payload = await request<AuthResponse>("/auth/register", {
				method: "POST",
				body: JSON.stringify({ email, password, name, companyName }),
			});
			storeSession(payload);
			return payload.user;
		},
		[storeSession],
	);

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
			navigate("/login", { replace: true });
		}
	}, [navigate]);

	const value = useMemo<AuthContextValue>(
		() => ({
			user,
			isAuthenticated: user !== null,
			isAdmin: user?.role === "owner" || user?.role === "admin",
			isLoading,
			login,
			register,
			logout,
		}),
		[isLoading, login, logout, register, user],
	);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
	const ctx = useContext(AuthContext);
	if (!ctx) throw new Error("useAuth must be used within AuthProvider");
	return ctx;
}
