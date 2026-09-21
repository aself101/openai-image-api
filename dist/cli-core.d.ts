/**
 * OpenAI Image Generation - CLI core
 *
 * Everything the `openai-img` binary does, minus process.argv and
 * process.exit, so it can be imported and unit-tested. `src/cli.ts` is the thin
 * bin entry that wires those two in.
 *
 * Command-line tool for generating and editing images with OpenAI's GPT Image
 * models (gpt-image-2.5-sunburst, gpt-image-2.5-flare, gpt-image-2, and the
 * deprecated gpt-image-1.5 / gpt-image-1 / gpt-image-1-mini).
 *
 * Usage:
 *   openai-img --prompt "a cat"                              # default: gpt-image-2.5-flare
 *   openai-img --sunburst --prompt "a cat" --quality max
 *   openai-img --gpt-image-2 --prompt "a poster" --size 2048x1152
 *   openai-img --edit --image photo.png --prompt "add a hat"
 *   openai-img --stream --partial-images 2 --prompt "a river of feathers"
 *   openai-img --model gpt-image-2.5-flare-2026-09-08 --prompt "pinned snapshot"
 */
import { Command } from 'commander';
import { OpenAIImageAPI } from './api.js';
import type { ImageModel, ImageQuality, ImageBackground, ImageOutputFormat, ImageModeration, InputFidelity, LogLevel, ImagePartialImageEvent, ImageResponse, StreamImageParams, StreamEditImageParams } from './types.js';
/**
 * Format an error for the terminal. When the message was sanitized
 * (NODE_ENV=production) the API's own reason is still on apiMessage; a CI
 * runner needs that line to tell a moderation block from a bad size.
 */
export declare function describeError(error: unknown): string;
/** CLI Options interface */
export interface CLIOptions {
    model?: string;
    sunburst?: boolean;
    flare?: boolean;
    gptImage2?: boolean;
    gptImage15?: boolean;
    gptImage1?: boolean;
    gptImage1Mini?: boolean;
    edit?: boolean;
    stream?: boolean;
    partialImages?: number;
    /** commander's --no-validate sets `validate: false`; default true */
    validate: boolean;
    prompt: string[];
    image: string[];
    mask?: string;
    size?: string;
    quality?: ImageQuality;
    n?: number;
    user?: string;
    background?: ImageBackground;
    moderation?: ImageModeration;
    outputFormat?: ImageOutputFormat;
    outputCompression?: number;
    inputFidelity?: InputFidelity;
    apiKey?: string;
    outputDir?: string;
    logLevel: LogLevel;
    dryRun?: boolean;
    examples?: boolean;
}
/**
 * Validate commander's untyped option bag into CLIOptions field by field.
 */
export declare function readOptions(raw: Record<string, unknown>): CLIOptions;
/**
 * Display usage examples.
 */
export declare function showExamples(): void;
/**
 * Resolve the model from flags. `--model` wins over shortcut flags.
 */
export declare function resolveModel(options: CLIOptions): ImageModel;
/**
 * Run exactly the pre-flight a real request would run — key, prompt, constraint
 * table, and for edits every input file opened and header-checked — without
 * sending anything. Through 2.1.1 the dry-run path never validated; through
 * 3.0.0-rc it ran only the constraint table, so a missing prompt or a
 * nonexistent --image passed dry-run and failed the real call.
 */
export declare function dryRun(job: RequestJob, validate: boolean): Promise<void>;
/**
 * Persist images and a metadata sidecar for one completed request.
 */
export declare function persistResult(api: OpenAIImageAPI, response: ImageResponse, outputDir: string, model: ImageModel, operation: 'generate' | 'edit', baseFilename: string, parameters: StreamImageParams | StreamEditImageParams, requestedFormat: string | undefined, partialPaths: string[]): Promise<{
    savedPaths: string[];
    metadataPath: string;
}>;
/**
 * Filename stem for one request. Computed once so partial frames, the final
 * image, and the metadata sidecar share a timestamp and sort together.
 */
export declare function requestStem(prompt: string, tag: string): string;
/**
 * Build an onPartialImage handler that writes each frame beside the final image.
 */
export declare function partialImageWriter(outputDir: string, stem: string, format: string, sink: string[]): (event: ImagePartialImageEvent) => Promise<void>;
/** One request's worth of inputs, shared by the edit and generate paths */
export type RequestJob = {
    api: OpenAIImageAPI;
    model: ImageModel;
    prompt: string;
    outputDir: string;
    stream: boolean;
    outputFormat: ImageOutputFormat | undefined;
} & ({
    operation: 'generate';
    params: StreamImageParams;
} | {
    operation: 'edit';
    params: StreamEditImageParams;
});
/**
 * Execute one generate or edit request end to end: spinner, (streaming) call,
 * partial-frame capture, persistence, and the success summary. Throws on
 * failure after stopping the spinner; the caller decides whether to continue.
 */
export declare function runRequest(job: RequestJob): Promise<void>;
/**
 * Build the commander program. `version` is injected by the bin entry, which
 * is the only place that knows where package.json is.
 */
export declare function buildProgram(version: string): Command;
/**
 * Run the CLI against an argv. Returns the process exit code instead of
 * calling process.exit, so tests can drive it in-process.
 *
 * @param argv - Full argv including the node and script entries
 * @param version - Package version for --version
 * @returns Exit code: 0 on success, 1 on any failure
 */
export declare function runCli(argv: string[], version: string): Promise<number>;
/**
 * Cross-flag checks that commander cannot express. Returns the resolved model
 * and operation.
 *
 * @throws Error On a flag combination the CLI cannot act on
 */
export declare function validateOptions(options: CLIOptions): {
    model: ImageModel;
    operation: 'generate' | 'edit';
};
/**
 * Resolve and create the output directory. A user-supplied path is checked for
 * traversal; the default is `<OPENAI_OUTPUT_DIR|datasets/openai>/<model>`.
 */
export declare function resolveOutputDir(options: CLIOptions, model: ImageModel): Promise<string>;
/**
 * Turn parsed options into one job per prompt. Edits take the first prompt
 * only; generation batches over every prompt.
 */
export declare function buildJobs(options: CLIOptions, ctx: {
    api: OpenAIImageAPI;
    model: ImageModel;
    operation: 'generate' | 'edit';
    outputDir: string;
}): RequestJob[];
/**
 * Run every job in order, continuing past failures when there is more than
 * one. Returns the exit code: 1 if any job failed (the failures are listed),
 * 0 otherwise. Dry runs validate and print instead of calling the API.
 */
export declare function runBatch(jobs: RequestJob[], options: CLIOptions): Promise<number>;
//# sourceMappingURL=cli-core.d.ts.map