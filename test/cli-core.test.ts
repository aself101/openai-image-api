/**
 * CLI core tests
 *
 * In-process tests for the CLI logic in src/cli-core.ts. The subprocess tests
 * in test/cli.test.ts cover the bin entry (argv/exit wiring); these cover the
 * option parsing, validation, job construction and batch semantics directly so
 * they show up in coverage and fail with a stack trace instead of an exit code.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  readOptions,
  resolveModel,
  validateOptions,
  buildJobs,
  describeError,
  runCli,
  type CLIOptions,
} from '../src/cli-core.js';
import { OpenAIImageAPI, OpenAIImageAPIError } from '../src/api.js';
import { logger, setLogLevel } from '../src/utils.js';

const argv = (...args: string[]) => ['node', 'openai-img', ...args];

/** Minimal valid options, overridable */
function opts(over: Partial<CLIOptions> = {}): CLIOptions {
  return readOptions({ prompt: ['a cat'], ...over });
}

describe('cli-core', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.OPENAI_API_KEY = 'sk-test-key-for-cli-core';
    process.env.OPENAI_IMAGE_API_NO_DOTENV = '1';
    setLogLevel('ERROR');
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('readOptions', () => {
    it('should default validate to true and logLevel to INFO', () => {
      const o = readOptions({ prompt: ['x'] });
      expect(o.validate).toBe(true);
      expect(o.logLevel).toBe('INFO');
      expect(o.image).toEqual([]);
    });

    it('should honour --no-validate (commander sets validate: false)', () => {
      expect(readOptions({ prompt: ['x'], validate: false }).validate).toBe(false);
    });

    it('should upper-case and check --log-level', () => {
      expect(readOptions({ prompt: ['x'], logLevel: 'debug' }).logLevel).toBe('DEBUG');
      expect(() => readOptions({ prompt: ['x'], logLevel: 'LOUD' })).toThrow('Invalid value "LOUD" for --log-level');
    });

    it('should reject enum flags outside their set', () => {
      expect(() => readOptions({ prompt: ['x'], quality: 'ultra' })).toThrow('for --quality');
      expect(() => readOptions({ prompt: ['x'], background: 'blue' })).toThrow('for --background');
      expect(() => readOptions({ prompt: ['x'], outputFormat: 'bmp' })).toThrow('for --output-format');
      expect(() => readOptions({ prompt: ['x'], inputFidelity: 'medium' })).toThrow('for --input-fidelity');
    });

    it('should reject non-integer numeric flags', () => {
      expect(() => readOptions({ prompt: ['x'], n: NaN })).toThrow('--n expects an integer');
      expect(() => readOptions({ prompt: ['x'], partialImages: 1.5 })).toThrow('--partial-images expects an integer');
    });

    it('should reject a non-array prompt bag', () => {
      expect(() => readOptions({ prompt: 'not-a-list' })).toThrow('--prompt expects one or more strings');
    });
  });

  describe('resolveModel', () => {
    it('should default to gpt-image-2.5-flare', () => {
      expect(resolveModel(opts())).toBe('gpt-image-2.5-flare');
    });

    it('should let --model win over shortcut flags', () => {
      expect(resolveModel(opts({ sunburst: true, model: 'gpt-image-2' }))).toBe('gpt-image-2');
    });

    it('should map every shortcut', () => {
      expect(resolveModel(opts({ sunburst: true }))).toBe('gpt-image-2.5-sunburst');
      expect(resolveModel(opts({ flare: true }))).toBe('gpt-image-2.5-flare');
      expect(resolveModel(opts({ gptImage2: true }))).toBe('gpt-image-2');
      expect(resolveModel(opts({ gptImage15: true }))).toBe('gpt-image-1.5');
      expect(resolveModel(opts({ gptImage1: true }))).toBe('gpt-image-1');
      expect(resolveModel(opts({ gptImage1Mini: true }))).toBe('gpt-image-1-mini');
    });

    it('should reject unknown ids unless --no-validate', () => {
      expect(() => resolveModel(opts({ model: 'gpt-image-9' }))).toThrow('pass --no-validate');
      // No warning here: the API class warns once when it builds the request
      const warn = vi.spyOn(logger, 'warn').mockImplementation(() => logger);
      expect(resolveModel(opts({ model: 'gpt-image-9', validate: false }))).toBe('gpt-image-9');
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('validateOptions', () => {
    it('should require a prompt', () => {
      expect(() => validateOptions(readOptions({}))).toThrow('--prompt is required');
    });

    it('should require --image for --edit', () => {
      expect(() => validateOptions(opts({ edit: true }))).toThrow('--image is required for --edit');
    });

    it('should require --stream for --partial-images', () => {
      expect(() => validateOptions(opts({ partialImages: 2 }))).toThrow('--partial-images requires --stream');
      expect(validateOptions(opts({ partialImages: 2, stream: true })).operation).toBe('generate');
    });

    it('should return the resolved model and operation', () => {
      expect(validateOptions(opts({ edit: true, image: ['a.png'], sunburst: true }))).toEqual({
        model: 'gpt-image-2.5-sunburst',
        operation: 'edit',
      });
    });
  });

  describe('buildJobs', () => {
    const api = new OpenAIImageAPI({ apiKey: 'sk-x', logLevel: 'ERROR' });

    it('should make one generate job per prompt, carrying partial_images only when streaming', () => {
      const o = opts({ prompt: ['a', 'b', 'c'], partialImages: 2, stream: true, quality: 'high' });
      const jobs = buildJobs(o, { api, model: 'gpt-image-2', operation: 'generate', outputDir: '/tmp/x' });
      expect(jobs.map((j) => j.prompt)).toEqual(['a', 'b', 'c']);
      expect(jobs[0]?.params).toMatchObject({ model: 'gpt-image-2', quality: 'high', partial_images: 2 });

      const buffered = buildJobs(opts({ prompt: ['a'], partialImages: 2 }), {
        api,
        model: 'gpt-image-2',
        operation: 'generate',
        outputDir: '/tmp/x',
      });
      expect(buffered[0]?.params).not.toHaveProperty('partial_images', 2);
    });

    it('should take only the first prompt for an edit and pass a single image as a string', () => {
      const o = opts({ prompt: ['a', 'b'], edit: true, image: ['one.png'], mask: 'm.png', inputFidelity: 'high' });
      const jobs = buildJobs(o, { api, model: 'gpt-image-1.5', operation: 'edit', outputDir: '/tmp/x' });
      expect(jobs).toHaveLength(1);
      expect(jobs[0]?.operation).toBe('edit');
      expect(jobs[0]?.params).toMatchObject({ image: 'one.png', mask: 'm.png', input_fidelity: 'high', prompt: 'a' });
    });

    it('should pass multiple images as an array', () => {
      const o = opts({ edit: true, image: ['a.png', 'b.png'] });
      const jobs = buildJobs(o, { api, model: 'gpt-image-2', operation: 'edit', outputDir: '/tmp/x' });
      expect(jobs[0]?.params).toMatchObject({ image: ['a.png', 'b.png'] });
    });
  });

  describe('describeError', () => {
    it('should append apiMessage and code when they add information', () => {
      const err = new OpenAIImageAPIError('Bad request: Invalid request parameters', {
        status: 400,
        code: 'invalid_size',
        type: 'image_generation_user_error',
        apiMessage: 'size not supported',
      });
      expect(describeError(err)).toBe(
        'Bad request: Invalid request parameters (API: size not supported; code: invalid_size; type: image_generation_user_error)'
      );
    });

    it('should not repeat an apiMessage the message already contains', () => {
      const err = new OpenAIImageAPIError('Bad request: size not supported', {
        status: 400,
        apiMessage: 'size not supported',
      });
      expect(describeError(err)).toBe('Bad request: size not supported');
    });

    it('should omit the package-internal type when there is no status', () => {
      const err = new OpenAIImageAPIError('Prompt is required', { type: 'validation_error' });
      expect(describeError(err)).toBe('Prompt is required');
    });

    it('should stringify non-Error values', () => {
      expect(describeError('boom')).toBe('boom');
    });
  });

  describe('runCli (in-process)', () => {
    it('should return 0 for a valid dry run and 1 for a validator rejection', async () => {
      expect(await runCli(argv('--dry-run', '--prompt', 'a cat', '--size', '1536x864'), '3.0.0')).toBe(0);
      expect(await runCli(argv('--dry-run', '--gpt-image-2', '--prompt', 'a cat', '--quality', 'max'), '3.0.0')).toBe(
        1
      );
    });

    it('should return 1 for a bad flag value before doing anything else', async () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(() => logger);
      expect(await runCli(argv('--prompt', 'x', '--quality', 'bogus'), '3.0.0')).toBe(1);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Invalid value "bogus" for --quality'));
    });

    it('should return 0 for --examples', async () => {
      const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      expect(await runCli(argv('--examples'), '3.0.0')).toBe(0);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('USAGE EXAMPLES'));
    });

    it('should return 1 and list failures when every prompt in a batch fails client-side', async () => {
      const error = vi.spyOn(logger, 'error').mockImplementation(() => logger);
      const tooLong = 'a'.repeat(32001);
      const code = await runCli(
        argv('--prompt', tooLong, '--prompt', `${tooLong}b`, '--output-dir', './test-cli-core-out'),
        '3.0.0'
      );
      expect(code).toBe(1);
      expect(error.mock.calls.map((c) => JSON.stringify(c[0])).join('\n')).toContain('2 of 2 prompt(s) failed');
      const fs = await import('fs/promises');
      await fs.rm('./test-cli-core-out', { recursive: true, force: true });
    });

    it('should honour --no-validate on an unknown --model at dry run', async () => {
      // The catalogue warning is emitted by the API class's own logger; the
      // subprocess test in test/cli.test.ts asserts it appears exactly once.
      expect(await runCli(argv('--dry-run', '--no-validate', '--model', 'gpt-image-9', '--prompt', 'x'), '3.0.0')).toBe(
        0
      );
    });
  });
});
