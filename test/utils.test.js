/**
 * Utility Functions Tests
 *
 * Tests for utils.js - file I/O, image handling, and helper functions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import {
  ensureDirectory,
  writeToFile,
  sanitizeForFilename,
  promptToFilename,
  generateTimestampedFilename,
  validateImageFile,
  decodeBase64Image,
  validateImageUrl,
  validateImagePath
} from '../utils.js';

const TEST_DIR = './test-output';

describe('Utility Functions', () => {
  beforeEach(async () => {
    // Clean up test directory before each test
    if (existsSync(TEST_DIR)) {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    // Clean up test directory after each test
    if (existsSync(TEST_DIR)) {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('ensureDirectory', () => {
    it('should create directory if it does not exist', async () => {
      const dirPath = path.join(TEST_DIR, 'new-dir');
      await ensureDirectory(dirPath);
      expect(existsSync(dirPath)).toBe(true);
    });

    it('should not throw error if directory already exists', async () => {
      const dirPath = path.join(TEST_DIR, 'existing-dir');
      await ensureDirectory(dirPath);
      await ensureDirectory(dirPath); // Call again
      expect(existsSync(dirPath)).toBe(true);
    });

    it('should create nested directories', async () => {
      const dirPath = path.join(TEST_DIR, 'a', 'b', 'c');
      await ensureDirectory(dirPath);
      expect(existsSync(dirPath)).toBe(true);
    });
  });

  describe('writeToFile', () => {
    it('should write JSON file', async () => {
      const filepath = path.join(TEST_DIR, 'test.json');
      const data = { key: 'value', number: 42 };

      await writeToFile(data, filepath, 'json');

      expect(existsSync(filepath)).toBe(true);
      const content = await fs.readFile(filepath, 'utf8');
      const parsed = JSON.parse(content);
      expect(parsed).toEqual(data);
    });

    it('should write text file', async () => {
      const filepath = path.join(TEST_DIR, 'test.txt');
      const data = 'Hello, World!';

      await writeToFile(data, filepath, 'txt');

      expect(existsSync(filepath)).toBe(true);
      const content = await fs.readFile(filepath, 'utf8');
      expect(content).toBe(data);
    });

    it('should write binary file', async () => {
      const filepath = path.join(TEST_DIR, 'test.bin');
      const data = Buffer.from([0x00, 0x01, 0x02, 0x03]);

      await writeToFile(data, filepath, 'binary');

      expect(existsSync(filepath)).toBe(true);
      const content = await fs.readFile(filepath);
      expect(content).toEqual(data);
    });

    it('should auto-detect format from extension', async () => {
      const jsonPath = path.join(TEST_DIR, 'auto.json');
      await writeToFile({ test: true }, jsonPath, 'auto');
      expect(existsSync(jsonPath)).toBe(true);

      const txtPath = path.join(TEST_DIR, 'auto.txt');
      await writeToFile('text', txtPath, 'auto');
      expect(existsSync(txtPath)).toBe(true);
    });

    it('should create parent directories if needed', async () => {
      const filepath = path.join(TEST_DIR, 'nested', 'dir', 'file.json');
      await writeToFile({ test: true }, filepath);
      expect(existsSync(filepath)).toBe(true);
    });

    it('should throw error if filepath not provided', async () => {
      await expect(writeToFile({ test: true }, null)).rejects.toThrow('Filepath is required');
    });
  });

  describe('sanitizeForFilename', () => {
    it('should convert to lowercase', () => {
      expect(sanitizeForFilename('HELLO')).toBe('hello');
    });

    it('should replace spaces with underscores', () => {
      expect(sanitizeForFilename('hello world')).toBe('hello_world');
    });

    it('should replace special characters', () => {
      expect(sanitizeForFilename('hello@world#test!')).toBe('hello_world_test');
    });

    it('should remove leading and trailing underscores', () => {
      expect(sanitizeForFilename('___hello___')).toBe('hello');
    });

    it('should respect max length', () => {
      const longText = 'a'.repeat(100);
      const result = sanitizeForFilename(longText, 20);
      expect(result.length).toBe(20);
    });

    it('should handle empty string', () => {
      expect(sanitizeForFilename('')).toBe('');
    });

    it('should collapse multiple underscores', () => {
      expect(sanitizeForFilename('hello   world')).toBe('hello_world');
    });
  });

  describe('promptToFilename', () => {
    it('should sanitize prompt for filename', () => {
      const prompt = 'A Beautiful Sunset Over The Ocean!';
      const result = promptToFilename(prompt);
      expect(result).toBe('a_beautiful_sunset_over_the_ocean');
    });

    it('should truncate long prompts', () => {
      const longPrompt = 'a'.repeat(100);
      const result = promptToFilename(longPrompt, 30);
      expect(result.length).toBe(30);
    });
  });

  describe('generateTimestampedFilename', () => {
    it('should generate filename with timestamp', () => {
      const prompt = 'a cat';
      const model = 'dalle-3';
      const result = generateTimestampedFilename(prompt, model, 'png');

      expect(result).toContain('dalle-3');
      expect(result).toContain('a_cat');
      // Timestamp format: YYYY-MM-DD_HHMMSS or YYYY-MM-DD_HH-MM-SS
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}_[\d-]+_dalle-3_a_cat\.png$/);
    });

    it('should use specified extension', () => {
      const result = generateTimestampedFilename('test', 'dalle-2', 'webp');
      expect(result).toMatch(/\.webp$/);
    });

    it('should sanitize prompt in filename', () => {
      const result = generateTimestampedFilename('Test! Image@ #123', 'dalle-2');
      expect(result).toContain('test_image_123');
    });
  });

  describe('validateImageFile', () => {
    it('should validate file exists', async () => {
      const filepath = path.join(TEST_DIR, 'test.png');
      const result = await validateImageFile(filepath);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('not found');
    });

    it('should validate file size', async () => {
      const filepath = path.join(TEST_DIR, 'test.png');
      const largeData = Buffer.alloc(5 * 1024 * 1024); // 5MB
      await writeToFile(largeData, filepath, 'binary');

      const result = await validateImageFile(filepath, {
        maxSize: 4 * 1024 * 1024 // 4MB limit
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('exceeds maximum');
    });

    it('should validate file format', async () => {
      const filepath = path.join(TEST_DIR, 'test.txt');
      await writeToFile('test', filepath);

      const result = await validateImageFile(filepath, {
        formats: ['png', 'jpg', 'webp']
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('not supported');
    });

    it('should pass validation for valid file', async () => {
      const filepath = path.join(TEST_DIR, 'test.png');
      const smallData = Buffer.alloc(1024); // 1KB
      await writeToFile(smallData, filepath, 'binary');

      const result = await validateImageFile(filepath, {
        maxSize: 10 * 1024 * 1024, // 10MB
        formats: ['png', 'jpg']
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('decodeBase64Image', () => {
    it('should decode base64 and save image', async () => {
      const filepath = path.join(TEST_DIR, 'decoded.png');
      const testData = Buffer.from('test image data').toString('base64');

      await decodeBase64Image(testData, filepath);

      expect(existsSync(filepath)).toBe(true);
      const content = await fs.readFile(filepath);
      expect(content.toString()).toBe('test image data');
    });

    it('should create parent directories', async () => {
      const filepath = path.join(TEST_DIR, 'nested', 'decoded.png');
      const testData = Buffer.from('test').toString('base64');

      await decodeBase64Image(testData, filepath);

      expect(existsSync(filepath)).toBe(true);
    });
  });

  describe('imageToBase64', () => {
    it('should convert local PNG file to base64', async () => {
      const filepath = path.join(TEST_DIR, 'test.png');
      // Create valid PNG header (magic bytes: 89 50 4E 47)
      const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      const imageData = Buffer.concat([pngHeader, Buffer.from('PNG image data')]);
      await writeToFile(imageData, filepath, 'binary');

      const result = await import('../utils.js').then(m => m.imageToBase64(filepath));

      expect(result).toContain('data:image/png;base64,');
      expect(result).toContain(imageData.toString('base64'));
    });

    it('should detect MIME type from file extension', async () => {
      const jpgPath = path.join(TEST_DIR, 'test.jpg');
      const webpPath = path.join(TEST_DIR, 'test.webp');

      // Create valid JPEG header (magic bytes: FF D8 FF)
      const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
      const jpegData = Buffer.concat([jpegHeader, Buffer.from('jpg data')]);

      // Create valid WebP header (RIFF...WEBP)
      const webpHeader = Buffer.from('RIFF\x00\x00\x00\x00WEBP', 'binary');
      const webpData = Buffer.concat([webpHeader, Buffer.from('webp data')]);

      await writeToFile(jpegData, jpgPath, 'binary');
      await writeToFile(webpData, webpPath, 'binary');

      const { imageToBase64 } = await import('../utils.js');

      const jpgResult = await imageToBase64(jpgPath);
      const webpResult = await imageToBase64(webpPath);

      expect(jpgResult).toContain('data:image/jpeg;base64,');
      expect(webpResult).toContain('data:image/webp;base64,');
    });

    it('should throw error for non-existent file', async () => {
      const { imageToBase64 } = await import('../utils.js');

      await expect(imageToBase64('/nonexistent/file.png'))
        .rejects.toThrow('Failed to convert image to base64');
    });
  });

  describe('createSpinner', () => {
    it('should create spinner with start and stop methods', () => {
      const { createSpinner } = require('../utils.js');
      const spinner = createSpinner('Testing');

      expect(spinner).toHaveProperty('start');
      expect(spinner).toHaveProperty('stop');
      expect(spinner).toHaveProperty('update');
      expect(spinner).toHaveProperty('fail');
    });

    it('should return spinner object from start()', () => {
      const { createSpinner } = require('../utils.js');
      const spinner = createSpinner('Testing');

      const result = spinner.start();
      spinner.stop();

      expect(result).toBe(spinner);
    });

    it('should allow updating message', () => {
      const { createSpinner } = require('../utils.js');
      const spinner = createSpinner('Initial');

      spinner.start();
      const result = spinner.update('Updated');
      spinner.stop();

      expect(result).toBe(spinner);
    });

    it('should handle stop with custom message', () => {
      const { createSpinner } = require('../utils.js');
      const spinner = createSpinner('Testing');

      spinner.start();
      const result = spinner.stop('Custom completion message');

      expect(result).toBe(spinner);
    });

    it('should handle fail with error message', () => {
      const { createSpinner } = require('../utils.js');
      const spinner = createSpinner('Testing');

      spinner.start();
      const result = spinner.fail('Operation failed');

      expect(result).toBe(spinner);
    });
  });

  describe('Security: validateImageUrl', () => {
    it('should accept valid HTTPS URLs', () => {
      const validUrls = [
        'https://example.com/image.png',
        'https://api.example.com/v1/images/123',
        'https://cdn.example.org/path/to/image.jpg'
      ];

      validUrls.forEach(url => {
        expect(() => validateImageUrl(url)).not.toThrow();
      });
    });

    it('should reject HTTP URLs (only HTTPS allowed)', () => {
      expect(() => validateImageUrl('http://example.com/image.png'))
        .toThrow('Only HTTPS URLs are allowed');
    });

    it('should reject localhost URLs', () => {
      const localhostUrls = [
        'https://localhost/image.png',
        'https://127.0.0.1/image.png',
        'https://[::1]/image.png'
      ];

      localhostUrls.forEach(url => {
        expect(() => validateImageUrl(url)).toThrow(/localhost|internal/i);
      });
    });

    it('should reject private IP ranges', () => {
      const privateIps = [
        'https://10.0.0.1/image.png',
        'https://172.16.0.1/image.png',
        'https://192.168.1.1/image.png',
        'https://169.254.169.254/latest/meta-data'
      ];

      privateIps.forEach(url => {
        expect(() => validateImageUrl(url)).toThrow(/internal|private|metadata/i);
      });
    });

    it('should reject cloud metadata endpoints', () => {
      const metadataUrls = [
        'https://metadata.google.internal/computeMetadata',
        'https://169.254.169.254/latest/meta-data'
      ];

      metadataUrls.forEach(url => {
        expect(() => validateImageUrl(url)).toThrow(/metadata|internal|private/i);
      });
    });

    it('should reject invalid URLs', () => {
      expect(() => validateImageUrl('not-a-url')).toThrow('Invalid URL');
      expect(() => validateImageUrl('ftp://example.com')).toThrow('HTTPS');
    });
  });

  describe('Security: validateImagePath', () => {
    it('should accept valid PNG files', async () => {
      const testFile = path.join(TEST_DIR, 'test.png');
      await ensureDirectory(TEST_DIR);

      // Create a valid PNG file (PNG magic bytes: 89 50 4E 47)
      const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      await fs.writeFile(testFile, pngHeader);

      await expect(validateImagePath(testFile)).resolves.toBe(testFile);
    });

    it('should accept valid JPEG files', async () => {
      const testFile = path.join(TEST_DIR, 'test.jpg');
      await ensureDirectory(TEST_DIR);

      // Create a valid JPEG file (JPEG magic bytes: FF D8 FF)
      const jpegHeader = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
      await fs.writeFile(testFile, jpegHeader);

      await expect(validateImagePath(testFile)).resolves.toBe(testFile);
    });

    it('should reject non-existent files', async () => {
      await expect(validateImagePath('/nonexistent/file.png'))
        .rejects.toThrow('Image file not found');
    });

    it('should reject empty files', async () => {
      const testFile = path.join(TEST_DIR, 'empty.png');
      await ensureDirectory(TEST_DIR);
      await fs.writeFile(testFile, Buffer.alloc(0));

      await expect(validateImagePath(testFile))
        .rejects.toThrow('Image file is empty');
    });

    it('should reject non-image files', async () => {
      const testFile = path.join(TEST_DIR, 'test.txt');
      await ensureDirectory(TEST_DIR);
      await fs.writeFile(testFile, 'This is not an image');

      await expect(validateImagePath(testFile))
        .rejects.toThrow('does not appear to be a valid image');
    });
  });
});
