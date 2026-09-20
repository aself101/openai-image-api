/**
 * Utility Functions Tests
 *
 * Tests for utils.ts - file I/O, image handling, SSE parsing, and helper functions.
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
  decodeBase64Image,
  validateImagePath,
  validateOutputPath,
  parseSSEStream,
  readStreamToString,
  getErrorMessage,
  getErrorCode,
} from '../src/utils.js';
import { Readable } from 'stream';
import type { RawSSEEvent } from '../src/types.js';

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
      const model = 'gpt-image-2';
      const result = generateTimestampedFilename(prompt, model, 'png');

      expect(result).toContain('gpt-image-2');
      expect(result).toContain('a_cat');
      // Timestamp format: YYYY-MM-DD_HHMMSS or YYYY-MM-DD_HH-MM-SS
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}_[\d-]+_gpt-image-2_a_cat\.png$/);
    });

    it('should use specified extension', () => {
      const result = generateTimestampedFilename('test', 'gpt-image-2.5-flare', 'webp');
      expect(result).toMatch(/\.webp$/);
    });

    it('should sanitize prompt in filename', () => {
      const result = generateTimestampedFilename('Test! Image@ #123', 'gpt-image-2.5-flare');
      expect(result).toContain('test_image_123');
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

  describe('writeToFile binary guard', () => {
    it('should refuse a binary write of a non-Buffer', async () => {
      await expect(writeToFile('not a buffer', path.join(TEST_DIR, 'x.png'))).rejects.toThrow(
        'requires a Buffer, got string'
      );
    });
  });

  describe('getErrorMessage / getErrorCode', () => {
    it('should read Error messages', () => {
      expect(getErrorMessage(new Error('boom'))).toBe('boom');
    });

    it('should pass strings through and stringify everything else', () => {
      expect(getErrorMessage('plain')).toBe('plain');
      expect(getErrorMessage({ a: 1 })).toBe('{"a":1}');
      expect(getErrorMessage(null)).toBe('null');
      expect(getErrorMessage(undefined)).toBe('undefined');
    });

    it('should survive values JSON.stringify rejects', () => {
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      expect(getErrorMessage(circular)).toBe('[object Object]');
    });

    it('should extract errno codes only when they are strings', () => {
      expect(getErrorCode(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe('ENOENT');
      expect(getErrorCode(Object.assign(new Error('x'), { code: 13 }))).toBeUndefined();
      expect(getErrorCode('nope')).toBeUndefined();
      expect(getErrorCode(null)).toBeUndefined();
    });
  });

  describe('parseSSEStream', () => {
    const collect = async (stream: Readable) => {
      const out: RawSSEEvent[] = [];
      for await (const e of parseSSEStream(stream)) out.push(e);
      return out;
    };

    it('should parse event and data fields from a single chunk', async () => {
      const events = await collect(
        Readable.from(['event: image_generation.completed\ndata: {"a":1}\n\n'])
      );
      expect(events).toEqual([{ event: 'image_generation.completed', data: '{"a":1}' }]);
    });

    it('should reassemble events split across arbitrary chunk boundaries', async () => {
      const text = 'event: e1\ndata: {"i":0}\n\nevent: e2\ndata: {"i":1}\n\n';
      const parts: string[] = [];
      for (let i = 0; i < text.length; i += 3) parts.push(text.slice(i, i + 3));
      const events = await collect(Readable.from(parts));
      expect(events).toEqual([
        { event: 'e1', data: '{"i":0}' },
        { event: 'e2', data: '{"i":1}' },
      ]);
    });

    it('should accept Buffer chunks', async () => {
      const events = await collect(Readable.from([Buffer.from('data: x\n\n')]));
      expect(events).toEqual([{ event: undefined, data: 'x' }]);
    });

    it('should join multi-line data with newlines', async () => {
      const events = await collect(Readable.from(['data: line1\ndata: line2\n\n']));
      expect(events[0].data).toBe('line1\nline2');
    });

    it('should ignore comments and unknown fields', async () => {
      const events = await collect(Readable.from([': keepalive\nid: 7\nretry: 100\ndata: ok\n\n']));
      expect(events).toEqual([{ event: undefined, data: 'ok' }]);
    });

    it('should tolerate CRLF line endings', async () => {
      const events = await collect(Readable.from(['event: e\r\ndata: 1\r\n\r\nevent: f\r\ndata: 2\r\n\r\n']));
      expect(events).toEqual([
        { event: 'e', data: '1' },
        { event: 'f', data: '2' },
      ]);
    });

    it('should handle a mixed CR/LF delimiter without eating the next event', async () => {
      const events = await collect(Readable.from(['event: a\ndata: 1\r\n\nevent: b\ndata: 2\n\n']));
      expect(events).toEqual([
        { event: 'a', data: '1' },
        { event: 'b', data: '2' },
      ]);
    });

    it('should flush a trailing event with no terminating blank line', async () => {
      const events = await collect(Readable.from(['event: last\ndata: fin']));
      expect(events).toEqual([{ event: 'last', data: 'fin' }]);
    });

    it('should yield nothing for an empty or keepalive-only stream', async () => {
      expect(await collect(Readable.from([]))).toEqual([]);
      expect(await collect(Readable.from([': ping\n\n: ping\n\n']))).toEqual([]);
    });

    it('should preserve large single-line payloads intact', async () => {
      const big = 'A'.repeat(200_000);
      const events = await collect(Readable.from([`data: ${big.slice(0, 100_000)}`, `${big.slice(100_000)}\n\n`]));
      expect(events[0].data).toHaveLength(200_000);
    });
  });

  describe('readStreamToString', () => {
    it('should concatenate string and Buffer chunks', async () => {
      expect(await readStreamToString(Readable.from(['ab', Buffer.from('cd')]))).toBe('abcd');
    });

    it('should refuse bodies above the byte limit', async () => {
      await expect(readStreamToString(Readable.from(['x'.repeat(20)]), 10)).rejects.toThrow('exceeded 10 bytes');
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

    it('should accept directory names that merely contain two dots', () => {
      expect(validateOutputPath('my..dir')).toMatch(/my\.\.dir$/);
      expect(validateOutputPath('/tmp/renders/v1..2')).toBe('/tmp/renders/v1..2');
    });

    it('should reject a .. segment written with backslashes', () => {
      expect(() => validateOutputPath('out\\..\\etc')).toThrow('Path traversal sequences');
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
