/**
 * LoginPage.tsx — combined sign-in / register page.
 *
 * Design goals (current iteration):
 *   - enterprise look: white background, brand-blue accents, no animation
 *   - accessibility first: real <label htmlFor>, aria-live error region,
 *     aria-describedby for helper/error text, focus-visible rings, no
 *     colour-only signalling, keyboard-only friendly tab toggle
 *   - hard-coded light palette so this screen stays consistent even if
 *     the rest of the app is in dark mode (auth happens before any user
 *     theme preference is known)
 *
 * Behaviour parity with the previous design:
 *   - reads ?email= and ?invite= from the URL (invite pre-fills the
 *     email field and switches to the register tab)
 *   - login(email, password) / register(email, password, name, company)
 *     from AuthContext are unchanged
 *   - first-account-owner copy is preserved
 */

import { CheckCircle2, GitBranch, Lock, Shield } from "lucide-react";
import {
	type FormEvent,
	type InputHTMLAttributes,
	useEffect,
	useId,
	useMemo,
	useState,
} from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

type AuthMode = "signin" | "register";

function getErrorMessage(error: unknown) {
	if (error instanceof Error && error.message) return error.message;
	return "Something went wrong. Please try again.";
}

/* ── Form field primitive (white / enterprise theme) ────────────────── */

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
	label: string;
	helperText?: string;
	error?: string;
}

function Field({ label, helperText, error, id, ...rest }: FieldProps) {
	const generatedId = useId();
	const fieldId = id ?? generatedId;
	const helperId = `${fieldId}-helper`;
	const errorId = `${fieldId}-error`;
	const describedBy = error ? errorId : helperText ? helperId : undefined;
	return (
		<div className="space-y-1.5">
			<label
				htmlFor={fieldId}
				className="block text-sm font-medium text-slate-800"
			>
				{label}
			</label>
			<input
				{...rest}
				id={fieldId}
				aria-invalid={Boolean(error)}
				aria-describedby={describedBy}
				className={[
					"block w-full rounded-md border bg-white px-3 py-2.5 text-sm text-slate-900",
					"placeholder:text-slate-400",
					"outline-none transition-colors",
					"focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-white",
					error
						? "border-red-400 focus-visible:ring-red-400"
						: "border-slate-300 focus-visible:border-blue-600 focus-visible:ring-blue-600",
				].join(" ")}
			/>
			{error ? (
				<p id={errorId} className="text-xs text-red-600">
					{error}
				</p>
			) : helperText ? (
				<p id={helperId} className="text-xs text-slate-500">
					{helperText}
				</p>
			) : null}
		</div>
	);
}

/* ── Submit button (primary, brand blue) ─────────────────────────────── */

function PrimaryButton({
	loading,
	children,
	...rest
}: {
	loading?: boolean;
	children: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
	return (
		<button
			{...rest}
			disabled={rest.disabled || loading}
			className={[
				"inline-flex h-11 w-full items-center justify-center gap-2 rounded-md",
				"bg-blue-700 px-4 text-sm font-semibold text-white",
				"transition-colors hover:bg-blue-800",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 focus-visible:ring-offset-white",
				"disabled:cursor-not-allowed disabled:bg-blue-300",
			].join(" ")}
		>
			{loading ? (
				<span
					aria-hidden="true"
					className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
				/>
			) : null}
			<span>{children}</span>
		</button>
	);
}

/* ── Marketing column (left side on desktop) ─────────────────────────── */

const VALUE_PROPS = [
	{
		icon: Shield,
		title: "Local-first, privacy-native",
		body: "Your code, conversations, and credentials stay on your machine. SQL is the source of truth — never a vendor's server.",
	},
	{
		icon: GitBranch,
		title: "Fork any plot, replay any run",
		body: "Every run produces a tamper-evident transcript and a mark commit, so you can branch from a known-good state and never lose context.",
	},
	{
		icon: CheckCircle2,
		title: "Multi-agent orchestration",
		body: "Claude, Codex, Gemini, and Ollama run side-by-side on the same workspace with shared tools and a single audit trail.",
	},
];

function MarketingPanel() {
	return (
		<aside className="hidden flex-col justify-between bg-slate-50 p-12 lg:flex">
			<div>
				<div className="flex items-center gap-2 text-slate-900">
					<div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-700 text-white">
						<Lock className="h-5 w-5" aria-hidden="true" />
					</div>
					<span className="text-lg font-semibold tracking-tight">Setra</span>
				</div>
				<h1 className="mt-12 text-3xl font-semibold tracking-tight text-slate-900">
					The collaborative AI engineering platform.
				</h1>
				<p className="mt-3 max-w-md text-sm leading-relaxed text-slate-600">
					Pool agents and engineers on the same workspace, on the same Wi-Fi or
					over the internet — with the audit trail an enterprise actually needs.
				</p>

				<ul className="mt-10 space-y-6">
					{VALUE_PROPS.map(({ icon: Icon, title, body }) => (
						<li key={title} className="flex gap-3">
							<div className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-md bg-white text-blue-700 ring-1 ring-slate-200">
								<Icon className="h-5 w-5" aria-hidden="true" />
							</div>
							<div>
								<p className="text-sm font-semibold text-slate-900">{title}</p>
								<p className="mt-1 text-sm leading-relaxed text-slate-600">
									{body}
								</p>
							</div>
						</li>
					))}
				</ul>
			</div>

			<p className="text-xs text-slate-500">
				© {new Date().getFullYear()} Setra · Enterprise AI agent orchestration
			</p>
		</aside>
	);
}

/* ── Main page ───────────────────────────────────────────────────────── */

export function LoginPage() {
	const navigate = useNavigate();
	const [params] = useSearchParams();
	const invitedEmail = params.get("email") ?? "";
	const inviteId = params.get("invite") ?? "";
	const { isAuthenticated, isLoading, login, register } = useAuth();
	const [mode, setMode] = useState<AuthMode>(
		invitedEmail || inviteId ? "register" : "signin",
	);
	const [error, setError] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [loginForm, setLoginForm] = useState({
		email: invitedEmail,
		password: "",
	});
	const [registerForm, setRegisterForm] = useState({
		name: "",
		email: invitedEmail,
		password: "",
		companyName: "",
	});

	useEffect(() => {
		setError(null);
	}, [mode]);

	const headline = useMemo(
		() => (mode === "signin" ? "Welcome back" : "Create your account"),
		[mode],
	);
	const subtitle = useMemo(
		() =>
			mode === "signin"
				? "Sign in to your Setra workspace."
				: inviteId
					? "You were invited to join an existing workspace."
					: "The first account becomes the workspace owner.",
		[mode, inviteId],
	);

	if (isLoading) {
		return (
			<div
				role="status"
				aria-live="polite"
				className="flex min-h-screen items-center justify-center bg-white text-sm text-slate-500"
			>
				<span
					aria-hidden="true"
					className="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-700"
				/>
				Loading your workspace…
			</div>
		);
	}

	if (isAuthenticated) {
		return <Navigate to="/overview" replace />;
	}

	async function handleSignIn(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		setIsSubmitting(true);
		try {
			await login(loginForm.email, loginForm.password);
			navigate("/overview", { replace: true });
		} catch (nextError) {
			setError(getErrorMessage(nextError));
		} finally {
			setIsSubmitting(false);
		}
	}

	async function handleRegister(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		setIsSubmitting(true);
		try {
			await register(
				registerForm.email,
				registerForm.password,
				registerForm.name,
				registerForm.companyName,
			);
			navigate("/overview", { replace: true });
		} catch (nextError) {
			setError(getErrorMessage(nextError));
		} finally {
			setIsSubmitting(false);
		}
	}

	return (
		<div className="min-h-screen bg-white text-slate-900">
			<a
				href="#auth-form"
				className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:rounded focus:bg-blue-700 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
			>
				Skip to sign-in form
			</a>

			<div className="grid min-h-screen grid-cols-1 lg:grid-cols-[1.1fr_1fr]">
				<MarketingPanel />

				<main className="flex items-center justify-center px-6 py-12 sm:px-12">
					<div className="w-full max-w-sm">
						{/* Mobile-only logo */}
						<div className="mb-8 flex items-center gap-2 lg:hidden">
							<div className="flex h-9 w-9 items-center justify-center rounded-md bg-blue-700 text-white">
								<Lock className="h-5 w-5" aria-hidden="true" />
							</div>
							<span className="text-lg font-semibold tracking-tight">
								Setra
							</span>
						</div>

						<header className="mb-8">
							<h2 className="text-2xl font-semibold tracking-tight text-slate-900">
								{headline}
							</h2>
							<p className="mt-1 text-sm text-slate-600">{subtitle}</p>
						</header>

						{/* Mode tabs */}
						<div
							role="tablist"
							aria-label="Authentication mode"
							className="mb-6 inline-flex rounded-md border border-slate-200 bg-slate-50 p-1 text-sm"
						>
							{(
								[
									["signin", "Sign in"],
									["register", "Create account"],
								] as const
							).map(([value, label]) => {
								const active = mode === value;
								return (
									<button
										key={value}
										type="button"
										role="tab"
										aria-selected={active}
										aria-controls="auth-form"
										onClick={() => setMode(value)}
										className={[
											"rounded-[5px] px-3 py-1.5 font-medium transition-colors",
											"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-50",
											active
												? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
												: "text-slate-600 hover:text-slate-900",
										].join(" ")}
									>
										{label}
									</button>
								);
							})}
						</div>

						<section
							id="auth-form"
							aria-live="polite"
							aria-atomic="true"
							role="tabpanel"
						>
							{mode === "signin" ? (
								<form className="space-y-4" onSubmit={handleSignIn} noValidate>
									<Field
										label="Email"
										type="email"
										autoComplete="email"
										required
										value={loginForm.email}
										onChange={(event) =>
											setLoginForm((c) => ({ ...c, email: event.target.value }))
										}
									/>
									<Field
										label="Password"
										type="password"
										autoComplete="current-password"
										required
										value={loginForm.password}
										onChange={(event) =>
											setLoginForm((c) => ({
												...c,
												password: event.target.value,
											}))
										}
									/>

									{error ? (
										<div
											role="alert"
											className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
										>
											{error}
										</div>
									) : null}

									<PrimaryButton type="submit" loading={isSubmitting}>
										Sign in
									</PrimaryButton>

									<p className="text-center text-sm text-slate-600">
										New to Setra?{" "}
										<button
											type="button"
											className="font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:underline"
											onClick={() => setMode("register")}
										>
											Create an account
										</button>
									</p>
								</form>
							) : (
								<form
									className="space-y-4"
									onSubmit={handleRegister}
									noValidate
								>
									<Field
										label="Your name"
										autoComplete="name"
										required
										value={registerForm.name}
										onChange={(event) =>
											setRegisterForm((c) => ({
												...c,
												name: event.target.value,
											}))
										}
									/>
									<Field
										label="Email"
										type="email"
										autoComplete="email"
										required
										value={registerForm.email}
										onChange={(event) =>
											setRegisterForm((c) => ({
												...c,
												email: event.target.value,
											}))
										}
									/>
									<Field
										label="Password"
										type="password"
										autoComplete="new-password"
										required
										minLength={8}
										helperText="Use at least 8 characters."
										value={registerForm.password}
										onChange={(event) =>
											setRegisterForm((c) => ({
												...c,
												password: event.target.value,
											}))
										}
									/>

									{!inviteId ? (
										<Field
											label="Company name"
											autoComplete="organization"
											required
											helperText="Used as the name of your shared workspace."
											value={registerForm.companyName}
											onChange={(event) =>
												setRegisterForm((c) => ({
													...c,
													companyName: event.target.value,
												}))
											}
										/>
									) : (
										<div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
											You were invited to join an existing workspace. Register
											with{" "}
											<strong>{invitedEmail || "the invited email"}</strong> to
											accept.
										</div>
									)}

									{error ? (
										<div
											role="alert"
											className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
										>
											{error}
										</div>
									) : null}

									<p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
										The first account becomes the workspace{" "}
										<span className="font-semibold text-slate-900">owner</span>.
										Anyone you invite afterwards joins as a team member.
									</p>

									<PrimaryButton type="submit" loading={isSubmitting}>
										Create account
									</PrimaryButton>

									<p className="text-center text-sm text-slate-600">
										Already have an account?{" "}
										<button
											type="button"
											className="font-medium text-blue-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:underline"
											onClick={() => setMode("signin")}
										>
											Sign in
										</button>
									</p>
								</form>
							)}
						</section>

						<p className="mt-10 text-center text-xs text-slate-500 lg:hidden">
							Enterprise AI agent orchestration — local-first, privacy-native.
						</p>
					</div>
				</main>
			</div>
		</div>
	);
}
