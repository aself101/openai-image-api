/**
 * Configuration Tests
 *
 * Tests for config.ts - API key management, model constraints, and validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getOpenAIApiKey,
  validateApiKeyFormat,
  getOutputDir,
  loadEnvConfig,
  validateModelParams,
  validateFlexibleSize,
  getModelConstraints,
  getModelDeprecation,
  deprecationNotice,
  resolveModelFamily,
  isSupportedModel,
  MODELS,
  MODEL_ALIASES,
  MODEL_DEPRECATIONS,
  ENDPOINTS,
  MODEL_CONSTRAINTS,
  DEFAULT_MODEL,
} from '../src/config.js';

describe('Configuration', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
    // Keep the lazy .env loader from reading this machine's real key files
    process.env.OPENAI_IMAGE_API_NO_DOTENV = '1';
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('getOpenAIApiKey', () => {
    it('should return CLI API key when provided', () => {
      process.env.OPENAI_API_KEY = 'env-key';
      expect(getOpenAIApiKey('cli-key')).toBe('cli-key');
    });

    it('should return environment variable when no CLI key', () => {
      process.env.OPENAI_API_KEY = 'env-key';
      expect(getOpenAIApiKey()).toBe('env-key');
    });

    it('should throw error when no API key found', () => {
      delete process.env.OPENAI_API_KEY;
      expect(() => getOpenAIApiKey()).toThrow('OPENAI_API_KEY not found');
    });

    it('should not read .env files when OPENAI_IMAGE_API_NO_DOTENV is set', () => {
      delete process.env.OPENAI_API_KEY;
      expect(loadEnvConfig()).toBe(false);
      expect(() => getOpenAIApiKey()).toThrow('OPENAI_API_KEY not found');
    });

    it('should not touch .env files when a CLI key is given', () => {
      delete process.env.OPENAI_IMAGE_API_NO_DOTENV;
      // With a CLI key the loader must not run at all; an opt-out is not needed
      expect(getOpenAIApiKey('cli-key')).toBe('cli-key');
    });

    it('should not mention removed models in the help text', () => {
      delete process.env.OPENAI_API_KEY;
      expect(() => getOpenAIApiKey()).not.toThrow(/dalle|sora/i);
    });
  });

  describe('validateApiKeyFormat', () => {
    it('should return true for valid-looking API key', () => {
      expect(validateApiKeyFormat('sk-' + 'a'.repeat(48))).toBe(true);
    });

    it('should return true for project API keys', () => {
      expect(validateApiKeyFormat('sk-proj-' + 'a'.repeat(48))).toBe(true);
    });

    it('should return false for null or undefined', () => {
      expect(validateApiKeyFormat(null)).toBe(false);
      expect(validateApiKeyFormat(undefined)).toBe(false);
    });

    it('should return false for keys without sk- prefix', () => {
      expect(validateApiKeyFormat('a'.repeat(48))).toBe(false);
    });

    it('should return false for short strings', () => {
      expect(validateApiKeyFormat('sk-short')).toBe(false);
    });
  });

  describe('getOutputDir', () => {
    it('should return default output directory', () => {
      delete process.env.OPENAI_OUTPUT_DIR;
      expect(getOutputDir()).toBe('datasets/openai');
    });

    it('should return custom output directory from env', () => {
      process.env.OPENAI_OUTPUT_DIR = '/custom/path';
      expect(getOutputDir()).toBe('/custom/path');
    });
  });

  describe('Model catalogue', () => {
    it('should default to gpt-image-2.5-flare', () => {
      expect(DEFAULT_MODEL).toBe('gpt-image-2.5-flare');
      expect(MODEL_CONSTRAINTS[DEFAULT_MODEL]).toBeDefined();
    });

    it('should expose exactly the six GPT Image families', () => {
      expect(Object.keys(MODEL_CONSTRAINTS).sort()).toEqual([
        'gpt-image-1',
        'gpt-image-1-mini',
        'gpt-image-1.5',
        'gpt-image-2',
        'gpt-image-2.5-flare',
        'gpt-image-2.5-sunburst',
      ]);
    });

    it('should not carry any DALL-E or Sora identifiers', () => {
      const everything = JSON.stringify({ MODELS, MODEL_ALIASES, MODEL_CONSTRAINTS, ENDPOINTS });
      expect(everything).not.toMatch(/dall-e|sora|video/i);
    });

    it('should map every CLI name to a constrained family', () => {
      for (const family of Object.values(MODELS)) {
        expect(MODEL_CONSTRAINTS[family]).toBeDefined();
      }
    });

    it('should resolve dated snapshots to their family', () => {
      expect(resolveModelFamily('gpt-image-2.5-flare-2026-09-08')).toBe('gpt-image-2.5-flare');
      expect(resolveModelFamily('gpt-image-2.5-sunburst-2026-09-08')).toBe('gpt-image-2.5-sunburst');
      expect(resolveModelFamily('gpt-image-2-2026-04-21')).toBe('gpt-image-2');
    });

    it('should resolve canonical names to themselves', () => {
      expect(resolveModelFamily('gpt-image-2')).toBe('gpt-image-2');
    });

    it('should return null for unknown identifiers', () => {
      expect(resolveModelFamily('dall-e-3')).toBeNull();
      expect(resolveModelFamily('gpt-image-9')).toBeNull();
      expect(isSupportedModel('dall-e-2')).toBe(false);
      expect(isSupportedModel('gpt-image-2.5-flare-2026-09-08')).toBe(true);
    });

    it('should have only the two image endpoints', () => {
      expect(ENDPOINTS).toEqual({
        generate: '/v1/images/generations',
        edit: '/v1/images/edits',
      });
    });
  });

  describe('Model deprecations', () => {
    it('should record shutdown dates for the 1.x models', () => {
      expect(MODEL_DEPRECATIONS['gpt-image-1']?.shutdown).toBe('2026-10-23');
      expect(MODEL_DEPRECATIONS['gpt-image-1-mini']?.shutdown).toBe('2026-12-01');
      expect(MODEL_DEPRECATIONS['gpt-image-1.5']?.shutdown).toBe('2026-12-01');
    });

    it('should not deprecate gpt-image-2 or the 2.5 models', () => {
      expect(getModelDeprecation('gpt-image-2')).toBeNull();
      expect(getModelDeprecation('gpt-image-2.5-flare')).toBeNull();
      expect(getModelDeprecation('gpt-image-2.5-sunburst-2026-09-08')).toBeNull();
    });

    it('should phrase the notice in the right tense around the shutdown date', () => {
      const dep = MODEL_DEPRECATIONS['gpt-image-1']!;
      expect(deprecationNotice('gpt-image-1', dep, new Date('2026-10-22T23:59:59Z'))).toMatch(
        /is scheduled for removal from the OpenAI API on 2026-10-23\. Migrate to gpt-image-2\./
      );
      expect(deprecationNotice('gpt-image-1', dep, new Date('2026-10-23T00:00:00Z'))).toMatch(
        /was removed from the OpenAI API on 2026-10-23/
      );
    });

    it('README model table should carry the same shutdown dates as MODEL_DEPRECATIONS', async () => {
      const fs = await import('fs/promises');
      const readme = await fs.readFile(new URL('../README.md', import.meta.url), 'utf8');
      for (const [model, dep] of Object.entries(MODEL_DEPRECATIONS)) {
        const row = readme
          .split('\n')
          .find((l) => new RegExp(`^\\| \`${model.replace(/\./g, '\\.')}\`\\s+\\|`).test(l));
        expect(row, `README row for ${model}`).toBeDefined();
        expect(row).toContain(`Shutdown ${dep.shutdown}`);
      }
      // and no other date claims to be a shutdown
      const claimed = [...readme.matchAll(/Shutdown (\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]);
      const known = new Set(Object.values(MODEL_DEPRECATIONS).map((d) => d.shutdown));
      for (const c of claimed) expect(known.has(c), `README shutdown date ${c}`).toBe(true);
    });

    it('should point every deprecated model at a live replacement', () => {
      for (const dep of Object.values(MODEL_DEPRECATIONS)) {
        expect(dep).toBeDefined();
        expect(getModelDeprecation(dep.replacement)).toBeNull();
      }
    });
  });

  describe('Model Constraints', () => {
    it('should allow xhigh and max only on the 2.5 models', () => {
      for (const family of Object.keys(MODEL_CONSTRAINTS) as Array<keyof typeof MODEL_CONSTRAINTS>) {
        const q = MODEL_CONSTRAINTS[family].quality;
        if (family.startsWith('gpt-image-2.5')) {
          expect(q).toContain('xhigh');
          expect(q).toContain('max');
        } else {
          expect(q).not.toContain('xhigh');
          expect(q).not.toContain('max');
        }
      }
    });

    it('should give flexible sizes to gpt-image-2 and 2.5 only', () => {
      expect(MODEL_CONSTRAINTS['gpt-image-2'].flexibleSize).toBeDefined();
      expect(MODEL_CONSTRAINTS['gpt-image-2.5-flare'].flexibleSize).toBeDefined();
      expect(MODEL_CONSTRAINTS['gpt-image-2.5-sunburst'].flexibleSize).toBeDefined();
      expect(MODEL_CONSTRAINTS['gpt-image-1'].flexibleSize).toBeUndefined();
      expect(MODEL_CONSTRAINTS['gpt-image-1.5'].flexibleSize).toBeUndefined();
      expect(MODEL_CONSTRAINTS['gpt-image-1-mini'].flexibleSize).toBeUndefined();
    });

    it('should accept input_fidelity on the 1.x models only (2.5 rejection live-verified 2026-09-20)', () => {
      expect(MODEL_CONSTRAINTS['gpt-image-2'].inputFidelity).toBeUndefined();
      expect(MODEL_CONSTRAINTS['gpt-image-2.5-sunburst'].inputFidelity).toBeUndefined();
      expect(MODEL_CONSTRAINTS['gpt-image-2.5-flare'].inputFidelity).toBeUndefined();
      expect(MODEL_CONSTRAINTS['gpt-image-1'].inputFidelity).toEqual(['high', 'low']);
      expect(MODEL_CONSTRAINTS['gpt-image-1-mini'].inputFidelity).toEqual(['high', 'low']);
      expect(MODEL_CONSTRAINTS['gpt-image-1.5'].inputFidelity).toEqual(['high', 'low']);
    });

    it('should have 32k prompt limit and n 1-10 everywhere', () => {
      for (const c of Object.values(MODEL_CONSTRAINTS)) {
        expect(c.promptMaxLength).toBe(32000);
        expect(c.n).toEqual({ min: 1, max: 10 });
        expect(c.supportsEdit).toBe(true);
        expect(c.editMaxImages).toBe(16);
      }
    });

    it('getModelConstraints should resolve snapshots and reject unknowns', () => {
      expect(getModelConstraints('gpt-image-2-2026-04-21')).toBe(MODEL_CONSTRAINTS['gpt-image-2']);
      expect(getModelConstraints('dall-e-3')).toBeNull();
    });
  });

  describe('validateFlexibleSize', () => {
    const rule = MODEL_CONSTRAINTS['gpt-image-2'].flexibleSize!;

    it('should accept documented sizes', () => {
      for (const size of ['1536x864', '2048x2048', '2048x1152', '3840x2160', '2160x3840', '1024x1024']) {
        expect(validateFlexibleSize(size, rule)).toEqual([]);
      }
    });

    it('should reject non-multiples of 16', () => {
      expect(validateFlexibleSize('1000x1000', rule).join()).toMatch(/multiples of 16/);
    });

    it('should reject edges above 3840', () => {
      expect(validateFlexibleSize('4096x1376', rule).join()).toMatch(/exceed 3840/);
    });

    it('should reject aspect ratios beyond 3:1', () => {
      // 3072x1024 is exactly 3:1 and passes; 3088x1024 does not
      expect(validateFlexibleSize('3072x1024', rule)).toEqual([]);
      expect(validateFlexibleSize('3088x1024', rule).join()).toMatch(/aspect ratio/);
    });

    it('should reject too few or too many pixels', () => {
      expect(validateFlexibleSize('512x512', rule).join()).toMatch(/total pixels/);
      expect(validateFlexibleSize('3840x2176', rule).join()).toMatch(/total pixels|exceed/);
    });

    it('should accept exactly the minimum pixel count and reject one grid step below', () => {
      // 640x1024 = 655,360 px, the published floor; 624x1024 = 638,976 px
      expect(validateFlexibleSize('640x1024', rule)).toEqual([]);
      expect(validateFlexibleSize('624x1024', rule).join()).toMatch(/total pixels/);
    });

    it('should accept exactly the maximum pixel count', () => {
      // 3840x2160 = 8,294,400 px, the published ceiling
      expect(validateFlexibleSize('3840x2160', rule)).toEqual([]);
    });

    it('should reject malformed strings', () => {
      expect(validateFlexibleSize('big', rule).join()).toMatch(/WIDTHxHEIGHT/);
      expect(validateFlexibleSize('1024x', rule).join()).toMatch(/WIDTHxHEIGHT/);
    });

    it('should name the expected argument when handed a model id instead of a rule', () => {
      expect(() => validateFlexibleSize('1000x1000', 'gpt-image-2' as unknown as typeof rule)).toThrow(
        /expects a FlexibleSizeConstraint.*got "gpt-image-2"/
      );
    });

    it('should report multiple violations at once', () => {
      // odd multiple, over-wide, over-ratio
      const errors = validateFlexibleSize('4000x1000', rule);
      expect(errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('validateModelParams', () => {
    it('should validate flare parameters successfully', () => {
      const result = validateModelParams('gpt-image-2.5-flare', {
        prompt: 'a cat',
        size: '1536x1024',
        quality: 'max',
        n: 2,
        background: 'transparent',
        output_format: 'webp',
        output_compression: 80,
        moderation: 'low',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should accept free-form sizes on flexible models', () => {
      expect(validateModelParams('gpt-image-2', { size: '2048x1152' }).valid).toBe(true);
      expect(validateModelParams('gpt-image-2.5-sunburst', { size: '1536x864' }).valid).toBe(true);
    });

    it('should reject free-form sizes on gpt-image-1.x', () => {
      const result = validateModelParams('gpt-image-1.5', { size: '1536x864' });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/Invalid size "1536x864" for gpt-image-1.5/);
    });

    it('should reject an invalid free-form size with the rule that failed', () => {
      const result = validateModelParams('gpt-image-2', { size: '1000x1000' });
      expect(result.valid).toBe(false);
      expect(result.errors.join()).toMatch(/multiples of 16/);
    });

    it('should reject xhigh and max on gpt-image-2', () => {
      expect(validateModelParams('gpt-image-2', { quality: 'xhigh' }).valid).toBe(false);
      expect(validateModelParams('gpt-image-2', { quality: 'max' }).valid).toBe(false);
      expect(validateModelParams('gpt-image-2', { quality: 'high' }).valid).toBe(true);
    });

    it('should reject prompt exceeding 32000 characters', () => {
      const result = validateModelParams('gpt-image-2.5-flare', { prompt: 'a'.repeat(32001) });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/exceeds maximum length/);
    });

    it('should reject n outside 1-10 or non-integer', () => {
      expect(validateModelParams('gpt-image-2.5-flare', { n: 0 }).valid).toBe(false);
      expect(validateModelParams('gpt-image-2.5-flare', { n: 11 }).valid).toBe(false);
      expect(validateModelParams('gpt-image-2.5-flare', { n: 1.5 }).valid).toBe(false);
      expect(validateModelParams('gpt-image-2.5-flare', { n: 10 }).valid).toBe(true);
    });

    it('should reject transparent background with jpeg output', () => {
      const result = validateModelParams('gpt-image-2.5-flare', {
        background: 'transparent',
        output_format: 'jpeg',
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/requires output_format "png" or "webp"/);
    });

    it('should reject output_compression without jpeg/webp', () => {
      expect(validateModelParams('gpt-image-2.5-flare', { output_compression: 50 }).valid).toBe(false);
      expect(validateModelParams('gpt-image-2.5-flare', { output_compression: 50, output_format: 'png' }).valid).toBe(
        false
      );
      expect(validateModelParams('gpt-image-2.5-flare', { output_compression: 50, output_format: 'jpeg' }).valid).toBe(
        true
      );
    });

    it('should reject output_compression outside 0-100', () => {
      const result = validateModelParams('gpt-image-2.5-flare', {
        output_compression: 101,
        output_format: 'webp',
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/between 0 and 100/);
    });

    it('should reject input_fidelity on gpt-image-2 and the 2.5 models', () => {
      for (const model of ['gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.5-flare']) {
        const result = validateModelParams(model, { input_fidelity: 'high' });
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toMatch(new RegExp(`not accepted by ${model.replace('.', '\\.')}`));
      }
    });

    it('should accept input_fidelity on the 1.x models', () => {
      expect(validateModelParams('gpt-image-1.5', { input_fidelity: 'high' }).valid).toBe(true);
      expect(validateModelParams('gpt-image-1-mini', { input_fidelity: 'low' }).valid).toBe(true);
    });

    it('should bound partial_images to 0-3 integers', () => {
      expect(validateModelParams('gpt-image-2.5-flare', { partial_images: 0 }).valid).toBe(true);
      expect(validateModelParams('gpt-image-2.5-flare', { partial_images: 3 }).valid).toBe(true);
      expect(validateModelParams('gpt-image-2.5-flare', { partial_images: 4 }).valid).toBe(false);
      expect(validateModelParams('gpt-image-2.5-flare', { partial_images: -1 }).valid).toBe(false);
    });

    it('should reject invalid moderation and background values', () => {
      expect(validateModelParams('gpt-image-2.5-flare', { moderation: 'none' as unknown as 'auto' }).valid).toBe(false);
      expect(validateModelParams('gpt-image-2.5-flare', { background: 'blue' as unknown as 'auto' }).valid).toBe(false);
    });

    it('should return error for unknown model', () => {
      const result = validateModelParams('dall-e-3', { prompt: 'x' });
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(
        /^Unknown model "dall-e-3"\. Supported: gpt-image-2\.5-sunburst, .*dated snapshots\)$/
      );
    });

    it('should validate snapshots with the family constraints', () => {
      expect(validateModelParams('gpt-image-2.5-flare-2026-09-08', { quality: 'max' }).valid).toBe(true);
      expect(validateModelParams('gpt-image-2-2026-04-21', { quality: 'max' }).valid).toBe(false);
    });
  });
});
