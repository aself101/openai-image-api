/**
 * OpenAI Image Service Utility Functions
 *
 * Utility functions for OpenAI image generation, including file I/O,
 * image handling, and data transformations.
 */

import fs from 'fs/promises';
import { statSync } from 'fs';
import path from 'path';
import winston from 'winston';
import axios from 'axios';
import { lookup } from 'dns/promises';
import { isIPv4, isIPv6 } from 'net';
import type {
  Spinner,
  ImageFileConstraints,
  VideoFileConstraints,
  VideoObject,
  VideoMetadata,
  SaveVideoOptions,
  PollVideoOptions,
  ValidationResult,
  Logger,
} from './types.js';

// Configure module logger
const logger: Logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} - ${level.toUpperCase()} - ${message}`;
    })
  ),
  transports: [new winston.transports.Console()],
});

/**
 * Set the logging level.
 *
 * @param level - Log level (DEBUG, INFO, WARNING, ERROR)
 */
export function setLogLevel(level: string): void {
  logger.level = level.toLowerCase();
}

export { logger };

/**
 * Helper function to check if an IP address is blocked (private/internal).
 *
 * @param ip - IP address to check (IPv4 or IPv6)
 * @returns True if IP is blocked, false otherwise
 */
function isBlockedIP(ip: string): boolean {
  // Remove IPv6 bracket notation
  const cleanIP = ip.replace(/^\[|\]$/g, '');

  // Block IPv4-mapped IPv6 addresses (::ffff:x.x.x.x format)
  // This prevents SSRF bypass using addresses like ::ffff:127.0.0.1
  if (cleanIP.toLowerCase().startsWith('::ffff:')) {
    const mappedIPv4 = cleanIP.substring(7); // Extract the IPv4 part
    return isBlockedIP(mappedIPv4); // Recursively check the mapped IPv4 address
  }

  // Block localhost variations
  if (cleanIP === 'localhost' || cleanIP === '127.0.0.1' || cleanIP === '::1') {
    return true;
  }

  // Block cloud metadata endpoints
  const blockedHosts = ['metadata.google.internal', 'metadata', '169.254.169.254'];
  if (blockedHosts.includes(cleanIP)) {
    return true;
  }

  // Block private IP ranges and special addresses
  const blockedPatterns = [
    /^127\./, // Loopback
    /^10\./, // Private Class A
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private Class B
    /^192\.168\./, // Private Class C
    /^169\.254\./, // Link-local (AWS metadata)
    /^0\./, // Invalid range
    /^::1$/, // IPv6 loopback
    /^fe80:/, // IPv6 link-local
    /^fc00:/, // IPv6 unique local
    /^fd00:/, // IPv6 unique local
  ];

  return blockedPatterns.some((pattern) => pattern.test(cleanIP));
}

/**
 * Validate URL for security (prevent SSRF attacks).
 *
 * DNS Resolution: This function performs DNS resolution to prevent DNS rebinding attacks,
 * where a domain might resolve to different IPs between validation time and request time.
 *
 * @param url - URL to validate
 * @returns The validated URL
 * @throws Error If URL is invalid or points to blocked resource
 */
export async function validateImageUrl(url: string): Promise<string> {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  // Only allow HTTPS (not HTTP)
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed for security reasons');
  }

  const hostname = parsed.hostname.toLowerCase();
  const cleanHostname = hostname.replace(/^\[|\]$/g, ''); // Remove IPv6 brackets

  // First check if hostname itself is blocked (before DNS resolution)
  const blockedHosts = ['localhost', 'metadata.google.internal', 'metadata'];
  if (blockedHosts.includes(cleanHostname)) {
    logger.warn(`SECURITY: Blocked access to prohibited hostname: ${hostname}`);
    throw new Error('Access to cloud metadata endpoints is not allowed');
  }

  // Check if hostname is already an IP address (not a domain name)
  if (isIPv4(cleanHostname) || isIPv6(cleanHostname)) {
    if (isBlockedIP(cleanHostname)) {
      logger.warn(`SECURITY: Blocked access to private/internal IP: ${hostname}`);
      throw new Error('Access to internal/private IP addresses is not allowed');
    }
  } else {
    // Hostname is a domain name - perform DNS resolution to prevent DNS rebinding
    try {
      logger.debug(`Resolving DNS for hostname: ${hostname}`);
      const { address } = await lookup(hostname);
      logger.debug(`DNS resolved ${hostname} → ${address}`);

      if (isBlockedIP(address)) {
        logger.warn(`SECURITY: DNS resolution of ${hostname} points to blocked IP: ${address}`);
        throw new Error(`Domain ${hostname} resolves to internal/private IP address`);
      }

      logger.debug(`DNS validation passed for ${hostname} (resolved to ${address})`);
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { message?: string };
      if (err.code === 'ENOTFOUND') {
        logger.warn(`SECURITY: Domain ${hostname} could not be resolved`);
        throw new Error(`Domain ${hostname} could not be resolved`);
      } else if (err.message && err.message.includes('resolves to internal')) {
        // Re-throw our custom error about blocked IPs
        throw error;
      } else {
        logger.warn(`SECURITY: DNS lookup failed for ${hostname}: ${err.message}`);
        throw new Error(`Failed to validate domain ${hostname}: ${err.message}`);
      }
    }
  }

  return url;
}

/**
 * Validate that file exists and is a valid image file.
 *
 * @param filepath - Path to image file
 * @returns The validated filepath
 * @throws Error If file doesn't exist or is not a valid image
 */
export async function validateImagePath(filepath: string): Promise<string> {
  try {
    const buffer = await fs.readFile(filepath);

    // Check file size (must be > 0)
    if (buffer.length === 0) {
      throw new Error(`Image file is empty: ${filepath}`);
    }

    // Check magic bytes for common image formats
    const magicBytes = buffer.slice(0, 4);
    const isPNG =
      magicBytes[0] === 0x89 &&
      magicBytes[1] === 0x50 &&
      magicBytes[2] === 0x4e &&
      magicBytes[3] === 0x47;
    const isJPEG = magicBytes[0] === 0xff && magicBytes[1] === 0xd8 && magicBytes[2] === 0xff;
    const isWebP = buffer.slice(8, 12).toString() === 'WEBP';
    const isGIF = magicBytes.slice(0, 3).toString() === 'GIF';

    if (!isPNG && !isJPEG && !isWebP && !isGIF) {
      throw new Error(
        `File does not appear to be a valid image (PNG, JPEG, WebP, or GIF): ${filepath}`
      );
    }

    return filepath;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      throw new Error(`Image file not found: ${filepath}`);
    } else if (err.code === 'EACCES') {
      throw new Error(`Permission denied reading image file: ${filepath}`);
    }
    throw error;
  }
}

/**
 * Validate output path for path traversal attacks.
 *
 * @param outputPath - Path to validate
 * @param basePath - Optional base path that output must be within
 * @returns The resolved absolute path
 * @throws Error if path contains traversal sequences or escapes base path
 */
export function validateOutputPath(outputPath: string, basePath?: string): string {
  // Check for obvious path traversal patterns
  if (outputPath.includes('..')) {
    throw new Error('Path traversal sequences (..) are not allowed in output paths');
  }

  // Resolve to absolute path
  const resolved = path.resolve(outputPath);

  // If base path provided, ensure output stays within it
  if (basePath) {
    const resolvedBase = path.resolve(basePath);
    if (!resolved.startsWith(resolvedBase + path.sep) && resolved !== resolvedBase) {
      throw new Error(`Output path must be within ${basePath}`);
    }
  }

  return resolved;
}

/**
 * Ensure a directory exists, creating it if necessary.
 *
 * @param dirPath - Directory path to ensure
 */
export async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    const err = error as Error;
    logger.error(`Error creating directory ${dirPath}: ${err.message}`);
    throw error;
  }
}

/** File format for writeToFile */
type FileFormat = 'json' | 'txt' | 'binary' | 'auto';

/**
 * Write data to file.
 *
 * @param data - Data to write (Object, Array, Buffer, string, etc.)
 * @param filepath - Path where file should be written
 * @param fileFormat - Format to use ('json', 'txt', 'binary', 'auto')
 */
export async function writeToFile(
  data: unknown,
  filepath: string,
  fileFormat: FileFormat = 'auto'
): Promise<void> {
  if (!filepath) {
    throw new Error('Filepath is required');
  }

  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(filepath);
    await ensureDirectory(dir);

    // Auto-detect format from extension
    let format = fileFormat;
    if (format === 'auto') {
      const ext = path.extname(filepath).toLowerCase();
      if (ext === '.json') {
        format = 'json';
      } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        format = 'binary';
      } else {
        format = 'txt';
      }
    }

    // Write based on format
    if (format === 'json') {
      await fs.writeFile(filepath, JSON.stringify(data, null, 2));
    } else if (format === 'binary') {
      await fs.writeFile(filepath, data as Buffer);
    } else {
      await fs.writeFile(filepath, String(data));
    }

    logger.debug(`Wrote file: ${filepath}`);
  } catch (error) {
    const err = error as Error;
    logger.error(`Error writing file ${filepath}: ${err.message}`);
    throw error;
  }
}

/**
 * Convert local image file or URL to base64 data URI.
 *
 * @param input - Local file path or URL
 * @returns Base64 data URI (data:image/png;base64,...)
 */
export async function imageToBase64(input: string): Promise<string> {
  try {
    let buffer: Buffer;
    let mimeType = 'image/png';

    // Check if input is a URL
    if (input.startsWith('http://') || input.startsWith('https://')) {
      // Validate URL for security
      await validateImageUrl(input);

      logger.debug(`Fetching image from URL: ${input}`);
      const response = await axios.get<ArrayBuffer>(input, {
        responseType: 'arraybuffer',
        timeout: 60000, // 60 second timeout
        maxContentLength: 50 * 1024 * 1024, // 50MB limit
        maxBodyLength: 50 * 1024 * 1024,
        maxRedirects: 5, // Prevent redirect loops
      });
      buffer = Buffer.from(response.data);

      // Try to detect MIME type from response
      const contentType = response.headers['content-type'] as string | undefined;
      if (contentType) {
        mimeType = contentType;
      }
    } else {
      // Local file - validate it's a real image
      await validateImagePath(input);

      logger.debug(`Reading local image: ${input}`);
      buffer = await fs.readFile(input);

      // Detect MIME type from extension
      const ext = path.extname(input).toLowerCase();
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
      };
      mimeType = mimeTypes[ext] || 'image/png';
    }

    const base64 = buffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    const err = error as Error;
    logger.error(`Error converting image to base64: ${err.message}`);
    throw new Error(`Failed to convert image to base64: ${err.message}`);
  }
}

/**
 * Download image from URL and save to file.
 *
 * @param url - Image URL
 * @param filepath - Destination file path
 * @returns The filepath where image was saved
 */
export async function downloadImage(url: string, filepath: string): Promise<string> {
  try {
    // Validate URL for security
    await validateImageUrl(url);

    logger.debug(`Downloading image from ${url} to ${filepath}`);

    const dir = path.dirname(filepath);
    await ensureDirectory(dir);

    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: 60000, // 60 second timeout
      maxContentLength: 50 * 1024 * 1024, // 50MB limit
      maxBodyLength: 50 * 1024 * 1024,
      maxRedirects: 5, // Prevent redirect loops
    });
    const buffer = Buffer.from(response.data);

    await fs.writeFile(filepath, buffer);
    logger.info(`Downloaded image: ${filepath}`);

    return filepath;
  } catch (error) {
    const err = error as Error;
    logger.error(`Error downloading image: ${err.message}`);
    throw new Error(`Failed to download image: ${err.message}`);
  }
}

/**
 * Decode base64 image data and save to file.
 *
 * @param b64Data - Base64 encoded image data
 * @param filepath - Destination file path
 * @returns The filepath where image was saved
 */
export async function decodeBase64Image(b64Data: string, filepath: string): Promise<string> {
  try {
    logger.debug(`Decoding base64 image to ${filepath}`);

    const dir = path.dirname(filepath);
    await ensureDirectory(dir);

    const buffer = Buffer.from(b64Data, 'base64');
    await fs.writeFile(filepath, buffer);

    logger.info(`Saved base64 image: ${filepath}`);
    return filepath;
  } catch (error) {
    const err = error as Error;
    logger.error(`Error decoding base64 image: ${err.message}`);
    throw new Error(`Failed to decode base64 image: ${err.message}`);
  }
}

/**
 * Sanitize text for use in filenames.
 *
 * @param text - Text to sanitize
 * @param maxLength - Maximum length of sanitized text
 * @returns Sanitized text safe for filenames
 */
export function sanitizeForFilename(text: string, maxLength: number = 50): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, maxLength);
}

/**
 * Generate filename from prompt text.
 *
 * @param prompt - The image generation prompt
 * @param maxLength - Maximum length of filename part
 * @returns Sanitized filename-safe string
 */
export function promptToFilename(prompt: string, maxLength: number = 50): string {
  return sanitizeForFilename(prompt, maxLength);
}

/**
 * Generate timestamped filename with prompt.
 *
 * @param prompt - The image generation prompt
 * @param model - Model name (dalle-2, dalle-3, gpt-image-1)
 * @param extension - File extension (png, jpg, webp)
 * @returns Timestamped filename
 */
export function generateTimestampedFilename(
  prompt: string,
  model: string,
  extension: string = 'png'
): string {
  const now = new Date();
  const datePart = now.toISOString().replace(/[:.]/g, '-').split('T')[0];
  const timePart = now.toISOString().replace(/[:.]/g, '-').split('T')[1].substring(0, 8);
  const timestamp = `${datePart}_${timePart}`;
  const promptPart = promptToFilename(prompt, 40);
  return `${timestamp}_${model}_${promptPart}.${extension}`;
}

/**
 * Validate image file.
 *
 * @param filepath - Path to image file
 * @param constraints - Validation constraints
 * @returns Validation result with valid flag and errors array
 */
export function validateImageFile(
  filepath: string,
  constraints: ImageFileConstraints = {}
): ValidationResult {
  const errors: string[] = [];

  try {
    // Check if file exists
    const stats = statSync(filepath);

    // Check file size
    if (constraints.maxSize && stats.size > constraints.maxSize) {
      const maxMB = (constraints.maxSize / (1024 * 1024)).toFixed(1);
      const actualMB = (stats.size / (1024 * 1024)).toFixed(1);
      errors.push(`Image file size (${actualMB}MB) exceeds maximum (${maxMB}MB)`);
    }

    // Check file extension
    const ext = path.extname(filepath).toLowerCase().substring(1);
    if (constraints.formats && !constraints.formats.includes(ext)) {
      errors.push(
        `Image format "${ext}" not supported. Valid formats: ${constraints.formats.join(', ')}`
      );
    }

    // Note: We don't check dimensions here as that would require image processing library
    // The API will validate dimensions if required
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      errors.push(`Image file not found: ${filepath}`);
    } else {
      errors.push(`Error validating image file: ${err.message}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Pause execution for specified time.
 *
 * @param seconds - Number of seconds to pause
 */
export async function pause(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Create a simple text-based spinner for CLI.
 *
 * @param message - Message to display
 * @returns Spinner object with update() and stop() methods
 */
export function createSpinner(message: string = 'Processing'): Spinner {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;
  let interval: ReturnType<typeof setInterval> | null = null;
  const startTime = Date.now();
  let currentMessage = message;

  const spinner: Spinner = {
    start() {
      process.stdout.write('\n');
      interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const frame = frames[frameIndex];
        frameIndex = (frameIndex + 1) % frames.length;

        process.stdout.write(`\r${frame} ${currentMessage}... (${elapsed}s elapsed)`);
      }, 80);
      return this;
    },

    update(newMessage: string) {
      currentMessage = newMessage;
      return this;
    },

    stop(finalMessage: string | undefined = undefined) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (finalMessage) {
        process.stdout.write(`\r✓ ${finalMessage} (${elapsed}s)\n`);
      } else {
        process.stdout.write(`\r✓ ${currentMessage} complete (${elapsed}s)\n`);
      }

      return this;
    },

    fail(errorMessage: string | undefined = undefined) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }

      if (errorMessage) {
        process.stdout.write(`\r✗ ${errorMessage}\n`);
      } else {
        process.stdout.write(`\r✗ ${currentMessage} failed\n`);
      }

      return this;
    },
  };

  return spinner;
}

// =============================================================================
// VIDEO-SPECIFIC UTILITIES (Sora)
// =============================================================================

/** Interface for video API with retrieveVideo method */
interface VideoAPIInterface {
  retrieveVideo(videoId: string, options?: { signal?: AbortSignal }): Promise<VideoObject>;
}

/**
 * Poll video status with progress display.
 *
 * @param api - OpenAIVideoAPI instance
 * @param videoId - Video job ID
 * @param options - Polling options
 * @returns Completed video object
 * @throws Error If video generation fails, times out, or is cancelled
 */
export async function pollVideoWithProgress(
  api: VideoAPIInterface,
  videoId: string,
  options: PollVideoOptions = {}
): Promise<VideoObject> {
  const {
    interval = 10000, // 10 seconds
    timeout = 600000, // 10 minutes
    showSpinner = true,
    signal,
  } = options;

  const startTime = Date.now();
  let spinner: Spinner | null = null;

  if (showSpinner) {
    spinner = createSpinner('Generating video');
    spinner.start();
  }

  try {
    while (true) {
      // Check if operation was cancelled
      if (signal?.aborted) {
        if (spinner) spinner.fail('Video generation cancelled');
        throw new Error('Video generation was cancelled');
      }

      // Check timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > timeout) {
        if (spinner) spinner.fail('Video generation timed out');
        throw new Error(`Video generation timed out after ${timeout / 1000}s`);
      }

      // Retrieve video status (pass signal for cancellable requests)
      const video = await api.retrieveVideo(videoId, { signal });

      // Update spinner with progress
      if (spinner && video.progress !== undefined) {
        const progressPercent = video.progress || 0;
        const elapsedSec = Math.floor(elapsed / 1000);

        // Estimate remaining time based on progress
        let estimatedMsg = '';
        if (progressPercent > 0 && progressPercent < 100) {
          const estimatedTotal = (elapsed / progressPercent) * 100;
          const estimatedRemaining = Math.floor((estimatedTotal - elapsed) / 1000);
          estimatedMsg = ` - ${estimatedRemaining}s remaining`;
        }

        const statusText =
          video.status === 'queued'
            ? 'Queued'
            : video.status === 'in_progress'
              ? 'Processing'
              : video.status;
        spinner.update(`${statusText} (${progressPercent}% complete, ${elapsedSec}s elapsed${estimatedMsg})`);
      }

      // Check if completed
      if (video.status === 'completed') {
        if (spinner) spinner.stop('Video generation completed');
        return video;
      }

      // Check if failed
      if (video.status === 'failed') {
        if (spinner) spinner.fail('Video generation failed');
        const errorMsg = video.error?.message || 'Video generation failed';
        throw new Error(errorMsg);
      }

      // Wait before next poll
      await pause(interval / 1000);
    }
  } catch (error) {
    if (spinner) spinner.fail((error as Error).message);
    throw error;
  }
}

/**
 * Save video buffer to MP4 file.
 *
 * @param buffer - Video data buffer
 * @param filepath - Destination file path
 * @param options - Save options
 * @returns Path to saved file
 * @throws Error If buffer is invalid or exceeds size limit
 */
export async function saveVideoFile(
  buffer: Buffer,
  filepath: string,
  options: SaveVideoOptions = {}
): Promise<string> {
  const { maxSize = 100 * 1024 * 1024 } = options; // 100MB default

  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Invalid video data: expected Buffer');
  }

  if (buffer.length === 0) {
    throw new Error('Video buffer is empty');
  }

  if (buffer.length > maxSize) {
    const maxMB = (maxSize / (1024 * 1024)).toFixed(1);
    const actualMB = (buffer.length / (1024 * 1024)).toFixed(1);
    throw new Error(`Video file size (${actualMB}MB) exceeds maximum (${maxMB}MB)`);
  }

  try {
    logger.debug(`Saving video file to ${filepath}`);

    const dir = path.dirname(filepath);
    await ensureDirectory(dir);

    await fs.writeFile(filepath, buffer);
    logger.info(`Saved video: ${filepath} (${(buffer.length / (1024 * 1024)).toFixed(2)}MB)`);

    return filepath;
  } catch (error) {
    const err = error as Error;
    logger.error(`Error saving video file: ${err.message}`);
    throw new Error(`Failed to save video file: ${err.message}`);
  }
}

/**
 * Generate timestamped filename for video.
 *
 * @param prompt - The video generation prompt
 * @param model - Model name (sora-2, sora-2-pro)
 * @param extension - File extension (mp4, webp, jpg)
 * @returns Timestamped filename
 */
export function generateVideoFilename(
  prompt: string,
  model: string,
  extension: string = 'mp4'
): string {
  const now = new Date();
  const datePart = now.toISOString().replace(/[:.]/g, '-').split('T')[0];
  const timePart = now.toISOString().replace(/[:.]/g, '-').split('T')[1].substring(0, 8);
  const timestamp = `${datePart}_${timePart}`;
  const promptPart = promptToFilename(prompt, 40);
  return `${timestamp}_${model}_${promptPart}.${extension}`;
}

/**
 * Save video metadata as JSON file.
 *
 * @param videoObject - Video object from API
 * @param filepath - Path to save metadata JSON
 * @returns Path to saved metadata file
 */
export async function saveVideoMetadata(videoObject: VideoObject, filepath: string): Promise<string> {
  try {
    logger.debug(`Saving video metadata to ${filepath}`);

    const metadata: VideoMetadata = {
      id: videoObject.id,
      object: videoObject.object,
      created_at: videoObject.created_at,
      status: videoObject.status,
      model: videoObject.model,
      progress: videoObject.progress,
      seconds: videoObject.seconds,
      size: videoObject.size,
      prompt: videoObject.prompt,
      remixed_from_video_id: videoObject.remixed_from_video_id,
      error: videoObject.error,
      timestamp: new Date().toISOString(),
    };

    await writeToFile(metadata, filepath, 'json');
    logger.info(`Saved video metadata: ${filepath}`);

    return filepath;
  } catch (error) {
    const err = error as Error;
    logger.error(`Error saving video metadata: ${err.message}`);
    throw new Error(`Failed to save video metadata: ${err.message}`);
  }
}

/**
 * Validate video file from download.
 *
 * @param buffer - Video buffer to validate
 * @param constraints - Validation constraints
 * @returns Validation result with valid flag and errors array
 */
export function validateVideoFile(
  buffer: Buffer,
  constraints: VideoFileConstraints = {}
): ValidationResult {
  const errors: string[] = [];

  if (!Buffer.isBuffer(buffer)) {
    errors.push('Invalid video data: expected Buffer');
    return { valid: false, errors };
  }

  if (buffer.length === 0) {
    errors.push('Video buffer is empty');
    return { valid: false, errors };
  }

  // Check file size
  if (constraints.maxSize && buffer.length > constraints.maxSize) {
    const maxMB = (constraints.maxSize / (1024 * 1024)).toFixed(1);
    const actualMB = (buffer.length / (1024 * 1024)).toFixed(1);
    errors.push(`Video file size (${actualMB}MB) exceeds maximum (${maxMB}MB)`);
  }

  // Check MP4 magic bytes
  // MP4 files start with various signatures:
  // - ftyp box: 0x00 0x00 0x00 [size] 'ftyp'
  // Common MP4 variants at bytes 4-7: 'ftyp', 'mdat', 'moov', 'wide'
  if (buffer.length >= 8) {
    const signature = buffer.slice(4, 8).toString();
    const validSignatures = ['ftyp', 'mdat', 'moov', 'wide', 'free', 'skip'];

    if (!validSignatures.includes(signature)) {
      errors.push('File does not appear to be a valid MP4 video');
    }
  } else {
    errors.push('Video file is too small to be valid');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
