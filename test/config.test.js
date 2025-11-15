/**
 * Configuration Tests
 *
 * Tests for config.js - API key management, model constraints, and validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getOpenAIApiKey,
  validateApiKeyFormat,
  getOutputDir,
  validateModelParams,
  getModelConstraints,
  MODELS,
  ENDPOINTS,
  MODEL_CONSTRAINTS
} from '../config.js';

describe('Configuration', () => {
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('getOpenAIApiKey', () => {
    it('should return CLI API key when provided', () => {
      const cliKey = 'sk-test-cli-key-123';
      const result = getOpenAIApiKey(cliKey);
      expect(result).toBe(cliKey);
    });

    it('should return environment variable when no CLI key', () => {
      process.env.OPENAI_API_KEY = 'sk-test-env-key-456';
      const result = getOpenAIApiKey();
      expect(result).toBe('sk-test-env-key-456');
    });

    it('should throw error when no API key found', () => {
      delete process.env.OPENAI_API_KEY;
      expect(() => getOpenAIApiKey()).toThrow('OPENAI_API_KEY not found');
    });

    it('should prioritize CLI key over environment variable', () => {
      const cliKey = 'sk-cli-key';
      process.env.OPENAI_API_KEY = 'sk-env-key';
      const result = getOpenAIApiKey(cliKey);
      expect(result).toBe(cliKey);
    });
  });

  describe('validateApiKeyFormat', () => {
    it('should return true for valid-looking API key', () => {
      const validKey = 'sk-1234567890abcdefghijklmnopqrstuvwxyz123456';
      expect(validateApiKeyFormat(validKey)).toBe(true);
    });

    it('should return true for project API keys', () => {
      const projectKey = 'sk-proj-1234567890abcdefghijklmnopqrstuvwxyz';
      expect(validateApiKeyFormat(projectKey)).toBe(true);
    });

    it('should return false for null or undefined', () => {
      expect(validateApiKeyFormat(null)).toBe(false);
      expect(validateApiKeyFormat(undefined)).toBe(false);
    });

    it('should return false for keys without sk- prefix', () => {
      expect(validateApiKeyFormat('1234567890abcdefghijklmnopqrstuvwxyz123456')).toBe(false);
      expect(validateApiKeyFormat('api-1234567890abcdefghijklmnop')).toBe(false);
    });

    it('should return false for short strings', () => {
      expect(validateApiKeyFormat('short')).toBe(false);
      expect(validateApiKeyFormat('sk-123')).toBe(false);
      expect(validateApiKeyFormat('sk-12345678901234567890')).toBe(false);
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

  describe('Model Constraints', () => {
    it('should have constraints for all models', () => {
      expect(MODEL_CONSTRAINTS['dall-e-2']).toBeDefined();
      expect(MODEL_CONSTRAINTS['dall-e-3']).toBeDefined();
      expect(MODEL_CONSTRAINTS['gpt-image-1']).toBeDefined();
    });

    it('should have correct size constraints for dall-e-2', () => {
      const constraints = MODEL_CONSTRAINTS['dall-e-2'];
      expect(constraints.sizes).toContain('256x256');
      expect(constraints.sizes).toContain('512x512');
      expect(constraints.sizes).toContain('1024x1024');
    });

    it('should have correct size constraints for dall-e-3', () => {
      const constraints = MODEL_CONSTRAINTS['dall-e-3'];
      expect(constraints.sizes).toContain('1024x1024');
      expect(constraints.sizes).toContain('1792x1024');
      expect(constraints.sizes).toContain('1024x1792');
    });

    it('should have correct prompt length limits', () => {
      expect(MODEL_CONSTRAINTS['dall-e-2'].promptMaxLength).toBe(1000);
      expect(MODEL_CONSTRAINTS['dall-e-3'].promptMaxLength).toBe(4000);
      expect(MODEL_CONSTRAINTS['gpt-image-1'].promptMaxLength).toBe(32000);
    });

    it('should indicate dall-e-3 only supports n=1', () => {
      const constraints = MODEL_CONSTRAINTS['dall-e-3'];
      expect(constraints.n.max).toBe(1);
    });

    it('should indicate which models support edit/variation', () => {
      expect(MODEL_CONSTRAINTS['dall-e-2'].supportsEdit).toBe(true);
      expect(MODEL_CONSTRAINTS['dall-e-2'].supportsVariation).toBe(true);
      expect(MODEL_CONSTRAINTS['dall-e-3'].supportsEdit).toBe(false);
      expect(MODEL_CONSTRAINTS['dall-e-3'].supportsVariation).toBe(false);
      expect(MODEL_CONSTRAINTS['gpt-image-1'].supportsEdit).toBe(true);
      expect(MODEL_CONSTRAINTS['gpt-image-1'].supportsVariation).toBe(false);
    });
  });

  describe('validateModelParams', () => {
    it('should validate dall-e-2 parameters successfully', () => {
      const params = {
        prompt: 'a cat',
        size: '1024x1024',
        n: 2
      };
      const result = validateModelParams('dall-e-2', params);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid size for dall-e-2', () => {
      const params = {
        prompt: 'a cat',
        size: '2048x2048'
      };
      const result = validateModelParams('dall-e-2', params);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid size');
    });

    it('should reject prompt exceeding max length', () => {
      const longPrompt = 'a'.repeat(1001);
      const params = {
        prompt: longPrompt
      };
      const result = validateModelParams('dall-e-2', params);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('exceeds maximum length');
    });

    it('should validate dall-e-3 style parameter', () => {
      const params = {
        prompt: 'a cat',
        style: 'vivid'
      };
      const result = validateModelParams('dall-e-3', params);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid style for dall-e-3', () => {
      const params = {
        prompt: 'a cat',
        style: 'invalid'
      };
      const result = validateModelParams('dall-e-3', params);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid style');
    });

    it('should validate gpt-image-1 background parameter', () => {
      const params = {
        prompt: 'a cat',
        background: 'transparent'
      };
      const result = validateModelParams('gpt-image-1', params);
      expect(result.valid).toBe(true);
    });

    it('should validate gpt-image-1 output compression', () => {
      const params = {
        prompt: 'a cat',
        output_compression: 85
      };
      const result = validateModelParams('gpt-image-1', params);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid output compression', () => {
      const params = {
        prompt: 'a cat',
        output_compression: 150
      };
      const result = validateModelParams('gpt-image-1', params);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('output_compression must be between');
    });

    it('should reject n > 1 for dall-e-3', () => {
      const params = {
        prompt: 'a cat',
        n: 3
      };
      const result = validateModelParams('dall-e-3', params);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('must be between 1 and 1');
    });

    it('should return error for unknown model', () => {
      const result = validateModelParams('unknown-model', {});
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Unknown model');
    });
  });

  describe('getModelConstraints', () => {
    it('should return constraints for valid model', () => {
      const constraints = getModelConstraints('dall-e-2');
      expect(constraints).toBeDefined();
      expect(constraints.sizes).toBeDefined();
    });

    it('should return null for invalid model', () => {
      const constraints = getModelConstraints('invalid-model');
      expect(constraints).toBeNull();
    });
  });

  describe('Constants', () => {
    it('should have all model mappings', () => {
      expect(MODELS['dalle-2']).toBe('dall-e-2');
      expect(MODELS['dalle-3']).toBe('dall-e-3');
      expect(MODELS['gpt-image-1']).toBe('gpt-image-1');
    });

    it('should have all endpoints', () => {
      expect(ENDPOINTS.generate).toBe('/v1/images/generations');
      expect(ENDPOINTS.edit).toBe('/v1/images/edits');
      expect(ENDPOINTS.variation).toBe('/v1/images/variations');
    });
  });

  describe('Security: validateApiKeyFormat', () => {
    it('should accept valid legacy API keys (sk-...)', () => {
      const validKeys = [
        'sk-1234567890abcdefghijklmnopqrstuvwxyz1234567890',
        'sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyz',
        'sk-abcd_efgh-ijkl_mnop-qrst_uvwx_yz12_3456_7890_abcd'
      ];

      validKeys.forEach(key => {
        expect(validateApiKeyFormat(key)).toBe(true);
      });
    });

    it('should accept valid project API keys (sk-proj-...)', () => {
      const validKeys = [
        'sk-proj-1234567890abcdefghijklmnopqrstuvwxyz1234567890',
        'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890abcdefghijklmnopqrstuvwxyz',
        'sk-proj-abcd_efgh-ijkl_mnop-qrst_uvwx_yz12_3456_7890_abcd'
      ];

      validKeys.forEach(key => {
        expect(validateApiKeyFormat(key)).toBe(true);
      });
    });

    it('should reject keys that are too short', () => {
      const shortKeys = [
        'sk-short',
        'sk-123456789',
        'sk-proj-tooshort'
      ];

      shortKeys.forEach(key => {
        expect(validateApiKeyFormat(key)).toBe(false);
      });
    });

    it('should reject keys without sk- prefix', () => {
      const invalidKeys = [
        '1234567890abcdefghijklmnopqrstuvwxyz1234567890',
        'api-1234567890abcdefghijklmnopqrstuvwxyz1234567890',
        'key-1234567890abcdefghijklmnopqrstuvwxyz1234567890'
      ];

      invalidKeys.forEach(key => {
        expect(validateApiKeyFormat(key)).toBe(false);
      });
    });

    it('should reject keys with invalid characters', () => {
      const invalidKeys = [
        'sk-1234567890abcdefghijklmnopqrstuvwxyz!@#$%^&*()',
        'sk-1234567890 abcdefghijklmnopqrstuvwxyz1234567890',
        'sk-1234567890abcdefghijklmnopqrstuvwxyz\n1234567890'
      ];

      invalidKeys.forEach(key => {
        expect(validateApiKeyFormat(key)).toBe(false);
      });
    });

    it('should reject null or undefined', () => {
      expect(validateApiKeyFormat(null)).toBe(false);
      expect(validateApiKeyFormat(undefined)).toBe(false);
    });

    it('should reject non-string values', () => {
      expect(validateApiKeyFormat(12345)).toBe(false);
      expect(validateApiKeyFormat({})).toBe(false);
      expect(validateApiKeyFormat([])).toBe(false);
    });

    it('should reject empty string', () => {
      expect(validateApiKeyFormat('')).toBe(false);
    });
  });
});
