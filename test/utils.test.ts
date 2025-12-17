/**
 * Utility Functions Tests
 *
 * Tests for utils.ts - file I/O, image handling, and helper functions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

// Mock DNS module before importing utils
vi.mock('dns/promises', () => ({
  lookup: vi.fn()
}));

import {
  ensureDirectory,
  writeToFile,
  sanitizeForFilename,
  promptToFilename,
  generateTimestampedFilename,
  validateImageFile,
  decodeBase64Image,
  validateImageUrl,
  validateImagePath,
  validateOutputPath,
  pollVideoWithProgress,
  saveVideoFile,
  generateVideoFilename,
  saveVideoMetadata,
  validateVideoFile
} from '../src/utils.js';
import { lookup } from 'dns/promises';
import type { Mock } from 'vitest';
import type { VideoObject } from '../src/types.js';

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
      await expect(writeToFile({ test: true }, null as unknown as string)).rejects.toThrow('Filepath is required');
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
    it('should validate file exists', () => {
      const filepath = path.join(TEST_DIR, 'test.png');
      const result = validateImageFile(filepath);

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('not found');
    });

    it('should validate file size', async () => {
      const filepath = path.join(TEST_DIR, 'test.png');
      const largeData = Buffer.alloc(5 * 1024 * 1024); // 5MB
      await writeToFile(largeData, filepath, 'binary');

      const result = validateImageFile(filepath, {
        maxSize: 4 * 1024 * 1024 // 4MB limit
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('exceeds maximum');
    });

    it('should validate file format', async () => {
      const filepath = path.join(TEST_DIR, 'test.txt');
      await writeToFile('test', filepath);

      const result = validateImageFile(filepath, {
        formats: ['png', 'jpg', 'webp']
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('not supported');
    });

    it('should pass validation for valid file', async () => {
      const filepath = path.join(TEST_DIR, 'test.png');
      const smallData = Buffer.alloc(1024); // 1KB
      await writeToFile(smallData, filepath, 'binary');

      const result = validateImageFile(filepath, {
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

  describe('Security: validateImageUrl', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should accept valid HTTPS URLs with public IPs', async () => {
      (lookup as Mock).mockResolvedValue({ address: '8.8.8.8', family: 4 });
      await expect(validateImageUrl('https://example.com/image.png')).resolves.toBe('https://example.com/image.png');

      (lookup as Mock).mockResolvedValue({ address: '1.1.1.1', family: 4 });
      await expect(validateImageUrl('https://api.example.com/v1/images/123')).resolves.toBe('https://api.example.com/v1/images/123');
    });

    it('should reject HTTP URLs (only HTTPS allowed)', async () => {
      await expect(validateImageUrl('http://example.com/image.png'))
        .rejects.toThrow('Only HTTPS URLs are allowed');
    });

    it('should reject localhost URLs', async () => {
      await expect(validateImageUrl('https://localhost/image.png'))
        .rejects.toThrow(/metadata/i);

      await expect(validateImageUrl('https://127.0.0.1/image.png'))
        .rejects.toThrow(/internal|private/i);
    });

    it('should reject private IP ranges', async () => {
      await expect(validateImageUrl('https://10.0.0.1/image.png'))
        .rejects.toThrow(/internal|private/i);

      await expect(validateImageUrl('https://192.168.1.1/image.png'))
        .rejects.toThrow(/internal|private/i);
    });

    it('should reject invalid URLs', async () => {
      await expect(validateImageUrl('not-a-url')).rejects.toThrow('Invalid URL');
      await expect(validateImageUrl('ftp://example.com')).rejects.toThrow('HTTPS');
    });

    // DNS Rebinding Prevention Tests
    it('should reject domains resolving to localhost (DNS rebinding prevention)', async () => {
      (lookup as Mock).mockResolvedValue({ address: '127.0.0.1', family: 4 });
      await expect(validateImageUrl('https://evil.com/image.jpg'))
        .rejects.toThrow('resolves to internal/private IP');
    });

    it('should reject domains resolving to private IPs (DNS rebinding prevention)', async () => {
      (lookup as Mock).mockResolvedValue({ address: '10.0.0.1', family: 4 });
      await expect(validateImageUrl('https://evil.com/image.jpg'))
        .rejects.toThrow('resolves to internal/private IP');
    });

    // IPv4-mapped IPv6 Bypass Prevention Tests
    it('should reject IPv4-mapped IPv6 localhost addresses (SSRF bypass prevention)', async () => {
      (lookup as Mock).mockResolvedValue({ address: '::ffff:127.0.0.1', family: 6 });
      await expect(validateImageUrl('https://evil.com/image.jpg'))
        .rejects.toThrow('resolves to internal/private IP');
    });

    it('should reject IPv4-mapped IPv6 private IP addresses (SSRF bypass prevention)', async () => {
      const mappedPrivateIPs = [
        '::ffff:10.0.0.1',      // Private Class A
        '::ffff:192.168.1.1',   // Private Class C
        '::ffff:172.16.0.1',    // Private Class B
        '::ffff:169.254.169.254' // AWS metadata
      ];

      for (const ip of mappedPrivateIPs) {
        (lookup as Mock).mockResolvedValue({ address: ip, family: 6 });
        await expect(validateImageUrl('https://evil.com/image.jpg'))
          .rejects.toThrow('resolves to internal/private IP');
      }
    });

    it('should handle DNS lookup failures gracefully', async () => {
      (lookup as Mock).mockRejectedValue({ code: 'ENOTFOUND' });
      await expect(validateImageUrl('https://nonexistent.domain.invalid/image.jpg'))
        .rejects.toThrow('could not be resolved');
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

  describe('Video Utilities (Sora)', () => {
    describe('pollVideoWithProgress', () => {
      it('should poll until video is completed', async () => {
        const mockApi = {
          retrieveVideo: vi.fn()
            .mockResolvedValueOnce({
              id: 'video_123',
              status: 'in_progress',
              progress: 25
            } as VideoObject)
            .mockResolvedValueOnce({
              id: 'video_123',
              status: 'in_progress',
              progress: 75
            } as VideoObject)
            .mockResolvedValueOnce({
              id: 'video_123',
              status: 'completed',
              progress: 100
            } as VideoObject)
        };

        const result = await pollVideoWithProgress(mockApi, 'video_123', {
          interval: 10,
          timeout: 5000,
          showSpinner: false
        });

        expect(result.status).toBe('completed');
        expect(mockApi.retrieveVideo).toHaveBeenCalledTimes(3);
      });

      it('should throw error if video fails', async () => {
        const mockApi = {
          retrieveVideo: vi.fn().mockResolvedValue({
            id: 'video_123',
            status: 'failed',
            error: { message: 'Generation failed' }
          } as VideoObject)
        };

        await expect(pollVideoWithProgress(mockApi, 'video_123', {
          interval: 10,
          showSpinner: false
        })).rejects.toThrow('Generation failed');
      });

      it('should throw error on timeout', async () => {
        const mockApi = {
          retrieveVideo: vi.fn().mockResolvedValue({
            id: 'video_123',
            status: 'in_progress',
            progress: 50
          } as VideoObject)
        };

        await expect(pollVideoWithProgress(mockApi, 'video_123', {
          interval: 100,
          timeout: 200,  // Very short timeout
          showSpinner: false
        })).rejects.toThrow('timed out');
      });
    });

    describe('saveVideoFile', () => {
      it('should save video buffer to file', async () => {
        const filepath = path.join(TEST_DIR, 'test-video.mp4');
        const videoBuffer = Buffer.from('fake video data');

        await saveVideoFile(videoBuffer, filepath);

        expect(existsSync(filepath)).toBe(true);
        const content = await fs.readFile(filepath);
        expect(content).toEqual(videoBuffer);
      });

      it('should create parent directories', async () => {
        const filepath = path.join(TEST_DIR, 'nested', 'video', 'test.mp4');
        const videoBuffer = Buffer.from('fake video data');

        await saveVideoFile(videoBuffer, filepath);

        expect(existsSync(filepath)).toBe(true);
      });

      it('should throw error if buffer is not provided', async () => {
        const filepath = path.join(TEST_DIR, 'test.mp4');

        await expect(saveVideoFile(null as unknown as Buffer, filepath))
          .rejects.toThrow('Invalid video data: expected Buffer');
      });

      it('should validate buffer is a Buffer instance', async () => {
        const filepath = path.join(TEST_DIR, 'test.mp4');

        await expect(saveVideoFile('not a buffer' as unknown as Buffer, filepath))
          .rejects.toThrow('Invalid video data: expected Buffer');
      });

      it('should reject buffer exceeding size limit', async () => {
        const filepath = path.join(TEST_DIR, 'test.mp4');
        const largeBuffer = Buffer.alloc(101 * 1024 * 1024); // 101MB

        await expect(saveVideoFile(largeBuffer, filepath, {
          maxSize: 100 * 1024 * 1024  // 100MB limit
        })).rejects.toThrow('exceeds maximum');
      });
    });

    describe('generateVideoFilename', () => {
      it('should generate filename with timestamp', () => {
        const prompt = 'a cat on a motorcycle';
        const model = 'sora-2';
        const result = generateVideoFilename(prompt, model);

        expect(result).toContain('sora-2');
        expect(result).toContain('a_cat_on_a_motorcycle');
        // Format: YYYY-MM-DD_HH-MM-SS_model_prompt.mp4
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2}_[\d-]+_sora-2_a_cat_on_a_motorcycle\.mp4$/);
      });

      it('should use specified extension', () => {
        const result = generateVideoFilename('test', 'sora-2', 'webm');
        expect(result).toMatch(/\.webm$/);
      });

      it('should default to mp4 extension', () => {
        const result = generateVideoFilename('test', 'sora-2');
        expect(result).toMatch(/\.mp4$/);
      });

      it('should sanitize prompt in filename', () => {
        const result = generateVideoFilename('Test! Video@ #123', 'sora-2');
        expect(result).toContain('test_video_123');
      });

      it('should truncate long prompts', () => {
        const longPrompt = 'a'.repeat(100);
        const result = generateVideoFilename(longPrompt, 'sora-2');

        // Filename should be reasonable length (not 100+ chars)
        expect(result.length).toBeLessThan(80);
      });

      it('should include model name in filename', () => {
        const result = generateVideoFilename('test', 'sora-2-pro');
        expect(result).toContain('sora-2-pro');
      });
    });

    describe('saveVideoMetadata', () => {
      it('should save video metadata as JSON', async () => {
        const filepath = path.join(TEST_DIR, 'metadata.json');
        const videoObject: VideoObject = {
          id: 'video_123',
          object: 'video',
          created_at: 1234567890,
          model: 'sora-2',
          status: 'completed',
          progress: 100,
          prompt: 'a cat on a motorcycle'
        };

        await saveVideoMetadata(videoObject, filepath);

        expect(existsSync(filepath)).toBe(true);
        const content = await fs.readFile(filepath, 'utf8');
        const parsed = JSON.parse(content);
        // The function saves specific fields, not the entire object
        expect(parsed.id).toBe('video_123');
        expect(parsed.model).toBe('sora-2');
        expect(parsed.status).toBe('completed');
      });

      it('should create parent directories', async () => {
        const filepath = path.join(TEST_DIR, 'nested', 'metadata.json');
        const videoObject = { id: 'video_123', status: 'completed' } as VideoObject;

        await saveVideoMetadata(videoObject, filepath);

        expect(existsSync(filepath)).toBe(true);
      });

      it('should format JSON nicely with indentation', async () => {
        const filepath = path.join(TEST_DIR, 'metadata.json');
        const videoObject = {
          id: 'video_123',
          model: 'sora-2'
        } as VideoObject;

        await saveVideoMetadata(videoObject, filepath);

        const content = await fs.readFile(filepath, 'utf8');
        expect(content).toContain('\n');  // Should be formatted, not minified
        expect(content).toContain('  ');  // Should have indentation
      });
    });

    describe('validateVideoFile', () => {
      it('should validate MP4 file magic bytes (ftyp)', () => {
        // Create file with valid MP4 magic bytes: "ftyp" at offset 4
        const mp4Header = Buffer.from([
          0x00, 0x00, 0x00, 0x20,  // Size
          0x66, 0x74, 0x79, 0x70,  // "ftyp"
          0x69, 0x73, 0x6F, 0x6D   // "isom"
        ]);

        const result = validateVideoFile(Buffer.concat([mp4Header, Buffer.alloc(100)]));

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should reject non-MP4 files', () => {
        const invalidBuffer = Buffer.from('This is not a video file');

        const result = validateVideoFile(invalidBuffer);

        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('not appear to be a valid MP4');
      });

      it('should reject empty buffers', () => {
        const result = validateVideoFile(Buffer.alloc(0));

        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('Video buffer is empty');
      });

      it('should reject buffers that are too small', () => {
        const result = validateVideoFile(Buffer.alloc(7)); // Less than 8 bytes

        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('too small to be valid');
      });

      it('should validate buffer size constraints', () => {
        const largeBuffer = Buffer.alloc(101 * 1024 * 1024); // 101MB

        const result = validateVideoFile(largeBuffer, {
          maxSize: 100 * 1024 * 1024  // 100MB limit
        });

        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('exceeds maximum');
      });
    });
  });

  describe('Security: validateOutputPath', () => {
    it('should accept valid absolute paths', () => {
      const result = validateOutputPath('/tmp/output');
      expect(result).toBe('/tmp/output');
    });

    it('should accept valid relative paths and resolve them', () => {
      const result = validateOutputPath('output');
      expect(path.isAbsolute(result)).toBe(true);
      expect(result.endsWith('output')).toBe(true);
    });

    it('should reject paths with .. traversal sequences', () => {
      expect(() => validateOutputPath('/tmp/../etc/passwd'))
        .toThrow('Path traversal sequences (..) are not allowed');
    });

    it('should reject paths with embedded .. sequences', () => {
      expect(() => validateOutputPath('/tmp/foo/../../etc'))
        .toThrow('Path traversal sequences (..) are not allowed');
    });

    it('should validate paths stay within base path when provided', () => {
      const result = validateOutputPath('/home/user/project/output', '/home/user/project');
      expect(result).toBe('/home/user/project/output');
    });

    it('should reject paths that escape base path', () => {
      // Even without .., a path outside base should be rejected
      expect(() => validateOutputPath('/etc/passwd', '/home/user/project'))
        .toThrow('Output path must be within /home/user/project');
    });
  });
});
