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

// Configure module logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} - ${level.toUpperCase()} - ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console()
  ]
});

/**
 * Set the logging level.
 *
 * @param {string} level - Log level (DEBUG, INFO, WARNING, ERROR)
 */
export function setLogLevel(level) {
  logger.level = level.toLowerCase();
}

export { logger };

/**
 * Validate URL for security (prevent SSRF attacks).
 *
 * @param {string} url - URL to validate
 * @throws {Error} If URL is invalid or points to blocked resource
 */
export function validateImageUrl(url) {
  let parsed;

  try {
    parsed = new URL(url);
  } catch (error) {
    throw new Error(`Invalid URL: ${url}`);
  }

  // Only allow HTTPS (not HTTP)
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed for security reasons');
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block localhost variations (including IPv6 bracket notation)
  const cleanHostname = hostname.replace(/^\[|\]$/g, ''); // Remove IPv6 brackets
  if (cleanHostname === 'localhost' || cleanHostname === '127.0.0.1' || cleanHostname === '::1') {
    throw new Error('Access to localhost is not allowed');
  }

  // Block private IP ranges and special addresses
  const blockedPatterns = [
    /^127\./,                    // Loopback
    /^10\./,                     // Private Class A
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // Private Class B
    /^192\.168\./,               // Private Class C
    /^169\.254\./,               // Link-local (AWS metadata)
    /^0\./,                      // Invalid range
    /^::1$/,                     // IPv6 loopback
    /^fe80:/,                    // IPv6 link-local
    /^fc00:/,                    // IPv6 unique local
    /^fd00:/,                    // IPv6 unique local
  ];

  // Block cloud metadata endpoints
  const blockedHosts = [
    'metadata.google.internal',  // GCP metadata
    'metadata',                  // Generic metadata
    '169.254.169.254',          // AWS/Azure metadata IP
  ];

  if (blockedHosts.includes(hostname)) {
    throw new Error('Access to cloud metadata endpoints is not allowed');
  }

  if (blockedPatterns.some(pattern => pattern.test(hostname))) {
    throw new Error('Access to internal/private IP addresses is not allowed');
  }

  return url;
}

/**
 * Validate that file exists and is a valid image file.
 *
 * @param {string} filepath - Path to image file
 * @throws {Error} If file doesn't exist or is not a valid image
 */
export async function validateImagePath(filepath) {
  try {
    const buffer = await fs.readFile(filepath);

    // Check file size (must be > 0)
    if (buffer.length === 0) {
      throw new Error(`Image file is empty: ${filepath}`);
    }

    // Check magic bytes for common image formats
    const magicBytes = buffer.slice(0, 4);
    const isPNG = magicBytes[0] === 0x89 && magicBytes[1] === 0x50 && magicBytes[2] === 0x4E && magicBytes[3] === 0x47;
    const isJPEG = magicBytes[0] === 0xFF && magicBytes[1] === 0xD8 && magicBytes[2] === 0xFF;
    const isWebP = buffer.slice(8, 12).toString() === 'WEBP';
    const isGIF = magicBytes.slice(0, 3).toString() === 'GIF';

    if (!isPNG && !isJPEG && !isWebP && !isGIF) {
      throw new Error(`File does not appear to be a valid image (PNG, JPEG, WebP, or GIF): ${filepath}`);
    }

    return filepath;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Image file not found: ${filepath}`);
    } else if (error.code === 'EACCES') {
      throw new Error(`Permission denied reading image file: ${filepath}`);
    }
    throw error;
  }
}

/**
 * Ensure a directory exists, creating it if necessary.
 *
 * @param {string} dirPath - Directory path to ensure
 */
export async function ensureDirectory(dirPath) {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch (error) {
    logger.error(`Error creating directory ${dirPath}: ${error.message}`);
    throw error;
  }
}

/**
 * Write data to file.
 *
 * @param {any} data - Data to write (Object, Array, Buffer, string, etc.)
 * @param {string} filepath - Path where file should be written
 * @param {string} fileFormat - Format to use ('json', 'txt', 'binary', 'auto')
 */
export async function writeToFile(data, filepath, fileFormat = 'auto') {
  if (!filepath) {
    throw new Error('Filepath is required');
  }

  try {
    // Create directory if it doesn't exist
    const dir = path.dirname(filepath);
    await ensureDirectory(dir);

    // Auto-detect format from extension
    if (fileFormat === 'auto') {
      const ext = path.extname(filepath).toLowerCase();
      if (ext === '.json') {
        fileFormat = 'json';
      } else if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        fileFormat = 'binary';
      } else {
        fileFormat = 'txt';
      }
    }

    // Write based on format
    if (fileFormat === 'json') {
      await fs.writeFile(filepath, JSON.stringify(data, null, 2));
    } else if (fileFormat === 'binary') {
      await fs.writeFile(filepath, data);
    } else {
      await fs.writeFile(filepath, String(data));
    }

    logger.debug(`Wrote file: ${filepath}`);
  } catch (error) {
    logger.error(`Error writing file ${filepath}: ${error.message}`);
    throw error;
  }
}

/**
 * Convert local image file or URL to base64 data URI.
 *
 * @param {string} input - Local file path or URL
 * @returns {Promise<string>} Base64 data URI (data:image/png;base64,...)
 */
export async function imageToBase64(input) {
  try {
    let buffer;
    let mimeType = 'image/png';

    // Check if input is a URL
    if (input.startsWith('http://') || input.startsWith('https://')) {
      // Validate URL for security
      validateImageUrl(input);

      logger.debug(`Fetching image from URL: ${input}`);
      const response = await axios.get(input, { responseType: 'arraybuffer' });
      buffer = Buffer.from(response.data);

      // Try to detect MIME type from response
      const contentType = response.headers['content-type'];
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
      const mimeTypes = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif'
      };
      mimeType = mimeTypes[ext] || 'image/png';
    }

    const base64 = buffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    logger.error(`Error converting image to base64: ${error.message}`);
    throw new Error(`Failed to convert image to base64: ${error.message}`);
  }
}

/**
 * Download image from URL and save to file.
 *
 * @param {string} url - Image URL
 * @param {string} filepath - Destination file path
 */
export async function downloadImage(url, filepath) {
  try {
    // Validate URL for security
    validateImageUrl(url);

    logger.debug(`Downloading image from ${url} to ${filepath}`);

    const dir = path.dirname(filepath);
    await ensureDirectory(dir);

    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data);

    await fs.writeFile(filepath, buffer);
    logger.info(`Downloaded image: ${filepath}`);

    return filepath;
  } catch (error) {
    logger.error(`Error downloading image: ${error.message}`);
    throw new Error(`Failed to download image: ${error.message}`);
  }
}

/**
 * Decode base64 image data and save to file.
 *
 * @param {string} b64Data - Base64 encoded image data
 * @param {string} filepath - Destination file path
 */
export async function decodeBase64Image(b64Data, filepath) {
  try {
    logger.debug(`Decoding base64 image to ${filepath}`);

    const dir = path.dirname(filepath);
    await ensureDirectory(dir);

    const buffer = Buffer.from(b64Data, 'base64');
    await fs.writeFile(filepath, buffer);

    logger.info(`Saved base64 image: ${filepath}`);
    return filepath;
  } catch (error) {
    logger.error(`Error decoding base64 image: ${error.message}`);
    throw new Error(`Failed to decode base64 image: ${error.message}`);
  }
}

/**
 * Sanitize text for use in filenames.
 *
 * @param {string} text - Text to sanitize
 * @param {number} maxLength - Maximum length of sanitized text
 * @returns {string} Sanitized text safe for filenames
 */
export function sanitizeForFilename(text, maxLength = 50) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, maxLength);
}

/**
 * Generate filename from prompt text.
 *
 * @param {string} prompt - The image generation prompt
 * @param {number} maxLength - Maximum length of filename part
 * @returns {string} Sanitized filename-safe string
 */
export function promptToFilename(prompt, maxLength = 50) {
  return sanitizeForFilename(prompt, maxLength);
}

/**
 * Generate timestamped filename with prompt.
 *
 * @param {string} prompt - The image generation prompt
 * @param {string} model - Model name (dalle-2, dalle-3, gpt-image-1)
 * @param {string} extension - File extension (png, jpg, webp)
 * @returns {string} Timestamped filename
 */
export function generateTimestampedFilename(prompt, model, extension = 'png') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0] + '_' +
                    new Date().toISOString().replace(/[:.]/g, '-').split('T')[1].substring(0, 8);
  const promptPart = promptToFilename(prompt, 40);
  return `${timestamp}_${model}_${promptPart}.${extension}`;
}

/**
 * Validate image file.
 *
 * @param {string} filepath - Path to image file
 * @param {Object} constraints - Validation constraints
 * @returns {Object} Validation result { valid: boolean, errors: string[] }
 */
export async function validateImageFile(filepath, constraints = {}) {
  const errors = [];

  try {
    // Check if file exists
    const stats = statSync(filepath);

    // Check file size
    if (constraints.maxSize && stats.size > constraints.maxSize) {
      const maxMB = (constraints.maxSize / (1024 * 1024)).toFixed(1);
      const actualMB = (stats.size / (1024 * 1024)).toFixed(1);
      errors.push(
        `Image file size (${actualMB}MB) exceeds maximum (${maxMB}MB)`
      );
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
    if (error.code === 'ENOENT') {
      errors.push(`Image file not found: ${filepath}`);
    } else {
      errors.push(`Error validating image file: ${error.message}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Pause execution for specified time.
 *
 * @param {number} seconds - Number of seconds to pause
 */
export async function pause(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

/**
 * Create a simple text-based spinner for CLI.
 *
 * @param {string} message - Message to display
 * @returns {Object} Spinner object with update() and stop() methods
 */
export function createSpinner(message = 'Processing') {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frameIndex = 0;
  let interval;
  let startTime = Date.now();

  const spinner = {
    start() {
      process.stdout.write('\n');
      interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const frame = frames[frameIndex];
        frameIndex = (frameIndex + 1) % frames.length;

        process.stdout.write(`\r${frame} ${message}... (${elapsed}s elapsed)`);
      }, 80);
      return this;
    },

    update(newMessage) {
      message = newMessage;
      return this;
    },

    stop(finalMessage = null) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      if (finalMessage) {
        process.stdout.write(`\r✓ ${finalMessage} (${elapsed}s)\n`);
      } else {
        process.stdout.write(`\r✓ ${message} complete (${elapsed}s)\n`);
      }

      return this;
    },

    fail(errorMessage = null) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }

      if (errorMessage) {
        process.stdout.write(`\r✗ ${errorMessage}\n`);
      } else {
        process.stdout.write(`\r✗ ${message} failed\n`);
      }

      return this;
    }
  };

  return spinner;
}
