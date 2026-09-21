# OpenAI Image Generation & Editing Service

[![npm version](https://img.shields.io/npm/v/openai-image-api.svg)](https://www.npmjs.com/package/openai-image-api)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/node/v/openai-image-api)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-214%20passing-brightgreen)](test/)

A Node.js wrapper for the [OpenAI Image API](https://developers.openai.com/api/reference/resources/images) — `/v1/images/generations` and `/v1/images/edits` — for the GPT Image model family: **GPT Image 2.5** (Sunburst, Flare), **GPT Image 2**, and the deprecated GPT Image 1.x models. Generate and edit images, with streaming partial-image delivery, via CLI or programmatic API.

This service follows the data-collection architecture pattern with organized data storage, logging, parameter validation, and CLI orchestration. Written in **TypeScript** with full type definitions included. Requires **Node.js 18 or newer**.

> **Upgrading from 2.x?** DALL-E 2/3, image variations, and Sora video generation were removed in 3.0.0 because OpenAI has shut down (or is about to shut down) those APIs. See [Migrating from 2.x](#migrating-from-2x).

## Quick Start

### CLI Usage

```bash
# Install globally
npm install -g openai-image-api

export OPENAI_API_KEY="your-api-key-here"

# Generate an image (default model: gpt-image-2.5-flare)
openai-img --prompt "a serene mountain landscape"

# Stream partial frames while it renders
openai-img --stream --partial-images 2 --prompt "a river made of owl feathers"

# Edit an image
openai-img --sunburst --edit --image photo.png --prompt "make the sky stormy"
```

### Programmatic Usage

```typescript
import { OpenAIImageAPI } from 'openai-image-api';

const api = new OpenAIImageAPI();

// Buffered generation
const result = await api.generateImage({
  prompt: 'a serene mountain landscape',
  model: 'gpt-image-2.5-flare',
  quality: 'high',
  size: '1536x1024',
});
await api.saveImages(result, './out', 'mountains'); // → ./out/mountains.png

// Streaming generation with partial frames
const streamed = await api.generateImageStream(
  { prompt: 'a river made of owl feathers', partial_images: 2 },
  { onPartialImage: (e) => console.log(`partial ${e.partial_image_index} arrived`) }
);
await api.saveImages(streamed, './out', 'river');
```

## Table of Contents

- [Overview](#overview)
- [Models](#models)
- [Authentication Setup](#authentication-setup)
- [Installation](#installation)
- [TypeScript Support](#typescript-support)
- [CLI Usage](#cli-usage)
- [API Methods](#api-methods)
- [Streaming](#streaming)
- [Examples](#examples)
- [Data Organization](#data-organization)
- [Testing](#testing)
- [Error Handling](#error-handling)
- [Troubleshooting](#troubleshooting)
- [Migrating from 2.x](#migrating-from-2x)

## Overview

The package wraps the two Image API endpoints:

| Endpoint                      | Method                | Streaming variant                                 |
| ----------------------------- | --------------------- | ------------------------------------------------- |
| `POST /v1/images/generations` | `generateImage()`     | `streamImage()` / `generateImageStream()`         |
| `POST /v1/images/edits`       | `generateImageEdit()` | `streamImageEdit()` / `generateImageEditStream()` |

Every request is validated client-side against the model's published constraints (sizes, quality tiers, formats, `n`, `partial_images`, `input_fidelity`) before any network call, so a bad parameter fails fast with a specific message rather than a generic 400.

**The constraint tables are a transcription of OpenAI's reference as of 2026-09-20.** That cuts both ways: when OpenAI _tightens_ a limit the request goes out and the API's own 400 comes back; when OpenAI _loosens_ one, or ships a model this release does not know, the validator says no before the network. For that case pass `skipValidation: true` (library) or `--no-validate` (CLI): the request is sent as-is and the API is the judge. `--dry-run` reports what this package would reject, not what the API would.

The Responses API `image_generation` _tool_ (multi-turn conversational editing) is a different surface and is not wrapped here.

## Models

| Model                               | Sizes               | Quality                                    | Notes                                  |
| ----------------------------------- | ------------------- | ------------------------------------------ | -------------------------------------- |
| `gpt-image-2.5-sunburst`            | standard + flexible | `auto` `low` `medium` `high` `xhigh` `max` | Editing precision                      |
| `gpt-image-2.5-flare` **(default)** | standard + flexible | `auto` `low` `medium` `high` `xhigh` `max` | Fast, high-quality everyday generation |
| `gpt-image-2`                       | standard + flexible | `auto` `low` `medium` `high`               | Up to 4K                               |
| `gpt-image-1.5`                     | standard            | `auto` `low` `medium` `high`               | **Shutdown 2026-12-01**                |
| `gpt-image-1`                       | standard            | `auto` `low` `medium` `high`               | **Shutdown 2026-10-23**                |
| `gpt-image-1-mini`                  | standard            | `auto` `low` `medium` `high`               | **Shutdown 2026-12-01**                |

**Standard sizes:** `1024x1024`, `1536x1024`, `1024x1536`, `auto`.

**Flexible sizes** (gpt-image-2 and 2.5): any `WIDTHxHEIGHT` where both edges are multiples of 16, the aspect ratio is between 1:3 and 3:1, neither edge exceeds 3840 px, and total pixels fall between 655,360 and 8,294,400. Resolutions above 2560x1440 are documented as experimental. Examples: `1536x864`, `2048x1152`, `3840x2160`.

**Common parameters (all models):** `n` 1–10 · `background` `auto|transparent|opaque` · `output_format` `png|jpeg|webp` · `output_compression` 0–100 (jpeg/webp only) · `moderation` `auto|low` · prompt up to 32,000 characters · up to 16 input images per edit.

**`input_fidelity`** (`high|low`) is accepted on edits by the gpt-image-1.x models only. gpt-image-2 and both 2.5 models reject it and always process inputs at high fidelity — the API reference documents this for gpt-image-2; the 2.5 behaviour was confirmed against the live API on 2026-09-20.

**Dated snapshots** — `gpt-image-2.5-sunburst-2026-09-08`, `gpt-image-2.5-flare-2026-09-08`, `gpt-image-2-2026-04-21` — are accepted anywhere a model is, via `--model <id>` on the CLI or `model:` in code, and validate with their family's constraints.

**Deprecated models** still work until their shutdown dates. The API class logs a warning (once per model per instance) when one is used; the CLI prints the same notice. The dates are relayed, not enforced — after the date the notice changes tense and the request still goes out, coming back as the API's 404. Source: [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations).

## Authentication Setup

### 1. Get Your API Key

1. Visit [https://platform.openai.com/](https://platform.openai.com/)
2. Create an account or sign in
3. Navigate to API keys section
4. Generate your API key
5. Copy your API key

### 2. Configure Your API Key

You can provide your API key in multiple ways (listed in priority order):

#### Option A: CLI Flag (Highest Priority)

```bash
openai-img --api-key YOUR_API_KEY --prompt "a cat"
```

On a shared host the flag is visible to other users through the process list for the life of the run; the CLI prints a warning. Prefer Option B or D there.

#### Option B: Environment Variable

```bash
# Add to your ~/.bashrc, ~/.zshrc, or equivalent
export OPENAI_API_KEY=your_actual_api_key_here

# Or use it for a single command
OPENAI_API_KEY=your_key openai-img --prompt "a cat"
```

#### Option C: Local .env File

```bash
# In your project directory
echo "OPENAI_API_KEY=your_actual_api_key_here" > .env
```

#### Option D: Global Config

```bash
# Create config directory
mkdir -p ~/.openai

# Add your API key
echo "OPENAI_API_KEY=your_actual_api_key_here" > ~/.openai/.env
```

**Security Note:** Never commit `.env` files or expose your API key publicly.

**Library consumers:** `.env` files are read only when a key is actually being looked up (no `apiKey` passed and `OPENAI_API_KEY` unset) — not at import time as in 2.x — and never when `OPENAI_IMAGE_API_NO_DOTENV` is set. A server that manages its own configuration can set that variable and the SDK will not touch the filesystem for credentials.

### 3. Organization Verification

OpenAI may require [API Organization Verification](https://help.openai.com/en/articles/10910291-api-organization-verification) before GPT Image models can be used. Without it you'll receive a 400-level error.

1. Go to your [OpenAI Organization Settings](https://platform.openai.com/settings/organization/general)
2. Complete the verification process (government ID + selfie)
3. Wait for approval (typically a few business days)

## Installation

### Option 1: Install from npm (Recommended)

```bash
# Install globally for CLI usage
npm install -g openai-image-api

# Or install locally in your project
npm install openai-image-api
```

### Option 2: Install from source

```bash
git clone https://github.com/aself101/openai-image-api.git
cd openai-image-api
npm install
npm run build
```

## TypeScript Support

This package is written in TypeScript and includes full type definitions. All types are exported.

### Importing Types

Every type is re-exported from the main entry; `openai-image-api/types` also works.

```typescript
import {
  OpenAIImageAPI,
  type GenerateImageParams,
  type EditImageParams,
  type StreamImageParams,
  type StreamEditImageParams,
  type ImageResponse,
  type ImageModel,
  type ImageQuality,
  type ImageGenerationStreamEvent,
  type ImageEditStreamEvent,
  type APIOptions,
} from 'openai-image-api';

// Constraints and helpers
import {
  MODEL_CONSTRAINTS, // per-family sizes/quality/limits
  MODEL_DEPRECATIONS, // shutdown dates for the 1.x models
  MODEL_ALIASES, // dated snapshot → family
  MODELS, // CLI short names → model ids
  DEFAULT_MODEL, // 'gpt-image-2.5-flare'
  validateModelParams, // the pre-flight validator the API class runs
  validateFlexibleSize, // WIDTHxHEIGHT rules for gpt-image-2 / 2.5
  getModelConstraints,
  getModelDeprecation,
  resolveModelFamily,
  isSupportedModel,
  getOpenAIApiKey, // CLI flag → env resolution used by the constructor
  validateApiKeyFormat, // shape check only; does not call the API
  getOutputDir, // OPENAI_OUTPUT_DIR or 'datasets/openai'
} from 'openai-image-api/config';

// File and stream helpers used by the CLI, exported for reuse
import {
  decodeBase64Image, // write a b64 payload to disk (creates directories)
  validateImagePath, // magic-byte check: PNG/JPEG/WebP/GIF
  validateOutputPath, // reject '..' traversal, optionally pin to a base dir
  generateTimestampedFilename,
  sanitizeForFilename,
  parseSSEStream, // raw SSE → { event, data } async generator
  getErrorMessage, // message from an `unknown` catch value
} from 'openai-image-api/utils';
```

`ensureDirectory`, `writeToFile`, `readStreamToString`, `promptToFilename`, `createSpinner`, `setLogLevel`, `logger`, and `getErrorCode` are also exported from `./utils` — small internals the CLI uses; they carry JSDoc but no compatibility promise beyond the current major.

### Project Structure

```text
openai-image-api/
├── src/                    # Published alongside dist/ so source maps resolve
│   ├── api.ts              # OpenAIImageAPI class (buffered + streaming)
│   ├── config.ts           # Model constraints, deprecations, validation
│   ├── utils.ts            # File I/O, image header checks, SSE parser
│   ├── cli-core.ts         # CLI logic (testable in-process)
│   ├── cli.ts              # CLI bin entry (argv / exit wiring)
│   └── types.ts            # Type definitions
├── scripts/check-reference.mjs  # Diff config against OpenAI's published reference
├── dist/                   # Compiled JavaScript (committed for npm)
├── test/                   # Vitest suites
└── tsconfig.json
```

### Building from Source

```bash
npm install
npm run build          # tsc → dist/
npm run build:watch
```

## CLI Usage

### Basic Command Structure

```bash
openai-img [model] [operation] --prompt "..." [options]
```

### Model Selection

The default is `gpt-image-2.5-flare`. Override with a shortcut flag or `--model`:

```bash
--flare                 # gpt-image-2.5-flare (default)
--sunburst              # gpt-image-2.5-sunburst
--gpt-image-2           # gpt-image-2
--gpt-image-15          # gpt-image-1.5   (deprecated, shutdown 2026-12-01)
--gpt-image-1           # gpt-image-1     (deprecated, shutdown 2026-10-23)
--gpt-image-1-mini      # gpt-image-1-mini (deprecated, shutdown 2026-12-01)
--model <id>            # any supported id, including dated snapshots; wins over shortcuts
```

### Operation Mode

```bash
# Default: generate
openai-img --prompt "a cat"

# Edit one or more images (repeat --image up to 16 times)
openai-img --edit --image a.png --image b.png --prompt "combine into a collage"

# Stream, saving partial frames beside the final image
openai-img --stream --partial-images 2 --prompt "a cat"
```

### Options

| Option                       | Description                                                     |
| ---------------------------- | --------------------------------------------------------------- |
| `--prompt <text>`            | Text prompt (repeat for batch generation)                       |
| `--image <path>`             | Input image for `--edit` (repeatable)                           |
| `--mask <path>`              | Mask image for `--edit`                                         |
| `--size <size>`              | `WIDTHxHEIGHT` or `auto`                                        |
| `--quality <q>`              | `auto`, `low`, `medium`, `high`; `xhigh`, `max` on 2.5          |
| `--n <number>`               | Images per request, 1–10                                        |
| `--background <bg>`          | `auto`, `transparent`, `opaque`                                 |
| `--output-format <f>`        | `png`, `jpeg`, `webp`                                           |
| `--output-compression <pct>` | 0–100, jpeg/webp only                                           |
| `--moderation <level>`       | `auto`, `low`                                                   |
| `--input-fidelity <level>`   | `high`, `low` — gpt-image-1.x edits only                        |
| `--stream`                   | Stream the response                                             |
| `--partial-images <n>`       | 0–3 partial frames (requires `--stream`)                        |
| `--no-validate`              | Skip the client-side constraint check; accepts any `--model` id |
| `--user <id>`                | End-user identifier                                             |
| `--api-key <key>`            | Override environment key                                        |
| `--output-dir <path>`        | Output directory (default `datasets/openai/<model>`)            |
| `--log-level <level>`        | `DEBUG`, `INFO`, `WARNING`, `ERROR`                             |
| `--dry-run`                  | Validate parameters without calling the API                     |
| `--examples`                 | Show usage examples                                             |

`--dry-run` runs the full pre-flight a real request runs — API key present, prompt present, constraint table, and for edits every input file opened and header-checked — without sending anything. It reports the rejection _this package_ would issue, not what the API would say. With `--no-validate` the constraint table is skipped but files are still verified. The same check is available in code as `api.validateRequest(params)`.

## API Methods

All methods live on `OpenAIImageAPI`.

### `new OpenAIImageAPI(options?)`

```typescript
const api = new OpenAIImageAPI({
  apiKey: 'sk-...', // default: OPENAI_API_KEY
  baseUrl: 'https://...', // default: https://api.openai.com (HTTPS enforced)
  logLevel: 'WARNING', // DEBUG | INFO | WARNING | ERROR — default WARNING; 2.x defaulted to INFO
  rateLimitDelay: 1000, // ms between requests (serialized across concurrent calls)
  requestTimeout: 180000, // ms; image generation can take minutes at high quality
  skipValidation: false, // true: send unknown models / out-of-table params, let the API judge
});
```

### `validateRequest(params, { streaming? }): Promise<ImageModel>`

Runs every check a request would run — key, prompt, constraint table (unless `skipValidation`), and for edits every input file opened, size- and header-checked — and rejects with the same `OpenAIImageAPIError` the request would, without sending anything. This is what `--dry-run` calls.

### `generateImage(params): Promise<ImageResponse>`

```typescript
const result = await api.generateImage({
  prompt: 'a cat', // required, ≤ 32,000 chars
  model: 'gpt-image-2.5-flare', // default
  size: '1536x1024',
  quality: 'high',
  n: 1,
  background: 'auto',
  output_format: 'png',
  output_compression: 80, // jpeg/webp only
  moderation: 'auto',
  user: 'user-123',
});
// result.data[i].b64_json, result.usage, result.output_format, result.quality, result.size, result.background
```

### `generateImageEdit(params): Promise<ImageResponse>`

```typescript
const result = await api.generateImageEdit({
  image: ['a.png', 'b.png'], // string | string[], up to 16
  prompt: 'combine these',
  model: 'gpt-image-2.5-sunburst',
  mask: 'mask.png', // optional
  input_fidelity: 'high', // gpt-image-1.x only
  // ...plus every generateImage option except prompt handling
});
```

Images are sent as multipart `image[]` parts; the mask as `mask`. Every input file is opened once, checked for size (≤ 50 MB) and image magic bytes (PNG/JPEG/WebP), and uploaded from that same open handle — the bytes checked are the bytes sent, so a path swapped between check and upload is not picked up. Files are opened after the rate-limit wait, not held across it.

### `streamImage(params): AsyncGenerator<ImageGenerationStreamEvent>`

Yields `image_generation.partial_image` events (0–`partial_images` of them) followed by one `image_generation.completed` event. See [Streaming](#streaming).

### `generateImageStream(params, handlers?): Promise<ImageResponse>`

Wraps `streamImage`: calls `handlers.onPartialImage(event)` for each partial frame and resolves to the completed image in the same shape `generateImage` returns, so `saveImages` works on either.

### `streamImageEdit(params)` / `generateImageEditStream(params, handlers?)`

Edit counterparts; events are `image_edit.partial_image` / `image_edit.completed`.

### `saveImages(response, outputDir, baseFilename, format?): Promise<string[]>`

Decodes each `b64_json` entry to `<outputDir>/<baseFilename>.<format>` (numbered `_1`, `_2`… when `n > 1`). `format` defaults to `response.output_format`, then `png`.

Path inputs are checked before writing: `outputDir` may not contain a `..` segment and `baseFilename` must be a single path component (no `/`, `\`, `..`). A server forwarding end-user input here cannot be steered outside `outputDir`; to write elsewhere, validate your own path and call `decodeBase64Image` directly.

## Streaming

Streaming uses `stream: true` on the same endpoints; the API answers with Server-Sent Events. This package parses them and exposes both an async generator and a callback wrapper.

```typescript
import fs from 'fs';
import { OpenAIImageAPI } from 'openai-image-api';

const api = new OpenAIImageAPI();

for await (const event of api.streamImage({ prompt: 'a storm', partial_images: 3 })) {
  if (event.type === 'image_generation.partial_image') {
    fs.writeFileSync(`partial-${event.partial_image_index}.png`, Buffer.from(event.b64_json, 'base64'));
  } else {
    fs.writeFileSync('final.png', Buffer.from(event.b64_json, 'base64'));
    console.log(event.usage);
  }
}
```

Things the API documents that are worth knowing before relying on partials:

- Each partial frame costs an additional 100 image output tokens.
- **You may receive fewer partials than requested** — "the final image may be sent before the full number of partial images are generated if the full image is generated more quickly." In testing, `low` quality at 1024x1024 frequently delivered zero partials; `medium` delivered one of two requested. Write consumers that treat partials as optional.
- Partial and final payloads are large (a `medium` 1024x1024 PNG is ~3 MB of base64 per event); the parser buffers per event, not per line.

## Examples

### Example 1: Highest quality Sunburst render

```bash
openai-img --sunburst --prompt "photorealistic portrait of an astronaut" --size 1024x1536 --quality max
```

### Example 2: 4K landscape with gpt-image-2

```bash
openai-img --gpt-image-2 --prompt "wide cinematic desert vista" --size 3840x2160 --quality high
```

### Example 3: Transparent background as WebP

```bash
openai-img --prompt "a cute robot character, sticker style" --background transparent --output-format webp
```

### Example 4: Streaming with partial frames

```bash
openai-img --stream --partial-images 2 --quality medium --prompt "a lighthouse in a storm"
# → ..._partial_0.png (if delivered), ..._lighthouse.png, ..._metadata.json
```

### Example 5: Multi-image edit

```bash
openai-img --sunburst --edit --image lotion.png --image soap.png --image candle.png \
  --prompt "arrange these in a gift basket"
```

### Example 6: Batch generation

```bash
openai-img --prompt "a red apple" --prompt "a green pear" --prompt "a yellow banana"
```

### Example 7: Programmatic edit with streaming

```typescript
import fs from 'fs';
import { OpenAIImageAPI } from 'openai-image-api';

const api = new OpenAIImageAPI({ logLevel: 'WARNING' });

const edited = await api.generateImageEditStream(
  {
    image: 'photo.png',
    prompt: 'make it look like autumn',
    model: 'gpt-image-2.5-sunburst',
    partial_images: 1,
  },
  {
    onPartialImage: async (e) => {
      await fs.promises.writeFile(`preview-${e.partial_image_index}.png`, Buffer.from(e.b64_json, 'base64'));
    },
  }
);

const [path] = await api.saveImages(edited, './out', 'autumn');
console.log(path, edited.usage);
```

## Data Organization

Generated images and metadata are organized by model:

```text
datasets/
└── openai/
    ├── gpt-image-2.5-flare/
    │   ├── 2026-09-20_22-37-00_gpt-image-2.5-flare_a_lighthouse_partial_0.png
    │   ├── 2026-09-20_22-37-00_gpt-image-2.5-flare_a_lighthouse.png
    │   ├── 2026-09-20_22-37-00_gpt-image-2.5-flare_a_lighthouse_metadata.json
    │   └── ...
    ├── gpt-image-2.5-sunburst/
    │   └── 2026-09-20_22-38-19_gpt-image-2.5-sunburst-edit_make_the_fox_blue.png
    └── gpt-image-2/
        └── ...
```

Partial frames, the final image, and the metadata sidecar for one request share a stem — `YYYY-MM-DD_HH-MM-SS-mmm_<4 hex>_<model>_<prompt>` — so they sort together and two processes rendering the same prompt in the same millisecond do not overwrite each other. Prompt text keeps letters and digits in any script (a Japanese prompt keeps its characters); everything else becomes `_`; Windows-reserved stems (`con`, `nul`, `com1`…) get a trailing `_`. `saveImages()` does not sanitize the `baseFilename` you pass beyond requiring it to be a single path component.

The metadata sidecar stores the prompt and any `--user` id in plaintext. Sharing or backing up an output directory shares the prompts.

**Metadata Format:**

```json
{
  "model": "gpt-image-2.5-flare",
  "operation": "generate",
  "timestamp": "2026-09-20T22:37:11.223Z",
  "parameters": {
    "model": "gpt-image-2.5-flare",
    "size": "1024x1024",
    "quality": "medium",
    "partial_images": 2,
    "prompt": "a detailed watercolor of a lighthouse in a storm"
  },
  "response": {
    "created": 1789943831,
    "images": ["datasets/openai/gpt-image-2.5-flare/..._a_lighthouse.png"],
    "partial_images": ["datasets/openai/gpt-image-2.5-flare/..._a_lighthouse_partial_0.png"],
    "usage": {
      "input_tokens": 15,
      "input_tokens_details": { "image_tokens": 0, "text_tokens": 15 },
      "output_tokens": 516,
      "output_tokens_details": { "image_tokens": 516, "text_tokens": 0 },
      "total_tokens": 531
    },
    "output_format": "png",
    "quality": "medium",
    "size": "1024x1024",
    "background": "opaque"
  }
}
```

## Testing

```bash
npm test                # run all tests
npm run test:watch
npm run test:ui
npm run test:coverage
npm run lint            # eslint (type-aware) — also run in CI
npm run format:check    # prettier
npm run verify          # lint + format + type-check (src and tests) + build + test, what CI runs
```

The suite has 214 tests across four files:

- **config** — model catalogue and deprecation table, flexible-size rules (multiples of 16, aspect ratio, pixel bounds), per-model quality gating, `input_fidelity` rejection, cross-field rules (transparent+jpeg, compression without jpeg/webp), snapshot resolution.
- **api** — request payloads per model family, default model, deprecation warning once per model, streaming (SSE reassembly across chunk boundaries, event ordering, callback wrapper, error-body recovery from a failed stream, terminal error events), edit pre-flight, `saveImages`, security (HTTPS enforcement, key redaction, production error sanitisation, rate limiting).
- **utils** — file I/O, filename generation, image magic-byte validation, path traversal, error-message extraction, SSE parser edge cases (CRLF, multi-line data, comments, trailing event, 200 kB payloads).
- **cli-core** — in-process tests of the CLI logic (`src/cli-core.ts`): option parsing and enum checks, model resolution, cross-flag validation, job construction, `runCli` exit codes for dry runs and batch failures.
- **cli** — subprocess smoke tests against the built `dist/cli.js`: `--dry-run` validation failures exit non-zero with the validator's message, `--model` rejects removed ids, invalid enum flags are refused before any request.

Network calls are mocked. Live verification of streaming, editing, and the `input_fidelity` behaviour was performed against the real API on 2026-09-20 during the 3.0.0 work; it is not part of `npm test`.

## Error Handling

Every failure thrown by `OpenAIImageAPI` methods is an `OpenAIImageAPIError` (exported from the main entry) — API responses, client-side rejections, input-file checks, and stream failures alike. The `message` is the stable human-readable vocabulary below; the fields let you branch without parsing it:

```typescript
import { OpenAIImageAPI, OpenAIImageAPIError } from 'openai-image-api';

try {
  await api.generateImage({ prompt });
} catch (err) {
  if (err instanceof OpenAIImageAPIError) {
    err.status; // HTTP status when the API answered; undefined for client-side rejections
    err.code; // API error.code — the stable discriminator
    err.type; // API error.type (e.g. 'image_generation_user_error': fix the input, do not retry unchanged)
    // or the package's own: 'validation_error' | 'input_error' | 'configuration_error' | 'stream_error'
    err.apiMessage; // the API's own message — deliberately exempt from NODE_ENV=production sanitization
    // (it is addressed to the key holder and names the rejected parameter or policy, not
    // internals); do not forward it to end users unreviewed
    err.cause; // the original axios error (or the underlying fs error for input_error)
  }
}
```

The constructor throws an `OpenAIImageAPIError` with `type: 'configuration_error'` for a non-HTTPS `baseUrl`, so one `instanceof` covers construction too.

| Error                                                                       | Meaning                                                                                                  |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `Authentication failed. Please check your API key.`                         | 401                                                                                                      |
| `Bad request: <API message>`                                                | 400 — the API's own message is passed through (sanitised to a generic string when `NODE_ENV=production`) |
| `Rate limit exceeded. Please try again later.`                              | 429                                                                                                      |
| `OpenAI service error. Please try again later.`                             | 500 / 502 / 503                                                                                          |
| `Parameter validation failed:\n  - ...`                                     | Rejected client-side before any request; lists every failing rule (`type: 'validation_error'`)           |
| `Streaming requests generate a single image; omit n or set it to 1`         | This package's streaming wrappers return one image; `n > 1` on a stream is refused                       |
| `Image file not found: <path>` / `File does not appear to be a valid image` | Edit input failed the pre-upload check                                                                   |
| `Unknown model "<id>". Supported: ...`                                      | Model id not in the catalogue (DALL-E ids land here)                                                     |
| `Stream error: <message>`                                                   | The API sent a terminal `error` event mid-stream (`type: 'stream_error'`)                                |
| `Stream ended without an image_generation.completed event`                  | Connection closed early                                                                                  |
| `Unexpected response shape from <endpoint>`                                 | 200 without a `data[]` array                                                                             |

Example validation failure:

```text
Error: Parameter validation failed:
  - Size "1000x1000": width and height must both be multiples of 16
  - Invalid quality "max" for gpt-image-2. Valid options: auto, low, medium, high
```

## Troubleshooting

### API Key Not Found

Set `OPENAI_API_KEY` via one of the four methods in [Authentication Setup](#authentication-setup).

### `does not support the 'input_fidelity' parameter`

You're editing with gpt-image-2 or a 2.5 model. Drop `--input-fidelity`; these models always use high fidelity. The client-side validator catches this before the request when the model is known.

### CI runner shows `Bad request: Invalid request parameters`

`NODE_ENV=production` sanitizes `message`. The CLI appends the API's own reason in parentheses (`API: ...; code: ...`) and the library keeps it on `err.apiMessage`.

### The API accepts something this package rejects

The constraint tables date from 2026-09-20. Pass `--no-validate` / `skipValidation: true` and file an issue with the API's response so the table can be updated.

### Requests time out

Default timeout is 180 s. `max` quality at large sizes can exceed that; raise `requestTimeout` in `APIOptions`.

### Organization Not Verified

A 400 mentioning verification means your org must complete [API Organization Verification](https://help.openai.com/en/articles/10910291-api-organization-verification).

### Model returns 404

`dall-e-2`, `dall-e-3` (since 2026-05-12) and, after their dates, `gpt-image-1` (2026-10-23), `gpt-image-1.5` / `gpt-image-1-mini` (2026-12-01) are removed from the API. Migrate to `gpt-image-2` or a 2.5 model.

## Migrating from 2.x

3.0.0 is a breaking release. Everything removed was removed because OpenAI shut down or scheduled shutdown of the underlying API:

| Removed                                                                                                                                                                              | Why                                                 | Replacement                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ---------------------------------------------------------- |
| `dall-e-2`, `dall-e-3` models                                                                                                                                                        | Shut down 2026-05-12                                | `gpt-image-2.5-flare` (new default) or any GPT Image model |
| `generateImageVariation()`, `--variation`                                                                                                                                            | `/v1/images/variations` was DALL-E-2-only           | Use an edit with a descriptive prompt                      |
| `response_format`, `style`, `url` in responses                                                                                                                                       | DALL-E-only fields; GPT Image always returns base64 | `data[i].b64_json`                                         |
| `OpenAIVideoAPI`, `openai-image-api/video-api`, `--video`, `--sora-2`, `--sora-2-pro`, `--remix-video`, `--list-videos`, `--delete-video`, `--seconds`, `--input-image`, `--variant` | Videos API and Sora 2 shut down 2026-09-24          | —                                                          |
| `--dalle-2`, `--dalle-3` flags                                                                                                                                                       | as above                                            | `--flare`, `--sunburst`, `--gpt-image-2`, `--model <id>`   |
| 30 s request timeout                                                                                                                                                                 | Too short for image generation                      | 180 s default, `requestTimeout` option                     |

Other behaviour changes:

- **Default model** is `gpt-image-2.5-flare`, not `dall-e-2`. Cost note: `dall-e-2` had been returning 404 since 2026-05-12, so no working 2.x default is being upgraded — but a pipeline that pinned `openai-image-api@2` and switches to 3 with no `--quality` flag now pays GPT Image 2.5 `auto`-quality token rates (see [pricing](https://developers.openai.com/api/docs/pricing#image-generation)). Set `--quality low` for drafts.
- **`gpt-image-1.5` now actually works.** In 2.1.x its options were gated on `model === 'gpt-image-1'`, so 1.5 requests carried `response_format` (a 400) and silently dropped `background`/`output_format`/`moderation`/`input_fidelity`. All GPT Image models now share one code path.
- **Streaming exists.** The 2.1.0 changelog announced partial-image streaming; only a constraints entry shipped. `streamImage`, `generateImageStream`, `streamImageEdit`, `generateImageEditStream`, and `--stream` are new in 3.0.0.
- **`--dry-run` validates.** Previously it printed parameters and declared them valid without checking.
- **`saveImages` `format` is optional** and defaults to the response's `output_format`.
- **Output directories** are named by the full model id (`datasets/openai/gpt-image-2.5-flare/`), not a shortened alias.
- New client-side rules: `background: transparent` with `output_format: jpeg` and `output_compression` without jpeg/webp are rejected before the request; edit inputs are magic-byte checked before upload.
- **Batch exit code.** A `--prompt` batch with any failed prompt now exits 1 and lists the failures; 2.x printed the success banner and exited 0 even when every prompt failed.
- **Rate limiting** is serialized across concurrent calls on one instance; 2.x spaced only sequential callers.
- Errors are `OpenAIImageAPIError` instances with `status`/`code`/`type`/`apiMessage`/`cause`; messages are unchanged.
- **Library log level defaults to `WARNING`** (was `INFO`): `new OpenAIImageAPI()` no longer writes a progress line to stdout on every request. Pass `logLevel: 'INFO'` to restore. The CLI is unchanged (`--log-level`, default INFO).
- **Bounded buffers.** Buffered responses are capped at 256 MiB (`maxContentLength`/`maxBodyLength`) and a single SSE event at 128 MiB; both are far above any real image and exist so a hostile or broken upstream cannot exhaust memory.
- Removed utilities: `validateImageUrl`, `downloadImage`, `imageToBase64`, `validateImageFile`, `pause` (`openai-image-api/utils`). The first three served DALL-E URL responses; the package no longer fetches anything but the API itself. `RequestOptions` and `ImageFileConstraints` types are gone with them.

## Additional Resources

- [OpenAI Image API Reference](https://developers.openai.com/api/reference/resources/images)
- [Image Generation Guide](https://developers.openai.com/api/docs/guides/image-generation)
- [Model Deprecations](https://developers.openai.com/api/docs/deprecations)
- [OpenAI Platform](https://platform.openai.com/)

## Related Packages

This package is part of the img-gen ecosystem. Check out these other AI generation services:

- [`ideogram-api`](https://github.com/aself101/ideogram-api) - Ideogram API wrapper for image generation, editing, remixing, and manipulation
- [`bfl-api`](https://github.com/aself101/bfl-api) - Black Forest Labs API wrapper for FLUX and Kontext models
- [`stability-ai-api`](https://github.com/aself101/stability-ai-api) - Stability AI API wrapper for Stable Diffusion 3.5 and image upscaling
- [`google-genai-api`](https://github.com/aself101/google-genai-api) - Google Generative AI (Imagen) wrapper

---

**Disclaimer:** This project is an independent community wrapper and is not affiliated with OpenAI.

## License

This project is licensed under the MIT License - see the LICENSE file for details.
