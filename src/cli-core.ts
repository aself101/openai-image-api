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
import path from 'path';
import { OpenAIImageAPI, OpenAIImageAPIError } from './api.js';
import {
  generateTimestampedFilename,
  writeToFile,
  ensureDirectory,
  setLogLevel,
  createSpinner,
  logger,
  decodeBase64Image,
  validateOutputPath,
  getErrorMessage,
} from './utils.js';
import {
  getOutputDir,
  getModelConstraints,
  getModelDeprecation,
  isSupportedModel,
  unknownModelMessage,
  deprecationNotice,
  MODELS,
  MODEL_DEPRECATIONS,
  DEFAULT_MODEL,
} from './config.js';
import type {
  ImageModel,
  ImageQuality,
  ImageBackground,
  ImageOutputFormat,
  ImageModeration,
  InputFidelity,
  LogLevel,
  ImagePartialImageEvent,
  ImageResponse,
  StreamImageParams,
  StreamEditImageParams,
} from './types.js';

/**
 * Format an error for the terminal. When the message was sanitized
 * (NODE_ENV=production) the API's own reason is still on apiMessage; a CI
 * runner needs that line to tell a moderation block from a bad size.
 */
export function describeError(error: unknown): string {
  const message = getErrorMessage(error);
  if (error instanceof OpenAIImageAPIError) {
    const extra: string[] = [];
    if (error.apiMessage && !message.includes(error.apiMessage)) extra.push(`API: ${error.apiMessage}`);
    if (error.code) extra.push(`code: ${error.code}`);
    if (error.type && error.status !== undefined) extra.push(`type: ${error.type}`);
    return extra.length ? `${message} (${extra.join('; ')})` : message;
  }
  return message;
}

/** CLI Options interface */
export interface CLIOptions {
  // Model selection
  model?: string;
  sunburst?: boolean;
  flare?: boolean;
  gptImage2?: boolean;
  gptImage15?: boolean;
  gptImage1?: boolean;
  gptImage1Mini?: boolean;

  // Operation mode
  edit?: boolean;
  stream?: boolean;
  partialImages?: number;
  /** commander's --no-validate sets `validate: false`; default true */
  validate: boolean;

  // Common parameters
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

  // API and output
  apiKey?: string;
  outputDir?: string;
  logLevel: LogLevel;
  dryRun?: boolean;
  examples?: boolean;
}

const LOG_LEVELS: readonly LogLevel[] = ['DEBUG', 'INFO', 'WARNING', 'ERROR'];
const QUALITIES: readonly ImageQuality[] = ['auto', 'low', 'medium', 'high', 'xhigh', 'max'];
const BACKGROUNDS: readonly ImageBackground[] = ['auto', 'transparent', 'opaque'];
const MODERATIONS: readonly ImageModeration[] = ['auto', 'low'];
const OUTPUT_FORMATS: readonly ImageOutputFormat[] = ['png', 'jpeg', 'webp'];
const INPUT_FIDELITIES: readonly InputFidelity[] = ['high', 'low'];

/** Render an arbitrary flag value for an error message without '[object Object]' */
function describeValue(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
      return value.toString();
    case 'symbol':
      return value.toString();
    case 'undefined':
      return 'undefined';
    default:
      return JSON.stringify(value) ?? 'undefined';
  }
}

/**
 * Narrow a raw flag value to one of an allowed set, or fail with the set.
 *
 * Commander hands back untyped strings; casting them to the literal unions the
 * API expects would let `--quality bogus` type-check. Membership is checked
 * here so the value is genuinely narrowed. Per-model rules (e.g. `max` only on
 * 2.5) are still enforced by validateModelParams downstream.
 */
export function oneOf<T extends string>(value: unknown, allowed: readonly T[], flag: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`Invalid value "${describeValue(value)}" for ${flag}. Valid options: ${allowed.join(', ')}`);
}

/** Read an optional string flag */
export function optString(value: unknown, flag: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  throw new Error(`${flag} expects a string`);
}

/** Read an optional integer flag (commander's parseInt yields NaN on junk) */
export function optInt(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  throw new Error(`${flag} expects an integer`);
}

/** Read a repeatable string flag */
export function stringList(value: unknown, flag: string): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value;
  throw new Error(`${flag} expects one or more strings`);
}

/**
 * Validate commander's untyped option bag into CLIOptions field by field.
 */
export function readOptions(raw: Record<string, unknown>): CLIOptions {
  const logLevel = oneOf(
    typeof raw.logLevel === 'string' ? raw.logLevel.toUpperCase() : raw.logLevel,
    LOG_LEVELS,
    '--log-level'
  );
  return {
    model: optString(raw.model, '--model'),
    sunburst: Boolean(raw.sunburst),
    flare: Boolean(raw.flare),
    gptImage2: Boolean(raw.gptImage2),
    gptImage15: Boolean(raw.gptImage15),
    gptImage1: Boolean(raw.gptImage1),
    gptImage1Mini: Boolean(raw.gptImage1Mini),
    edit: Boolean(raw.edit),
    stream: Boolean(raw.stream),
    validate: raw.validate !== false,
    partialImages: optInt(raw.partialImages, '--partial-images'),
    prompt: stringList(raw.prompt, '--prompt'),
    image: stringList(raw.image, '--image'),
    mask: optString(raw.mask, '--mask'),
    size: optString(raw.size, '--size'),
    quality: oneOf(raw.quality, QUALITIES, '--quality'),
    n: optInt(raw.n, '--n'),
    user: optString(raw.user, '--user'),
    background: oneOf(raw.background, BACKGROUNDS, '--background'),
    moderation: oneOf(raw.moderation, MODERATIONS, '--moderation'),
    outputFormat: oneOf(raw.outputFormat, OUTPUT_FORMATS, '--output-format'),
    outputCompression: optInt(raw.outputCompression, '--output-compression'),
    inputFidelity: oneOf(raw.inputFidelity, INPUT_FIDELITIES, '--input-fidelity'),
    apiKey: optString(raw.apiKey, '--api-key'),
    outputDir: optString(raw.outputDir, '--output-dir'),
    logLevel: logLevel ?? 'INFO',
    dryRun: Boolean(raw.dryRun),
    examples: Boolean(raw.examples),
  };
}

/**
 * Display usage examples.
 */
export function showExamples(): void {
  console.log(`
${'='.repeat(70)}
OPENAI IMAGE GENERATION - USAGE EXAMPLES
${'='.repeat(70)}

1. Default model (gpt-image-2.5-flare) - basic text-to-image
   $ openai-img --prompt "a serene mountain landscape at sunset"

2. Sunburst - precise, high-quality render
   $ openai-img --sunburst \\
       --prompt "photorealistic portrait of an astronaut" \\
       --size 1024x1536 \\
       --quality max

3. Flexible sizes (gpt-image-2 and 2.5) - 2K landscape
   $ openai-img --gpt-image-2 \\
       --prompt "wide cinematic desert vista" \\
       --size 2048x1152 \\
       --quality high

4. Transparent background (png or webp only)
   $ openai-img --flare \\
       --prompt "a cute robot character" \\
       --background transparent \\
       --output-format png

5. Compressed webp output
   $ openai-img --flare \\
       --prompt "abstract digital art" \\
       --output-format webp \\
       --output-compression 85 \\
       --quality medium

6. Streaming with partial images
   $ openai-img --stream --partial-images 2 \\
       --prompt "a river made of white owl feathers, winter landscape"

7. Image editing with a mask
   $ openai-img --edit \\
       --image photo.png \\
       --mask mask.png \\
       --prompt "add snow and winter atmosphere"

8. Multi-image editing (up to 16 inputs)
   $ openai-img --sunburst --edit \\
       --image image1.png \\
       --image image2.png \\
       --image image3.png \\
       --prompt "combine these into a collage"

9. Batch generation with multiple prompts
   $ openai-img \\
       --prompt "a red apple" \\
       --prompt "a green pear" \\
       --prompt "a yellow banana"

10. Low moderation
    $ openai-img --flare \\
        --prompt "surreal artistic scene" \\
        --moderation low

11. Save to custom directory
    $ openai-img \\
        --prompt "sunset over ocean" \\
        --output-dir ./my-images

12. Pin a dated snapshot
    $ openai-img --model gpt-image-2.5-flare-2026-09-08 \\
        --prompt "reproducible render"

${'='.repeat(70)}
MODEL COMPARISON
${'='.repeat(70)}

gpt-image-2.5-sunburst:
  - Sizes: 1024x1024, 1536x1024, 1024x1536, auto, or any WxH (see below)
  - Quality: auto, low, medium, high, xhigh, max
  - Best for: editing precision

gpt-image-2.5-flare (default):
  - Sizes: as Sunburst
  - Quality: auto, low, medium, high, xhigh, max
  - Best for: fast, high-quality everyday generation

gpt-image-2:
  - Sizes: as above; up to 3840x2160 (4K)
  - Quality: auto, low, medium, high

Note: input_fidelity is accepted by the gpt-image-1.x models only; gpt-image-2
and the 2.5 models process inputs at high fidelity automatically.

gpt-image-1.5, gpt-image-1, gpt-image-1-mini (deprecated):
  - Sizes: 1024x1024, 1536x1024, 1024x1536, auto
  - Quality: auto, low, medium, high
  - Shutdown: gpt-image-1 on ${MODEL_DEPRECATIONS['gpt-image-1']?.shutdown}; 1.5 and 1-mini on ${MODEL_DEPRECATIONS['gpt-image-1.5']?.shutdown}

Newer than this release? Pass --model <id> --no-validate to send an id or
parameter the catalogue does not know; the API's own answer comes back.

Flexible size rules (gpt-image-2 / 2.5):
  - Width and height multiples of 16
  - Aspect ratio between 1:3 and 3:1
  - No edge above 3840px; total pixels 655,360 - 8,294,400
  - Above 2560x1440 is experimental

${'='.repeat(70)}
`);
}

/**
 * Resolve the model from flags. `--model` wins over shortcut flags.
 */
export function resolveModel(options: CLIOptions): ImageModel {
  if (options.model) {
    if (!isSupportedModel(options.model)) {
      if (options.validate) {
        throw new Error(`${unknownModelMessage(options.model)}\n  (pass --no-validate to send it to the API anyway)`);
      }
      // The API class logs the "not in this package's catalogue" warning when
      // the request is built; warning here too printed it twice.
      // SAFETY: --no-validate is the caller's explicit choice to let the API judge the id
      return options.model as ImageModel;
    }
    return options.model;
  }
  if (options.sunburst) return MODELS.sunburst;
  if (options.flare) return MODELS.flare;
  if (options.gptImage2) return MODELS['gpt-image-2'];
  if (options.gptImage15) return MODELS['gpt-image-1.5'];
  if (options.gptImage1) return MODELS['gpt-image-1'];
  if (options.gptImage1Mini) return MODELS['gpt-image-1-mini'];
  return DEFAULT_MODEL;
}

/**
 * Run exactly the pre-flight a real request would run — key, prompt, constraint
 * table, and for edits every input file opened and header-checked — without
 * sending anything. Through 2.1.1 the dry-run path never validated; through
 * 3.0.0-rc it ran only the constraint table, so a missing prompt or a
 * nonexistent --image passed dry-run and failed the real call.
 */
export async function dryRun(job: RequestJob, validate: boolean): Promise<void> {
  await job.api.validateRequest(job.params, { streaming: job.stream });
  logger.info(
    validate
      ? 'Dry run - request validated successfully:'
      : 'Dry run - constraint check skipped (--no-validate); inputs verified; parameters as they would be sent:'
  );
  logger.info(JSON.stringify(job.params, null, 2));
}

/**
 * Persist images and a metadata sidecar for one completed request.
 */
export async function persistResult(
  api: OpenAIImageAPI,
  response: ImageResponse,
  outputDir: string,
  model: ImageModel,
  operation: 'generate' | 'edit',
  baseFilename: string,
  parameters: StreamImageParams | StreamEditImageParams,
  requestedFormat: string | undefined,
  partialPaths: string[]
): Promise<{ savedPaths: string[]; metadataPath: string }> {
  const outputFormat = requestedFormat ?? response.output_format ?? 'png';

  const savedPaths = await api.saveImages(response, outputDir, baseFilename, outputFormat);

  const metadataPath = path.join(outputDir, `${baseFilename}_metadata.json`);
  await writeToFile(
    {
      model,
      operation,
      timestamp: new Date().toISOString(),
      parameters,
      response: {
        created: response.created,
        images: savedPaths,
        partial_images: partialPaths.length > 0 ? partialPaths : undefined,
        usage: response.usage,
        output_format: response.output_format,
        quality: response.quality,
        size: response.size,
        background: response.background,
      },
    },
    metadataPath
  );

  return { savedPaths, metadataPath };
}

/**
 * Filename stem for one request. Computed once so partial frames, the final
 * image, and the metadata sidecar share a timestamp and sort together.
 */
export function requestStem(prompt: string, tag: string): string {
  return generateTimestampedFilename(prompt, tag, 'png').replace(/\.png$/, '');
}

/**
 * Build an onPartialImage handler that writes each frame beside the final image.
 */
export function partialImageWriter(outputDir: string, stem: string, format: string, sink: string[]) {
  return async (event: ImagePartialImageEvent): Promise<void> => {
    const filepath = path.join(outputDir, `${stem}_partial_${event.partial_image_index}.${format}`);
    await decodeBase64Image(event.b64_json, filepath);
    sink.push(filepath);
    logger.info(`  partial image ${event.partial_image_index} → ${filepath}`);
  };
}

/** One request's worth of inputs, shared by the edit and generate paths */
export type RequestJob = {
  api: OpenAIImageAPI;
  model: ImageModel;
  prompt: string;
  outputDir: string;
  stream: boolean;
  outputFormat: ImageOutputFormat | undefined;
} & ({ operation: 'generate'; params: StreamImageParams } | { operation: 'edit'; params: StreamEditImageParams });

/**
 * Execute one generate or edit request end to end: spinner, (streaming) call,
 * partial-frame capture, persistence, and the success summary. Throws on
 * failure after stopping the spinner; the caller decides whether to continue.
 */
export async function runRequest(job: RequestJob): Promise<void> {
  const { api, model, operation, prompt, outputDir, stream, outputFormat } = job;
  const tag = operation === 'edit' ? `${model}-edit` : model;
  const stem = requestStem(prompt, tag);
  const partialPaths: string[] = [];
  const spinner = createSpinner(operation === 'edit' ? 'Editing image' : 'Generating image').start();

  try {
    const handlers = { onPartialImage: partialImageWriter(outputDir, stem, outputFormat ?? 'png', partialPaths) };
    let response: ImageResponse;
    if (job.operation === 'edit') {
      response = stream
        ? await api.generateImageEditStream(job.params, handlers)
        : await api.generateImageEdit(job.params);
    } else {
      response = stream ? await api.generateImageStream(job.params, handlers) : await api.generateImage(job.params);
    }

    spinner.stop(operation === 'edit' ? 'Image edit complete' : 'Image generation complete');

    const { savedPaths, metadataPath } = await persistResult(
      api,
      response,
      outputDir,
      model,
      operation,
      stem,
      job.params,
      outputFormat,
      partialPaths
    );

    logger.info(`\n✓ Success! Generated ${savedPaths.length} ${operation === 'edit' ? 'edited ' : ''}image(s):`);
    savedPaths.forEach((p: string) => logger.info(`  - ${p}`));
    logger.info(`  - ${metadataPath}`);
  } catch (error) {
    spinner.fail(`${operation === 'edit' ? 'Edit' : 'Generation'} failed: ${describeError(error)}`);
    throw error;
  }
}

/**
 * Build the commander program. `version` is injected by the bin entry, which
 * is the only place that knows where package.json is.
 */
export function buildProgram(version: string): Command {
  const program = new Command();
  program.name('openai-img').description('OpenAI Image Generation CLI - GPT Image models').version(version);

  // Model selection
  program
    .option('--model <id>', 'Model identifier (canonical or dated snapshot); overrides shortcut flags')
    .option('--sunburst', 'Use gpt-image-2.5-sunburst (editing precision)')
    .option('--flare', 'Use gpt-image-2.5-flare (fast, high quality; default)')
    .option('--gpt-image-2', 'Use gpt-image-2')
    .option(
      '--gpt-image-15',
      `Use gpt-image-1.5 (deprecated, shutdown ${MODEL_DEPRECATIONS['gpt-image-1.5']?.shutdown})`
    )
    .option('--gpt-image-1', `Use gpt-image-1 (deprecated, shutdown ${MODEL_DEPRECATIONS['gpt-image-1']?.shutdown})`)
    .option(
      '--gpt-image-1-mini',
      `Use gpt-image-1-mini (deprecated, shutdown ${MODEL_DEPRECATIONS['gpt-image-1-mini']?.shutdown})`
    );

  // Operation mode
  program
    .option('--edit', 'Edit existing image(s) with prompt')
    .option('--stream', 'Stream the response, saving partial images as they arrive')
    .option('--partial-images <n>', 'Number of partial images to stream, 0-3 (requires --stream)', parseInt)
    .option(
      '--no-validate',
      'Skip the client-side constraint check and let the API judge (for models or limits newer than this release)'
    );

  // Common parameters
  program
    .option(
      '--prompt <text>',
      'Text prompt (can specify multiple for batch generation)',
      (value: string, previous: string[]) => {
        return previous ? [...previous, value] : [value];
      },
      [] as string[]
    )
    .option(
      '--image <path>',
      'Input image path for --edit (repeat for up to 16 images)',
      (value: string, previous: string[]) => {
        return previous ? [...previous, value] : [value];
      },
      [] as string[]
    )
    .option('--mask <path>', 'Mask image path for editing')
    .option('--size <size>', 'Image size: WIDTHxHEIGHT or auto (e.g. 1024x1024, 2048x1152)')
    .option('--quality <quality>', 'Quality: auto, low, medium, high; xhigh, max on 2.5 models')
    .option('--n <number>', 'Number of images to generate (1-10)', parseInt)
    .option('--background <bg>', 'Background: auto, transparent, or opaque')
    .option('--moderation <level>', 'Moderation: auto or low')
    .option('--output-format <format>', 'Output format: png, jpeg, or webp')
    .option('--output-compression <percent>', 'Compression 0-100 (jpeg/webp only)', parseInt)
    .option('--input-fidelity <level>', 'Input fidelity for --edit: high or low (gpt-image-1.x only)')
    .option('--user <id>', 'End-user identifier for abuse monitoring');

  // API and output configuration
  program
    .option(
      '--api-key <key>',
      'OpenAI API key (overrides environment variable). Visible to other users of a shared host via the process list; prefer OPENAI_API_KEY or ~/.openai/.env there'
    )
    .option('--output-dir <path>', 'Output directory for generated images')
    .option('--log-level <level>', 'Log level: DEBUG, INFO, WARNING, ERROR', 'INFO')
    .option('--dry-run', 'Validate parameters without making API call')
    .option('--examples', 'Show usage examples');
  return program;
}

/**
 * Run the CLI against an argv. Returns the process exit code instead of
 * calling process.exit, so tests can drive it in-process.
 *
 * @param argv - Full argv including the node and script entries
 * @param version - Package version for --version
 * @returns Exit code: 0 on success, 1 on any failure
 */
export async function runCli(argv: string[], version: string): Promise<number> {
  const program = buildProgram(version);
  program.parse(argv);

  let options: CLIOptions;
  try {
    options = readOptions(program.opts());
  } catch (error) {
    logger.error(`\n✗ Error: ${getErrorMessage(error)}\n`);
    return 1;
  }

  try {
    if (options.examples) {
      showExamples();
      return 0;
    }
    if (argv.slice(2).length === 0) {
      program.outputHelp();
      return 0;
    }

    setLogLevel(options.logLevel);

    const { model, operation } = validateOptions(options);

    const deprecation = getModelDeprecation(model);
    if (deprecation) logger.warn(deprecationNotice(model, deprecation));
    if (options.apiKey) {
      logger.warn('--api-key is visible in the process list on shared hosts; prefer OPENAI_API_KEY or ~/.openai/.env');
    }

    const api = new OpenAIImageAPI({
      apiKey: options.apiKey,
      logLevel: options.logLevel,
      skipValidation: !options.validate,
    });

    const outputDir = await resolveOutputDir(options, model);
    logger.info(`Using model: ${model}`);
    logger.info(`Operation: ${operation}${options.stream ? ' (streaming)' : ''}`);
    logger.info(`Output directory: ${outputDir}`);

    const jobs = buildJobs(options, { api, model, operation, outputDir });
    return await runBatch(jobs, options);
  } catch (error) {
    logger.error(`\n✗ Error: ${describeError(error)}\n`);
    return 1;
  }
}

/**
 * Cross-flag checks that commander cannot express. Returns the resolved model
 * and operation.
 *
 * @throws Error On a flag combination the CLI cannot act on
 */
export function validateOptions(options: CLIOptions): { model: ImageModel; operation: 'generate' | 'edit' } {
  const model = resolveModel(options);
  const operation: 'generate' | 'edit' = options.edit ? 'edit' : 'generate';
  const constraints = getModelConstraints(model);

  if (operation === 'edit' && constraints && !constraints.supportsEdit) {
    throw new Error(`Model ${model} does not support image editing`);
  }
  if (options.partialImages !== undefined && !options.stream) {
    throw new Error('--partial-images requires --stream');
  }
  if (options.prompt.length === 0) {
    throw new Error('--prompt is required');
  }
  if (operation === 'edit' && options.image.length === 0) {
    throw new Error('--image is required for --edit');
  }
  return { model, operation };
}

/**
 * Resolve and create the output directory. A user-supplied path is checked for
 * traversal; the default is `<OPENAI_OUTPUT_DIR|datasets/openai>/<model>`.
 */
export async function resolveOutputDir(options: CLIOptions, model: ImageModel): Promise<string> {
  const outputDir = options.outputDir ? validateOutputPath(options.outputDir) : path.join(getOutputDir(), model);
  await ensureDirectory(outputDir);
  return outputDir;
}

/**
 * Turn parsed options into one job per prompt. Edits take the first prompt
 * only; generation batches over every prompt.
 */
export function buildJobs(
  options: CLIOptions,
  ctx: { api: OpenAIImageAPI; model: ImageModel; operation: 'generate' | 'edit'; outputDir: string }
): RequestJob[] {
  const { api, model, operation, outputDir } = ctx;
  const common = {
    model,
    size: options.size,
    quality: options.quality,
    n: options.n,
    background: options.background,
    moderation: options.moderation,
    output_format: options.outputFormat,
    output_compression: options.outputCompression,
    user: options.user,
    partial_images: options.stream ? options.partialImages : undefined,
  };
  // options.prompt is non-empty (validateOptions), so slice(0, 1) is one item
  const prompts = operation === 'edit' ? options.prompt.slice(0, 1) : options.prompt;
  const editImage: string | string[] = options.image.length === 1 ? options.image.join('') : options.image;
  const base = { api, model, outputDir, stream: Boolean(options.stream), outputFormat: options.outputFormat };

  return prompts.map((prompt): RequestJob =>
    operation === 'edit'
      ? {
          ...base,
          prompt,
          operation,
          params: { ...common, image: editImage, prompt, mask: options.mask, input_fidelity: options.inputFidelity },
        }
      : { ...base, prompt, operation, params: { ...common, prompt } }
  );
}

/**
 * Run every job in order, continuing past failures when there is more than
 * one. Returns the exit code: 1 if any job failed (the failures are listed),
 * 0 otherwise. Dry runs validate and print instead of calling the API.
 */
export async function runBatch(jobs: RequestJob[], options: CLIOptions): Promise<number> {
  const failed: string[] = [];

  for (const [i, job] of jobs.entries()) {
    const promptNum = jobs.length > 1 ? ` [${i + 1}/${jobs.length}]` : '';
    logger.info(`\n${'='.repeat(60)}`);
    logger.info(
      job.operation === 'edit'
        ? `Editing ${options.image.length} image(s) with prompt: "${job.prompt.substring(0, 50)}..."`
        : `Processing prompt${promptNum}: "${job.prompt.substring(0, 60)}..."`
    );
    logger.info(`${'='.repeat(60)}`);

    if (options.dryRun) {
      await dryRun(job, options.validate);
      continue;
    }

    try {
      await runRequest(job);
    } catch (error) {
      // A batch keeps going past one failed prompt; a single request surfaces it
      if (jobs.length > 1) {
        failed.push(job.prompt);
        logger.error('Continuing with next prompt...');
      } else {
        throw error;
      }
    }
  }

  // A batch with any failure exits non-zero so scripted callers see it;
  // the summary names what did not render.
  if (failed.length > 0) {
    logger.error(`\n✗ ${failed.length} of ${jobs.length} prompt(s) failed:`);
    failed.forEach((p) => logger.error(`  - "${p.substring(0, 60)}"`));
    logger.error('');
    return 1;
  }

  logger.info('\n✓ All operations completed successfully!\n');
  return 0;
}
