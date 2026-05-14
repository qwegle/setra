/**
 * Apply the user's preferred color theme to <html> before React renders.
 *
 * We default to "light" (Beacons-style cream palette). Dark mode remains
 * available as an opt-in toggle from the Settings page. The chosen value is
 * persisted under the `appearance:theme` localStorage key — the same key the
 * Settings page reads via `useLocalSetting`.
 */
type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "appearance:theme";

function readStoredPreference(): ThemePreference {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return "light";
		const parsed = JSON.parse(raw) as unknown;
		if (parsed === "light" || parsed === "dark" || parsed === "system") {
			return parsed;
		}
	} catch {
		/* fall through */
	}
	return "light";
}

function applyTheme(prefersDark: boolean): void {
	const root = document.documentElement;
	root.classList.toggle("dark", prefersDark);
	root.classList.toggle("light", !prefersDark);
}

export function bootstrapTheme(): void {
	const preference = readStoredPreference();
	if (preference === "system") {
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		applyTheme(mq.matches);
		mq.addEventListener("change", (event) => applyTheme(event.matches));
		return;
	}
	applyTheme(preference === "dark");
}
