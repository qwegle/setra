// Uses @xenova/transformers for 100% local, offline embeddings.
// Model: Xenova/all-MiniLM-L6-v2 (22MB, downloaded lazily to ~/.setra/models/)
// Produces 384-dimensional float32 vectors.
//
// Note: @xenova/transformers is pure ESM. We use a dynamic import() so this
// module is safe to load from a CJS context (Electron main process).

import type { FeatureExtractionPipeline } from "@xenova/transformers";

export interface EmbedderConfig {
	model?: string;
	localModelPath?: string;
	cacheDir?: string;
	allowRemoteModels?: boolean;
	allowLocalModels?: boolean;
}

let _pipeline: FeatureExtractionPipeline | null = null;
let _modelId = "Xenova/all-MiniLM-L6-v2";
let _config: EmbedderConfig = {
	allowRemoteModels: true,
	allowLocalModels: true,
};

export function configureEmbedder(config: EmbedderConfig): void {
	_config = { ..._config, ...config };
	if (config.model) _modelId = config.model;
}

export async function initEmbedder(model?: string): Promise<void> {
	if (_pipeline) return;
	if (model) _modelId = model;

	// Dynamic import keeps this ESM-only package out of the CJS require graph.
	const { pipeline, env } = await import("@xenova/transformers");

	if (_config.localModelPath) env.localModelPath = _config.localModelPath;
	if (_config.cacheDir) env.cacheDir = _config.cacheDir;
	if (_config.allowRemoteModels !== undefined) {
		env.allowRemoteModels = _config.allowRemoteModels;
	}
	if (_config.allowLocalModels !== undefined) {
		env.allowLocalModels = _config.allowLocalModels;
	}

	_pipeline = (await pipeline("feature-extraction", _modelId, {
		quantized: true,
	})) as FeatureExtractionPipeline;
}

export async function embed(text: string): Promise<Float32Array> {
	if (!_pipeline) await initEmbedder();
	const output = await _pipeline!(text, { pooling: "mean", normalize: true });
	return new Float32Array(output.data as ArrayBuffer | Float32Array);
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
	if (!_pipeline) await initEmbedder();
	const results: Float32Array[] = [];
	for (const text of texts) {
		const output = await _pipeline!(text, { pooling: "mean", normalize: true });
		results.push(new Float32Array(output.data as ArrayBuffer | Float32Array));
	}
	return results;
}
