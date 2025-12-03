/**
 * Video API Tests
 *
 * Tests for video-api.ts - OpenAIVideoAPI class and all video generation methods.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import axios from 'axios';
import { OpenAIVideoAPI } from '../src/video-api.js';

// Mock axios
vi.mock('axios');

// Type for API with exposed private members for testing
interface TestableVideoAPI {
  apiKey: string;
  baseUrl: string;
  rateLimitDelay: number;
  _verifyApiKey(): void;
  _redactApiKey(apiKey: string): string;
  _sanitizeErrorMessage(error: unknown, status: number): string;
  _makeRequest<T>(method: string, endpoint: string, videoId?: string | null, data?: Record<string, unknown> | null, isMultipart?: boolean, options?: Record<string, unknown>): Promise<T>;
}

describe('OpenAIVideoAPI', () => {
  let api: OpenAIVideoAPI & TestableVideoAPI;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Set test API key
    process.env.OPENAI_API_KEY = 'sk-test-key-123';

    // Create API instance
    api = new OpenAIVideoAPI({ logLevel: 'ERROR' }) as OpenAIVideoAPI & TestableVideoAPI;

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
      const customApi = new OpenAIVideoAPI({ apiKey: 'sk-custom-key' }) as OpenAIVideoAPI & TestableVideoAPI;
      expect(customApi.apiKey).toBe('sk-custom-key');
    });

    it('should use default base URL', () => {
      expect(api.baseUrl).toBe('https://api.openai.com');
    });

    it('should use custom base URL if provided', () => {
      const customApi = new OpenAIVideoAPI({
        apiKey: 'sk-test',
        baseUrl: 'https://custom.api.com'
      }) as OpenAIVideoAPI & TestableVideoAPI;
      expect(customApi.baseUrl).toBe('https://custom.api.com');
    });

    it('should enforce HTTPS for baseUrl', () => {
      expect(() => {
        new OpenAIVideoAPI({
          apiKey: 'sk-test123',
          baseUrl: 'http://api.openai.com'  // HTTP not HTTPS
        });
      }).toThrow('API base URL must use HTTPS');
    });

    it('should accept HTTPS baseUrl', () => {
      expect(() => {
        new OpenAIVideoAPI({
          apiKey: 'sk-test123',
          baseUrl: 'https://api.openai.com'
        });
      }).not.toThrow();
    });
  });

  describe('createVideo', () => {
    it('should create video with sora-2 (text-to-video)', async () => {
      const mockResponse = {
        data: {
          id: 'video_123',
          object: 'video',
          created: 1234567890,
          model: 'sora-2',
          status: 'queued',
          prompt: 'a cat on a motorcycle'
        }
      };

      (axios.post as Mock).mockResolvedValue(mockResponse);

      const result = await api.createVideo({
        prompt: 'a cat on a motorcycle',
        model: 'sora-2',
        size: '1280x720',
        seconds: 8
      });

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.openai.com/v1/videos',
        {
          prompt: 'a cat on a motorcycle',
          model: 'sora-2',
          size: '1280x720',
          seconds: 8
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

    it('should create video with sora-2-pro', async () => {
      const mockResponse = {
        data: {
          id: 'video_456',
          object: 'video',
          created: 1234567890,
          model: 'sora-2-pro',
          status: 'queued',
          prompt: 'a landscape'
        }
      };

      (axios.post as Mock).mockResolvedValue(mockResponse);

      await api.createVideo({
        prompt: 'a landscape',
        model: 'sora-2-pro',
        seconds: 12
      });

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.openai.com/v1/videos',
        expect.objectContaining({
          prompt: 'a landscape',
          model: 'sora-2-pro',
          seconds: 12
        }),
        expect.any(Object)
      );
    });

    it('should throw error if prompt is missing', async () => {
      await expect(api.createVideo({ model: 'sora-2' } as { prompt: string; model: 'sora-2' }))
        .rejects.toThrow('Prompt is required');
    });

    it('should validate parameters before making request', async () => {
      await expect(api.createVideo({
        prompt: 'a cat',
        model: 'sora-2',
        size: 'invalid-size'
      })).rejects.toThrow('Parameter validation failed');
    });

    it('should reject prompt exceeding max length', async () => {
      const longPrompt = 'a'.repeat(10001);

      await expect(api.createVideo({
        prompt: longPrompt,
        model: 'sora-2'
      })).rejects.toThrow('exceeds maximum length');
    });

    it('should reject invalid duration', async () => {
      await expect(api.createVideo({
        prompt: 'a cat',
        model: 'sora-2',
        seconds: 15  // Not valid: must be 4, 8, or 12
      })).rejects.toThrow('Parameter validation failed');
    });

    it('should accept valid durations (4, 8, 12)', async () => {
      const mockResponse = {
        data: { id: 'video_123', status: 'queued' }
      };

      (axios.post as Mock).mockResolvedValue(mockResponse);

      // Test all valid durations
      await expect(api.createVideo({
        prompt: 'test',
        model: 'sora-2',
        seconds: 4
      })).resolves.toBeDefined();

      await expect(api.createVideo({
        prompt: 'test',
        model: 'sora-2',
        seconds: 8
      })).resolves.toBeDefined();

      await expect(api.createVideo({
        prompt: 'test',
        model: 'sora-2',
        seconds: 12
      })).resolves.toBeDefined();
    });
  });

  describe('retrieveVideo', () => {
    it('should retrieve video status', async () => {
      const mockResponse = {
        data: {
          id: 'video_123',
          object: 'video',
          created: 1234567890,
          model: 'sora-2',
          status: 'in_progress',
          progress: 45,
          prompt: 'a cat'
        }
      };

      (axios.get as Mock).mockResolvedValue(mockResponse);

      const result = await api.retrieveVideo('video_123');

      expect(axios.get).toHaveBeenCalledWith(
        'https://api.openai.com/v1/videos/video_123',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer sk-test-key-123'
          })
        })
      );

      expect(result).toEqual(mockResponse.data);
      expect(result.status).toBe('in_progress');
      expect(result.progress).toBe(45);
    });

    it('should throw error if video ID is missing', async () => {
      await expect(api.retrieveVideo(''))
        .rejects.toThrow('Video ID is required');
    });

    it('should handle 404 error for non-existent video', async () => {
      (axios.get as Mock).mockRejectedValue({
        response: {
          status: 404,
          data: { error: { message: 'Video not found' } }
        }
      });

      await expect(api.retrieveVideo('invalid_id'))
        .rejects.toThrow('Resource not found');
    });
  });

  describe('downloadVideoContent', () => {
    it('should download video MP4 by default', async () => {
      const mockBuffer = Buffer.from('fake video data');

      (axios.get as Mock).mockResolvedValue({ data: mockBuffer });

      const result = await api.downloadVideoContent('video_123');

      expect(axios.get).toHaveBeenCalledWith(
        'https://api.openai.com/v1/videos/video_123/content',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer sk-test-key-123'
          }),
          responseType: 'arraybuffer',
          timeout: 60000
        })
      );

      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it('should download thumbnail variant', async () => {
      const mockBuffer = Buffer.from('fake thumbnail data');

      (axios.get as Mock).mockResolvedValue({ data: mockBuffer });

      await api.downloadVideoContent('video_123', 'thumbnail');

      expect(axios.get).toHaveBeenCalledWith(
        'https://api.openai.com/v1/videos/video_123/content?variant=thumbnail',
        expect.any(Object)
      );
    });

    it('should download spritesheet variant', async () => {
      const mockBuffer = Buffer.from('fake spritesheet data');

      (axios.get as Mock).mockResolvedValue({ data: mockBuffer });

      await api.downloadVideoContent('video_123', 'spritesheet');

      expect(axios.get).toHaveBeenCalledWith(
        'https://api.openai.com/v1/videos/video_123/content?variant=spritesheet',
        expect.any(Object)
      );
    });

    it('should reject invalid variant', async () => {
      await expect(api.downloadVideoContent('video_123', 'invalid' as 'video'))
        .rejects.toThrow('Invalid variant');
    });

    it('should throw error if video ID is missing', async () => {
      await expect(api.downloadVideoContent(''))
        .rejects.toThrow('Video ID is required');
    });
  });

  describe('listVideos', () => {
    it('should list videos with default parameters', async () => {
      const mockResponse = {
        data: {
          object: 'list',
          data: [
            { id: 'video_1', status: 'completed' },
            { id: 'video_2', status: 'in_progress' }
          ],
          has_more: false
        }
      };

      (axios.get as Mock).mockResolvedValue(mockResponse);

      const result = await api.listVideos();

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('/v1/videos?limit=20&order=desc'),
        expect.any(Object)
      );

      expect(result).toEqual(mockResponse.data);
    });

    it('should list videos with custom limit', async () => {
      const mockResponse = {
        data: { object: 'list', data: [] }
      };

      (axios.get as Mock).mockResolvedValue(mockResponse);

      await api.listVideos({ limit: 5 });

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('limit=5'),
        expect.any(Object)
      );
    });

    it('should list videos with pagination cursor', async () => {
      const mockResponse = {
        data: { object: 'list', data: [] }
      };

      (axios.get as Mock).mockResolvedValue(mockResponse);

      await api.listVideos({ limit: 10, after: 'video_123' });

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('after=video_123'),
        expect.any(Object)
      );
    });

    it('should support ascending order', async () => {
      const mockResponse = {
        data: { object: 'list', data: [] }
      };

      (axios.get as Mock).mockResolvedValue(mockResponse);

      await api.listVideos({ order: 'asc' });

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('order=asc'),
        expect.any(Object)
      );
    });
  });

  describe('deleteVideo', () => {
    it('should delete video', async () => {
      const mockResponse = {
        data: {
          id: 'video_123',
          object: 'video',
          deleted: true
        }
      };

      (axios.delete as Mock).mockResolvedValue(mockResponse);

      const result = await api.deleteVideo('video_123');

      expect(axios.delete).toHaveBeenCalledWith(
        'https://api.openai.com/v1/videos/video_123',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer sk-test-key-123'
          })
        })
      );

      expect(result).toEqual(mockResponse.data);
    });

    it('should throw error if video ID is missing', async () => {
      await expect(api.deleteVideo(''))
        .rejects.toThrow('Video ID is required');
    });

    it('should handle 404 error for non-existent video', async () => {
      (axios.delete as Mock).mockRejectedValue({
        response: {
          status: 404,
          data: { error: { message: 'Video not found' } }
        }
      });

      await expect(api.deleteVideo('invalid_id'))
        .rejects.toThrow('Resource not found');
    });
  });

  describe('remixVideo', () => {
    it('should create remix of existing video', async () => {
      const mockResponse = {
        data: {
          id: 'video_remix_123',
          object: 'video',
          created: 1234567890,
          model: 'sora-2',
          status: 'queued',
          prompt: 'make it sunny',
          based_on: 'video_123'
        }
      };

      (axios.post as Mock).mockResolvedValue(mockResponse);

      const result = await api.remixVideo('video_123', 'make it sunny');

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.openai.com/v1/videos/video_123/remix',
        { prompt: 'make it sunny' },
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer sk-test-key-123',
            'Content-Type': 'application/json'
          })
        })
      );

      expect(result).toEqual(mockResponse.data);
    });

    it('should throw error if video ID is missing', async () => {
      await expect(api.remixVideo('', 'make it sunny'))
        .rejects.toThrow('Video ID is required');
    });

    it('should throw error if prompt is missing', async () => {
      await expect(api.remixVideo('video_123', ''))
        .rejects.toThrow('Prompt is required');
    });

    it('should validate prompt length', async () => {
      const longPrompt = 'a'.repeat(10001);

      await expect(api.remixVideo('video_123', longPrompt))
        .rejects.toThrow('Parameter validation failed');
    });
  });

  describe('waitForVideo', () => {
    it('should throw error if video ID is missing', async () => {
      await expect(api.waitForVideo(''))
        .rejects.toThrow('Video ID is required');
    });
  });

  describe('createAndPoll', () => {
    it('should create video and wait for completion', async () => {
      const createResponse = {
        data: {
          id: 'video_123',
          status: 'queued'
        }
      };

      const completedResponse = {
        data: {
          id: 'video_123',
          status: 'completed',
          progress: 100
        }
      };

      (axios.post as Mock).mockResolvedValue(createResponse);
      (axios.get as Mock).mockResolvedValue(completedResponse);

      // Mock the polling to resolve immediately
      vi.spyOn(api, 'waitForVideo').mockResolvedValue(completedResponse.data);

      const result = await api.createAndPoll({
        prompt: 'a cat',
        model: 'sora-2'
      });

      expect(result.status).toBe('completed');
    });
  });

  describe('_verifyApiKey', () => {
    it('should not throw if API key is set', () => {
      expect(() => api._verifyApiKey()).not.toThrow();
    });

    it('should throw if API key is not set', () => {
      expect(() => {
        OpenAIVideoAPI.prototype['_verifyApiKey'].call({ apiKey: null });
      }).toThrow('API key not set');
    });
  });

  describe('Error Handling', () => {
    it('should handle authentication errors', async () => {
      (axios.post as Mock).mockRejectedValue({
        response: {
          status: 401,
          data: { error: { message: 'Invalid API key' } }
        }
      });

      await expect(api.createVideo({
        prompt: 'a cat',
        model: 'sora-2'
      })).rejects.toThrow('Authentication failed');
    });

    it('should handle rate limit errors', async () => {
      (axios.post as Mock).mockRejectedValue({
        response: {
          status: 429,
          data: { error: { message: 'Rate limit exceeded' } }
        }
      });

      await expect(api.createVideo({
        prompt: 'a cat',
        model: 'sora-2'
      })).rejects.toThrow('Rate limit exceeded');
    });

    it('should handle bad request errors', async () => {
      (axios.post as Mock).mockRejectedValue({
        response: {
          status: 400,
          data: { error: { message: 'Invalid parameters' } }
        }
      });

      await expect(api.createVideo({
        prompt: 'a cat',
        model: 'sora-2'
      })).rejects.toThrow('Bad request');
    });

    it('should handle network errors', async () => {
      (axios.post as Mock).mockRejectedValue(new Error('Network error'));

      await expect(api.createVideo({
        prompt: 'a cat',
        model: 'sora-2'
      })).rejects.toThrow('Request failed');
    });

    it('should handle 500 errors', async () => {
      (axios.post as Mock).mockRejectedValue({
        response: {
          status: 500,
          data: {}
        }
      });

      await expect(api.createVideo({
        prompt: 'a cat',
        model: 'sora-2'
      })).rejects.toThrow('OpenAI service error');
    });
  });

  describe('Security Features', () => {
    it('should redact API key in logs', () => {
      const testApi = new OpenAIVideoAPI({ apiKey: 'sk-test1234567890' }) as OpenAIVideoAPI & TestableVideoAPI;
      const redacted = testApi._redactApiKey('sk-test1234567890');

      expect(redacted).toBe('sk-...7890');
      expect(redacted).not.toContain('test1234567890');
    });

    it('should redact short API keys', () => {
      const testApi = new OpenAIVideoAPI({ apiKey: 'sk-test' }) as OpenAIVideoAPI & TestableVideoAPI;
      const redacted = testApi._redactApiKey('sk-test');

      expect(redacted).toBe('[REDACTED]');
    });

    it('should sanitize error messages in production', () => {
      process.env.NODE_ENV = 'production';

      const testApi = new OpenAIVideoAPI({ apiKey: 'sk-test123' }) as OpenAIVideoAPI & TestableVideoAPI;
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

      const sanitized = testApi._sanitizeErrorMessage(error, 400);

      expect(sanitized).toBe('Invalid request parameters');
      expect(sanitized).not.toContain('sensitive information');

      delete process.env.NODE_ENV;
    });

    it('should provide detailed error messages in development', () => {
      process.env.NODE_ENV = 'development';

      const testApi = new OpenAIVideoAPI({ apiKey: 'sk-test123' }) as OpenAIVideoAPI & TestableVideoAPI;
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

      const sanitized = testApi._sanitizeErrorMessage(error, 400);

      expect(sanitized).toBe('Detailed error message');

      delete process.env.NODE_ENV;
    });

    it('should enforce rate limiting between requests', async () => {
      const testApi = new OpenAIVideoAPI({
        apiKey: 'sk-test123',
        rateLimitDelay: 100  // 100ms delay for testing
      }) as OpenAIVideoAPI & TestableVideoAPI;

      // Mock axios to return immediately
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          id: 'video_123',
          status: 'queued'
        }
      });

      const startTime = Date.now();

      // Make first request
      await testApi._makeRequest('GET', '/test');

      // Make second request (should be delayed)
      await testApi._makeRequest('GET', '/test');

      const elapsed = Date.now() - startTime;

      // Should have waited at least 100ms between requests
      expect(elapsed).toBeGreaterThanOrEqual(90); // Allow small margin
    });

    it('should allow custom rate limit delay', () => {
      const testApi = new OpenAIVideoAPI({
        apiKey: 'sk-test123',
        rateLimitDelay: 5000
      }) as OpenAIVideoAPI & TestableVideoAPI;

      expect(testApi.rateLimitDelay).toBe(5000);
    });

    it('should use default rate limit delay if not specified', () => {
      const testApi = new OpenAIVideoAPI({ apiKey: 'sk-test123' }) as OpenAIVideoAPI & TestableVideoAPI;

      expect(testApi.rateLimitDelay).toBe(1000); // Default 1000ms
    });
  });

  describe('Request Cancellation', () => {
    it('should handle cancellation during requests', async () => {
      const error = new Error('Request cancelled');
      (error as NodeJS.ErrnoException).name = 'CanceledError';
      (error as NodeJS.ErrnoException).code = 'ERR_CANCELED';

      (axios.post as Mock).mockRejectedValue(error);

      await expect(api.createVideo({
        prompt: 'a test video',
        model: 'sora-2'
      })).rejects.toThrow('Request was cancelled');
    });

    it('should detect CanceledError by error name', async () => {
      const error = new Error('Request aborted');
      (error as { name: string }).name = 'CanceledError';

      (axios.get as Mock).mockRejectedValue(error);

      await expect(api.retrieveVideo('video_123')).rejects.toThrow('Request was cancelled');
    });

    it('should detect cancellation by ERR_CANCELED code', async () => {
      const error = new Error('Request aborted');
      (error as NodeJS.ErrnoException).code = 'ERR_CANCELED';

      (axios.get as Mock).mockRejectedValue(error);

      await expect(api.retrieveVideo('video_123')).rejects.toThrow('Request was cancelled');
    });
  });

  describe('Parameter Validation', () => {
    it('should validate video size constraints', async () => {
      await expect(api.createVideo({
        prompt: 'test',
        model: 'sora-2',
        size: '1920x1080'  // Not valid for Sora
      })).rejects.toThrow('Parameter validation failed');
    });

    it('should accept valid video sizes', async () => {
      const mockResponse = {
        data: { id: 'video_123', status: 'queued' }
      };

      (axios.post as Mock).mockResolvedValue(mockResponse);

      const validSizes = ['720x1280', '1280x720', '1024x1792', '1792x1024'];

      for (const size of validSizes) {
        await expect(api.createVideo({
          prompt: 'test',
          model: 'sora-2',
          size
        })).resolves.toBeDefined();
      }
    });

    it('should accept valid models', async () => {
      const mockResponse = {
        data: { id: 'video_123', status: 'queued' }
      };

      (axios.post as Mock).mockResolvedValue(mockResponse);

      await expect(api.createVideo({
        prompt: 'test',
        model: 'sora-2'
      })).resolves.toBeDefined();

      await expect(api.createVideo({
        prompt: 'test',
        model: 'sora-2-pro'
      })).resolves.toBeDefined();
    });
  });
});
