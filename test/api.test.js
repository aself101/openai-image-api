/**
 * API Tests
 *
 * Tests for api.js - OpenAIImageAPI class and all generation methods.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import { OpenAIImageAPI } from '../api.js';

// Mock axios
vi.mock('axios');

describe('OpenAIImageAPI', () => {
  let api;
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Set test API key
    process.env.OPENAI_API_KEY = 'sk-test-key-123';

    // Create API instance
    api = new OpenAIImageAPI({ logLevel: 'ERROR' });

    // Reset axios mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('Initialization', () => {
    it('should initialize with API key from environment', () => {
      expect(api.apiKey).toBe('sk-test-key-123');
    });

    it('should use provided API key over environment', () => {
      const customApi = new OpenAIImageAPI({ apiKey: 'sk-custom-key' });
      expect(customApi.apiKey).toBe('sk-custom-key');
    });

    it('should use default base URL', () => {
      expect(api.baseUrl).toBe('https://api.openai.com');
    });

    it('should use custom base URL if provided', () => {
      const customApi = new OpenAIImageAPI({
        apiKey: 'sk-test',
        baseUrl: 'https://custom.api.com'
      });
      expect(customApi.baseUrl).toBe('https://custom.api.com');
    });
  });

  describe('generateImage', () => {
    it('should generate image with DALL-E 2', async () => {
      const mockResponse = {
        data: {
          created: 1234567890,
          data: [
            { url: 'https://example.com/image.png' }
          ]
        }
      };

      axios.post.mockResolvedValue(mockResponse);

      const result = await api.generateImage({
        prompt: 'a cat',
        model: 'dall-e-2',
        size: '1024x1024',
        n: 1
      });

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.openai.com/v1/images/generations',
        {
          prompt: 'a cat',
          model: 'dall-e-2',
          size: '1024x1024',
          n: 1
        },
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer sk-test-key-123',
            'Content-Type': 'application/json'
          })
        })
      );

      expect(result).toEqual(mockResponse.data);
    });

    it('should generate image with DALL-E 3 and style', async () => {
      const mockResponse = {
        data: {
          created: 1234567890,
          data: [
            { url: 'https://example.com/image.png' }
          ]
        }
      };

      axios.post.mockResolvedValue(mockResponse);

      await api.generateImage({
        prompt: 'a landscape',
        model: 'dall-e-3',
        size: '1024x1024',
        quality: 'hd',
        style: 'vivid'
      });

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.openai.com/v1/images/generations',
        expect.objectContaining({
          prompt: 'a landscape',
          model: 'dall-e-3',
          style: 'vivid',
          quality: 'hd'
        }),
        expect.any(Object)
      );
    });

    it('should generate image with GPT Image 1 and advanced options', async () => {
      const mockResponse = {
        data: {
          created: 1234567890,
          data: [
            { b64_json: 'base64encodeddata...' }
          ],
          usage: {
            total_tokens: 100
          }
        }
      };

      axios.post.mockResolvedValue(mockResponse);

      await api.generateImage({
        prompt: 'a robot',
        model: 'gpt-image-1',
        background: 'transparent',
        output_format: 'png',
        output_compression: 85,
        quality: 'high'
      });

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.openai.com/v1/images/generations',
        expect.objectContaining({
          prompt: 'a robot',
          model: 'gpt-image-1',
          background: 'transparent',
          output_format: 'png',
          output_compression: 85,
          quality: 'high'
        }),
        expect.any(Object)
      );
    });

    it('should throw error if prompt is missing', async () => {
      await expect(api.generateImage({ model: 'dall-e-2' }))
        .rejects.toThrow('Prompt is required');
    });

    it('should validate parameters before making request', async () => {
      await expect(api.generateImage({
        prompt: 'a cat',
        model: 'dall-e-2',
        size: 'invalid-size'
      })).rejects.toThrow('Parameter validation failed');
    });

    it('should handle API errors gracefully', async () => {
      axios.post.mockRejectedValue({
        response: {
          status: 401,
          data: { error: { message: 'Invalid API key' } }
        }
      });

      await expect(api.generateImage({
        prompt: 'a cat',
        model: 'dall-e-2'
      })).rejects.toThrow('Authentication failed');
    });

    it('should handle rate limit errors', async () => {
      axios.post.mockRejectedValue({
        response: {
          status: 429,
          data: { error: { message: 'Rate limit exceeded' } }
        }
      });

      await expect(api.generateImage({
        prompt: 'a cat',
        model: 'dall-e-2'
      })).rejects.toThrow('Rate limit exceeded');
    });

    it('should handle bad request errors', async () => {
      axios.post.mockRejectedValue({
        response: {
          status: 400,
          data: { error: { message: 'Invalid parameters' } }
        }
      });

      await expect(api.generateImage({
        prompt: 'a cat',
        model: 'dall-e-2'
      })).rejects.toThrow('Bad request');
    });
  });

  describe('generateImageEdit', () => {
    it('should require valid image file path', async () => {
      // This will throw because file doesn't exist (FormData will fail)
      await expect(api.generateImageEdit({
        image: '/nonexistent/path/image.png',
        prompt: 'add a hat',
        model: 'dall-e-2'
      })).rejects.toThrow();
    });

    it('should throw error if image is missing', async () => {
      await expect(api.generateImageEdit({
        prompt: 'add a hat',
        model: 'dall-e-2'
      })).rejects.toThrow('Image is required');
    });

    it('should throw error if prompt is missing', async () => {
      await expect(api.generateImageEdit({
        image: '/path/to/image.png',
        model: 'dall-e-2'
      })).rejects.toThrow('Prompt is required');
    });

    it('should throw error if model does not support editing', async () => {
      await expect(api.generateImageEdit({
        image: '/path/to/image.png',
        prompt: 'edit this',
        model: 'dall-e-3'
      })).rejects.toThrow('does not support image editing');
    });

    it('should throw error if dall-e-2 receives multiple images', async () => {
      await expect(api.generateImageEdit({
        image: ['/path/1.png', '/path/2.png'],
        prompt: 'edit this',
        model: 'dall-e-2'
      })).rejects.toThrow('only supports editing a single image');
    });
  });

  describe('generateImageVariation', () => {
    it('should require valid image file path', async () => {
      // This will throw because file doesn't exist (FormData will fail)
      await expect(api.generateImageVariation({
        image: '/nonexistent/path/image.png',
        model: 'dall-e-2',
        n: 2
      })).rejects.toThrow();
    });

    it('should throw error if image is missing', async () => {
      await expect(api.generateImageVariation({
        model: 'dall-e-2'
      })).rejects.toThrow('Image is required');
    });

    it('should throw error if model is not dall-e-2', async () => {
      await expect(api.generateImageVariation({
        image: '/path/to/image.png',
        model: 'dall-e-3'
      })).rejects.toThrow('Only dall-e-2 supports image variations');
    });

    it('should throw error if model does not support variations', async () => {
      await expect(api.generateImageVariation({
        image: '/path/to/image.png',
        model: 'gpt-image-1'
      })).rejects.toThrow('dall-e-2 supports image variations');
    });
  });

  describe('_verifyApiKey', () => {
    it('should not throw if API key is set', () => {
      expect(() => api._verifyApiKey()).not.toThrow();
    });

    it('should throw if API key is not set', () => {
      // Test the method directly with no API key
      expect(() => {
        OpenAIImageAPI.prototype._verifyApiKey.call({ apiKey: null });
      }).toThrow('API key not set');
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      axios.post.mockRejectedValue(new Error('Network error'));

      await expect(api.generateImage({
        prompt: 'a cat',
        model: 'dall-e-2'
      })).rejects.toThrow('Request failed');
    });

    it('should handle 500 errors', async () => {
      axios.post.mockRejectedValue({
        response: {
          status: 500,
          data: {}
        }
      });

      await expect(api.generateImage({
        prompt: 'a cat',
        model: 'dall-e-2'
      })).rejects.toThrow('OpenAI service error');
    });

    it('should handle 503 errors', async () => {
      axios.post.mockRejectedValue({
        response: {
          status: 503,
          data: {}
        }
      });

      await expect(api.generateImage({
        prompt: 'a cat',
        model: 'dall-e-2'
      })).rejects.toThrow('OpenAI service error');
    });
  });

  describe('Parameter Validation', () => {
    it('should reject prompt exceeding max length for dall-e-2', async () => {
      const longPrompt = 'a'.repeat(1001);

      await expect(api.generateImage({
        prompt: longPrompt,
        model: 'dall-e-2'
      })).rejects.toThrow('exceeds maximum length');
    });

    it('should reject invalid n parameter for dall-e-3', async () => {
      await expect(api.generateImage({
        prompt: 'a cat',
        model: 'dall-e-3',
        n: 3
      })).rejects.toThrow('Parameter validation failed');
    });

    it('should accept valid parameters for all models', async () => {
      const mockResponse = {
        data: { created: 123, data: [{ url: 'test' }] }
      };

      axios.post.mockResolvedValue(mockResponse);

      // DALL-E 2
      await expect(api.generateImage({
        prompt: 'test',
        model: 'dall-e-2',
        size: '1024x1024',
        n: 2
      })).resolves.toBeDefined();

      // DALL-E 3
      await expect(api.generateImage({
        prompt: 'test',
        model: 'dall-e-3',
        size: '1024x1024',
        quality: 'hd',
        style: 'vivid'
      })).resolves.toBeDefined();

      // GPT Image 1
      await expect(api.generateImage({
        prompt: 'test',
        model: 'gpt-image-1',
        size: 'auto',
        background: 'transparent',
        quality: 'high'
      })).resolves.toBeDefined();
    });
  });

  describe('saveImages', () => {
    const API_TEST_DIR = './test-api-output';

    beforeEach(async () => {
      // Mock axios.get for downloadImage
      axios.get.mockResolvedValue({
        data: Buffer.from('fake image data')
      });

      // Clean up test output directory
      const fs = await import('fs/promises');
      const { existsSync } = await import('fs');
      if (existsSync(API_TEST_DIR)) {
        await fs.rm(API_TEST_DIR, { recursive: true, force: true });
      }
    });

    afterEach(async () => {
      const fs = await import('fs/promises');
      const { existsSync } = await import('fs');
      if (existsSync(API_TEST_DIR)) {
        await fs.rm(API_TEST_DIR, { recursive: true, force: true });
      }
    });

    it('should save images from URL response', async () => {
      const mockResponse = {
        data: [
          { url: 'https://example.com/image1.png' },
          { url: 'https://example.com/image2.png' }
        ]
      };

      const paths = await api.saveImages(
        mockResponse,
        API_TEST_DIR,
        'test-image',
        'png'
      );

      expect(paths).toHaveLength(2);
      expect(axios.get).toHaveBeenCalledWith('https://example.com/image1.png', { responseType: 'arraybuffer' });
    });

    it('should save images from b64_json response', async () => {
      const mockResponse = {
        data: [
          { b64_json: Buffer.from('image data 1').toString('base64') },
          { b64_json: Buffer.from('image data 2').toString('base64') }
        ]
      };

      const paths = await api.saveImages(
        mockResponse,
        API_TEST_DIR,
        'test-image',
        'png'
      );

      expect(paths).toHaveLength(2);
      expect(axios.get).not.toHaveBeenCalled();
    });

    it('should handle single image response', async () => {
      const mockResponse = {
        data: [
          { url: 'https://example.com/image.png' }
        ]
      };

      const paths = await api.saveImages(
        mockResponse,
        API_TEST_DIR,
        'single-image',
        'png'
      );

      expect(paths).toHaveLength(1);
      expect(paths[0]).toContain('single-image.png');
    });

    it('should handle multiple images with numbered filenames', async () => {
      const mockResponse = {
        data: [
          { b64_json: Buffer.from('data1').toString('base64') },
          { b64_json: Buffer.from('data2').toString('base64') },
          { b64_json: Buffer.from('data3').toString('base64') }
        ]
      };

      const paths = await api.saveImages(
        mockResponse,
        API_TEST_DIR,
        'batch',
        'png'
      );

      expect(paths).toHaveLength(3);
      expect(paths[0]).toContain('batch_1.png');
      expect(paths[1]).toContain('batch_2.png');
      expect(paths[2]).toContain('batch_3.png');
    });

    it('should skip images without url or b64_json', async () => {
      const mockResponse = {
        data: [
          { url: 'https://example.com/image.png' },
          { invalid: 'data' },
          { b64_json: Buffer.from('base64data').toString('base64') }
        ]
      };

      const paths = await api.saveImages(
        mockResponse,
        API_TEST_DIR,
        'test',
        'png'
      );

      // Should save 2 valid images, skip 1 invalid
      expect(paths).toHaveLength(2);
    });
  });

  describe('Security Features', () => {
    it('should enforce HTTPS for baseUrl', () => {
      expect(() => {
        new OpenAIImageAPI({
          apiKey: 'sk-test123',
          baseUrl: 'http://api.openai.com'  // HTTP not HTTPS
        });
      }).toThrow('API base URL must use HTTPS');
    });

    it('should accept HTTPS baseUrl', () => {
      expect(() => {
        new OpenAIImageAPI({
          apiKey: 'sk-test123',
          baseUrl: 'https://api.openai.com'
        });
      }).not.toThrow();
    });

    it('should redact API key in logs', () => {
      const api = new OpenAIImageAPI({ apiKey: 'sk-test1234567890' });
      const redacted = api._redactApiKey('sk-test1234567890');

      expect(redacted).toBe('sk-...7890');
      expect(redacted).not.toContain('test1234567890');
    });

    it('should redact short API keys', () => {
      const api = new OpenAIImageAPI({ apiKey: 'sk-test' });
      const redacted = api._redactApiKey('sk-test');

      expect(redacted).toBe('[REDACTED]');
    });

    it('should sanitize error messages in production', () => {
      process.env.NODE_ENV = 'production';

      const api = new OpenAIImageAPI({ apiKey: 'sk-test123' });
      const error = {
        response: {
          data: {
            error: {
              message: 'Detailed internal error with sensitive information'
            }
          }
        },
        message: 'Error message'
      };

      const sanitized = api._sanitizeErrorMessage(error, 400);

      expect(sanitized).toBe('Invalid request parameters');
      expect(sanitized).not.toContain('sensitive information');

      delete process.env.NODE_ENV;
    });

    it('should provide detailed error messages in development', () => {
      process.env.NODE_ENV = 'development';

      const api = new OpenAIImageAPI({ apiKey: 'sk-test123' });
      const error = {
        response: {
          data: {
            error: {
              message: 'Detailed error message'
            }
          }
        },
        message: 'Error message'
      };

      const sanitized = api._sanitizeErrorMessage(error, 400);

      expect(sanitized).toBe('Detailed error message');

      delete process.env.NODE_ENV;
    });

    it('should enforce rate limiting between requests', async () => {
      const api = new OpenAIImageAPI({
        apiKey: 'sk-test123',
        rateLimitDelay: 100  // 100ms delay for testing
      });

      // Mock axios to return immediately
      vi.mocked(axios.post).mockResolvedValue({
        data: {
          created: Date.now(),
          data: [{ url: 'https://example.com/image.png' }]
        }
      });

      const startTime = Date.now();

      // Make first request
      await api._makeRequest('POST', '/test', {});

      // Make second request (should be delayed)
      await api._makeRequest('POST', '/test', {});

      const elapsed = Date.now() - startTime;

      // Should have waited at least 100ms between requests
      expect(elapsed).toBeGreaterThanOrEqual(90); // Allow small margin
    });

    it('should allow custom rate limit delay', () => {
      const api = new OpenAIImageAPI({
        apiKey: 'sk-test123',
        rateLimitDelay: 5000
      });

      expect(api.rateLimitDelay).toBe(5000);
    });

    it('should use default rate limit delay if not specified', () => {
      const api = new OpenAIImageAPI({ apiKey: 'sk-test123' });

      expect(api.rateLimitDelay).toBe(1000); // Default 1000ms
    });
  });
});
