#!/usr/bin/env node
/**
 * OpenAI Image & Video Generation - Main CLI Script
 *
 * Command-line tool for generating, editing, and creating variations of images
 * using OpenAI's image generation API (DALL-E 2, DALL-E 3, GPT Image 1),
 * and generating videos using Sora (Sora 2, Sora 2 Pro).
 *
 * Image Usage:
 *   openai-img --dalle-3 --prompt "a cat" --size 1024x1024
 *   openai-img --gpt-image-1 --prompt "landscape" --background transparent
 *   openai-img --dalle-2 --edit --image photo.png --prompt "add a hat"
 *   openai-img --dalle-2 --variation --image photo.png --n 3
 *
 * Video Usage:
 *   openai-img --video --sora-2 --prompt "a cat on a motorcycle" --seconds 8
 *   openai-img --video --sora-2-pro --input-image frame.jpg --prompt "she walks away"
 *   openai-img --remix-video video_123 --prompt "change to teal colors"
 *   openai-img --list-videos --limit 20
 */
import { Command } from 'commander';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { OpenAIImageAPI, OpenAIVideoAPI } from './api.js';
import { generateTimestampedFilename, generateVideoFilename, writeToFile, ensureDirectory, setLogLevel, createSpinner, logger, saveVideoFile, saveVideoMetadata, } from './utils.js';
import { getOutputDir, getModelConstraints, MODELS, VIDEO_MODELS } from './config.js';
// ES module dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
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
VIDEO GENERATION (SORA)
${'='.repeat(70)}

13. Sora 2 - Basic text-to-video
    $ openai-img --video --sora-2 \\
        --prompt "a cat riding a motorcycle through the night" \\
        --seconds 8 \\
        --size 1280x720

14. Sora 2 Pro - High quality video with reference image
    $ openai-img --video --sora-2-pro \\
        --input-image first_frame.jpg \\
        --prompt "she turns around and smiles, then walks away" \\
        --seconds 12 \\
        --size 1792x1024

15. Remix existing video
    $ openai-img --remix-video video_abc123 \\
        --prompt "change the color palette to teal and rust"

16. List your video library
    $ openai-img --list-videos --limit 20 --order desc

17. Delete a video
    $ openai-img --delete-video video_abc123

18. Download video thumbnail
    $ openai-img --video --sora-2 \\
        --prompt "sunset over ocean waves" \\
        --variant thumbnail

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

Sora 2:
  - Sizes: 720x1280, 1280x720, 1024x1792, 1792x1024
  - Duration: 4, 8, or 12 seconds
  - Features: Fast generation, text-to-video, image-to-video, remix
  - Use case: Rapid iteration, social content, prototypes

Sora 2 Pro:
  - Sizes: 720x1280, 1280x720, 1024x1792, 1792x1024
  - Duration: 4, 8, or 12 seconds
  - Features: Production quality, text-to-video, image-to-video, remix
  - Use case: High-resolution cinematic footage, marketing assets

${'='.repeat(70)}
`);
}
/**
 * Handle video mode operations (Sora).
 */
async function handleVideoMode(options) {
    // Determine video model
    let model = 'sora-2'; // default
    if (options.sora2)
        model = VIDEO_MODELS['sora-2'];
    if (options.sora2Pro)
        model = VIDEO_MODELS['sora-2-pro'];
    // Initialize video API
    const videoApi = new OpenAIVideoAPI({
        apiKey: options.apiKey,
        logLevel: options.logLevel,
    });
    // Determine output directory
    const outputDir = options.outputDir || path.join(getOutputDir(), model);
    await ensureDirectory(outputDir);
    // Handle list videos
    if (options.listVideos) {
        logger.info(`\n${'='.repeat(60)}`);
        logger.info('Listing videos');
        logger.info(`${'='.repeat(60)}`);
        const result = await videoApi.listVideos({
            limit: options.limit || 20,
            order: options.order || 'desc',
        });
        if (result.data && result.data.length > 0) {
            logger.info(`\nFound ${result.data.length} video(s):\n`);
            result.data.forEach((video) => {
                logger.info(`  ID: ${video.id}`);
                logger.info(`  Status: ${video.status}`);
                logger.info(`  Model: ${video.model}`);
                logger.info(`  Size: ${video.size}`);
                logger.info(`  Duration: ${video.seconds}s`);
                logger.info(`  Created: ${new Date(video.created_at * 1000).toISOString()}`);
                if (video.prompt)
                    logger.info(`  Prompt: "${video.prompt.substring(0, 60)}..."`);
                logger.info('');
            });
        }
        else {
            logger.info('\nNo videos found.');
        }
        return;
    }
    // Handle delete video
    if (options.deleteVideo) {
        logger.info(`\n${'='.repeat(60)}`);
        logger.info(`Deleting video: ${options.deleteVideo}`);
        logger.info(`${'='.repeat(60)}`);
        await videoApi.deleteVideo(options.deleteVideo);
        logger.info(`\n✓ Video deleted: ${options.deleteVideo}`);
        return;
    }
    // Handle remix video
    if (options.remixVideo) {
        const videoId = options.remixVideo;
        const prompt = options.prompt[0];
        if (!prompt) {
            throw new Error('--prompt is required for remixing video');
        }
        logger.info(`\n${'='.repeat(60)}`);
        logger.info(`Remixing video ${videoId}: "${prompt.substring(0, 50)}..."`);
        logger.info(`${'='.repeat(60)}`);
        // Create remix
        const remixJob = await videoApi.remixVideo(videoId, prompt);
        // Poll for completion
        const video = await videoApi.waitForVideo(remixJob.id);
        // Download video content
        logger.info('Downloading video content...');
        const buffer = await videoApi.downloadVideoContent(video.id, options.variant || 'video');
        // Save video
        const filename = generateVideoFilename(prompt, model, 'mp4');
        const videoPath = path.join(outputDir, filename);
        await saveVideoFile(buffer, videoPath);
        // Save metadata
        const metadataPath = videoPath.replace('.mp4', '.json');
        await saveVideoMetadata(video, metadataPath);
        logger.info(`\n✓ Success! Remixed video saved:`);
        logger.info(`  - ${videoPath}`);
        logger.info(`  - ${metadataPath}\n`);
        return;
    }
    // Handle create video
    if (options.prompt.length === 0) {
        throw new Error('--prompt is required for video generation');
    }
    const prompt = options.prompt[0];
    logger.info(`\n${'='.repeat(60)}`);
    logger.info(`Generating video with ${model}: "${prompt.substring(0, 50)}..."`);
    logger.info(`Output directory: ${outputDir}`);
    logger.info(`${'='.repeat(60)}`);
    // Build parameters
    const params = {
        prompt,
        model,
        size: options.size,
        seconds: options.seconds, // Keep as string - API expects "4", "8", or "12"
        input_reference: options.inputImage,
    };
    if (options.inputImage) {
        logger.info(`Using input reference image: ${options.inputImage}`);
    }
    if (options.dryRun) {
        logger.info('Dry run - parameters validated successfully:');
        logger.info(JSON.stringify(params, null, 2));
        return;
    }
    // Create video and poll for completion
    const video = await videoApi.createAndPoll(params);
    // Download video content
    const variant = options.variant || 'video';
    logger.info(`Downloading ${variant} content...`);
    const buffer = await videoApi.downloadVideoContent(video.id, variant);
    // Determine file extension based on variant
    let extension = 'mp4';
    if (variant === 'thumbnail')
        extension = 'webp';
    if (variant === 'spritesheet')
        extension = 'jpg';
    // Save video/image
    const filename = generateVideoFilename(prompt, model, extension);
    const filePath = path.join(outputDir, filename);
    await saveVideoFile(buffer, filePath);
    // Save metadata
    const metadataPath = filePath.replace(`.${extension}`, '.json');
    await saveVideoMetadata(video, metadataPath);
    logger.info(`\n✓ Success! Video saved:`);
    logger.info(`  - ${filePath}`);
    logger.info(`  - ${metadataPath}\n`);
}
/**
 * Parse and validate CLI arguments.
 */
program
    .name('openai-img')
    .description('OpenAI Image & Video Generation CLI - DALL-E, GPT Image, and Sora models')
    .version(version);
// Model selection (mutually exclusive)
program
    .option('--dalle-2', 'Use DALL-E 2 model')
    .option('--dalle-3', 'Use DALL-E 3 model')
    .option('--gpt-image-1', 'Use GPT Image 1 model')
    .option('--gpt-image-15', 'Use GPT Image 1.5 model');
// Video model selection (mutually exclusive)
program
    .option('--sora-2', 'Use Sora 2 model (fast video generation)')
    .option('--sora-2-pro', 'Use Sora 2 Pro model (high quality video)');
// Operation mode
program
    .option('--video', 'Enable video generation mode')
    .option('--edit', 'Edit existing image(s) with prompt')
    .option('--variation', 'Create variations of existing image');
// Video-specific operations
program
    .option('--remix-video <video_id>', 'Remix existing video with new prompt')
    .option('--list-videos', 'List your video library')
    .option('--delete-video <video_id>', 'Delete a video from storage')
    .option('--limit <number>', 'Number of videos to list (default: 20)', parseInt)
    .option('--order <order>', 'Sort order for list (asc or desc, default: desc)');
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
program.option('--style <style>', 'Style: vivid or natural (dalle-3 only)');
// GPT Image 1 specific
program
    .option('--background <bg>', 'Background: auto, transparent, or opaque (gpt-image-1 only)')
    .option('--moderation <level>', 'Moderation: auto or low (gpt-image-1 only)')
    .option('--output-format <format>', 'Output format: png, jpeg, or webp (gpt-image-1 only)')
    .option('--output-compression <percent>', 'Compression 0-100 (gpt-image-1 only)', parseInt)
    .option('--input-fidelity <level>', 'Input fidelity: high or low (gpt-image-1 edit only)');
// Sora (video) specific
program
    .option('--seconds <duration>', 'Video duration in seconds: 4, 8, or 12 (sora only)')
    .option('--input-image <path>', 'Reference image for first frame (sora only)')
    .option('--variant <type>', 'Download variant: video, thumbnail, or spritesheet (default: video)');
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
        // Show help if no arguments provided
        if (!process.argv.slice(2).length) {
            program.outputHelp();
            process.exit(0);
        }
        // Set log level
        if (options.logLevel) {
            setLogLevel(options.logLevel);
        }
        // Detect video mode
        const isVideoMode = options.video ||
            options.sora2 ||
            options.sora2Pro ||
            options.remixVideo ||
            options.listVideos ||
            options.deleteVideo;
        if (isVideoMode) {
            // VIDEO MODE - handle Sora video operations
            await handleVideoMode(options);
            return;
        }
        // IMAGE MODE - handle DALL-E and GPT Image operations
        // Determine model
        let model = 'dall-e-2'; // default
        if (options.dalle2)
            model = MODELS['dalle-2'];
        if (options.dalle3)
            model = MODELS['dalle-3'];
        if (options.gptImage1)
            model = MODELS['gpt-image-1'];
        if (options.gptImage15)
            model = MODELS['gpt-image-1.5'];
        // Determine operation mode
        const isEdit = options.edit;
        const isVariation = options.variation;
        const isGenerate = !isEdit && !isVariation;
        // Validate operation mode with model
        const constraints = getModelConstraints(model);
        if (isEdit && (!constraints || !constraints.supportsEdit)) {
            throw new Error(`Model ${model} does not support image editing`);
        }
        if (isVariation && (!constraints || !constraints.supportsVariation)) {
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
            logLevel: options.logLevel,
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
                    user: options.user,
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
                    }
                    else if (response.output_format) {
                        outputFormat = response.output_format;
                    }
                    // Save images
                    const baseFilename = generateTimestampedFilename(prompt, modelDir, outputFormat);
                    const savedPaths = await api.saveImages(response, outputDir, baseFilename.replace(`.${outputFormat}`, ''), outputFormat);
                    // Save metadata
                    const metadataPath = path.join(outputDir, baseFilename.replace(`.${outputFormat}`, '_metadata.json'));
                    await writeToFile({
                        model,
                        operation: 'generate',
                        timestamp: new Date().toISOString(),
                        parameters: params,
                        response: {
                            created: response.created,
                            images: savedPaths,
                            usage: response.usage,
                        },
                    }, metadataPath);
                    logger.info(`\n✓ Success! Generated ${savedPaths.length} image(s):`);
                    savedPaths.forEach((p) => logger.info(`  - ${p}`));
                    logger.info(`  - ${metadataPath}`);
                }
                catch (error) {
                    spinner.fail(`Generation failed: ${error.message}`);
                    if (options.prompt.length > 1) {
                        logger.error('Continuing with next prompt...');
                    }
                    else {
                        throw error;
                    }
                }
            }
        }
        else if (isEdit) {
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
                user: options.user,
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
                }
                else if (response.output_format) {
                    outputFormat = response.output_format;
                }
                // Save images
                const baseFilename = generateTimestampedFilename(prompt, `${modelDir}-edit`, outputFormat);
                const savedPaths = await api.saveImages(response, outputDir, baseFilename.replace(`.${outputFormat}`, ''), outputFormat);
                // Save metadata
                const metadataPath = path.join(outputDir, baseFilename.replace(`.${outputFormat}`, '_metadata.json'));
                await writeToFile({
                    model,
                    operation: 'edit',
                    timestamp: new Date().toISOString(),
                    parameters: params,
                    response: {
                        created: response.created,
                        images: savedPaths,
                        usage: response.usage,
                    },
                }, metadataPath);
                logger.info(`\n✓ Success! Generated ${savedPaths.length} edited image(s):`);
                savedPaths.forEach((p) => logger.info(`  - ${p}`));
                logger.info(`  - ${metadataPath}`);
            }
            catch (error) {
                spinner.fail(`Edit failed: ${error.message}`);
                throw error;
            }
        }
        else if (isVariation) {
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
                model: 'dall-e-2',
                n: options.n || 2,
                size: options.size,
                response_format: options.responseFormat,
                user: options.user,
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
                const savedPaths = await api.saveImages(response, outputDir, baseFilename, 'png');
                // Save metadata
                const metadataPath = path.join(outputDir, `${baseFilename}_metadata.json`);
                await writeToFile({
                    model,
                    operation: 'variation',
                    timestamp: new Date().toISOString(),
                    parameters: params,
                    response: {
                        created: response.created,
                        images: savedPaths,
                    },
                }, metadataPath);
                logger.info(`\n✓ Success! Generated ${savedPaths.length} variation(s):`);
                savedPaths.forEach((p) => logger.info(`  - ${p}`));
                logger.info(`  - ${metadataPath}`);
            }
            catch (error) {
                spinner.fail(`Variation failed: ${error.message}`);
                throw error;
            }
        }
        logger.info('\n✓ All operations completed successfully!\n');
    }
    catch (error) {
        logger.error(`\n✗ Error: ${error.message}\n`);
        process.exit(1);
    }
}
// Run main function
main();
//# sourceMappingURL=cli.js.map