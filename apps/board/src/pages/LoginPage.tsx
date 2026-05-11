import { AnimatePresence, motion } from "framer-motion";
import { Bot, BrainCircuit, Network, Zap } from "lucide-react";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Input } from "../components/ui";
import { useAuth } from "../context/AuthContext";

type AuthMode = "signin" | "register";

function getErrorMessage(error: unknown) {
	if (error instanceof Error && error.message) return error.message;
	return "Something went wrong. Please try again.";
}

/* ── Animated particle canvas ─────────────────────────────────────────── */

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	r: number;
	opacity: number;
}

function ParticleField() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const particles = useRef<Particle[]>([]);
	const raf = useRef(0);
	const mouse = useRef({ x: -999, y: -999 });

	const init = useCallback(() => {
		const cvs = canvasRef.current;
		if (!cvs) return;
		const w = window.innerWidth;
		const h = window.innerHeight;
		cvs.width = w;
		cvs.height = h;
		const count = Math.min(Math.floor((w * h) / 8000), 120);
		particles.current = Array.from({ length: count }, () => ({
			x: Math.random() * w,
			y: Math.random() * h,
			vx: (Math.random() - 0.5) * 0.35,
			vy: (Math.random() - 0.5) * 0.35,
			r: Math.random() * 1.6 + 0.6,
			opacity: Math.random() * 0.5 + 0.15,
		}));
	}, []);

	useEffect(() => {
		init();
		const onResize = () => init();
		window.addEventListener("resize", onResize);

		const onMouseMove = (e: MouseEvent) => {
			mouse.current = { x: e.clientX, y: e.clientY };
		};
		window.addEventListener("mousemove", onMouseMove);

		const draw = () => {
			const cvs = canvasRef.current;
			if (!cvs) return;
			const ctx = cvs.getContext("2d");
			if (!ctx) return;
			const { width: w, height: h } = cvs;
			ctx.clearRect(0, 0, w, h);

			const pts = particles.current;
			const mx = mouse.current.x;
			const my = mouse.current.y;

			for (let i = 0; i < pts.length; i++) {
				const p = pts[i]!;
				p.x += p.vx;
				p.y += p.vy;
				if (p.x < 0) p.x = w;
				if (p.x > w) p.x = 0;
				if (p.y < 0) p.y = h;
				if (p.y > h) p.y = 0;

				// Glow near mouse
				const dm = Math.hypot(p.x - mx, p.y - my);
				const glow = dm < 180 ? 1 - dm / 180 : 0;
				const alpha = Math.min(p.opacity + glow * 0.6, 1);

				ctx.beginPath();
				ctx.arc(p.x, p.y, p.r + glow * 1.5, 0, Math.PI * 2);
				ctx.fillStyle = `rgba(99,140,255,${alpha})`;
				ctx.fill();

				// Connect nearby particles with lines
				for (let j = i + 1; j < pts.length; j++) {
					const q = pts[j]!;
					const dist = Math.hypot(p.x - q.x, p.y - q.y);
					if (dist < 120) {
						ctx.beginPath();
						ctx.moveTo(p.x, p.y);
						ctx.lineTo(q.x, q.y);
						ctx.strokeStyle = `rgba(99,140,255,${0.08 * (1 - dist / 120)})`;
						ctx.lineWidth = 0.5;
						ctx.stroke();
					}
				}
			}

			raf.current = requestAnimationFrame(draw);
		};
		raf.current = requestAnimationFrame(draw);

		return () => {
			cancelAnimationFrame(raf.current);
			window.removeEventListener("resize", onResize);
			window.removeEventListener("mousemove", onMouseMove);
		};
	}, [init]);

	return (
		<canvas
			ref={canvasRef}
			tabIndex={-1}
			className="pointer-events-none absolute inset-0 z-0"
		/>
	);
}

/* ── Floating feature badges ──────────────────────────────────────────── */

const FLOATING_ITEMS = [
	{ icon: Bot, label: "AI Agents", x: "8%", y: "18%" },
	{ icon: BrainCircuit, label: "Multi-Model", x: "82%", y: "14%" },
	{ icon: Network, label: "Autonomous Ops", x: "12%", y: "76%" },
	{ icon: Zap, label: "Real-time", x: "85%", y: "72%" },
] as const;

function FloatingBadges() {
	return (
		<>
			{FLOATING_ITEMS.map((item, i) => (
				<motion.div
					key={item.label}
					initial={{ opacity: 0, scale: 0.7 }}
					animate={{
						opacity: [0, 0.7, 0.5],
						scale: 1,
						y: [0, -8, 0],
					}}
					transition={{
						delay: 0.8 + i * 0.2,
						duration: 4,
						repeat: Number.POSITIVE_INFINITY,
						repeatType: "reverse",
						ease: "easeInOut",
					}}
					className="pointer-events-none absolute z-[1] hidden md:flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1.5 backdrop-blur-md"
					style={{ left: item.x, top: item.y }}
				>
					<item.icon className="h-3.5 w-3.5 text-blue-400/70" />
					<span className="text-[10px] font-medium text-white/40">
						{item.label}
					</span>
				</motion.div>
			))}
		</>
	);
}

/* ── Animated grid lines (subtle) ─────────────────────────────────────── */

function GridOverlay() {
	return (
		<div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
			{/* Horizontal scan line */}
			<motion.div
				className="absolute left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/20 to-transparent"
				initial={{ top: "0%" }}
				animate={{ top: "100%" }}
				transition={{
					duration: 8,
					repeat: Number.POSITIVE_INFINITY,
					ease: "linear",
				}}
			/>
			{/* Grid pattern */}
			<div
				className="absolute inset-0 opacity-[0.03]"
				style={{
					backgroundImage:
						"linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)",
					backgroundSize: "60px 60px",
				}}
			/>
		</div>
	);
}

/* ── Pulsing orbital ring ─────────────────────────────────────────────── */

function OrbitalRing() {
	return (
		<div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
			<motion.div
				className="rounded-full border border-blue-500/[0.06]"
				style={{ width: "min(80vw, 700px)", height: "min(80vw, 700px)" }}
				animate={{ rotate: 360, scale: [1, 1.02, 1] }}
				transition={{
					rotate: {
						duration: 40,
						repeat: Number.POSITIVE_INFINITY,
						ease: "linear",
					},
					scale: {
						duration: 6,
						repeat: Number.POSITIVE_INFINITY,
						repeatType: "reverse",
						ease: "easeInOut",
					},
				}}
			/>
			<motion.div
				className="absolute rounded-full border border-purple-500/[0.04]"
				style={{ width: "min(60vw, 520px)", height: "min(60vw, 520px)" }}
				animate={{ rotate: -360 }}
				transition={{
					duration: 30,
					repeat: Number.POSITIVE_INFINITY,
					ease: "linear",
				}}
			/>
		</div>
	);
}

/* ── Main login page ──────────────────────────────────────────────────── */

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

	const subtitle = useMemo(
		() =>
			mode === "signin"
				? "Sign in to your multi-agent workspace."
				: "Bootstrap your AI-powered workspace.",
		[mode],
	);

	if (isLoading) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-[#050510] text-sm text-zinc-500">
				<motion.div
					animate={{ opacity: [0.4, 1, 0.4] }}
					transition={{ duration: 1.5, repeat: Number.POSITIVE_INFINITY }}
					className="flex items-center gap-2"
				>
					<Zap className="h-4 w-4 text-blue-400" />
					<span>Initializing…</span>
				</motion.div>
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

	const inputClass =
		"border-white/[0.08] bg-white/[0.04] text-foreground placeholder:text-zinc-600 focus:border-blue-500/40 focus:ring-blue-500/20 transition-colors";

	return (
		<div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050510] px-6 py-12 text-foreground">
			{/* Layered animated background */}
			<ParticleField />
			<GridOverlay />
			<OrbitalRing />
			<FloatingBadges />

			{/* Radial gradient overlays */}
			<div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(ellipse_at_top,rgba(59,130,246,0.12),transparent_50%)]" />
			<div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(ellipse_at_bottom_right,rgba(139,92,246,0.08),transparent_50%)]" />
			<div className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(circle_at_center,transparent_30%,rgba(5,5,16,0.8)_70%)]" />

			{/* Main card */}
			<motion.div
				initial={{ opacity: 0, y: 32, scale: 0.97 }}
				animate={{ opacity: 1, y: 0, scale: 1 }}
				transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
				className="relative z-10 w-full max-w-[420px] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0a0a1a]/80 shadow-[0_0_80px_-12px_rgba(59,130,246,0.15)] backdrop-blur-2xl"
			>
				{/* Top glow accent */}
				<div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent" />
				<div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-blue-500/[0.06] to-transparent" />

				<div className="relative p-8">
					{/* Logo + Header */}
					<div className="mb-8 flex flex-col items-center text-center">
						<motion.div
							initial={{ scale: 0.5, opacity: 0 }}
							animate={{ scale: 1, opacity: 1 }}
							transition={{
								delay: 0.15,
								type: "spring",
								stiffness: 200,
								damping: 15,
							}}
							className="relative mb-5"
						>
							<div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.08] bg-gradient-to-br from-blue-600/20 to-purple-600/20 shadow-xl shadow-blue-950/30">
								<Zap className="h-8 w-8 text-white" strokeWidth={2.2} />
							</div>
							{/* Pulse ring */}
							<motion.div
								className="absolute -inset-2 rounded-2xl border border-blue-500/20"
								animate={{ scale: [1, 1.15, 1], opacity: [0.5, 0, 0.5] }}
								transition={{
									duration: 3,
									repeat: Number.POSITIVE_INFINITY,
									ease: "easeInOut",
								}}
							/>
						</motion.div>

						<motion.p
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							transition={{ delay: 0.3 }}
							className="text-[10px] font-bold uppercase tracking-[0.4em] text-blue-400/60"
						>
							Setra Platform
						</motion.p>
						<motion.h1
							initial={{ opacity: 0, y: 8 }}
							animate={{ opacity: 1, y: 0 }}
							transition={{ delay: 0.35 }}
							className="mt-3 text-2xl font-semibold tracking-tight text-white"
						>
							{mode === "signin" ? "Welcome back" : "Create your workspace"}
						</motion.h1>
						<motion.p
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							transition={{ delay: 0.4 }}
							className="mt-2 text-sm text-zinc-500"
						>
							{subtitle}
						</motion.p>
					</div>

					{/* Tab toggle */}
					<div className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
						{(
							[
								["signin", "Sign In"],
								["register", "Register"],
							] as const
						).map(([value, label]) => (
							<button
								key={value}
								type="button"
								onClick={() => setMode(value)}
								className={`relative rounded-lg px-3 py-2 text-sm font-medium transition-all ${
									mode === value
										? "text-white"
										: "text-zinc-500 hover:text-zinc-300"
								}`}
							>
								{mode === value && (
									<motion.div
										layoutId="auth-tab"
										className="absolute inset-0 rounded-lg bg-white/[0.08] border border-white/[0.06]"
										transition={{ type: "spring", stiffness: 400, damping: 30 }}
									/>
								)}
								<span className="relative z-10">{label}</span>
							</button>
						))}
					</div>

					{/* Form */}
					<AnimatePresence mode="wait">
						<motion.div
							key={mode}
							initial={{ opacity: 0, y: 16 }}
							animate={{ opacity: 1, y: 0 }}
							exit={{ opacity: 0, y: -16 }}
							transition={{ duration: 0.25, ease: "easeOut" }}
						>
							{mode === "signin" ? (
								<form className="space-y-4" onSubmit={handleSignIn}>
									<Input
										label="Email"
										type="email"
										autoComplete="email"
										value={loginForm.email}
										onChange={(event) =>
											setLoginForm((c) => ({
												...c,
												email: event.target.value,
											}))
										}
										className={inputClass}
										required
									/>
									<Input
										label="Password"
										type="password"
										autoComplete="current-password"
										value={loginForm.password}
										onChange={(event) =>
											setLoginForm((c) => ({
												...c,
												password: event.target.value,
											}))
										}
										className={inputClass}
										required
									/>
									{error ? (
										<motion.div
											initial={{ opacity: 0, height: 0 }}
											animate={{ opacity: 1, height: "auto" }}
											className="rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300"
										>
											{error}
										</motion.div>
									) : null}
									<Button
										type="submit"
										loading={isSubmitting}
										className="h-11 w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white font-medium hover:from-blue-500 hover:to-blue-400 shadow-lg shadow-blue-600/20 border-0 transition-all"
									>
										Sign In
									</Button>
								</form>
							) : (
								<form className="space-y-3.5" onSubmit={handleRegister}>
									<Input
										label="Your name"
										autoComplete="name"
										value={registerForm.name}
										onChange={(event) =>
											setRegisterForm((c) => ({
												...c,
												name: event.target.value,
											}))
										}
										className={inputClass}
										required
									/>
									<Input
										label="Email"
										type="email"
										autoComplete="email"
										value={registerForm.email}
										onChange={(event) =>
											setRegisterForm((c) => ({
												...c,
												email: event.target.value,
											}))
										}
										className={inputClass}
										required
									/>
									<Input
										label="Password"
										type="password"
										autoComplete="new-password"
										helperText="Use at least 8 characters."
										value={registerForm.password}
										onChange={(event) =>
											setRegisterForm((c) => ({
												...c,
												password: event.target.value,
											}))
										}
										className={inputClass}
										required
									/>
									{!inviteId ? (
										<Input
											label="Company name"
											autoComplete="organization"
											helperText="Only needed for the first account."
											value={registerForm.companyName}
											onChange={(event) =>
												setRegisterForm((c) => ({
													...c,
													companyName: event.target.value,
												}))
											}
											className={inputClass}
											required
										/>
									) : (
										<div className="rounded-md border border-setra-500/30 bg-setra-500/10 px-3 py-2 text-xs text-setra-200">
											You were invited to join an existing workspace. Just
											register with the email{" "}
											<strong>{invitedEmail || "above"}</strong> to accept.
										</div>
									)}
									{error ? (
										<motion.div
											initial={{ opacity: 0, height: 0 }}
											animate={{ opacity: 1, height: "auto" }}
											className="rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-sm text-red-300"
										>
											{error}
										</motion.div>
									) : null}
									<p className="rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2 text-[11px] leading-relaxed text-zinc-500">
										The first account becomes the{" "}
										<span className="text-zinc-300 font-medium">owner</span>.
										Everyone after joins the workspace as a team member.
									</p>
									<Button
										type="submit"
										loading={isSubmitting}
										className="h-11 w-full bg-gradient-to-r from-blue-600 to-blue-500 text-white font-medium hover:from-blue-500 hover:to-blue-400 shadow-lg shadow-blue-600/20 border-0 transition-all"
									>
										Create Account
									</Button>
								</form>
							)}
						</motion.div>
					</AnimatePresence>

					{/* Bottom tagline */}
					<motion.p
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						transition={{ delay: 0.6 }}
						className="mt-6 text-center text-[10px] text-zinc-600"
					>
						Enterprise AI agent orchestration — local-first, privacy-native.
					</motion.p>
				</div>

				{/* Bottom glow accent */}
				<div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-purple-500/30 to-transparent" />
			</motion.div>
		</div>
	);
}
