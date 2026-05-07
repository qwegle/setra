/**
 * useSocket — React hook that manages the lifecycle of the IPC socket
 * and subscribes to push events from setra-core.
 *
 * Used once at the App root. All components read state from appStore.
 */

import { useEffect, useRef } from "react";
import { getClient } from "../../ipc/socket.js";
import type { SocketEvent } from "../../ipc/socket.js";
import { api } from "../../ipc/socket.js";
import { useAppStore } from "../store/appStore.js";

export function useSocket() {
	const {
		setDaemonConnected,
		setConnectionError,
		setPlots,
		setRuns,
		setGrounds,
		setLedger,
		updateRunStatus,
		appendRunOutput,
	} = useAppStore();

	const client = getClient();
	const fetchedRef = useRef(false);

	useEffect(() => {
		let active = true;

		async function connect() {
			try {
				await client.connect();
				if (!active) return;

				const status = await api.daemon.status();
				setDaemonConnected(true, status);
				setConnectionError(null);

				if (!fetchedRef.current) {
					fetchedRef.current = true;
					await fetchAll();
				}
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				setConnectionError(msg);
				setDaemonConnected(false);
			}
		}

		async function fetchAll() {
			const [plots, runs, grounds, ledger] = await Promise.allSettled([
				api.plots.list(),
				api.runs.list(),
				api.grounds.list(),
				api.ledger.summary(),
			]);

			if (plots.status === "fulfilled") setPlots(plots.value);
			if (runs.status === "fulfilled") setRuns(runs.value);
			if (grounds.status === "fulfilled") setGrounds(grounds.value);
			if (ledger.status === "fulfilled") setLedger(ledger.value);
		}

		client.on("event", (evt: SocketEvent) => {
			if (!active) return;
			switch (evt.type) {
				case "run:output":
					// Route to the pane that owns this run
					appendRunOutput(evt.plotId, evt.chunk);
					break;
				case "run:status":
					updateRunStatus(evt.plotId, evt.status);
					break;
				case "plot:update":
					api.plots
						.list()
						.then(setPlots)
						.catch(() => {});
					break;
				case "daemon:error":
					setConnectionError(evt.message);
					break;
			}
		});

		client.on("disconnect", () => {
			if (!active) return;
			setDaemonConnected(false);
			setConnectionError("Connection to setra-core lost. Reconnecting…");
			// Attempt reconnect after 2s
			setTimeout(() => {
				if (active) connect();
			}, 2000);
		});

		connect();

		return () => {
			active = false;
			client.removeAllListeners();
			client.disconnect();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);
}
