import { useEffect, useRef, useState } from "react";

const SETRA_ASCII = `  ███████╗███████╗████████╗██████╗  █████╗ 
  ██╔════╝██╔════╝╚══██╔══╝██╔══██╗██╔══██╗
  ███████╗█████╗     ██║   ██████╔╝███████║
  ╚════██║██╔══╝     ██║   ██╔══██╗██╔══██║
  ███████║███████╗   ██║   ██║  ██║██║  ██║
  ╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝`;

interface AsciiArtAnimationProps {
	companyName: string;
	onComplete?: () => void;
}

export function AsciiArtAnimation({
	companyName,
	onComplete,
}: AsciiArtAnimationProps) {
	const [displayedChars, setDisplayedChars] = useState(0);
	const [showReady, setShowReady] = useState(false);
	const [showCompany, setShowCompany] = useState(false);
	const [showButton, setShowButton] = useState(false);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const total = SETRA_ASCII.length;

	useEffect(() => {
		intervalRef.current = setInterval(() => {
			setDisplayedChars((prev) => {
				if (prev >= total) {
					if (intervalRef.current) clearInterval(intervalRef.current);
					// Sequence the appearance of subsequent elements
					setTimeout(() => setShowReady(true), 200);
					setTimeout(() => setShowCompany(true), 600);
					setTimeout(() => {
						setShowButton(true);
						onComplete?.();
					}, 1000);
					return prev;
				}
				return prev + 1;
			});
		}, 18);

		return () => {
			if (intervalRef.current) clearInterval(intervalRef.current);
		};
	}, [total, onComplete]);

	const renderedAscii = SETRA_ASCII.slice(0, displayedChars);

	return (
		<div className="flex flex-col items-center justify-center gap-6 select-none">
			{/* ASCII art block */}
			<pre
				className="font-mono text-setra-400 text-sm leading-tight whitespace-pre"
				aria-hidden="true"
			>
				{renderedAscii}
				{displayedChars < total && (
					<span className="animate-pulse text-setra-300">▋</span>
				)}
			</pre>

			{/* Ready text */}
			<div
				className={`font-mono text-base text-accent-green transition-all duration-500 ${
					showReady ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
				}`}
			>
				Your company is ready.
			</div>

			{/* Company name */}
			<div
				className={`font-sans text-3xl font-bold text-foreground tracking-tight transition-all duration-500 delay-100 ${
					showCompany ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
				}`}
			>
				{companyName}
			</div>

			{/* Placeholder slot for the button rendered by parent */}
			<div
				className={`transition-all duration-500 delay-200 ${
					showButton ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"
				}`}
				id="ascii-button-slot"
			/>
		</div>
	);
}
