/**
 * Forgot password — two step.
 *
 * Step 1: user enters email → server returns the security question they set
 *         at register-time.
 * Step 2: user types the answer + new password → server verifies and updates.
 *
 * The server returns generic 401 if the answer is wrong so we don't leak
 * which email exists.
 */

import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Input } from "../components/ui";
import { request } from "../lib/api";

type Step = "email" | "answer" | "done";

export default function ForgotPasswordPage() {
	const navigate = useNavigate();
	const [step, setStep] = useState<Step>("email");
	const [email, setEmail] = useState("");
	const [question, setQuestion] = useState("");
	const [answer, setAnswer] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirm, setConfirm] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submitEmail(e: FormEvent) {
		e.preventDefault();
		setError(null);
		setBusy(true);
		try {
			const { securityQuestion } = await request<{
				securityQuestion: string;
			}>("/auth/forgot-password/start", {
				method: "POST",
				body: JSON.stringify({ email: email.trim() }),
			});
			setQuestion(securityQuestion);
			setStep("answer");
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: "No recovery available for this account.",
			);
		} finally {
			setBusy(false);
		}
	}

	async function submitAnswer(e: FormEvent) {
		e.preventDefault();
		setError(null);
		if (newPassword.length < 8) {
			return setError("New password must be at least 8 characters.");
		}
		if (newPassword !== confirm) return setError("Passwords do not match.");
		setBusy(true);
		try {
			await request("/auth/forgot-password/verify", {
				method: "POST",
				body: JSON.stringify({
					email: email.trim(),
					answer: answer.trim(),
					newPassword,
				}),
			});
			setStep("done");
		} catch (err) {
			setError(
				err instanceof Error ? err.message : "Recovery failed. Try again.",
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="min-h-screen bg-gradient-to-br from-[#fbf6ec] via-[#f7efe0] to-[#f1e6d0]">
			<div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 py-12">
				<div className="w-full rounded-2xl border border-[#e5d6b8] bg-white/90 p-7 shadow-[0_24px_48px_-24px_rgba(74,55,28,0.25)]">
					<h1 className="text-2xl font-semibold text-[#2b2418]">
						Recover account
					</h1>
					<p className="mt-1 text-sm text-[#5b4f3a]">
						Answer the security question you chose when you registered.
					</p>

					{step === "email" && (
						<form onSubmit={submitEmail} className="mt-6 space-y-4">
							<Field label="Email">
								<Input
									type="email"
									required
									value={email}
									onChange={(e) => setEmail(e.target.value)}
									placeholder="you@company.com"
								/>
							</Field>
							{error && <FormError>{error}</FormError>}
							<Button type="submit" disabled={busy} className="w-full">
								{busy ? "Checking..." : "Continue"}
							</Button>
						</form>
					)}

					{step === "answer" && (
						<form onSubmit={submitAnswer} className="mt-6 space-y-4">
							<div className="rounded-md border border-[#e5d6b8] bg-[#fbf6ec] px-3 py-2 text-sm text-[#3d3324]">
								<span className="font-medium">Question: </span>
								{question}
							</div>
							<Field label="Your answer">
								<Input
									required
									value={answer}
									onChange={(e) => setAnswer(e.target.value)}
								/>
							</Field>
							<Field label="New password">
								<Input
									type="password"
									required
									minLength={8}
									value={newPassword}
									onChange={(e) => setNewPassword(e.target.value)}
								/>
							</Field>
							<Field label="Confirm new password">
								<Input
									type="password"
									required
									minLength={8}
									value={confirm}
									onChange={(e) => setConfirm(e.target.value)}
								/>
							</Field>
							{error && <FormError>{error}</FormError>}
							<Button type="submit" disabled={busy} className="w-full">
								{busy ? "Updating..." : "Reset password"}
							</Button>
						</form>
					)}

					{step === "done" && (
						<div className="mt-6 space-y-4">
							<p className="rounded-md border border-[#bbd5b8] bg-[#eef7eb] px-3 py-2 text-sm text-[#2e5a23]">
								Password updated. You can sign in with your new password.
							</p>
							<Button
								onClick={() => navigate("/login", { replace: true })}
								className="w-full"
							>
								Go to sign in
							</Button>
						</div>
					)}

					<p className="mt-6 text-center text-xs text-[#6f6044]">
						<Link
							to="/login"
							className="font-medium text-[#7a5421] hover:text-[#5b3d18]"
						>
							Back to sign in
						</Link>
					</p>
				</div>
			</div>
		</div>
	);
}

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
