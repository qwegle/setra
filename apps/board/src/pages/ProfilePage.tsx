import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, KeyRound, LogOut, Mail, Shield, User } from "lucide-react";
import { type FormEvent, useCallback, useRef, useState } from "react";
import { Badge, Button, Card, Input, PageHeader } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { request } from "../lib/api";
import { cn } from "../lib/utils";

export function ProfilePage() {
	const { user, logout } = useAuth();
	const qc = useQueryClient();

	const [name, setName] = useState(user?.name ?? "");
	const [email] = useState(user?.email ?? "");
	const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

	// Password change
	const [showPwSection, setShowPwSection] = useState(false);
	const [currentPw, setCurrentPw] = useState("");
	const [newPw, setNewPw] = useState("");
	const [confirmPw, setConfirmPw] = useState("");
	const [pwError, setPwError] = useState("");
	const [pwSuccess, setPwSuccess] = useState(false);

	const updateProfile = useMutation({
		mutationFn: async (data: { name: string; avatarUrl?: string | null }) =>
			request("/api/auth/profile", {
				method: "PUT",
				body: JSON.stringify(data),
			}),
		onSuccess: () => {
			setSaved(true);
			qc.invalidateQueries({ queryKey: ["auth", "me"] });
			setTimeout(() => setSaved(false), 2000);
		},
	});

	const changePassword = useMutation({
		mutationFn: async (data: {
			currentPassword: string;
			newPassword: string;
		}) =>
			request("/api/auth/change-password", {
				method: "POST",
				body: JSON.stringify(data),
			}),
		onSuccess: () => {
			setPwSuccess(true);
			setCurrentPw("");
			setNewPw("");
			setConfirmPw("");
			setPwError("");
			setTimeout(() => setPwSuccess(false), 3000);
		},
		onError: (err: Error) => {
			setPwError(err.message || "Failed to change password");
		},
	});

	const handleSave = useCallback(
		(e: FormEvent) => {
			e.preventDefault();
			updateProfile.mutate({ name: name.trim(), avatarUrl });
		},
		[name, avatarUrl, updateProfile],
	);

	const handlePasswordChange = useCallback(
		(e: FormEvent) => {
			e.preventDefault();
			setPwError("");
			if (newPw.length < 8) {
				setPwError("New password must be at least 8 characters");
				return;
			}
			if (newPw !== confirmPw) {
				setPwError("Passwords do not match");
				return;
			}
			changePassword.mutate({
				currentPassword: currentPw,
				newPassword: newPw,
			});
		},
		[currentPw, newPw, confirmPw, changePassword],
	);

	const handleAvatarClick = useCallback(() => {
		fileRef.current?.click();
	}, []);

	const handleAvatarChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = () => {
				setAvatarUrl(reader.result as string);
			};
			reader.readAsDataURL(file);
		},
		[],
	);

	const initials = (name || email || "?")
		.split(/[\s@]+/)
		.map((p) => p[0]?.toUpperCase())
		.slice(0, 2)
		.join("");

	const roleBadgeColor: Record<string, string> = {
		owner: "bg-accent-orange/20 text-accent-orange",
		admin: "bg-accent-blue/20 text-accent-blue",
		member: "bg-accent-green/20 text-accent-green",
	};

	return (
		<div className="mx-auto max-w-2xl space-y-6 p-6">
			<PageHeader
				title="Profile"
				subtitle="Manage your account settings and preferences"
			/>

			{/* Avatar & Identity */}
			<Card className="p-6">
				<div className="flex items-center gap-6">
					<button
						type="button"
						onClick={handleAvatarClick}
						className="group relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-accent-blue/20 text-2xl font-bold text-accent-blue transition-all hover:ring-2 hover:ring-accent-blue/50"
					>
						{avatarUrl ? (
							<img
								src={avatarUrl}
								alt="Avatar"
								className="h-full w-full rounded-full object-cover"
							/>
						) : (
							initials
						)}
						<div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
							<Camera className="h-5 w-5 text-white" />
						</div>
					</button>
					<input
						ref={fileRef}
						type="file"
						accept="image/*"
						className="hidden"
						onChange={handleAvatarChange}
					/>
					<div className="min-w-0">
						<h2 className="truncate text-lg font-semibold text-foreground">
							{name || email}
						</h2>
						<p className="truncate text-sm text-muted-foreground">{email}</p>
						<Badge
							className={cn(
								"mt-1 text-xs capitalize",
								roleBadgeColor[user?.role ?? "member"],
							)}
						>
							<Shield className="mr-1 h-3 w-3" />
							{user?.role ?? "member"}
						</Badge>
					</div>
				</div>
			</Card>

			{/* Edit Profile */}
			<Card className="p-6">
				<h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-foreground">
					<User className="h-4 w-4" />
					Edit Profile
				</h3>
				<form onSubmit={handleSave} className="space-y-4">
					<div>
						<label className="mb-1 block text-xs font-medium text-muted-foreground">
							Display Name
						</label>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Your name"
						/>
					</div>
					<div>
						<label className="mb-1 block text-xs font-medium text-muted-foreground">
							Email
						</label>
						<div className="flex items-center gap-2 rounded-md border border-border/50 bg-ground-800/50 px-3 py-2 text-sm text-muted-foreground">
							<Mail className="h-4 w-4" />
							{email}
						</div>
						<p className="mt-1 text-[11px] text-muted-foreground/60">
							Email cannot be changed
						</p>
					</div>
					<div className="flex items-center gap-3">
						<Button
							type="submit"
							disabled={updateProfile.isPending}
							className="bg-accent-blue text-white hover:bg-accent-blue/80"
						>
							{updateProfile.isPending ? "Saving…" : "Save Changes"}
						</Button>
						{saved && (
							<span className="text-xs text-accent-green">✓ Saved</span>
						)}
					</div>
				</form>
			</Card>

			{/* Change Password */}
			<Card className="p-6">
				<button
					type="button"
					onClick={() => setShowPwSection(!showPwSection)}
					className="flex w-full items-center justify-between text-sm font-semibold text-foreground"
				>
					<span className="flex items-center gap-2">
						<KeyRound className="h-4 w-4" />
						Change Password
					</span>
					<span className="text-xs text-muted-foreground">
						{showPwSection ? "Hide" : "Show"}
					</span>
				</button>
				{showPwSection && (
					<form onSubmit={handlePasswordChange} className="mt-4 space-y-3">
						<Input
							type="password"
							placeholder="Current password"
							value={currentPw}
							onChange={(e) => setCurrentPw(e.target.value)}
						/>
						<Input
							type="password"
							placeholder="New password (min 8 chars)"
							value={newPw}
							onChange={(e) => setNewPw(e.target.value)}
						/>
						<Input
							type="password"
							placeholder="Confirm new password"
							value={confirmPw}
							onChange={(e) => setConfirmPw(e.target.value)}
						/>
						{pwError && <p className="text-xs text-red-400">{pwError}</p>}
						{pwSuccess && (
							<p className="text-xs text-accent-green">
								✓ Password changed successfully
							</p>
						)}
						<Button
							type="submit"
							disabled={changePassword.isPending}
							className="bg-accent-orange text-white hover:bg-accent-orange/80"
						>
							{changePassword.isPending ? "Changing…" : "Update Password"}
						</Button>
					</form>
				)}
			</Card>

			{/* Danger Zone */}
			<Card className="border-red-500/20 p-6">
				<h3 className="mb-3 text-sm font-semibold text-red-400">Session</h3>
				<Button
					type="button"
					onClick={() => logout()}
					className="border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20"
				>
					<LogOut className="mr-2 h-4 w-4" />
					Sign Out
				</Button>
			</Card>
		</div>
	);
}
