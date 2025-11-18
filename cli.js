#!/usr/bin/env node

/**
 * OpenAI Image Generation - Main CLI Script
 *
 * Command-line tool for generating, editing, and creating variations of images
 * using OpenAI's image generation API (DALL-E 2, DALL-E 3, GPT Image 1).
 *
 * Usage:
 *   openai-img --dalle-3 --prompt "a cat" --size 1024x1024
 *   openai-img --gpt-image-1 --prompt "landscape" --background transparent
 *   openai-img --dalle-2 --edit --image photo.png --prompt "add a hat"
 *   openai-img --dalle-2 --variation --image photo.png --n 3
 */

import { Command } from 'commander';
import path from 'path';
import { fileURLToPath } from 'url';
import { OpenAIImageAPI } from './api.js';
import {
  generateTimestampedFilename,
  writeToFile,
  ensureDirectory,
  setLogLevel,
  createSpinner,
  logger
} from './utils.js';
import { getOutputDir, getModelConstraints, MODELS } from './config.js';

// ES module dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

/**
 * Display usage examples.
 */
function showExamples() {
  console.log(`
${'='.repeat(70)}
OPENAI IMAGE GENERATION - USAGE EXAMPLES
${'='.repeat(70)}

1. DALL-E 2 - Basic text-to-image
   $ openai-img --dalle-2 \\
       --prompt "a serene mountain landscape at sunset" \\
       --size 1024x1024 \\
       --n 2

2. DALL-E 3 - High quality with style
   $ openai-img --dalle-3 \\
       --prompt "photorealistic portrait of an astronaut" \\
       --size 1024x1792 \\
       --quality hd \\
       --style vivid

3. DALL-E 3 - Natural style
   $ openai-img --dalle-3 \\
       --prompt "minimalist interior design" \\
       --style natural \\
       --size 1792x1024

4. GPT Image 1 - Advanced text-to-image with transparent background
   $ openai-img --gpt-image-1 \\
       --prompt "a cute robot character" \\
       --background transparent \\
       --output-format png \\
       --quality high

5. GPT Image 1 - Multiple sizes and compression
   $ openai-img --gpt-image-1 \\
       --prompt "abstract digital art" \\
       --size 1536x1024 \\
       --output-format webp \\
       --output-compression 85 \\
       --quality medium

6. DALL-E 2 - Image editing with mask
   $ openai-img --dalle-2 --edit \\
       --image photo.png \\
       --mask mask.png \\
       --prompt "add snow and winter atmosphere" \\
       --size 1024x1024

7. GPT Image 1 - Multi-image editing
   $ openai-img --gpt-image-1 --edit \\
       --image image1.png \\
       --image image2.png \\
       --image image3.png \\
       --prompt "combine these into a collage" \\
       --input-fidelity high

8. DALL-E 2 - Image variations
   $ openai-img --dalle-2 --variation \\
       --image original.png \\
       --n 4 \\
       --size 1024x1024

9. Batch generation with multiple prompts
   $ openai-img --dalle-3 \\
       --prompt "a red apple" \\
       --prompt "a green pear" \\
       --prompt "a yellow banana" \\
       --quality hd

10. GPT Image 1 - Low moderation for artistic freedom
    $ openai-img --gpt-image-1 \\
        --prompt "surreal artistic scene" \\
        --moderation low \\
        --quality high \\
        --size 1536x1024

11. Save to custom directory
    $ openai-img --dalle-3 \\
        --prompt "sunset over ocean" \\
        --output-dir ./my-images \\
        --quality hd

12. Generate with specific response format (URL vs base64)
    $ openai-img --dalle-2 \\
        --prompt "cityscape at night" \\
        --response-format url

${'='.repeat(70)}
MODEL COMPARISON
${'='.repeat(70)}

DALL-E 2:
  - Sizes: 256x256, 512x512, 1024x1024
  - Features: Basic generation, editing, variations
  - Cost: Lower cost per image
  - Speed: Faster generation

DALL-E 3:
  - Sizes: 1024x1024, 1792x1024, 1024x1792
  - Features: HD quality, vivid/natural styles
  - Quality: Higher quality, more detailed
  - Note: Only generates 1 image at a time (n=1)

GPT Image 1:
  - Sizes: 1024x1024, 1536x1024, 1024x1536, auto
  - Features: Transparent backgrounds, multi-image editing, compression
  - Advanced: Input fidelity, moderation control, multiple formats
  - Note: Always returns base64-encoded images

${'='.repeat(70)}
`);
}

/**
 * Parse and validate CLI arguments.
 */
program
  .name('openai-img')
  .description('OpenAI Image Generation CLI - DALL-E and GPT Image models')
  .version('1.0.1');

// Model selection (mutually exclusive)
program
  .option('--dalle-2', 'Use DALL-E 2 model')
  .option('--dalle-3', 'Use DALL-E 3 model')
  .option('--gpt-image-1', 'Use GPT Image 1 model');

// Operation mode
program
  .option('--edit', 'Edit existing image(s) with prompt')
  .option('--variation', 'Create variations of existing image');

// Common parameters
program
  .option('--prompt <text>', 'Text prompt (can specify multiple for batch)', (value, previous) => {
    return previous ? [...previous, value] : [value];
  }, [])
  .option('--image <path>', 'Input image path (can specify multiple for gpt-image-1)', (value, previous) => {
    return previous ? [...previous, value] : [value];
  }, [])
  .option('--mask <path>', 'Mask image path for editing')
  .option('--size <size>', 'Image size (e.g., 1024x1024)')
  .option('--quality <quality>', 'Image quality (auto, low, medium, high for gpt-image-1; standard, hd for dalle-3)')
  .option('--n <number>', 'Number of images to generate', parseInt)
  .option('--response-format <format>', 'Response format: url or b64_json (dalle-2/3 only)')
  .option('--user <id>', 'User identifier for monitoring');

// DALL-E 3 specific
program
  .option('--style <style>', 'Style: vivid or natural (dalle-3 only)');

// GPT Image 1 specific
program
  .option('--background <bg>', 'Background: auto, transparent, or opaque (gpt-image-1 only)')
  .option('--moderation <level>', 'Moderation: auto or low (gpt-image-1 only)')
  .option('--output-format <format>', 'Output format: png, jpeg, or webp (gpt-image-1 only)')
  .option('--output-compression <percent>', 'Compression 0-100 (gpt-image-1 only)', parseInt)
  .option('--input-fidelity <level>', 'Input fidelity: high or low (gpt-image-1 edit only)');

// API and output configuration
program
  .option('--api-key <key>', 'OpenAI API key (overrides environment variable)')
  .option('--output-dir <path>', 'Output directory for generated images')
  .option('--log-level <level>', 'Log level: DEBUG, INFO, WARNING, ERROR', 'INFO')
  .option('--dry-run', 'Validate parameters without making API call')
  .option('--examples', 'Show usage examples');

program.parse(process.argv);
const options = program.opts();

/**
 * Main CLI execution.
 */
async function main() {
  try {
    // Show examples if requested
    if (options.examples) {
      showExamples();
      process.exit(0);
    }

    // Set log level
    if (options.logLevel) {
      setLogLevel(options.logLevel);
    }

    // Determine model
    let model = 'dall-e-2'; // default
    if (options.dalle2) model = MODELS['dalle-2'];
    if (options.dalle3) model = MODELS['dalle-3'];
    if (options.gptImage1) model = MODELS['gpt-image-1'];

    // Determine operation mode
    const isEdit = options.edit;
    const isVariation = options.variation;
    const isGenerate = !isEdit && !isVariation;

    // Validate operation mode with model
    const constraints = getModelConstraints(model);
    if (isEdit && !constraints.supportsEdit) {
      throw new Error(`Model ${model} does not support image editing`);
    }
    if (isVariation && !constraints.supportsVariation) {
      throw new Error(`Model ${model} does not support image variations`);
    }

    // Validate required parameters
    if (isGenerate && options.prompt.length === 0) {
      throw new Error('--prompt is required for image generation');
    }
    if ((isEdit || isVariation) && options.image.length === 0) {
      throw new Error('--image is required for edit/variation operations');
    }
    if (isEdit && options.prompt.length === 0) {
      throw new Error('--prompt is required for image editing');
    }

    // Initialize API
    const api = new OpenAIImageAPI({
      apiKey: options.apiKey,
      logLevel: options.logLevel
    });

    // Determine output directory
    const modelDir = model.replace('dall-e-', 'dalle-');
    const outputDir = options.outputDir || path.join(getOutputDir(), modelDir);
    await ensureDirectory(outputDir);

    logger.info(`Using model: ${model}`);
    logger.info(`Operation: ${isEdit ? 'edit' : isVariation ? 'variation' : 'generate'}`);
    logger.info(`Output directory: ${outputDir}`);

    // Process requests
    if (isGenerate) {
      // Batch generation: process each prompt
      for (let i = 0; i < options.prompt.length; i++) {
        const prompt = options.prompt[i];
        const promptNum = options.prompt.length > 1 ? ` [${i + 1}/${options.prompt.length}]` : '';

        logger.info(`\n${'='.repeat(60)}`);
        logger.info(`Processing prompt${promptNum}: "${prompt.substring(0, 60)}..."`);
        logger.info(`${'='.repeat(60)}`);

        // Build parameters
        const params = {
          prompt,
          model,
          size: options.size,
          quality: options.quality,
          n: options.n,
          style: options.style,
          background: options.background,
          moderation: options.moderation,
          output_format: options.outputFormat,
          output_compression: options.outputCompression,
          response_format: options.responseFormat,
          user: options.user
        };

        if (options.dryRun) {
          logger.info('Dry run - parameters validated successfully:');
          logger.info(JSON.stringify(params, null, 2));
          continue;
        }

        const spinner = createSpinner('Generating image').start();

        try {
          const response = await api.generateImage(params);

          spinner.stop('Image generation complete');

          // Determine output format
          let outputFormat = 'png';
          if (options.outputFormat) {
            outputFormat = options.outputFormat;
          } else if (response.output_format) {
            outputFormat = response.output_format;
          }

          // Save images
          const baseFilename = generateTimestampedFilename(prompt, modelDir, outputFormat);
          const savedPaths = await api.saveImages(
            response,
            outputDir,
            baseFilename.replace(`.${outputFormat}`, ''),
            outputFormat
          );

          // Save metadata
          const metadataPath = path.join(
            outputDir,
            baseFilename.replace(`.${outputFormat}`, '_metadata.json')
          );
          await writeToFile({
            model,
            operation: 'generate',
            timestamp: new Date().toISOString(),
            parameters: params,
            response: {
              created: response.created,
              images: savedPaths,
              usage: response.usage
            }
          }, metadataPath);

          logger.info(`\n✓ Success! Generated ${savedPaths.length} image(s):`);
          savedPaths.forEach(p => logger.info(`  - ${p}`));
          logger.info(`  - ${metadataPath}`);

        } catch (error) {
          spinner.fail(`Generation failed: ${error.message}`);
          if (options.prompt.length > 1) {
            logger.error('Continuing with next prompt...');
          } else {
            throw error;
          }
        }
      }

    } else if (isEdit) {
      // Image editing
      const prompt = options.prompt[0];
      if (!prompt) {
        throw new Error('--prompt is required for editing');
      }

      logger.info(`\n${'='.repeat(60)}`);
      logger.info(`Editing ${options.image.length} image(s) with prompt: "${prompt.substring(0, 50)}..."`);
      logger.info(`${'='.repeat(60)}`);

      const params = {
        image: options.image.length === 1 ? options.image[0] : options.image,
        prompt,
        model,
        mask: options.mask,
        size: options.size,
        quality: options.quality,
        n: options.n,
        input_fidelity: options.inputFidelity,
        background: options.background,
        output_format: options.outputFormat,
        output_compression: options.outputCompression,
        response_format: options.responseFormat,
        user: options.user
      };

      if (options.dryRun) {
        logger.info('Dry run - parameters validated successfully:');
        logger.info(JSON.stringify(params, null, 2));
        return;
      }

      const spinner = createSpinner('Editing image').start();

      try {
        const response = await api.generateImageEdit(params);

        spinner.stop('Image edit complete');

        // Determine output format
        let outputFormat = 'png';
        if (options.outputFormat) {
          outputFormat = options.outputFormat;
        } else if (response.output_format) {
          outputFormat = response.output_format;
        }

        // Save images
        const baseFilename = generateTimestampedFilename(prompt, `${modelDir}-edit`, outputFormat);
        const savedPaths = await api.saveImages(
          response,
          outputDir,
          baseFilename.replace(`.${outputFormat}`, ''),
          outputFormat
        );

        // Save metadata
        const metadataPath = path.join(
          outputDir,
          baseFilename.replace(`.${outputFormat}`, '_metadata.json')
        );
        await writeToFile({
          model,
          operation: 'edit',
          timestamp: new Date().toISOString(),
          parameters: params,
          response: {
            created: response.created,
            images: savedPaths,
            usage: response.usage
          }
        }, metadataPath);

        logger.info(`\n✓ Success! Generated ${savedPaths.length} edited image(s):`);
        savedPaths.forEach(p => logger.info(`  - ${p}`));
        logger.info(`  - ${metadataPath}`);

      } catch (error) {
        spinner.fail(`Edit failed: ${error.message}`);
        throw error;
      }

    } else if (isVariation) {
      // Image variations
      const imagePath = options.image[0];
      if (!imagePath) {
        throw new Error('--image is required for variations');
      }

      logger.info(`\n${'='.repeat(60)}`);
      logger.info(`Creating variations of: ${imagePath}`);
      logger.info(`${'='.repeat(60)}`);

      const params = {
        image: imagePath,
        model,
        n: options.n || 2,
        size: options.size,
        response_format: options.responseFormat,
        user: options.user
      };

      if (options.dryRun) {
        logger.info('Dry run - parameters validated successfully:');
        logger.info(JSON.stringify(params, null, 2));
        return;
      }

      const spinner = createSpinner('Creating variations').start();

      try {
        const response = await api.generateImageVariation(params);

        spinner.stop('Variations created');

        // Save images
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        const baseFilename = `${timestamp}_${modelDir}-variation`;
        const savedPaths = await api.saveImages(
          response,
          outputDir,
          baseFilename,
          'png'
        );

        // Save metadata
        const metadataPath = path.join(outputDir, `${baseFilename}_metadata.json`);
        await writeToFile({
          model,
          operation: 'variation',
          timestamp: new Date().toISOString(),
          parameters: params,
          response: {
            created: response.created,
            images: savedPaths
          }
        }, metadataPath);

        logger.info(`\n✓ Success! Generated ${savedPaths.length} variation(s):`);
        savedPaths.forEach(p => logger.info(`  - ${p}`));
        logger.info(`  - ${metadataPath}`);

      } catch (error) {
        spinner.fail(`Variation failed: ${error.message}`);
        throw error;
      }
    }

    logger.info('\n✓ All operations completed successfully!\n');

  } catch (error) {
    logger.error(`\n✗ Error: ${error.message}\n`);
    process.exit(1);
  }
}

// Run main function
main();
