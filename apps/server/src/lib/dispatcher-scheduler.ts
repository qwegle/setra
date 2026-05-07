let dispatcherTickHandler: ((reason?: string) => Promise<void> | void) | null =
	null;
let tickQueued = false;

export function registerDispatcherTickHandler(
	handler: ((reason?: string) => Promise<void> | void) | null,
): void {
	dispatcherTickHandler = handler;
}

export function requestDispatcherTick(reason = "manual"): void {
	if (!dispatcherTickHandler || tickQueued) return;
	tickQueued = true;
	setTimeout(() => {
		tickQueued = false;
		const handler = dispatcherTickHandler;
		if (!handler) return;
		Promise.resolve(handler(reason)).catch((err) => {
			console.warn(`[dispatcher] scheduled tick failed (${reason}):`, err);
		});
	}, 0);
}
