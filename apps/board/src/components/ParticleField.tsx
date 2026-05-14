/**
 * Animated particle constellation, cream-palette.
 *
 * Soft warm dots float and connect with thin lines when close; cursor
 * proximity gently brightens nearby particles. Pure canvas (no React tree
 * updates per frame) so it stays cheap.
 */

import { useCallback, useEffect, useRef } from "react";

interface Particle {
	x: number;
	y: number;
	vx: number;
	vy: number;
	r: number;
	opacity: number;
}

export function ParticleField() {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const particles = useRef<Particle[]>([]);
	const raf = useRef(0);
	const mouse = useRef({ x: -999, y: -999 });

	const init = useCallback(() => {
		const cvs = canvasRef.current;
		if (!cvs) return;
		const w = window.innerWidth;
		const h = window.innerHeight;
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		cvs.width = w * dpr;
		cvs.height = h * dpr;
		cvs.style.width = `${w}px`;
		cvs.style.height = `${h}px`;
		const ctx = cvs.getContext("2d");
		if (ctx) ctx.scale(dpr, dpr);
		const count = Math.min(Math.floor((w * h) / 9000), 110);
		particles.current = Array.from({ length: count }, () => ({
			x: Math.random() * w,
			y: Math.random() * h,
			vx: (Math.random() - 0.5) * 0.3,
			vy: (Math.random() - 0.5) * 0.3,
			r: Math.random() * 1.6 + 0.6,
			opacity: Math.random() * 0.4 + 0.15,
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
			const w = cvs.clientWidth;
			const h = cvs.clientHeight;
			ctx.clearRect(0, 0, w, h);

			const pts = particles.current;
			const mx = mouse.current.x;
			const my = mouse.current.y;

			for (let i = 0; i < pts.length; i++) {
				const p = pts[i];
				if (!p) continue;
				p.x += p.vx;
				p.y += p.vy;
				if (p.x < 0) p.x = w;
				if (p.x > w) p.x = 0;
				if (p.y < 0) p.y = h;
				if (p.y > h) p.y = 0;

				const dm = Math.hypot(p.x - mx, p.y - my);
				const glow = dm < 180 ? 1 - dm / 180 : 0;
				const alpha = Math.min(p.opacity + glow * 0.55, 0.85);

				ctx.beginPath();
				ctx.arc(p.x, p.y, p.r + glow * 1.4, 0, Math.PI * 2);
				ctx.fillStyle = `rgba(122,84,33,${alpha})`;
				ctx.fill();

				for (let j = i + 1; j < pts.length; j++) {
					const q = pts[j];
					if (!q) continue;
					const dx = p.x - q.x;
					const dy = p.y - q.y;
					const dist = Math.hypot(dx, dy);
					if (dist < 130) {
						ctx.beginPath();
						ctx.moveTo(p.x, p.y);
						ctx.lineTo(q.x, q.y);
						ctx.strokeStyle = `rgba(181,138,76,${0.10 * (1 - dist / 130)})`;
						ctx.lineWidth = 0.6;
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
			aria-hidden
			className="pointer-events-none absolute inset-0 z-0"
		/>
	);
}
