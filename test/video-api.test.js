/**
 * Video API Tests
 *
 * Tests for video-api.js - OpenAIVideoAPI class and all video generation methods.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import { OpenAIVideoAPI } from '../video-api.js';

// Mock axios
vi.mock('axios');

describe('OpenAIVideoAPI', () => {
  let api;
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Set test API key
    process.env.OPENAI_API_KEY = 'sk-test-key-123';

    // Create API instance
    api = new OpenAIVideoAPI({ logLevel: 'ERROR' });

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
      const customApi = new OpenAIVideoAPI({ apiKey: 'sk-custom-key' });
      expect(customApi.apiKey).toBe('sk-custom-key');
    });

    it('should use default base URL', () => {
      expect(api.baseUrl).toBe('https://api.openai.com');
    });

    it('should use custom base URL if provided', () => {
      const customApi = new OpenAIVideoAPI({
        apiKey: 'sk-test',
        baseUrl: 'https://custom.api.com'
      });
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

      axios.post.mockResolvedValue(mockResponse);

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

      axios.post.mockResolvedValue(mockResponse);

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
      await expect(api.createVideo({ model: 'sora-2' }))
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

      axios.post.mockResolvedValue(mockResponse);

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

    it('should require valid input_reference image path', async () => {
      // This will throw because file doesn't exist and validation will fail
      await expect(api.createVideo({
        prompt: 'continue this scene',
        model: 'sora-2',
        input_reference: '/nonexistent/path/image.png'
      })).rejects.toThrow();
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

      axios.get.mockResolvedValue(mockResponse);

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
      await expect(api.retrieveVideo())
        .rejects.toThrow('Video ID is required');
    });

    it('should handle 404 error for non-existent video', async () => {
      axios.get.mockRejectedValue({
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

      axios.get.mockResolvedValue({ data: mockBuffer });

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

      axios.get.mockResolvedValue({ data: mockBuffer });

      await api.downloadVideoContent('video_123', 'thumbnail');

      expect(axios.get).toHaveBeenCalledWith(
        'https://api.openai.com/v1/videos/video_123/content?variant=thumbnail',
        expect.any(Object)
      );
    });

    it('should download spritesheet variant', async () => {
      const mockBuffer = Buffer.from('fake spritesheet data');

      axios.get.mockResolvedValue({ data: mockBuffer });

      await api.downloadVideoContent('video_123', 'spritesheet');

      expect(axios.get).toHaveBeenCalledWith(
        'https://api.openai.com/v1/videos/video_123/content?variant=spritesheet',
        expect.any(Object)
      );
    });

    it('should reject invalid variant', async () => {
      await expect(api.downloadVideoContent('video_123', 'invalid'))
        .rejects.toThrow('Invalid variant');
    });

    it('should throw error if video ID is missing', async () => {
      await expect(api.downloadVideoContent())
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

      axios.get.mockResolvedValue(mockResponse);

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

      axios.get.mockResolvedValue(mockResponse);

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

      axios.get.mockResolvedValue(mockResponse);

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

      axios.get.mockResolvedValue(mockResponse);

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

      axios.delete.mockResolvedValue(mockResponse);

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
      expect(result.deleted).toBe(true);
    });

    it('should throw error if video ID is missing', async () => {
      await expect(api.deleteVideo())
        .rejects.toThrow('Video ID is required');
    });

    it('should handle 404 error for non-existent video', async () => {
      axios.delete.mockRejectedValue({
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

      axios.post.mockResolvedValue(mockResponse);

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
      await expect(api.remixVideo(null, 'make it sunny'))
        .rejects.toThrow('Video ID is required');
    });

    it('should throw error if prompt is missing', async () => {
      await expect(api.remixVideo('video_123'))
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
      await expect(api.waitForVideo())
        .rejects.toThrow('Video ID is required');
    });

    // Note: Full polling tests would require mocking the pollVideoWithProgress utility
    // which is tested separately in utils.test.js
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

      axios.post.mockResolvedValue(createResponse);
      axios.get.mockResolvedValue(completedResponse);

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
        OpenAIVideoAPI.prototype._verifyApiKey.call({ apiKey: null });
      }).toThrow('API key not set');
    });
  });

  describe('Error Handling', () => {
    it('should handle authentication errors', async () => {
      axios.post.mockRejectedValue({
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
      axios.post.mockRejectedValue({
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
      axios.post.mockRejectedValue({
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
      axios.post.mockRejectedValue(new Error('Network error'));

      await expect(api.createVideo({
        prompt: 'a cat',
        model: 'sora-2'
      })).rejects.toThrow('Request failed');
    });

    it('should handle 500 errors', async () => {
      axios.post.mockRejectedValue({
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

    it('should handle 502 errors', async () => {
      axios.get.mockRejectedValue({
        response: {
          status: 502,
          data: {}
        }
      });

      await expect(api.retrieveVideo('video_123'))
        .rejects.toThrow('OpenAI service error');
    });

    it('should handle 503 errors', async () => {
      axios.get.mockRejectedValue({
        response: {
          status: 503,
          data: {}
        }
      });

      await expect(api.retrieveVideo('video_123'))
        .rejects.toThrow('OpenAI service error');
    });
  });

  describe('Security Features', () => {
    it('should redact API key in logs', () => {
      const api = new OpenAIVideoAPI({ apiKey: 'sk-test1234567890' });
      const redacted = api._redactApiKey('sk-test1234567890');

      expect(redacted).toBe('sk-...7890');
      expect(redacted).not.toContain('test1234567890');
    });

    it('should redact short API keys', () => {
      const api = new OpenAIVideoAPI({ apiKey: 'sk-test' });
      const redacted = api._redactApiKey('sk-test');

      expect(redacted).toBe('[REDACTED]');
    });

    it('should sanitize error messages in production', () => {
      process.env.NODE_ENV = 'production';

      const api = new OpenAIVideoAPI({ apiKey: 'sk-test123' });
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

      const api = new OpenAIVideoAPI({ apiKey: 'sk-test123' });
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
      const api = new OpenAIVideoAPI({
        apiKey: 'sk-test123',
        rateLimitDelay: 100  // 100ms delay for testing
      });

      // Mock axios to return immediately
      vi.mocked(axios.get).mockResolvedValue({
        data: {
          id: 'video_123',
          status: 'queued'
        }
      });

      const startTime = Date.now();

      // Make first request
      await api._makeRequest('GET', '/test');

      // Make second request (should be delayed)
      await api._makeRequest('GET', '/test');

      const elapsed = Date.now() - startTime;

      // Should have waited at least 100ms between requests
      expect(elapsed).toBeGreaterThanOrEqual(90); // Allow small margin
    });

    it('should allow custom rate limit delay', () => {
      const api = new OpenAIVideoAPI({
        apiKey: 'sk-test123',
        rateLimitDelay: 5000
      });

      expect(api.rateLimitDelay).toBe(5000);
    });

    it('should use default rate limit delay if not specified', () => {
      const api = new OpenAIVideoAPI({ apiKey: 'sk-test123' });

      expect(api.rateLimitDelay).toBe(1000); // Default 1000ms
    });
  });

  describe('Request Cancellation', () => {
    it('should support AbortController for cancelling requests', async () => {
      const controller = new AbortController();

      axios.post.mockImplementation(() => {
        // Simulate cancelled request
        const error = new Error('Request cancelled');
        error.name = 'CanceledError';
        error.code = 'ERR_CANCELED';
        return Promise.reject(error);
      });

      await expect(api.createVideo({
        prompt: 'a test video',
        model: 'sora-2',
        signal: controller.signal
      })).rejects.toThrow('Request was cancelled');
    });

    it('should handle cancellation during video polling', async () => {
      const controller = new AbortController();

      // Mock retrieveVideo to return in_progress status
      axios.get.mockResolvedValue({
        data: {
          id: 'video_123',
          status: 'in_progress',
          progress: 25
        }
      });

      // Cancel after a short delay
      setTimeout(() => controller.abort(), 100);

      await expect(api.waitForVideo('video_123', {
        interval: 50,
        showSpinner: false,
        signal: controller.signal
      })).rejects.toThrow('cancelled');
    });

    it('should pass signal through to _makeRequest', async () => {
      const controller = new AbortController();
      const signal = controller.signal;

      axios.get.mockResolvedValue({
        data: {
          id: 'video_123',
          status: 'completed',
          progress: 100
        }
      });

      await api.retrieveVideo('video_123', { signal });

      // Verify signal was passed to axios
      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal
        })
      );
    });

    it('should detect CanceledError by error name', async () => {
      const error = new Error('Request aborted');
      error.name = 'CanceledError';

      axios.get.mockRejectedValue(error);

      await expect(api.retrieveVideo('video_123')).rejects.toThrow('Request was cancelled');
    });

    it('should detect cancellation by ERR_CANCELED code', async () => {
      const error = new Error('Request aborted');
      error.code = 'ERR_CANCELED';

      axios.get.mockRejectedValue(error);

      await expect(api.retrieveVideo('video_123')).rejects.toThrow('Request was cancelled');
    });

    it('should allow normal completion if not cancelled', async () => {
      const controller = new AbortController();

      axios.get
        .mockResolvedValueOnce({
          data: { id: 'video_123', status: 'in_progress', progress: 50 }
        })
        .mockResolvedValueOnce({
          data: { id: 'video_123', status: 'completed', progress: 100 }
        });

      const result = await api.waitForVideo('video_123', {
        interval: 10,
        showSpinner: false,
        signal: controller.signal
      });

      expect(result.status).toBe('completed');
      expect(controller.signal.aborted).toBe(false);
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

      axios.post.mockResolvedValue(mockResponse);

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

      axios.post.mockResolvedValue(mockResponse);

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
