# OpenAI Image & Video Generation Service

[![npm version](https://img.shields.io/npm/v/openai-image-api.svg)](https://www.npmjs.com/package/openai-image-api)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/node/v/openai-image-api)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-207%20passing-brightgreen)](test/)

A Node.js wrapper for the [OpenAI Image Generation API](https://platform.openai.com/docs/api-reference/images) and [OpenAI Video Generation API](https://platform.openai.com/docs/api-reference/video). Supports DALL-E 2, DALL-E 3, GPT Image 1, and Sora models. Generate, edit, and create variations of images, plus generate and remix videos via CLI or programmatic API.

This service follows the data-collection architecture pattern with organized data storage, logging, parameter validation, and CLI orchestration. Written in **TypeScript** with full type definitions included.

## Quick Start

### CLI Usage
```bash
# Install globally
npm install -g openai-image-api

export OPENAI_API_KEY="your-api-key-here"

# Generate an image
openai-img --dalle-3 --prompt "a serene mountain landscape"

# Generate a video
openai-img --video --sora-2 --prompt "a cat sitting on a windowsill watching the rain" --seconds 4
```

### Programmatic Usage
```typescript
import { OpenAIImageAPI } from 'openai-image-api';
import { OpenAIVideoAPI } from 'openai-image-api/video-api';

const imageApi = new OpenAIImageAPI();

// Generate an image with DALL-E 3
const imageResult = await imageApi.generateImage({
  prompt: 'a serene mountain landscape',
  model: 'dall-e-3',
  quality: 'hd',
  size: '1792x1024'
});

console.log('Image URL:', imageResult.data[0].url);

// Generate a video with Sora
const videoApi = new OpenAIVideoAPI();
const videoResult = await videoApi.createVideo({
  prompt: 'a cat sitting on a windowsill watching the rain',
  model: 'sora-2',
  seconds: '4'
});

// Wait for completion
const completedVideo = await videoApi.waitForVideo(videoResult.id);

// Download the video content
const videoBuffer = await videoApi.downloadVideoContent(completedVideo.id);
console.log('Video downloaded:', videoBuffer.length, 'bytes');
```

## Table of Contents

- [Overview](#overview)
- [Models](#models)
- [Authentication Setup](#authentication-setup)
- [Installation](#installation)
- [TypeScript Support](#typescript-support)
- [CLI Usage](#cli-usage)
- [API Methods](#api-methods)
- [Examples](#examples)
- [Data Organization](#data-organization)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Overview

This Node.js service implements:

- **6 Generation Models** - DALL-E 2, DALL-E 3, GPT Image 1, GPT Image 1.5, Sora 2, Sora 2 Pro
- **Image Operations** - Generate, Edit, Variation
- **Video Operations** - Create (text-to-video), Create (image-to-video), List, Retrieve, Delete, Remix
- **Parameter Validation** - Pre-flight validation catches invalid parameters before API calls
- **Security** - SSRF protection with DNS rebinding prevention, input validation, rate limiting, log sanitization
- **API Key Authentication** - Simple Bearer token authentication
- **Batch Processing** - Generate multiple images sequentially from multiple prompts
- **Async Video Polling** - Automatic progress tracking with spinner UI and cancellation support
- **Organized Storage** - Structured directories with timestamped files and metadata
- **CLI Orchestration** - Command-line tool for batch generation
- **Testing** - 207 tests with Vitest

## Models

### DALL-E 2

Image generation with multiple size options. Supports editing and variations.

**Parameters:**
- `prompt` - Text description of desired image (required for generation)
- `size` - Image dimensions (256x256, 512x512, 1024x1024)
- `n` - Number of images to generate (1-10)
- `image` - Input image for edits/variations (PNG with transparency)
- `mask` - Mask image for edits (PNG with transparency, edit areas transparent)

**Features:** Generate, edit, variations

### DALL-E 3

Image generation with HD support and style control.

**Parameters:**
- `prompt` - Text description of desired image (required)
- `size` - Image dimensions (1024x1024, 1792x1024 landscape, 1024x1792 portrait)
- `quality` - Output quality (standard, hd)
- `style` - Image style (vivid, natural)
- `n` - Always 1 (DALL-E 3 only generates one image at a time)

**Features:** HD quality, vivid/natural styles

### GPT Image 1

Image generation with transparency, multi-image editing, and compression control.

**Parameters:**
- `prompt` - Text description of desired image (required)
- `size` - Image dimensions (1024x1024, 1536x1024, 1024x1536, auto)
- `n` - Number of images to generate (1-10)
- `format` - Output format (png, jpeg, webp)
- `compression` - Compression quality (0-100, for JPEG/WebP)
- `transparency` - Enable transparent backgrounds (boolean)
- `images` - Multiple input images for editing (array)
- `moderation` - Content moderation control

**Features:** Transparent backgrounds, multi-image editing, compression, moderation control

**⚠️ IMPORTANT:** GPT Image 1 requires a verified organization. See [Organization Verification](#organization-verification) below.

### GPT Image 1.5

Same capabilities as GPT Image 1, plus partial image streaming support.

**Parameters:**
- `prompt` - Text description of desired image (required)
- `size` - Image dimensions (1024x1024, 1536x1024, 1024x1536, auto)
- `n` - Number of images to generate (1-10)
- `format` - Output format (png, jpeg, webp)
- `compression` - Compression quality (0-100, for JPEG/WebP)
- `transparency` - Enable transparent backgrounds (boolean)
- `images` - Multiple input images for editing (array)
- `moderation` - Content moderation control
- `partial_images` - Number of partial images to return during generation (0-3)

**Features:** All GPT Image 1 features, plus partial image streaming

**⚠️ IMPORTANT:** GPT Image 1.5 requires a verified organization. See [Organization Verification](#organization-verification) below.

### Sora 2

Video generation with text-to-video and image-to-video capabilities.

**Parameters:**
- `prompt` - Text description of desired video (required)
- `size` - Video dimensions (1280x720, 1920x1080, 1080x1920)
- `seconds` - Video duration: "4", "8", or "12" seconds
- `input_reference` - Optional reference image for image-to-video generation (PNG, JPEG, WebP)

**Features:** Text-to-video, image-to-video, video remixing, async polling with progress tracking

### Sora 2 Pro

Video generation with higher quality output.

**Parameters:**
- `prompt` - Text description of desired video (required)
- `size` - Video dimensions (1280x720, 1920x1080, 1080x1920)
- `seconds` - Video duration: "4", "8", or "12" seconds
- `input_reference` - Optional reference image for image-to-video generation (PNG, JPEG, WebP)

**Features:** Enhanced quality, text-to-video, image-to-video, video remixing

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
openai-img --api-key YOUR_API_KEY --dalle-3 --prompt "a cat"
```

#### Option B: Environment Variable

```bash
# Add to your ~/.bashrc, ~/.zshrc, or equivalent
export OPENAI_API_KEY=your_actual_api_key_here

# Or use it for a single command
OPENAI_API_KEY=your_key openai-img --dalle-3 --prompt "a cat"
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

### 3. Organization Verification (Required for GPT Image 1)

If you want to use the **gpt-image-1** model, you must verify your OpenAI organization. Without verification, you'll receive a 400-level error when attempting to use this model.

**Verification Process:**

1. Go to your [OpenAI Organization Settings](https://platform.openai.com/settings/organization/general)
2. Navigate to the verification section
3. Complete the KYC (Know Your Customer) process which requires:
   - Photo of government-issued ID
   - Selfie/photo of yourself
4. Wait for verification approval (typically processed within a few business days)

**Why is this required?** OpenAI requires organization verification for GPT Image 1 to prevent abuse and ensure responsible use of advanced image generation features like transparent backgrounds and multi-image editing.

**Note:** DALL-E 2 and DALL-E 3 do NOT require organization verification and can be used immediately with a valid API key.

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
# Clone the repository
git clone https://github.com/aself101/openai-image-api.git
cd openai-image-api

# Install dependencies
npm install
```

Dependencies:
- `axios` - HTTP client for API calls
- `commander` - CLI argument parsing
- `dotenv` - Environment variable management
- `form-data` - Multipart form data for file uploads
- `winston` - Logging framework
- `typescript` - TypeScript compiler (dev dependency)

## TypeScript Support

This package is written in TypeScript and includes full type definitions. All types are exported for use in your TypeScript projects.

### Importing Types

```typescript
import {
  OpenAIImageAPI,
  // Type definitions
  type GenerateImageParams,
  type EditImageParams,
  type VariationImageParams,
  type ImageResponse,
  type ImageModel,
  type APIOptions
} from 'openai-image-api';

import {
  OpenAIVideoAPI,
  type CreateVideoParams,
  type VideoObject,
  type ListVideosResponse,
  type VideoModel,
  type PollVideoOptions
} from 'openai-image-api/video-api';
```

### Project Structure

```
openai-api/
├── src/                    # TypeScript source files
│   ├── api.ts              # Image API class
│   ├── video-api.ts        # Video API class
│   ├── config.ts           # Configuration & validation
│   ├── utils.ts            # Utility functions
│   ├── cli.ts              # CLI entry point
│   └── types.ts            # Type definitions
├── dist/                   # Compiled JavaScript (generated)
├── test/                   # Test files (TypeScript)
└── tsconfig.json           # TypeScript configuration
```

### Building from Source

```bash
# Install dependencies
npm install

# Build TypeScript to JavaScript
npm run build

# Watch mode for development
npm run build:watch
```

## Quick Start

### Using the CLI

The CLI command depends on how you installed the package:

**If installed globally** (`npm install -g openai-image-api`):
```bash
openai-img --examples                         # Show usage examples
openai-img --dalle-3 --prompt "a cat"         # Generate with DALL-E 3
```

**If installed locally** in a project:
```bash
npx openai-img --examples                     # Show usage examples
npx openai-img --dalle-3 --prompt "a cat"     # Generate with DALL-E 3
```

**If working from source** (cloned repository):
```bash
npm run openai:examples                       # Show usage examples
npm run openai -- --dalle-3 --prompt "a cat"  # Generate
```

### Example Commands

```bash
# Show examples
openai-img --examples

# Generate with DALL-E 3
openai-img --dalle-3 --prompt "a serene mountain landscape"

# Generate with GPT Image 1 (transparent background)
openai-img --gpt-image-1 --prompt "a cute robot" --background transparent

# Edit image with DALL-E 2
openai-img --dalle-2 --edit --image photo.png --prompt "add snow"

# Batch generation
openai-img --dalle-3 \
  --prompt "a cat" \
  --prompt "a dog" \
  --prompt "a bird"
```

**Note:** Examples below use `openai-img` directly (global install). If using local install, prefix with `npx`: `npx openai-img --dalle-3 ...`

### Using the API Class Directly

```typescript
// If installed via npm
import { OpenAIImageAPI } from 'openai-image-api';

// If running from source
import { OpenAIImageAPI } from './dist/api.js';

// Initialize the API
const api = new OpenAIImageAPI();

// Generate with DALL-E 3
const result = await api.generateImage({
  prompt: 'a beautiful sunset',
  model: 'dall-e-3',
  size: '1024x1024',
  quality: 'hd',
  style: 'vivid'
});

console.log('Generated images:', result.data);
```

## CLI Usage

### Basic Command Structure

```bash
# Global install
openai-img [model] [options]

# Local install (use npx)
npx openai-img [model] [options]

# From source (development)
npm run openai -- [model] [options]
```

### Model Selection (Required)

Choose one model:

**Image Models:**
```bash
--dalle-2          # DALL-E 2
--dalle-3          # DALL-E 3
--gpt-image-1      # GPT Image 1
--gpt-image-15     # GPT Image 1.5 (adds partial image streaming)
```

**Video Models:**
```bash
--video --sora-2       # Sora 2
--video --sora-2-pro   # Sora 2 Pro
```

### Operation Mode

**Image Operations:**
```bash
# Default: generate new image
--edit             # Edit existing image(s)
--variation        # Create variations of image
```

**Video Operations:**
```bash
--video            # Enable video mode (required for video generation)
--list-videos      # List all videos
--delete-video <id> # Delete a video by ID
--remix-video <id>  # Remix an existing video
```

### Common Options

**Image Options:**
```bash
--prompt <text>                # Prompt (can specify multiple for batch)
--image <path>                 # Input image (required for edit/variation)
--mask <path>                  # Mask image for editing
--size <size>                  # Image size (e.g., 1024x1024)
--quality <quality>            # Image quality
--n <number>                   # Number of images to generate
--response-format <format>     # url or b64_json (dalle-2/3 only)
--output-dir <path>            # Custom output directory
--log-level <level>            # DEBUG, INFO, WARNING, ERROR
--dry-run                      # Preview without API call
--examples                     # Show usage examples
```

**Video Options:**
```bash
--prompt <text>                # Video description (required for generation)
--input-reference <path>       # Reference image for image-to-video
--size <dimensions>            # Video dimensions (1280x720, 1920x1080, 1080x1920)
--seconds <duration>           # Video duration ("4", "8", or "12")
--list-videos                  # List all videos
--delete-video <id>            # Delete a video by ID
--remix-video <id>             # Remix an existing video with new prompt
--output-dir <path>            # Custom output directory
--log-level <level>            # DEBUG, INFO, WARNING, ERROR
```

### DALL-E 3 Specific

```bash
--style <style>                # vivid or natural
--quality <quality>            # standard or hd
```

### GPT Image 1 Specific

```bash
--background <bg>              # auto, transparent, or opaque
--moderation <level>           # auto or low
--output-format <format>       # png, jpeg, or webp
--output-compression <0-100>   # Compression percentage
--input-fidelity <level>       # high or low (edit only)
```

### Utility Commands

```bash
# General
npm run openai:help            # Show help
npm run openai:examples        # Show usage examples

# Video-specific
npm run openai:sora-2          # Quick Sora 2 generation
npm run openai:sora-2-pro      # Quick Sora 2 Pro generation
npm run openai:list-videos     # List all videos
```

## API Methods

### Core Generation Methods

#### `generateImage(params)`

Generate image from text prompt.

```typescript
import { OpenAIImageAPI } from 'openai-image-api';

const api = new OpenAIImageAPI();

const result = await api.generateImage({
  prompt: 'a beautiful landscape',
  model: 'dall-e-3',
  size: '1024x1024',
  quality: 'hd',
  style: 'vivid'
});
```

#### `generateImageEdit(params)`

Edit existing image with prompt.

```javascript
const result = await api.generateImageEdit({
  image: './photo.png',  // or array for gpt-image-1
  prompt: 'add snow and winter atmosphere',
  model: 'dall-e-2',
  mask: './mask.png',    // optional
  size: '1024x1024'
});
```

#### `generateImageVariation(params)`

Create variations of existing image.

```javascript
const result = await api.generateImageVariation({
  image: './original.png',
  model: 'dall-e-2',
  n: 4,
  size: '1024x1024'
});
```

#### `saveImages(response, outputDir, baseFilename, format)`

Download and save images from API response.

```javascript
const savedPaths = await api.saveImages(
  response,
  './output',
  'my-image',
  'png'
);
```

### Video Generation Methods

#### `createVideo(params)`

Generate video from text prompt or reference image.

```typescript
import { OpenAIVideoAPI } from 'openai-image-api/video-api';

const api = new OpenAIVideoAPI();

// Text-to-video
const videoJob = await api.createVideo({
  prompt: 'a cat sitting on a windowsill watching the rain',
  model: 'sora-2',
  size: '1280x720',
  seconds: '4'
});

// Image-to-video
const videoFromImage = await api.createVideo({
  prompt: 'animate this scene with gentle movement',
  model: 'sora-2',
  input_reference: './reference.png',
  seconds: '8'
});
```

#### `retrieveVideo(videoId)`

Get the status and details of a video generation job.

```javascript
const video = await api.retrieveVideo('video_abc123');
console.log('Status:', video.status);
console.log('Progress:', video.progress);
```

#### `waitForVideo(videoId, options)`

Poll for video completion with automatic progress tracking.

```javascript
// Basic usage with spinner
const completedVideo = await api.waitForVideo('video_abc123');

// With custom options
const video = await api.waitForVideo('video_abc123', {
  interval: 5000,    // Poll every 5 seconds
  timeout: 600000,   // 10 minute timeout
  showSpinner: true  // Show progress spinner
});

// With cancellation support
const controller = new AbortController();
setTimeout(() => controller.abort(), 30000); // Cancel after 30s

try {
  const video = await api.waitForVideo('video_abc123', {
    signal: controller.signal
  });
} catch (error) {
  if (error.message.includes('cancelled')) {
    console.log('Video generation was cancelled');
  }
}
```

#### `listVideos(options)`

List all video generation jobs.

```javascript
const videos = await api.listVideos({ limit: 10 });
videos.data.forEach(video => {
  console.log(`${video.id}: ${video.status} (${video.progress}%)`);
});
```

#### `deleteVideo(videoId)`

Delete a video generation job.

```javascript
await api.deleteVideo('video_abc123');
console.log('Video deleted');
```

#### `remixVideo(videoId, newPrompt, model)`

Remix an existing video with a new prompt.

```typescript
const remixedJob = await api.remixVideo(
  'video_abc123',
  'make it more dramatic with lightning',
  'sora-2'
);

const remixed = await api.waitForVideo(remixedJob.id);
console.log('Remixed video ready:', remixed);
```

#### `downloadVideoContent(videoId, variant?)`

Download video content as a Buffer.

**Parameters:**
- `videoId` - Video ID to download (required)
- `variant` - Content variant: `'video'`, `'thumbnail'`, or `'spritesheet'` (default: `'video'`)

**Returns:** `Promise<Buffer>` containing video/image data

```typescript
import { writeFile } from 'fs/promises';

const completedVideo = await api.waitForVideo('video_abc123');

// Download the video
const videoBuffer = await api.downloadVideoContent(completedVideo.id);
await writeFile('output.mp4', videoBuffer);

// Or download thumbnail
const thumbnail = await api.downloadVideoContent(completedVideo.id, 'thumbnail');
await writeFile('thumbnail.jpg', thumbnail);

// Or download spritesheet
const spritesheet = await api.downloadVideoContent(completedVideo.id, 'spritesheet');
await writeFile('spritesheet.jpg', spritesheet);
```

#### `createAndPoll(params, pollOptions?)`

Create video and automatically poll for completion. Convenience method that combines `createVideo()` and `waitForVideo()`.

**Parameters:**
- `params` - Same as `createVideo()` parameters
- `pollOptions` - Same as `waitForVideo()` options (interval, timeout, showSpinner)

**Returns:** `Promise<VideoObject>` - Completed video object

```typescript
// Create and wait in one call
const completedVideo = await api.createAndPoll({
  prompt: 'a serene mountain lake at dawn',
  model: 'sora-2',
  seconds: '8'
}, {
  showSpinner: true  // Show progress spinner
});

// Video is ready, download it
const buffer = await api.downloadVideoContent(completedVideo.id);
```

## Examples

### Example 1: Basic Text-to-Image with DALL-E 3

```bash
npm run openai -- --dalle-3 \
  --prompt "a serene mountain landscape at sunset" \
  --size 1024x1024 \
  --quality hd \
  --style vivid
```

### Example 2: GPT Image 1 with Transparent Background

```bash
npm run openai -- --gpt-image-1 \
  --prompt "a cute robot character" \
  --background transparent \
  --output-format png \
  --quality high
```

### Example 3: DALL-E 2 Image Editing

```bash
npm run openai -- --dalle-2 --edit \
  --image photo.png \
  --mask mask.png \
  --prompt "add snow and winter atmosphere" \
  --size 1024x1024
```

### Example 4: GPT Image 1 Multi-Image Editing

```bash
npm run openai -- --gpt-image-1 --edit \
  --image image1.png \
  --image image2.png \
  --image image3.png \
  --prompt "combine these into a collage" \
  --input-fidelity high
```

### Example 5: DALL-E 2 Image Variations

```bash
npm run openai -- --dalle-2 --variation \
  --image original.png \
  --n 4 \
  --size 1024x1024
```

### Example 6: Batch Generation

```bash
npm run openai -- --dalle-3 \
  --prompt "a red apple" \
  --prompt "a green pear" \
  --prompt "a yellow banana" \
  --quality hd
```

### Example 7: Using API Class in Code

```typescript
import { OpenAIImageAPI } from 'openai-image-api';

const api = new OpenAIImageAPI();

// Generate with DALL-E 3
const result = await api.generateImage({
  prompt: 'cinematic landscape',
  model: 'dall-e-3',
  size: '1792x1024',
  quality: 'hd',
  style: 'vivid'
});

// Save images
const savedPaths = await api.saveImages(
  result,
  './output/dalle-3',
  'landscape',
  'png'
);

console.log('Generated images:', savedPaths);
```

### Example 8: Basic Video Generation with Sora 2

```bash
npm run openai -- --video --sora-2 \
  --prompt "a cat sitting on a windowsill watching the rain" \
  --seconds 4 \
  --size 1280x720
```

### Example 9: Image-to-Video with Reference Image

```bash
npm run openai -- --video --sora-2 \
  --prompt "animate this scene with gentle waves" \
  --input-reference beach-photo.jpg \
  --seconds 8 \
  --size 1920x1080
```

### Example 10: High-Quality Video with Sora 2 Pro

```bash
npm run openai -- --video --sora-2-pro \
  --prompt "cinematic aerial view of mountains at sunrise" \
  --seconds 12 \
  --size 1920x1080
```

### Example 11: List and Manage Videos

```bash
# List all videos
npm run openai:list-videos

# Delete a specific video
npm run openai -- --delete-video video_abc123

# Remix an existing video
npm run openai -- --video --sora-2 \
  --remix-video video_abc123 \
  --prompt "add dramatic lightning effects"
```

### Example 12: Using Video API in Code

```typescript
import { OpenAIVideoAPI } from 'openai-image-api/video-api';
import { writeFile } from 'fs/promises';

const api = new OpenAIVideoAPI();

// Create video
const videoJob = await api.createVideo({
  prompt: 'a serene mountain lake at dawn',
  model: 'sora-2',
  size: '1920x1080',
  seconds: '8'
});

console.log('Video job created:', videoJob.id);

// Wait for completion with progress tracking
const completedVideo = await api.waitForVideo(videoJob.id);

console.log('Video ready!');
console.log('Video ID:', completedVideo.id);
console.log('Status:', completedVideo.status);
console.log('Duration:', completedVideo.seconds, 'seconds');

// Download the video content
const videoBuffer = await api.downloadVideoContent(completedVideo.id);
await writeFile('output.mp4', videoBuffer);
console.log('Video saved:', videoBuffer.length, 'bytes');
```

## Data Organization

Generated images/videos and metadata are organized by model:

```
datasets/
└── openai/
    ├── dalle-2/
    │   ├── 2025-01-13_143022_dalle-2_mountain_landscape.png
    │   ├── 2025-01-13_143022_dalle-2_mountain_landscape_metadata.json
    │   └── ...
    ├── dalle-3/
    │   └── ...
    ├── gpt-image-1/
    │   └── ...
    ├── sora-2/
    │   ├── 2025-11-20_04-28-05_sora-2_a_cat_sitting_on_a_windowsill_watching_t.mp4
    │   ├── 2025-11-20_04-28-05_sora-2_a_cat_sitting_on_a_windowsill_watching_t.json
    │   └── ...
    └── sora-2-pro/
        └── ...
```

**Image Metadata Format:**

```json
{
  "model": "dall-e-3",
  "operation": "generate",
  "timestamp": "2025-01-13T14:30:22Z",
  "parameters": {
    "prompt": "a serene mountain landscape",
    "size": "1024x1024",
    "quality": "hd",
    "style": "vivid"
  },
  "response": {
    "created": 1234567890,
    "images": ["datasets/openai/dalle-3/..."],
    "usage": {
      "total_tokens": 100
    }
  }
}
```

**Video Metadata Format:**

```json
{
  "id": "video_abc123",
  "object": "video",
  "created_at": 1763612808,
  "status": "completed",
  "model": "sora-2",
  "progress": 100,
  "seconds": "4",
  "size": "1280x720",
  "prompt": "a cat sitting on a windowsill watching the rain",
  "remixed_from_video_id": null,
  "error": null,
  "timestamp": "2025-11-20T04:28:05.911Z"
}
```

## Testing

### Run Tests

```bash
cd openai-api

# Run all tests
npm test

# Watch mode for development
npm run test:watch

# Interactive UI
npm run test:ui

# Generate coverage report
npm run test:coverage
```

### Test Coverage

The test suite includes 207 tests covering:

**Image API (128 tests):**
- API authentication and key validation
- All three generation methods (generate, edit, variation)
- All three models (DALL-E 2, DALL-E 3, GPT Image 1)
- Parameter validation for each model
- Error handling scenarios
- Utility functions (file I/O, image conversion, filename generation)
- Configuration management

**Video API (116 tests):**
- Video creation (text-to-video, image-to-video)
- Video retrieval and polling with progress tracking
- Video listing, deletion, and remixing
- Request cancellation with AbortController
- Parameter validation for Sora models
- Error handling and retry logic
- Security features (HTTPS enforcement, API key redaction)
- Utility functions (polling, file I/O, metadata storage)

## Error Handling

### Common Errors

#### Authentication Failed (401)

```
Error: Authentication failed. Please check your API key.
```

**Solution:** Verify your API key is correct in `.env` or environment variable.

#### Bad Request (400)

```
Error: Bad request: Invalid parameters
```

**Solution:** Check parameter validation errors. Common issues:
- Invalid size for the model
- Prompt too long for the model
- Invalid quality/style options
- n > 1 for DALL-E 3

#### Rate Limit (429)

```
Error: Rate limit exceeded. Please try again later.
```

**Solution:** Wait and retry. Consider reducing request frequency.

#### Parameter Validation

```
Error: Parameter validation failed:
  - Invalid size "2048x2048" for dall-e-2. Valid sizes: 256x256, 512x512, 1024x1024
```

**Solution:** Use valid parameters for the selected model. Check model constraints in documentation.

## Troubleshooting

### API Key Not Found

```
Error: OPENAI_API_KEY not found
```

**Solution:** Create `.env` file with your API key:
```bash
OPENAI_API_KEY=your_api_key_here
```

### Module Not Found

```
Error: Cannot find module 'axios'
```

**Solution:** Install dependencies:
```bash
cd openai-api
npm install
```

### Model Not Supported

```
Error: Model dall-e-3 does not support image editing
```

**Solution:** Use DALL-E 2 or GPT Image 1 for editing operations.

### Organization Not Verified (GPT Image 1)

```
Error: Bad request: Invalid parameters (400)
```

If you're trying to use GPT Image 1 and receiving a 400-level error despite valid parameters, your organization likely needs verification.

**Solution:** Complete the organization verification process:
1. Visit [OpenAI Organization Settings](https://platform.openai.com/settings/organization/general)
2. Complete KYC verification with ID and selfie
3. Wait for approval (usually a few business days)
4. Retry your request after verification is complete

See [Organization Verification](#organization-verification) for more details.

## Development Scripts

**Image Generation:**
```bash
npm run openai              # Run CLI
npm run openai:help         # Show help
npm run openai:examples     # Show usage examples
npm run openai:dalle2       # Use DALL-E 2
npm run openai:dalle3       # Use DALL-E 3
npm run openai:gpt-image    # Use GPT Image 1
```

**Video Generation:**
```bash
npm run openai:sora-2       # Use Sora 2
npm run openai:sora-2-pro   # Use Sora 2 Pro
npm run openai:list-videos  # List all videos
```

Pass additional flags with `--`:

```bash
npm run openai:dalle3 -- --prompt "a cat" --quality hd
npm run openai:sora-2 -- --prompt "a cat on a windowsill" --seconds 4
```

## Model Comparison

### Image Models

| Feature | DALL-E 2 | DALL-E 3 | GPT Image 1 | GPT Image 1.5 |
|---------|----------|----------|-------------|---------------|
| Text-to-Image | ✓ | ✓ | ✓ | ✓ |
| Image Editing | ✓ | ✗ | ✓ | ✓ |
| Image Variations | ✓ | ✗ | ✗ | ✗ |
| Max Images (n) | 10 | 1 | 10 | 10 |
| HD Quality | ✗ | ✓ | ✓ | ✓ |
| Styles | ✗ | vivid/natural | ✗ | ✗ |
| Transparent BG | ✗ | ✗ | ✓ | ✓ |
| Multi-image Edit | ✗ | ✗ | ✓ (16 images) | ✓ (16 images) |
| Compression Control | ✗ | ✗ | ✓ | ✓ |
| Partial Images | ✗ | ✗ | ✗ | ✓ (0-3) |
| Output Formats | PNG | PNG | PNG/JPEG/WebP | PNG/JPEG/WebP |

### Video Models

| Feature | Sora 2 | Sora 2 Pro |
|---------|--------|------------|
| Text-to-Video | ✓ | ✓ |
| Image-to-Video | ✓ | ✓ |
| Video Remixing | ✓ | ✓ |
| Max Duration | 12s | 12s |
| Resolutions | 720p, 1080p, portrait | 720p, 1080p, portrait |
| Quality | Standard | Enhanced |
| Async Processing | ✓ | ✓ |
| Progress Tracking | ✓ | ✓ |
| Cancellation | ✓ | ✓ |

## Additional Resources

- [OpenAI Image API Documentation](https://platform.openai.com/docs/api-reference/images)
- [OpenAI Video API Documentation](https://platform.openai.com/docs/api-reference/video)
- [OpenAI Platform](https://platform.openai.com/)
- [Image Generation Guide](https://platform.openai.com/docs/guides/images)

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

---

**Note:** This service implements:
- **Image Generation**: All three endpoints (create, edit, variation) for DALL-E 2, DALL-E 3, and GPT Image 1
- **Video Generation**: Complete Sora API integration with text-to-video, image-to-video, remixing, and async polling
- **Security**: SSRF protection, input validation, API key redaction, and error sanitization
- **Reliability**: 207 tests, parameter validation, and automatic retry with exponential backoff
