/**
 * Login + Register page.
 *
 * Cream/light enterprise theme — replaces the older animated dark canvas.
 * Register layout mirrors the user's request:
 *   firstName | lastName
 *   email | phone
 *   password | confirmPassword
 *   securityQuestion (dropdown) | securityAnswer
 *   [x] I accept the terms and conditions
 *
 * On successful register the user lands on /onboarding/company because we
 * no longer ask for company name on the signup page itself.
 */

import { type FormEvent, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Button, Input } from "../components/ui";
import { useAuth } from "../context/AuthContext";

type AuthMode = "signin" | "register";

const SECURITY_QUESTIONS = [
	"What was the name of your first pet?",
	"What city were you born in?",
	"What is your mother's maiden name?",
	"What was the make of your first car?",
	"What was the name of your primary school?",
	"What is your favorite book?",
];

function getErrorMessage(error: unknown) {
	if (error instanceof Error && error.message) return error.message;
	return "Something went wrong. Please try again.";
}

export default function LoginPage() {
	return <LoginPageInner />;
}

export { LoginPageInner as LoginPage };

function LoginPageInner() {
	const navigate = useNavigate();
	const { login, register, isAuthenticated, needsCompany, isLoading } =
		useAuth();
	const [mode, setMode] = useState<AuthMode>("signin");

	if (!isLoading && isAuthenticated) {
		return <Navigate to={needsCompany ? "/onboarding/company" : "/overview"} replace />;
	}

	return (
		<div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-[#fbf6ec] via-[#f7efe0] to-[#f1e6d0]">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-0 opacity-50"
				style={{
					backgroundImage:
						"radial-gradient(circle at 20% 15%, rgba(212,165,116,0.18), transparent 45%), radial-gradient(circle at 85% 80%, rgba(168,140,98,0.16), transparent 50%)",
				}}
			/>

			<div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col items-center justify-center gap-12 px-6 py-12 md:flex-row md:items-stretch md:gap-16">
				{/* Brand panel */}
				<div className="hidden flex-1 flex-col justify-center md:flex">
					<div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2b2418] text-2xl font-semibold text-[#fbf6ec] shadow-lg">
						S
					</div>
					<h1 className="text-4xl font-semibold leading-tight tracking-tight text-[#2b2418]">
						The team workspace
						<br />
						for human + AI engineers.
					</h1>
					<p className="mt-5 max-w-md text-base leading-relaxed text-[#5b4f3a]">
						Setra is a project board, agent runtime, and team-wide memory
						store. Sign in to your workspace or create a new one — no API
						keys to manage, just connect the CLI of your choice.
					</p>
					<dl className="mt-10 grid max-w-md grid-cols-1 gap-4 text-sm text-[#3d3324]">
						<Feature title="One project board, many engineers">
							Human teammates and AI agents share the same issues, plans,
							and reviews.
						</Feature>
						<Feature title="Adapter-only, zero keys">
							Connect Claude Code, Codex, Gemini, Cursor, or OpenCode — no
							API keys to provision.
						</Feature>
						<Feature title="Discover companies on your LAN or the internet">
							mDNS discovery for local networks, Supabase directory for
							public listings, codes for everything else.
						</Feature>
					</dl>
				</div>

				{/* Form card */}
				<div className="w-full max-w-md flex-shrink-0">
					<div className="rounded-2xl border border-[#e5d6b8] bg-white/90 p-7 shadow-[0_24px_48px_-24px_rgba(74,55,28,0.25)] backdrop-blur-sm md:p-9">
						<div className="mb-6 flex items-center justify-between gap-2">
							<button
								type="button"
								onClick={() => setMode("signin")}
								className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
									mode === "signin"
										? "bg-[#2b2418] text-[#fbf6ec]"
										: "text-[#5b4f3a] hover:bg-[#f3e7cf]"
								}`}
							>
								Sign in
							</button>
							<button
								type="button"
								onClick={() => setMode("register")}
								className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
									mode === "register"
										? "bg-[#2b2418] text-[#fbf6ec]"
										: "text-[#5b4f3a] hover:bg-[#f3e7cf]"
								}`}
							>
								Create account
							</button>
						</div>

						{mode === "signin" ? (
							<SignInForm
								onSuccess={(routeTo) =>
									navigate(routeTo, { replace: true })
								}
								login={login}
							/>
						) : (
							<RegisterForm
								onSuccess={(routeTo) =>
									navigate(routeTo, { replace: true })
								}
								register={register}
								onSwitchToSignIn={() => setMode("signin")}
							/>
						)}
					</div>
					<p className="mt-4 text-center text-xs text-[#6f6044]">
						Need help? Browse the docs at setra.sh/docs
					</p>
				</div>
			</div>
		</div>
	);
}

function Feature({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex gap-3">
			<div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-[#b58a4c]" />
			<div>
				<dt className="font-medium text-[#2b2418]">{title}</dt>
				<dd className="mt-1 text-[#5b4f3a]">{children}</dd>
			</div>
		</div>
	);
}

/* ── Sign in ────────────────────────────────────────────────────────── */

interface SignInFormProps {
	onSuccess: (route: string) => void;
	login: (email: string, password: string) => Promise<{ companyId: string }>;
}

function SignInForm({ onSuccess, login }: SignInFormProps) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setBusy(true);
		try {
			const u = await login(email.trim(), password);
			onSuccess(u.companyId ? "/overview" : "/onboarding/company");
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4" noValidate>
			<Field label="Email">
				<Input
					type="email"
					required
					autoComplete="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="you@company.com"
				/>
			</Field>
			<Field label="Password">
				<Input
					type="password"
					required
					autoComplete="current-password"
					value={password}
					onChange={(e) => setPassword(e.target.value)}
					placeholder="At least 8 characters"
				/>
			</Field>

			{error && <FormError>{error}</FormError>}

			<Button type="submit" disabled={busy} className="w-full">
				{busy ? "Signing in..." : "Sign in"}
			</Button>

			<div className="flex items-center justify-between text-xs text-[#6f6044]">
				<Link
					to="/forgot-password"
					className="font-medium text-[#7a5421] hover:text-[#5b3d18]"
				>
					Forgot password?
				</Link>
				<span>Setra is end-to-end yours.</span>
			</div>
		</form>
	);
}

/* ── Register ───────────────────────────────────────────────────────── */

interface RegisterFormProps {
	onSuccess: (route: string) => void;
	register: ReturnType<typeof useAuth>["register"];
	onSwitchToSignIn: () => void;
}

function RegisterForm({ onSuccess, register, onSwitchToSignIn }: RegisterFormProps) {
	const [firstName, setFirstName] = useState("");
	const [lastName, setLastName] = useState("");
	const [email, setEmail] = useState("");
	const [phone, setPhone] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [securityQuestion, setSecurityQuestion] = useState(
		SECURITY_QUESTIONS[0],
	);
	const [securityAnswer, setSecurityAnswer] = useState("");
	const [acceptedTerms, setAcceptedTerms] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function handleSubmit(e: FormEvent) {
		e.preventDefault();
		setError(null);

		if (!firstName.trim() || !lastName.trim()) {
			return setError("First name and last name are required.");
		}
		if (password.length < 8) {
			return setError("Password must be at least 8 characters.");
		}
		if (password !== confirmPassword) {
			return setError("Passwords do not match.");
		}
		if (!securityAnswer.trim()) {
			return setError("Please answer your security question.");
		}
		if (!acceptedTerms) {
			return setError("You must accept the terms and conditions to continue.");
		}

		setBusy(true);
		try {
			const result = await register({
				firstName: firstName.trim(),
				lastName: lastName.trim(),
				email: email.trim(),
				phone: phone.trim(),
				password,
				securityQuestion,
				securityAnswer: securityAnswer.trim(),
				acceptedTerms,
			});
			onSuccess(
				result.needsCompany || !result.user.companyId
					? "/onboarding/company"
					: "/overview",
			);
		} catch (err) {
			setError(getErrorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-4" noValidate>
			<div className="grid grid-cols-2 gap-3">
				<Field label="First name">
					<Input
						required
						autoComplete="given-name"
						value={firstName}
						onChange={(e) => setFirstName(e.target.value)}
					/>
				</Field>
				<Field label="Last name">
					<Input
						required
						autoComplete="family-name"
						value={lastName}
						onChange={(e) => setLastName(e.target.value)}
					/>
				</Field>
			</div>
			<div className="grid grid-cols-2 gap-3">
				<Field label="Email">
					<Input
						type="email"
						required
						autoComplete="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
					/>
				</Field>
				<Field label="Phone">
					<Input
						type="tel"
						required
						autoComplete="tel"
						value={phone}
						onChange={(e) => setPhone(e.target.value)}
						placeholder="+1 555 1234"
					/>
				</Field>
			</div>
			<div className="grid grid-cols-2 gap-3">
				<Field label="Password">
					<Input
						type="password"
						required
						autoComplete="new-password"
						minLength={8}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
					/>
				</Field>
				<Field label="Confirm password">
					<Input
						type="password"
						required
						autoComplete="new-password"
						minLength={8}
						value={confirmPassword}
						onChange={(e) => setConfirmPassword(e.target.value)}
					/>
				</Field>
			</div>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Field label="Security question">
					<select
						value={securityQuestion}
						onChange={(e) => setSecurityQuestion(e.target.value)}
						className="h-10 w-full rounded-md border border-[#d9c6a3] bg-white px-3 text-sm text-[#2b2418] outline-none transition focus:border-[#7a5421] focus:ring-2 focus:ring-[#e2c787]/60"
					>
						{SECURITY_QUESTIONS.map((q) => (
							<option key={q} value={q}>
								{q}
							</option>
						))}
					</select>
				</Field>
				<Field label="Answer">
					<Input
						required
						value={securityAnswer}
						onChange={(e) => setSecurityAnswer(e.target.value)}
						placeholder="Used to recover your password"
					/>
				</Field>
			</div>

			<label className="flex items-start gap-2 pt-1 text-sm text-[#3d3324]">
				<input
					type="checkbox"
					checked={acceptedTerms}
					onChange={(e) => setAcceptedTerms(e.target.checked)}
					className="mt-0.5 h-4 w-4 rounded border-[#c9b48a] text-[#7a5421] focus:ring-[#e2c787]"
				/>
				<span>
					I accept the{" "}
					<a
						href="https://setra.sh/terms"
						target="_blank"
						rel="noreferrer"
						className="font-medium text-[#7a5421] hover:text-[#5b3d18]"
					>
						terms and conditions
					</a>{" "}
					and{" "}
					<a
						href="https://setra.sh/privacy"
						target="_blank"
						rel="noreferrer"
						className="font-medium text-[#7a5421] hover:text-[#5b3d18]"
					>
						privacy policy
					</a>
					.
				</span>
			</label>

			{error && <FormError>{error}</FormError>}

			<Button type="submit" disabled={busy} className="w-full">
				{busy ? "Creating account..." : "Create account"}
			</Button>

			<p className="text-center text-xs text-[#6f6044]">
				Already have an account?{" "}
				<button
					type="button"
					onClick={onSwitchToSignIn}
					className="font-medium text-[#7a5421] hover:text-[#5b3d18]"
				>
					Sign in
				</button>
			</p>
		</form>
	);
}

/* ── Shared field bits ──────────────────────────────────────────────── */

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<label className="block">
			<span className="mb-1 block text-xs font-medium uppercase tracking-wide text-[#6f6044]">
				{label}
			</span>
			{children}
		</label>
	);
}

function FormError({ children }: { children: React.ReactNode }) {
	return (
		<div
			role="alert"
			className="rounded-md border border-[#e6b6b0] bg-[#fbeeec] px-3 py-2 text-sm text-[#8e2f23]"
		>
			{children}
		</div>
	);
}
