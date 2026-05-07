import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useState,
} from "react";

interface OnboardingOptions {
	companyId?: string;
	initialStep?: number;
}

interface DialogContextValue {
	onboardingOpen: boolean;
	openOnboarding: (options?: OnboardingOptions) => void;
	closeOnboarding: () => void;
	onboardingOptions: OnboardingOptions;
	commandPaletteOpen: boolean;
	openCommandPalette: () => void;
	closeCommandPalette: () => void;
	shortcutsModalOpen: boolean;
	openShortcutsModal: () => void;
	closeShortcutsModal: () => void;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: { children: ReactNode }) {
	const [onboardingOpen, setOnboardingOpen] = useState(false);
	const [onboardingOptions, setOnboardingOptions] = useState<OnboardingOptions>(
		{},
	);
	const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
	const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);

	const openOnboarding = useCallback((options: OnboardingOptions = {}) => {
		setOnboardingOptions(options);
		setOnboardingOpen(true);
	}, []);

	const closeOnboarding = useCallback(() => {
		setOnboardingOpen(false);
		setOnboardingOptions({});
	}, []);

	const openCommandPalette = useCallback(() => setCommandPaletteOpen(true), []);
	const closeCommandPalette = useCallback(
		() => setCommandPaletteOpen(false),
		[],
	);

	const openShortcutsModal = useCallback(() => setShortcutsModalOpen(true), []);
	const closeShortcutsModal = useCallback(
		() => setShortcutsModalOpen(false),
		[],
	);

	return (
		<DialogContext.Provider
			value={{
				onboardingOpen,
				openOnboarding,
				closeOnboarding,
				onboardingOptions,
				commandPaletteOpen,
				openCommandPalette,
				closeCommandPalette,
				shortcutsModalOpen,
				openShortcutsModal,
				closeShortcutsModal,
			}}
		>
			{children}
		</DialogContext.Provider>
	);
}

export function useDialog(): DialogContextValue {
	const ctx = useContext(DialogContext);
	if (!ctx) throw new Error("useDialog must be used within DialogProvider");
	return ctx;
}

/** Convenience hook returning only the action functions (no state) */
export function useDialogActions() {
	const {
		openOnboarding,
		closeOnboarding,
		openCommandPalette,
		closeCommandPalette,
		openShortcutsModal,
		closeShortcutsModal,
	} = useDialog();

	return {
		openOnboarding,
		closeOnboarding,
		openCommandPalette,
		closeCommandPalette,
		openShortcutsModal,
		closeShortcutsModal,
	};
}
