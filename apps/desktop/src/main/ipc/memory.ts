import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	type SearchResult,
	configureEmbedder,
	getMemoryStore,
} from "@setra/memory";
import { BrowserWindow, dialog, ipcMain } from "electron";

const MEMORY_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const MEMORY_MODELS_ROOT = join(homedir(), ".setra", "models");
const MEMORY_MODEL_DIR = join(
	MEMORY_MODELS_ROOT,
	...MEMORY_MODEL_ID.split("/"),
);
const MEMORY_MODEL_FILES = [
	"config.json",
	"special_tokens_map.json",
	"tokenizer.json",
	"tokenizer_config.json",
	"vocab.txt",
	"onnx/model_quantized.onnx",
] as const;

configureEmbedder({
	model: MEMORY_MODEL_ID,
	localModelPath: MEMORY_MODELS_ROOT,
	cacheDir: MEMORY_MODELS_ROOT,
	allowLocalModels: true,
	allowRemoteModels: false,
});

let memoryStoreReadyPromise: Promise<void> | null = null;
let modelDownloadPromise: Promise<MemoryModelStatus> | null = null;
let missingModelNoticeShown = false;
let lastDownloadError: string | null = null;

interface MemoryModelStatus {
	downloaded: boolean;
	downloading: boolean;
	modelId: string;
	path: string;
	message?: string;
	error?: string | null;
}

function getRequiredModelPaths(): string[] {
	return MEMORY_MODEL_FILES.map((file) => join(MEMORY_MODEL_DIR, file));
}

function hasDownloadedModel(): boolean {
	return getRequiredModelPaths().every((filePath) => {
		if (!existsSync(filePath)) return false;
		try {
			return statSync(filePath).size > 0;
		} catch {
			return false;
		}
	});
}

function getModelStatus(): MemoryModelStatus {
	if (hasDownloadedModel()) {
		return {
			downloaded: true,
			downloading: modelDownloadPromise !== null,
			modelId: MEMORY_MODEL_ID,
			path: MEMORY_MODEL_DIR,
			message: "Semantic memory model ready.",
			error: lastDownloadError,
		};
	}

	return {
		downloaded: false,
		downloading: modelDownloadPromise !== null,
		modelId: MEMORY_MODEL_ID,
		path: MEMORY_MODEL_DIR,
		message:
			modelDownloadPromise !== null
				? "Semantic memory model download is in progress."
				: "Semantic memory needs a one-time model download.",
		error: lastDownloadError,
	};
}

async function ensureMemoryStoreReady(): Promise<void> {
	if (!memoryStoreReadyPromise) {
		memoryStoreReadyPromise = getMemoryStore().init();
	}
	await memoryStoreReadyPromise;
}

async function downloadMemoryModel(): Promise<MemoryModelStatus> {
	if (hasDownloadedModel()) return getModelStatus();
	if (modelDownloadPromise) return modelDownloadPromise;

	modelDownloadPromise = (async () => {
		lastDownloadError = null;
		mkdirSync(join(MEMORY_MODEL_DIR, "onnx"), { recursive: true });

		for (const relativePath of MEMORY_MODEL_FILES) {
			const targetPath = join(MEMORY_MODEL_DIR, relativePath);
			if (existsSync(targetPath) && statSync(targetPath).size > 0) continue;

			const response = await fetch(
				`https://huggingface.co/${MEMORY_MODEL_ID}/resolve/main/${relativePath}`,
			);
			if (!response.ok) {
				throw new Error(
					`Failed to download ${relativePath} (${response.status} ${response.statusText})`,
				);
			}

			const buffer = Buffer.from(await response.arrayBuffer());
			mkdirSync(dirname(targetPath), { recursive: true });
			writeFileSync(targetPath, buffer);
		}

		return getModelStatus();
	})()
		.catch((error: unknown) => {
			lastDownloadError =
				error instanceof Error ? error.message : String(error);
			throw error;
		})
		.finally(() => {
			modelDownloadPromise = null;
		});

	return modelDownloadPromise;
}

function maybeNotifyModelDownload(): void {
	if (missingModelNoticeShown) return;
	missingModelNoticeShown = true;

	const targetWindow =
		BrowserWindow.getFocusedWindow() ??
		BrowserWindow.getAllWindows()[0] ??
		undefined;
	void dialog
		.showMessageBox(targetWindow as Electron.BrowserWindow, {
			type: "info",
			buttons: ["OK"],
			title: "Download semantic memory model",
			message: "Semantic memory is downloading its local model.",
			detail:
				"Setra keeps the 22 MB ONNX model out of the app bundle. It is being downloaded to ~/.setra/models/ and memory results will appear once the download finishes.",
		})
		.catch(() => {});
}

async function ensureModelOrReturnUnavailable<T>(
	fallback: T,
): Promise<T | null> {
	await ensureMemoryStoreReady();
	if (hasDownloadedModel()) return null;
	void downloadMemoryModel().catch(() => {});
	maybeNotifyModelDownload();
	return fallback;
}

export function registerMemoryHandlers(): void {
	ipcMain.handle(
		"memory:add",
		async (
			_e,
			input: {
				content: string;
				metadata?: Record<string, unknown>;
				context?: { sessionId?: string; plotId?: string; agentId?: string };
			},
		) => {
			const unavailable = await ensureModelOrReturnUnavailable({
				id: "",
				message: getModelStatus().message,
			});
			if (unavailable) return unavailable;

			const id = await getMemoryStore().add(
				input.content,
				input.metadata,
				input.context,
			);
			return { id };
		},
	);

	ipcMain.handle(
		"memory:search",
		async (
			_e,
			input: {
				query: string;
				limit?: number;
				minScore?: number;
				plotId?: string;
				sessionId?: string;
			},
		): Promise<SearchResult[]> => {
			const unavailable = await ensureModelOrReturnUnavailable(
				[] as SearchResult[],
			);
			if (unavailable) return unavailable;

			return getMemoryStore().search(input.query, {
				...(input.limit !== undefined ? { limit: input.limit } : {}),
				...(input.minScore !== undefined ? { minScore: input.minScore } : {}),
				...(input.plotId !== undefined ? { plotId: input.plotId } : {}),
				...(input.sessionId !== undefined
					? { sessionId: input.sessionId }
					: {}),
			});
		},
	);

	ipcMain.handle("memory:delete", async (_e, input: { id: string }) => {
		await ensureMemoryStoreReady();
		await getMemoryStore().delete(input.id);
	});

	ipcMain.handle(
		"memory:clear",
		async (_e, input: { plotId?: string } = {}) => {
			await ensureMemoryStoreReady();
			await getMemoryStore().clear(input.plotId);
		},
	);

	ipcMain.handle("memory:count", async () => {
		await ensureMemoryStoreReady();
		return getMemoryStore().count();
	});

	ipcMain.handle("memory:model-status", async () => {
		await ensureMemoryStoreReady();
		return getModelStatus();
	});

	ipcMain.handle("memory:download-model", async () => {
		await ensureMemoryStoreReady();
		return downloadMemoryModel();
	});
}
