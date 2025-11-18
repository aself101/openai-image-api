# OpenAI Image Generation Service

[![npm version](https://img.shields.io/npm/v/openai-image-api.svg)](https://www.npmjs.com/package/openai-image-api)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js Version](https://img.shields.io/node/v/openai-image-api)](https://nodejs.org)
[![Tests](https://img.shields.io/badge/tests-128%20passing-brightgreen)](test/)

A Node.js wrapper for the [OpenAI Image Generation API](https://platform.openai.com/docs/api-reference/images) that provides easy access to DALL-E 2, DALL-E 3, and GPT Image 1 models. Generate, edit, and create variations of AI images with a simple command-line interface.

This service follows the data-collection architecture pattern with organized data storage, comprehensive logging, parameter validation, and CLI orchestration.

## Quick Start

### CLI Usage
```bash
# Install globally
npm install -g openai-image-api

export OPENAI_API_KEY="your-api-key-here"

# Generate an image
openai-img --dalle-3 --prompt "a serene mountain landscape"
```

### Programmatic Usage
```javascript
import { OpenAIImageAPI } from 'openai-image-api';

const api = new OpenAIImageAPI();

// Generate an image with DALL-E 3
const result = await api.generateDallE3({
  prompt: 'a serene mountain landscape',
  quality: 'hd',
  size: '1792x1024'
});

console.log('Image URL:', result.data[0].url);
```

## Table of Contents

- [Overview](#overview)
- [Models](#models)
- [Authentication Setup](#authentication-setup)
- [Installation](#installation)
- [CLI Usage](#cli-usage)
- [API Methods](#api-methods)
- [Examples](#examples)
- [Data Organization](#data-organization)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Overview

The OpenAI Image Generation API provides access to state-of-the-art image generation models. This Node.js service implements:

- **3 Generation Models** - DALL-E 2, DALL-E 3, GPT Image 1
- **3 Operation Modes** - Generate, Edit, Variation
- **Parameter Validation** - Pre-flight validation catches invalid parameters before API calls
- **Security Hardened** - SSRF protection, input validation, rate limiting, log sanitization
- **API Key Authentication** - Simple Bearer token authentication
- **Batch Processing** - Generate multiple images sequentially from multiple prompts
- **Organized Storage** - Structured directories with timestamped files and metadata
- **CLI Orchestration** - Command-line tool for easy batch generation
- **Comprehensive Testing** - 128 tests with Vitest for reliability

## Models

### DALL-E 2

Basic image generation with multiple size options and variations support.

**Best for:** Cost-effective generation, creating variations, simple edits

**Parameters:**
- `prompt` - Text description of desired image (required for generation)
- `size` - Image dimensions (256x256, 512x512, 1024x1024)
- `n` - Number of images to generate (1-10)
- `image` - Input image for edits/variations (PNG with transparency)
- `mask` - Mask image for edits (PNG with transparency, edit areas transparent)

**Features:** Generate, edit, variations

### DALL-E 3

High-quality image generation with HD support and style control.

**Best for:** Professional quality, detailed images, specific styles

**Parameters:**
- `prompt` - Text description of desired image (required)
- `size` - Image dimensions (1024x1024, 1792x1024 landscape, 1024x1792 portrait)
- `quality` - Output quality (standard, hd)
- `style` - Image style (vivid, natural)
- `n` - Always 1 (DALL-E 3 only generates one image at a time)

**Features:** HD quality, vivid/natural styles

### GPT Image 1

Advanced image generation with transparency, multi-image editing, and compression control.

**Best for:** Transparent backgrounds, multi-image edits, advanced control

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

```javascript
// If installed via npm
import { OpenAIImageAPI } from 'openai-image-api';

// If running from source
import { OpenAIImageAPI } from './api.js';

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

```bash
--dalle-2          # DALL-E 2 - Basic generation
--dalle-3          # DALL-E 3 - High quality
--gpt-image-1      # GPT Image 1 - Advanced features
```

### Operation Mode

```bash
# Default: generate new image
--edit             # Edit existing image(s)
--variation        # Create variations of image
```

### Common Options

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
npm run openai:help            # Show help
npm run openai:examples        # Show usage examples
```

## API Methods

### Core Generation Methods

#### `generateImage(params)`

Generate image from text prompt.

```javascript
import { OpenAIImageAPI } from './api.js';

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

```javascript
// If installed via npm
import { OpenAIImageAPI } from 'openai-image-api';

// If running from source
// import { OpenAIImageAPI } from './api.js';

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

## Data Organization

Generated images and metadata are organized by model:

```
datasets/
└── openai/
    ├── dalle-2/
    │   ├── 2025-01-13_143022_dalle-2_mountain_landscape.png
    │   ├── 2025-01-13_143022_dalle-2_mountain_landscape_metadata.json
    │   └── ...
    ├── dalle-3/
    │   └── ...
    └── gpt-image-1/
        └── ...
```

**Metadata Format:**

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

The test suite includes 128 tests covering:
- API authentication and key validation
- All three generation methods (generate, edit, variation)
- All three models (DALL-E 2, DALL-E 3, GPT Image 1)
- Parameter validation for each model
- Error handling scenarios
- Utility functions (file I/O, image conversion, filename generation)
- Configuration management

## Error Handling

The service includes comprehensive error handling:

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

```bash
npm run openai              # Run CLI
npm run openai:help         # Show help
npm run openai:examples     # Show usage examples
npm run openai:dalle2       # Use DALL-E 2
npm run openai:dalle3       # Use DALL-E 3
npm run openai:gpt-image    # Use GPT Image 1
```

Pass additional flags with `--`:

```bash
npm run openai:dalle3 -- --prompt "a cat" --quality hd
```

## Model Comparison

| Feature | DALL-E 2 | DALL-E 3 | GPT Image 1 |
|---------|----------|----------|-------------|
| Text-to-Image | ✓ | ✓ | ✓ |
| Image Editing | ✓ | ✗ | ✓ |
| Image Variations | ✓ | ✗ | ✗ |
| Max Images (n) | 10 | 1 | 10 |
| HD Quality | ✗ | ✓ | ✓ |
| Styles | ✗ | vivid/natural | ✗ |
| Transparent BG | ✗ | ✗ | ✓ |
| Multi-image Edit | ✗ | ✗ | ✓ (16 images) |
| Compression Control | ✗ | ✗ | ✓ |
| Output Formats | PNG | PNG | PNG/JPEG/WebP |

## Additional Resources

- [OpenAI API Documentation](https://platform.openai.com/docs/api-reference/images)
- [OpenAI Platform](https://platform.openai.com/)
- [Image Generation Guide](https://platform.openai.com/docs/guides/images)

## Related Packages

- [`bfl-api`](https://github.com/aself101/bfl-api) – FLUX & Kontext
- [`stability-ai-api`](https://github.com/aself101/stability-ai-api) – Stable Diffusion 3.5 + upscalers

---

**Disclaimer:** This project is an independent community wrapper and is not affiliated with OpenAI.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

---

**Note:** This service implements all three image generation endpoints (create, edit, variation) with comprehensive parameter validation and error handling.
