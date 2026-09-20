#!/usr/bin/env node

/**
 * OpenAI Image Generation - Main CLI Script
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
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { OpenAIImageAPI } from './api.js';
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
  validateModelParams,
  unknownModelMessage,
  MODELS,
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

// ES module dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read version from package.json dynamically
// Note: In compiled output, package.json is one level up from dist/
interface PackageJson {
  version: string;
}
const packageJsonPath = path.join(__dirname, '..', 'package.json');
let version = '0.0.0';
try {
  version = (JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJson).version;
} catch {
  // A missing or malformed manifest only affects --version output
}

/**
 * Exit once winston has flushed.
 *
 * `process.exit` right after `logger.error` drops the final line when stdout is
 * a pipe with more than the 64 KB kernel buffer queued behind a slow reader —
 * exactly the CI capture where the reason for a non-zero exit matters most.
 * The timer is a backstop for a transport that never emits 'finish'.
 */
function exitAfterFlush(code: number): void {
  const timer = setTimeout(() => process.exit(code), 2000);
  logger.once('finish', () => {
    clearTimeout(timer);
    process.exit(code);
  });
  logger.end();
}

const program = new Command();

/** CLI Options interface */
interface CLIOptions {
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

/**
 * Narrow a raw flag value to one of an allowed set, or fail with the set.
 *
 * Commander hands back untyped strings; casting them to the literal unions the
 * API expects would let `--quality bogus` type-check. Membership is checked
 * here so the value is genuinely narrowed. Per-model rules (e.g. `max` only on
 * 2.5) are still enforced by validateModelParams downstream.
 */
function oneOf<T extends string>(value: unknown, allowed: readonly T[], flag: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`Invalid value "${String(value)}" for ${flag}. Valid options: ${allowed.join(', ')}`);
}

/** Read an optional string flag */
function optString(value: unknown, flag: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  throw new Error(`${flag} expects a string`);
}

/** Read an optional integer flag (commander's parseInt yields NaN on junk) */
function optInt(value: unknown, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  throw new Error(`${flag} expects an integer`);
}

/** Read a repeatable string flag */
function stringList(value: unknown, flag: string): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value) && value.every((v) => typeof v === 'string')) return value;
  throw new Error(`${flag} expects one or more strings`);
}

/**
 * Validate commander's untyped option bag into CLIOptions field by field.
 */
function readOptions(raw: Record<string, unknown>): CLIOptions {
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
function showExamples(): void {
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
  - Shutdown: gpt-image-1 on 2026-10-23; 1.5 and 1-mini on 2026-12-01

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
function resolveModel(options: CLIOptions): ImageModel {
  if (options.model) {
    if (!isSupportedModel(options.model)) {
      throw new Error(unknownModelMessage(options.model));
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
 * Run the same validation the API class applies, so `--dry-run` reports what a
 * real request would be rejected for instead of printing the parameters and
 * declaring them valid. (Through 2.1.1 the dry-run path never validated.)
 */
function dryRun(model: ImageModel, params: StreamImageParams | StreamEditImageParams): void {
  const validation = validateModelParams(model, params);
  if (!validation.valid) {
    throw new Error(`Parameter validation failed:\n  - ${validation.errors.join('\n  - ')}`);
  }
  logger.info('Dry run - parameters validated successfully:');
  logger.info(JSON.stringify(params, null, 2));
}

/**
 * Persist images and a metadata sidecar for one completed request.
 */
async function persistResult(
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
function requestStem(prompt: string, tag: string): string {
  return generateTimestampedFilename(prompt, tag, 'png').replace(/\.png$/, '');
}

/**
 * Build an onPartialImage handler that writes each frame beside the final image.
 */
function partialImageWriter(outputDir: string, stem: string, format: string, sink: string[]) {
  return async (event: ImagePartialImageEvent): Promise<void> => {
    const filepath = path.join(outputDir, `${stem}_partial_${event.partial_image_index}.${format}`);
    await decodeBase64Image(event.b64_json, filepath);
    sink.push(filepath);
    logger.info(`  partial image ${event.partial_image_index} → ${filepath}`);
  };
}

/** One request's worth of inputs, shared by the edit and generate paths */
type RequestJob = {
  api: OpenAIImageAPI;
  model: ImageModel;
  prompt: string;
  outputDir: string;
  stream: boolean;
  outputFormat: ImageOutputFormat | undefined;
} & (
  | { operation: 'generate'; params: StreamImageParams }
  | { operation: 'edit'; params: StreamEditImageParams }
);

/**
 * Execute one generate or edit request end to end: spinner, (streaming) call,
 * partial-frame capture, persistence, and the success summary. Throws on
 * failure after stopping the spinner; the caller decides whether to continue.
 */
async function runRequest(job: RequestJob): Promise<void> {
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
    spinner.fail(`${operation === 'edit' ? 'Edit' : 'Generation'} failed: ${getErrorMessage(error)}`);
    throw error;
  }
}

/**
 * Parse and validate CLI arguments.
 */
program
  .name('openai-img')
  .description('OpenAI Image Generation CLI - GPT Image models')
  .version(version);

// Model selection
program
  .option('--model <id>', 'Model identifier (canonical or dated snapshot); overrides shortcut flags')
  .option('--sunburst', 'Use gpt-image-2.5-sunburst (editing precision)')
  .option('--flare', 'Use gpt-image-2.5-flare (fast, high quality; default)')
  .option('--gpt-image-2', 'Use gpt-image-2')
  .option('--gpt-image-15', 'Use gpt-image-1.5 (deprecated, shutdown 2026-12-01)')
  .option('--gpt-image-1', 'Use gpt-image-1 (deprecated, shutdown 2026-10-23)')
  .option('--gpt-image-1-mini', 'Use gpt-image-1-mini (deprecated, shutdown 2026-12-01)');

// Operation mode
program
  .option('--edit', 'Edit existing image(s) with prompt')
  .option('--stream', 'Stream the response, saving partial images as they arrive')
  .option('--partial-images <n>', 'Number of partial images to stream, 0-3 (requires --stream)', parseInt);

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
  .option('--api-key <key>', 'OpenAI API key (overrides environment variable)')
  .option('--output-dir <path>', 'Output directory for generated images')
  .option('--log-level <level>', 'Log level: DEBUG, INFO, WARNING, ERROR', 'INFO')
  .option('--dry-run', 'Validate parameters without making API call')
  .option('--examples', 'Show usage examples');

program.parse(process.argv);

/**
 * Main CLI execution.
 */
async function main(): Promise<void> {
  let options: CLIOptions;
  try {
    options = readOptions(program.opts());
  } catch (error) {
    logger.error(`\n✗ Error: ${getErrorMessage(error)}\n`);
    exitAfterFlush(1);
    return;
  }

  try {
    // Show examples if requested
    if (options.examples) {
      showExamples();
      exitAfterFlush(0);
      return;
    }

    // Show help if no arguments provided
    if (!process.argv.slice(2).length) {
      program.outputHelp();
      exitAfterFlush(0);
      return;
    }

    setLogLevel(options.logLevel);

    const model = resolveModel(options);
    const operation: 'generate' | 'edit' = options.edit ? 'edit' : 'generate';
    const constraints = getModelConstraints(model);

    if (operation === 'edit' && (!constraints || !constraints.supportsEdit)) {
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

    const deprecation = getModelDeprecation(model);
    if (deprecation) {
      logger.warn(
        `${model} is scheduled for removal on ${deprecation.shutdown}; migrate to ${deprecation.replacement}`
      );
    }

    // Initialize API
    const api = new OpenAIImageAPI({ apiKey: options.apiKey, logLevel: options.logLevel });

    // Determine output directory (user-provided paths are checked for traversal)
    const outputDir = options.outputDir
      ? validateOutputPath(options.outputDir)
      : path.join(getOutputDir(), model);
    await ensureDirectory(outputDir);

    logger.info(`Using model: ${model}`);
    logger.info(`Operation: ${operation}${options.stream ? ' (streaming)' : ''}`);
    logger.info(`Output directory: ${outputDir}`);

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

    // Edits take the first prompt only; generation batches over every prompt.
    // options.prompt is non-empty here (checked above), so slice(0, 1) is one item.
    const prompts = operation === 'edit' ? options.prompt.slice(0, 1) : options.prompt;
    const editImage: string | string[] = options.image.length === 1 ? options.image.join('') : options.image;
    const failed: string[] = [];

    for (const [i, prompt] of prompts.entries()) {
      const promptNum = prompts.length > 1 ? ` [${i + 1}/${prompts.length}]` : '';

      logger.info(`\n${'='.repeat(60)}`);
      logger.info(
        operation === 'edit'
          ? `Editing ${options.image.length} image(s) with prompt: "${prompt.substring(0, 50)}..."`
          : `Processing prompt${promptNum}: "${prompt.substring(0, 60)}..."`
      );
      logger.info(`${'='.repeat(60)}`);

      const base = { api, model, prompt, outputDir, stream: Boolean(options.stream), outputFormat: options.outputFormat };
      const job: RequestJob =
        operation === 'edit'
          ? {
              ...base,
              operation,
              params: {
                ...common,
                image: editImage,
                prompt,
                mask: options.mask,
                input_fidelity: options.inputFidelity,
              },
            }
          : { ...base, operation, params: { ...common, prompt } };

      if (options.dryRun) {
        dryRun(model, job.params);
        continue;
      }

      try {
        await runRequest(job);
      } catch (error) {
        // A batch keeps going past one failed prompt; a single request surfaces it
        if (prompts.length > 1) {
          failed.push(prompt);
          logger.error('Continuing with next prompt...');
        } else {
          throw error;
        }
      }
    }

    // A batch with any failure exits non-zero so scripted callers see it;
    // the summary names what did not render.
    if (failed.length > 0) {
      logger.error(`\n✗ ${failed.length} of ${prompts.length} prompt(s) failed:`);
      failed.forEach((p) => logger.error(`  - "${p.substring(0, 60)}"`));
      logger.error('');
      exitAfterFlush(1);
      return;
    }

    logger.info('\n✓ All operations completed successfully!\n');
    exitAfterFlush(0);
  } catch (error) {
    logger.error(`\n✗ Error: ${getErrorMessage(error)}\n`);
    exitAfterFlush(1);
  }
}

// Run main function
void main();
