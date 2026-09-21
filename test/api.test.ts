/**
 * API Tests
 *
 * Tests for api.ts - OpenAIImageAPI class: generation, editing, streaming,
 * persistence, and error handling.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import axios from 'axios';
import { Readable } from 'stream';
import { OpenAIImageAPI, OpenAIImageAPIError } from '../src/api.js';
import type { ImageGenerationStreamEvent } from '../src/types.js';

// Mock axios
vi.mock('axios');

// Private members reached in tests. The class's private fields make
// `OpenAIImageAPI & TestableAPI` collapse to never, so tests hold the public
// instance and reach privates through priv().
interface TestableAPI {
  apiKey: string;
  baseUrl: string;
  rateLimitDelay: number;
  requestTimeout: number;
  logger: { warn: (...args: unknown[]) => unknown; debug: (...args: unknown[]) => unknown };
  _makeRequest(
    method: string,
    endpoint: string,
    body?: { kind: 'json'; data: Record<string, unknown> }
  ): Promise<unknown>;
}
const priv = (instance: OpenAIImageAPI): TestableAPI => instance as unknown as TestableAPI;

/** Build an SSE body from a list of events */
function sseBody(events: Array<{ event: string; data: unknown }>): string {
  return events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('');
}

/** A Readable that emits the text in fixed-size chunks, so parsing is exercised across boundaries */
function chunked(text: string, size: number): Readable {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return Readable.from(parts);
}

const okResponse = {
  data: {
    created: 1234567890,
    data: [{ b64_json: 'base64encodeddata...' }],
    usage: { total_tokens: 100 },
    output_format: 'png',
  },
};

describe('OpenAIImageAPI', () => {
  let api: OpenAIImageAPI;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Set test API key; keep the lazy .env loader away from real key files
    process.env.OPENAI_API_KEY = 'sk-test-key-123';
    process.env.OPENAI_IMAGE_API_NO_DOTENV = '1';

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
      expect(priv(api).apiKey).toBe('sk-test-key-123');
    });

    it('should use provided API key over environment', () => {
      const customApi = new OpenAIImageAPI({ apiKey: 'sk-custom-key' });
      expect(priv(customApi).apiKey).toBe('sk-custom-key');
    });

    it('should use default base URL', () => {
      expect(priv(api).baseUrl).toBe('https://api.openai.com');
    });

    it('should use custom base URL if provided', () => {
      const customApi = new OpenAIImageAPI({
        apiKey: 'sk-test',
        baseUrl: 'https://custom.api.com',
      });
      expect(priv(customApi).baseUrl).toBe('https://custom.api.com');
    });

    it('should default the request timeout to 180s and allow override', () => {
      expect(priv(api).requestTimeout).toBe(180000);
      const custom = new OpenAIImageAPI({ apiKey: 'sk-test', requestTimeout: 5000 });
      expect(priv(custom).requestTimeout).toBe(5000);
    });
  });

  describe('generateImage', () => {
    it('should default to gpt-image-2.5-flare and send only supplied fields', async () => {
      (axios.post as Mock).mockResolvedValue(okResponse);

      const result = await api.generateImage({ prompt: 'a cat' });

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.openai.com/v1/images/generations',
        { prompt: 'a cat', model: 'gpt-image-2.5-flare' },
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer sk-test-key-123',
            'Content-Type': 'application/json',
          }),
          timeout: 180000,
          maxContentLength: 256 * 1024 * 1024,
          maxBodyLength: 256 * 1024 * 1024,
        })
      );
      expect(result).toEqual(okResponse.data);
    });

    it('should pass every GPT Image option through for every model family', async () => {
      (axios.post as Mock).mockResolvedValue(okResponse);

      for (const model of ['gpt-image-2.5-sunburst', 'gpt-image-2', 'gpt-image-1.5', 'gpt-image-1-mini'] as const) {
        await api.generateImage({
          prompt: 'a robot',
          model,
          size: '1024x1536',
          quality: 'high',
          n: 2,
          background: 'transparent',
          output_format: 'webp',
          output_compression: 85,
          moderation: 'low',
          user: 'u-1',
        });

        expect(axios.post).toHaveBeenLastCalledWith(
          'https://api.openai.com/v1/images/generations',
          {
            prompt: 'a robot',
            model,
            size: '1024x1536',
            quality: 'high',
            n: 2,
            background: 'transparent',
            output_format: 'webp',
            output_compression: 85,
            moderation: 'low',
            user: 'u-1',
          },
          expect.any(Object)
        );
      }
    });

    it('should never send DALL-E-only fields', async () => {
      (axios.post as Mock).mockResolvedValue(okResponse);
      await api.generateImage({ prompt: 'x', model: 'gpt-image-2.5-flare' });
      const payload = (axios.post as Mock).mock.calls[0][1] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('response_format');
      expect(payload).not.toHaveProperty('style');
      expect(payload).not.toHaveProperty('stream');
    });

    it('should send xhigh/max and free-form sizes verbatim on 2.5', async () => {
      (axios.post as Mock).mockResolvedValue(okResponse);
      await api.generateImage({ prompt: 'x', model: 'gpt-image-2.5-sunburst', quality: 'max', size: '2048x1152' });
      expect((axios.post as Mock).mock.calls[0][1]).toMatchObject({ quality: 'max', size: '2048x1152' });
    });

    it('should send dated snapshots verbatim', async () => {
      (axios.post as Mock).mockResolvedValue(okResponse);
      await api.generateImage({ prompt: 'x', model: 'gpt-image-2.5-flare-2026-09-08' });
      expect((axios.post as Mock).mock.calls[0][1]).toMatchObject({ model: 'gpt-image-2.5-flare-2026-09-08' });
    });

    it('should throw error if prompt is missing', async () => {
      await expect(
        api.generateImage({ model: 'gpt-image-2' } as { prompt: string; model: 'gpt-image-2' })
      ).rejects.toThrow('Prompt is required');
    });

    it('should validate parameters before making request', async () => {
      await expect(api.generateImage({ prompt: 'a cat', model: 'gpt-image-1.5', size: '1536x864' })).rejects.toThrow(
        'Parameter validation failed'
      );
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should reject xhigh on gpt-image-2', async () => {
      await expect(api.generateImage({ prompt: 'a cat', model: 'gpt-image-2', quality: 'xhigh' })).rejects.toThrow(
        /Invalid quality "xhigh" for gpt-image-2/
      );
    });

    it('should reject removed models', async () => {
      await expect(
        api.generateImage({ prompt: 'a cat', model: 'dall-e-3' as unknown as 'gpt-image-2' })
      ).rejects.toThrow('Unknown model "dall-e-3". Supported:');
    });

    it('should type every client-side rejection as OpenAIImageAPIError', async () => {
      // Each call is a thunk so no rejection exists before it is awaited
      const cases: Array<() => Promise<unknown>> = [
        () => api.generateImage({ prompt: '' }),
        () => api.generateImage({ prompt: 'x', model: 'gpt-image-2', quality: 'max' }),
        () => api.generateImage({ prompt: 'x', model: 'nope' as unknown as 'gpt-image-2' }),
        () => api.generateImageEdit({ image: '/nonexistent.png', prompt: 'x' }),
        () => api.generateImageEdit({ image: [], prompt: 'x' }),
      ];
      for (const c of cases) {
        const err = await c().catch((e: unknown) => e);
        expect(err).toBeInstanceOf(OpenAIImageAPIError);
        expect((err as OpenAIImageAPIError).status).toBeUndefined();
        expect(['validation_error', 'input_error']).toContain((err as OpenAIImageAPIError).type);
      }
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should hint at skipValidation when the only failure is an unknown model', async () => {
      await expect(
        api.generateImage({ prompt: 'x', model: 'gpt-image-9' as unknown as 'gpt-image-2' })
      ).rejects.toThrow('pass skipValidation: true to send it to the API anyway');
    });

    it('skipValidation should send unknown models and out-of-table params untouched', async () => {
      const loose = new OpenAIImageAPI({ apiKey: 'sk-loose', skipValidation: true, logLevel: 'ERROR' });
      (axios.post as Mock).mockResolvedValue(okResponse);
      await loose.generateImage({
        prompt: 'x',
        model: 'gpt-image-9-2027-01-01' as unknown as 'gpt-image-2',
        quality: 'ultra' as unknown as 'max',
        size: '7x7',
      });
      expect((axios.post as Mock).mock.calls[0][1]).toEqual({
        prompt: 'x',
        model: 'gpt-image-9-2027-01-01',
        quality: 'ultra',
        size: '7x7',
      });
    });

    it('skipValidation should still require a prompt and an API key', async () => {
      const loose = new OpenAIImageAPI({ apiKey: 'sk-loose', skipValidation: true, logLevel: 'ERROR' });
      await expect(loose.generateImage({ prompt: '' })).rejects.toThrow('Prompt is required');
    });

    it('should refuse every request path when the API key is empty', async () => {
      // Reaches the guard through the public methods, not by calling the private check directly
      priv(api).apiKey = '';
      await expect(api.generateImage({ prompt: 'a cat' })).rejects.toThrow('API key not set');
      await expect(api.generateImageEdit({ image: '/p/a.png', prompt: 'x' })).rejects.toThrow('API key not set');
      await expect(api.generateImageStream({ prompt: 'a cat' })).rejects.toThrow('API key not set');
      await expect(api.generateImageEditStream({ image: '/p/a.png', prompt: 'x' })).rejects.toThrow('API key not set');
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should warn once per deprecated model', async () => {
      (axios.post as Mock).mockResolvedValue(okResponse);
      const warn = vi.spyOn(priv(api).logger, 'warn');

      await api.generateImage({ prompt: 'x', model: 'gpt-image-1' });
      await api.generateImage({ prompt: 'y', model: 'gpt-image-1' });
      await api.generateImage({ prompt: 'z', model: 'gpt-image-1.5' });
      await api.generateImage({ prompt: 'w', model: 'gpt-image-2.5-flare' });

      const messages = warn.mock.calls.map((c: unknown[]) => String(c[0]));
      expect(messages.filter((m: string) => /Model gpt-image-1 (is scheduled|was removed)/.test(m))).toHaveLength(1);
      expect(messages.filter((m: string) => /Model gpt-image-1\.5 (is scheduled|was removed)/.test(m))).toHaveLength(1);
      expect(messages.join()).toMatch(/2026-10-23/);
      expect(messages.join()).toMatch(/2026-12-01/);
      expect(messages.join()).not.toMatch(/flare/);
    });

    it('should handle API errors gracefully', async () => {
      (axios.post as Mock).mockRejectedValue({
        response: { status: 401, data: { error: { message: 'Invalid API key' } } },
      });
      await expect(api.generateImage({ prompt: 'a cat' })).rejects.toThrow('Authentication failed');
    });

    it('should handle rate limit errors', async () => {
      (axios.post as Mock).mockRejectedValue({
        response: { status: 429, data: { error: { message: 'Rate limit exceeded' } } },
      });
      await expect(api.generateImage({ prompt: 'a cat' })).rejects.toThrow('Rate limit exceeded');
    });

    it('should handle bad request errors with the API message', async () => {
      (axios.post as Mock).mockRejectedValue({
        response: { status: 400, data: { error: { message: 'Invalid parameters' } } },
      });
      await expect(api.generateImage({ prompt: 'a cat' })).rejects.toThrow('Bad request: Invalid parameters');
    });

    it('should expose status, code, type, apiMessage and cause on the thrown error', async () => {
      const original = {
        response: {
          status: 400,
          data: {
            error: { message: 'prompt rejected', code: 'moderation_blocked', type: 'image_generation_user_error' },
          },
        },
      };
      (axios.post as Mock).mockRejectedValue(original);
      const err = await api.generateImage({ prompt: 'a cat' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(OpenAIImageAPIError);
      const typed = err as OpenAIImageAPIError;
      expect(typed.name).toBe('OpenAIImageAPIError');
      expect(typed.status).toBe(400);
      expect(typed.code).toBe('moderation_blocked');
      expect(typed.type).toBe('image_generation_user_error');
      expect(typed.apiMessage).toBe('prompt rejected');
      expect(typed.cause).toBe(original);
    });

    it('should keep the raw API message on apiMessage even when production sanitizes the message', async () => {
      process.env.NODE_ENV = 'production';
      (axios.post as Mock).mockRejectedValue({
        response: { status: 400, data: { error: { message: 'size not supported', code: 'invalid_size' } } },
      });
      const err = (await api.generateImage({ prompt: 'a cat' }).catch((e: unknown) => e)) as OpenAIImageAPIError;
      expect(err.message).toBe('Bad request: Invalid request parameters');
      expect(err.apiMessage).toBe('size not supported');
      expect(err.code).toBe('invalid_size');
      delete process.env.NODE_ENV;
    });

    it('should reject a 200 body without a data[] array as an unexpected shape', async () => {
      (axios.post as Mock).mockResolvedValue({ status: 200, data: { created: 1 } });
      await expect(api.generateImage({ prompt: 'a cat' })).rejects.toThrow('Unexpected response shape');
      (axios.post as Mock).mockResolvedValue({ status: 200, data: 'not json at all' });
      await expect(api.generateImage({ prompt: 'a cat' })).rejects.toThrow('Unexpected response shape');
    });

    it('should not send partial_images on a buffered request', async () => {
      (axios.post as Mock).mockResolvedValue(okResponse);
      await api.generateImage({ prompt: 'x', partial_images: 2 } as Parameters<typeof api.generateImage>[0]);
      const payload = (axios.post as Mock).mock.calls[0][1] as Record<string, unknown>;
      expect(payload).not.toHaveProperty('partial_images');
      expect(payload).not.toHaveProperty('stream');
    });
  });

  describe('generateImageEdit', () => {
    it('should reject a missing image file before any request', async () => {
      await expect(
        api.generateImageEdit({ image: '/nonexistent/path/image.png', prompt: 'add a hat' })
      ).rejects.toThrow('Image file not found: /nonexistent/path/image.png');
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should reject a non-image file before any request', async () => {
      const fs = await import('fs/promises');
      const os = await import('os');
      const pathMod = await import('path');
      const dir = await fs.mkdtemp(pathMod.join(os.tmpdir(), 'openai-img-'));
      const fake = pathMod.join(dir, 'not-an-image.png');
      await fs.writeFile(fake, 'hello, not a png');
      try {
        await expect(api.generateImageEdit({ image: fake, prompt: 'x' })).rejects.toThrow(
          'does not appear to be a valid image'
        );
        expect(axios.post).not.toHaveBeenCalled();
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it('should post a multipart form with image[] parts for a real PNG', async () => {
      const fs = await import('fs/promises');
      const os = await import('os');
      const pathMod = await import('path');
      const dir = await fs.mkdtemp(pathMod.join(os.tmpdir(), 'openai-img-'));
      const png = pathMod.join(dir, 'real.png');
      await fs.writeFile(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]));
      (axios.post as Mock).mockResolvedValue(okResponse);
      try {
        await api.generateImageEdit({
          image: [png, png],
          prompt: 'combine',
          model: 'gpt-image-2.5-sunburst',
          quality: 'high',
        });
        const [url, form, config] = (axios.post as Mock).mock.calls[0];
        expect(url).toBe('https://api.openai.com/v1/images/edits');
        // form-data cannot buffer file streams; its part headers are the string entries of _streams
        const parts = (form as unknown as { _streams: unknown[] })._streams;
        const body = parts.filter((x): x is string => typeof x === 'string').join('');
        expect(body.match(/name="image\[\]"/g)).toHaveLength(2);
        expect(body).toMatch(/filename="real\.png"/);
        expect(body).toMatch(/name="model"\r\n\r\ngpt-image-2.5-sunburst/);
        expect(body).toMatch(/name="quality"\r\n\r\nhigh/);
        expect(body).not.toMatch(/name="response_format"/);
        expect(config.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    });

    it('should throw error if image is missing', async () => {
      await expect(api.generateImageEdit({ prompt: 'add a hat' } as { image: string; prompt: string })).rejects.toThrow(
        'Image is required'
      );
      await expect(api.generateImageEdit({ image: [], prompt: 'add a hat' })).rejects.toThrow('Image is required');
    });

    it('should throw error if prompt is missing', async () => {
      await expect(
        api.generateImageEdit({ image: '/path/to/image.png' } as { image: string; prompt: string })
      ).rejects.toThrow('Prompt is required');
    });

    it('should reject more than 16 images', async () => {
      const images = Array.from({ length: 17 }, (_, i) => `/p/${i}.png`);
      await expect(api.generateImageEdit({ image: images, prompt: 'collage' })).rejects.toThrow(
        'at most 16 input images'
      );
    });

    it('should reject input_fidelity on gpt-image-2 before touching the filesystem', async () => {
      await expect(
        api.generateImageEdit({ image: '/p/a.png', prompt: 'x', model: 'gpt-image-2', input_fidelity: 'high' })
      ).rejects.toThrow(/not accepted by gpt-image-2/);
    });

    it('should reject unknown models', async () => {
      await expect(
        api.generateImageEdit({ image: '/p/a.png', prompt: 'x', model: 'dall-e-2' as unknown as 'gpt-image-2' })
      ).rejects.toThrow('Unknown model "dall-e-2". Supported:');
    });
  });

  describe('Streaming', () => {
    const partial0 = {
      type: 'image_generation.partial_image',
      b64_json: Buffer.from('p0').toString('base64'),
      partial_image_index: 0,
      created_at: 1,
      output_format: 'png',
    };
    const partial1 = { ...partial0, b64_json: Buffer.from('p1').toString('base64'), partial_image_index: 1 };
    const completed = {
      type: 'image_generation.completed',
      b64_json: Buffer.from('final').toString('base64'),
      created_at: 2,
      output_format: 'png',
      quality: 'high',
      size: '1024x1024',
      background: 'opaque',
      usage: { total_tokens: 300, input_tokens: 10, output_tokens: 290 },
    };

    it('streamImage should send stream:true and yield parsed events in order', async () => {
      const body = sseBody([
        { event: 'image_generation.partial_image', data: partial0 },
        { event: 'image_generation.partial_image', data: partial1 },
        { event: 'image_generation.completed', data: completed },
      ]);
      // 7-byte chunks guarantee every event straddles chunk boundaries
      (axios.post as Mock).mockResolvedValue({ data: chunked(body, 7) });

      const events: ImageGenerationStreamEvent[] = [];
      for await (const e of api.streamImage({ prompt: 'a river', partial_images: 2 })) {
        events.push(e);
      }

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.openai.com/v1/images/generations',
        { prompt: 'a river', model: 'gpt-image-2.5-flare', stream: true, partial_images: 2 },
        expect.objectContaining({
          responseType: 'stream',
          headers: expect.objectContaining({ Accept: 'text/event-stream' }),
        })
      );
      expect(events.map((e) => e.type)).toEqual([
        'image_generation.partial_image',
        'image_generation.partial_image',
        'image_generation.completed',
      ]);
      expect(events[2]).toMatchObject({ usage: { total_tokens: 300 } });
    });

    it('generateImageStream should invoke onPartialImage and return a buffered-shape response', async () => {
      const body = sseBody([
        { event: 'image_generation.partial_image', data: partial0 },
        { event: 'image_generation.completed', data: completed },
      ]);
      (axios.post as Mock).mockResolvedValue({ data: Readable.from([body]) });

      const seen: number[] = [];
      const result = await api.generateImageStream(
        { prompt: 'a river', partial_images: 1 },
        { onPartialImage: (e) => void seen.push(e.partial_image_index) }
      );

      expect(seen).toEqual([0]);
      expect(result).toEqual({
        created: 2,
        data: [{ b64_json: completed.b64_json }],
        usage: completed.usage,
        output_format: 'png',
        quality: 'high',
        size: '1024x1024',
        background: 'opaque',
      });
    });

    it('generateImageStream should reject if the stream ends without a completed event', async () => {
      const body = sseBody([{ event: 'image_generation.partial_image', data: partial0 }]);
      (axios.post as Mock).mockResolvedValue({ data: Readable.from([body]) });

      await expect(api.generateImageStream({ prompt: 'a river' })).rejects.toThrow(
        'Stream ended without an image_generation.completed event'
      );
    });

    it('should skip events without a string type field', async () => {
      const body =
        'data: {"no_type":true}\n\n' +
        'data: "just a string"\n\n' +
        sseBody([{ event: 'image_generation.completed', data: completed }]);
      (axios.post as Mock).mockResolvedValue({ data: Readable.from([body]) });

      const result = await api.generateImageStream({ prompt: 'x' });
      expect(result.data[0].b64_json).toBe(completed.b64_json);
    });

    it('should surface a terminal error event as a thrown error (nested and flat shapes)', async () => {
      (axios.post as Mock).mockResolvedValue({
        data: Readable.from([
          sseBody([{ event: 'error', data: { type: 'error', error: { message: 'content policy' } } }]),
        ]),
      });
      const err = (await api
        .generateImageStream({ prompt: 'a river' })
        .catch((e: unknown) => e)) as OpenAIImageAPIError;
      expect(err).toBeInstanceOf(OpenAIImageAPIError);
      expect(err.message).toBe('Stream error: content policy');
      expect(err.type).toBe('stream_error');

      (axios.post as Mock).mockResolvedValue({
        data: Readable.from([sseBody([{ event: 'error', data: { type: 'error', message: 'flat shape' } }])]),
      });
      await expect(api.generateImageStream({ prompt: 'a river' })).rejects.toThrow('Stream error: flat shape');
    });

    it('should skip a typed event that carries no b64_json', async () => {
      const body =
        sseBody([
          {
            event: 'image_generation.partial_image',
            data: { type: 'image_generation.partial_image', partial_image_index: 0 },
          },
        ]) + sseBody([{ event: 'image_generation.completed', data: completed }]);
      (axios.post as Mock).mockResolvedValue({ data: Readable.from([body]) });
      const seen: number[] = [];
      const result = await api.generateImageStream(
        { prompt: 'x' },
        { onPartialImage: (e) => void seen.push(e.partial_image_index) }
      );
      expect(seen).toEqual([]);
      expect(result.data[0].b64_json).toBe(completed.b64_json);
    });

    it('should destroy the response stream when the consumer breaks out early', async () => {
      const body = sseBody([
        { event: 'image_generation.partial_image', data: partial0 },
        { event: 'image_generation.partial_image', data: partial1 },
        { event: 'image_generation.completed', data: completed },
      ]);
      const stream = Readable.from([body]);
      (axios.post as Mock).mockResolvedValue({ data: stream });

      for await (const e of api.streamImage({ prompt: 'x' })) {
        if (e.type === 'image_generation.partial_image') break;
      }
      expect(stream.destroyed).toBe(true);
    });

    it('should translate a mid-body stream failure into the package error vocabulary', async () => {
      const stream = new Readable({
        read() {
          this.push('event: image_generation.partial_image\n');
          this.destroy(Object.assign(new Error('aborted'), { code: 'ECONNRESET' }));
        },
      });
      (axios.post as Mock).mockResolvedValue({ data: stream });
      const err = (await api.generateImageStream({ prompt: 'x' }).catch((e: unknown) => e)) as OpenAIImageAPIError;
      expect(err).toBeInstanceOf(OpenAIImageAPIError);
      expect(err.message).toBe('Request failed: aborted');
      expect((err.cause as { code?: string }).code).toBe('ECONNRESET');
    });

    it('should recover the JSON error body from a failed stream response', async () => {
      (axios.post as Mock).mockRejectedValue({
        response: {
          status: 400,
          data: Readable.from([JSON.stringify({ error: { message: 'size not supported' } })]),
        },
      });

      await expect(api.generateImageStream({ prompt: 'a river' })).rejects.toThrow('Bad request: size not supported');
    });

    it('should reject n > 1 on streaming requests', async () => {
      await expect(api.generateImageStream({ prompt: 'x', n: 2 })).rejects.toThrow(
        'Streaming requests generate a single image'
      );
      await expect(api.generateImageEditStream({ image: '/p/a.png', prompt: 'x', n: 3 })).rejects.toThrow(
        'Streaming requests generate a single image'
      );
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should type an early stream end as a stream_error', async () => {
      (axios.post as Mock).mockResolvedValue({
        data: Readable.from([sseBody([{ event: 'image_generation.partial_image', data: partial0 }])]),
      });
      const err = (await api.generateImageStream({ prompt: 'x' }).catch((e: unknown) => e)) as OpenAIImageAPIError;
      expect(err).toBeInstanceOf(OpenAIImageAPIError);
      expect(err.type).toBe('stream_error');
    });

    it('should validate partial_images before opening a stream', async () => {
      await expect(api.generateImageStream({ prompt: 'x', partial_images: 5 })).rejects.toThrow(
        /partial_images must be an integer between 0 and 3/
      );
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('streamImageEdit should validate before touching the filesystem', async () => {
      await expect(
        api.generateImageEditStream({ image: '/p/a.png', prompt: 'x', model: 'gpt-image-2', input_fidelity: 'low' })
      ).rejects.toThrow(/not accepted by gpt-image-2/);
      expect(axios.post).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      (axios.post as Mock).mockRejectedValue(new Error('Network error'));
      await expect(api.generateImage({ prompt: 'a cat' })).rejects.toThrow('Request failed: Network error');
    });

    it('should point at requestTimeout on a timeout and at the network on a refused connection', async () => {
      (axios.post as Mock).mockRejectedValue(
        Object.assign(new Error('timeout of 180000ms exceeded'), { code: 'ECONNABORTED' })
      );
      await expect(api.generateImage({ prompt: 'x' })).rejects.toThrow(/exceeded requestTimeout=180000ms; raise it/);
      (axios.post as Mock).mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
      );
      await expect(api.generateImage({ prompt: 'x' })).rejects.toThrow(/could not reach https:\/\/api\.openai\.com/);
    });

    it('validateRequest should run the full pre-flight without sending', async () => {
      await expect(api.validateRequest({ prompt: '' })).rejects.toThrow('Prompt is required');
      await expect(api.validateRequest({ prompt: 'x', n: 2 }, { streaming: true })).rejects.toThrow('single image');
      await expect(api.validateRequest({ image: '/nope.png', prompt: 'x' })).rejects.toThrow('Image file not found');
      await expect(api.validateRequest({ prompt: 'x', model: 'gpt-image-2', size: '2048x1152' })).resolves.toBe(
        'gpt-image-2'
      );
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('should not crash the error handler on a non-Error rejection', async () => {
      (axios.post as Mock).mockRejectedValue('socket hang up');
      await expect(api.generateImage({ prompt: 'a cat' })).rejects.toThrow('Request failed: socket hang up');
      (axios.post as Mock).mockRejectedValue(null);
      await expect(api.generateImage({ prompt: 'a cat' })).rejects.toThrow('Request failed: null');
    });

    it('should handle 500 errors', async () => {
      (axios.post as Mock).mockRejectedValue({ response: { status: 500, data: {} } });
      await expect(api.generateImage({ prompt: 'a cat' })).rejects.toThrow('OpenAI service error');
    });

    it('should handle 503 errors', async () => {
      (axios.post as Mock).mockRejectedValue({ response: { status: 503, data: {} } });
      await expect(api.generateImage({ prompt: 'a cat' })).rejects.toThrow('OpenAI service error');
    });

    it('should report other statuses with code and message', async () => {
      (axios.post as Mock).mockRejectedValue({
        response: { status: 418, data: { error: { message: 'teapot' } } },
      });
      await expect(api.generateImage({ prompt: 'a cat' })).rejects.toThrow('API error (418): teapot');
    });
  });

  describe('saveImages', () => {
    const API_TEST_DIR = './test-api-output';

    beforeEach(async () => {
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

    it('should save images from b64_json response', async () => {
      const paths = await api.saveImages(
        {
          created: 123,
          data: [
            { b64_json: Buffer.from('image data 1').toString('base64') },
            { b64_json: Buffer.from('image data 2').toString('base64') },
          ],
        },
        API_TEST_DIR,
        'test-image',
        'png'
      );

      expect(paths).toHaveLength(2);
      expect(axios.get).not.toHaveBeenCalled();
    });

    it('should handle single image response', async () => {
      const paths = await api.saveImages(
        { created: 123, data: [{ b64_json: Buffer.from('x').toString('base64') }] },
        API_TEST_DIR,
        'single-image',
        'png'
      );
      expect(paths).toHaveLength(1);
      expect(paths[0]).toContain('single-image.png');
    });

    it('should handle multiple images with numbered filenames', async () => {
      const paths = await api.saveImages(
        {
          created: 123,
          data: [
            { b64_json: Buffer.from('data1').toString('base64') },
            { b64_json: Buffer.from('data2').toString('base64') },
            { b64_json: Buffer.from('data3').toString('base64') },
          ],
        },
        API_TEST_DIR,
        'batch',
        'png'
      );
      expect(paths).toHaveLength(3);
      expect(paths[0]).toContain('batch_1.png');
      expect(paths[1]).toContain('batch_2.png');
      expect(paths[2]).toContain('batch_3.png');
    });

    it('should refuse a baseFilename that is not a single path component', async () => {
      const resp = { created: 1, data: [{ b64_json: Buffer.from('x').toString('base64') }] };
      for (const bad of ['../escape', 'a/b', 'a\\b', '..', '.', '']) {
        await expect(api.saveImages(resp, API_TEST_DIR, bad)).rejects.toThrow('single path component');
      }
    });

    it('should refuse an outputDir with a .. segment', async () => {
      const resp = { created: 1, data: [{ b64_json: Buffer.from('x').toString('base64') }] };
      await expect(api.saveImages(resp, `${API_TEST_DIR}/../etc`, 'x')).rejects.toThrow('Path traversal');
    });

    it('should strip anything but alphanumerics from the extension', async () => {
      const paths = await api.saveImages(
        { created: 1, data: [{ b64_json: Buffer.from('x').toString('base64') }] },
        API_TEST_DIR,
        'ext',
        '../png'
      );
      expect(paths[0]).toMatch(/ext\.png$/);
    });

    it('should default the extension to the response output_format', async () => {
      const paths = await api.saveImages(
        { created: 1, data: [{ b64_json: Buffer.from('x').toString('base64') }], output_format: 'webp' },
        API_TEST_DIR,
        'fmt'
      );
      expect(paths[0]).toContain('fmt.webp');
    });

    it('should skip entries without b64_json', async () => {
      const paths = await api.saveImages(
        {
          created: 123,
          data: [
            { b64_json: Buffer.from('a').toString('base64') },
            { revised_prompt: 'no image' },
            { b64_json: Buffer.from('b').toString('base64') },
          ],
        },
        API_TEST_DIR,
        'test',
        'png'
      );
      expect(paths).toHaveLength(2);
    });
  });

  describe('Security Features', () => {
    it('should enforce HTTPS for baseUrl', () => {
      expect(() => {
        new OpenAIImageAPI({ apiKey: 'sk-test123', baseUrl: 'http://api.openai.com' });
      }).toThrow('API base URL must use HTTPS');
    });

    it('should accept HTTPS baseUrl', () => {
      expect(() => {
        new OpenAIImageAPI({ apiKey: 'sk-test123', baseUrl: 'https://api.openai.com' });
      }).not.toThrow();
    });

    it('should never write the API key to the debug log, only its redacted tail', async () => {
      const key = 'sk-test1234567890abcdef';
      const testApi = new OpenAIImageAPI({ apiKey: key, logLevel: 'DEBUG' });
      const debug = vi.spyOn(priv(testApi).logger, 'debug');
      (axios.post as Mock).mockResolvedValue(okResponse);

      await testApi.generateImage({ prompt: 'x' });

      const logged = JSON.stringify(debug.mock.calls);
      expect(logged).toContain('sk-...cdef');
      expect(logged).not.toContain(key);
      // The real header still carries the full key
      expect((axios.post as Mock).mock.calls[0][2].headers.Authorization).toBe(`Bearer ${key}`);
    });

    it('should redact a short key entirely rather than leak its tail', async () => {
      const testApi = new OpenAIImageAPI({ apiKey: 'sk-test', logLevel: 'DEBUG' });
      const debug = vi.spyOn(priv(testApi).logger, 'debug');
      (axios.post as Mock).mockResolvedValue(okResponse);
      await testApi.generateImage({ prompt: 'x' });
      const logged = JSON.stringify(debug.mock.calls);
      expect(logged).toContain('[REDACTED]');
      expect(logged).not.toContain('Bearer sk-test"');
    });

    it('should sanitize the thrown message in production but keep the API reason on apiMessage', async () => {
      process.env.NODE_ENV = 'production';
      (axios.post as Mock).mockRejectedValue({
        response: { status: 400, data: { error: { message: 'Detailed internal error with sensitive information' } } },
      });
      const err = (await api.generateImage({ prompt: 'x' }).catch((e: unknown) => e)) as OpenAIImageAPIError;
      expect(err.message).toBe('Bad request: Invalid request parameters');
      expect(err.message).not.toContain('sensitive information');
      expect(err.apiMessage).toBe('Detailed internal error with sensitive information');
      delete process.env.NODE_ENV;
    });

    it('should pass the API message through outside production', async () => {
      process.env.NODE_ENV = 'development';
      (axios.post as Mock).mockRejectedValue({
        response: { status: 400, data: { error: { message: 'Detailed error message' } } },
      });
      await expect(api.generateImage({ prompt: 'x' })).rejects.toThrow('Bad request: Detailed error message');
      delete process.env.NODE_ENV;
    });

    it('should enforce rate limiting between requests', async () => {
      const testApi = new OpenAIImageAPI({ apiKey: 'sk-test123', rateLimitDelay: 100 });
      vi.mocked(axios.post).mockResolvedValue({ data: { created: Date.now(), data: [{ b64_json: 'x' }] } });

      const startTime = Date.now();
      await priv(testApi)._makeRequest('POST', '/test', { kind: 'json', data: {} });
      await priv(testApi)._makeRequest('POST', '/test', { kind: 'json', data: {} });
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeGreaterThanOrEqual(90); // Allow small margin
    });

    it('should space concurrent callers on one instance, not release them as a burst', async () => {
      const testApi = new OpenAIImageAPI({ apiKey: 'sk-test123', rateLimitDelay: 60 });
      const times: number[] = [];
      vi.mocked(axios.post).mockImplementation(() => {
        times.push(Date.now());
        return Promise.resolve({ data: { created: 1, data: [{ b64_json: 'x' }] } });
      });

      await Promise.all(
        [1, 2, 3, 4].map(() => priv(testApi)._makeRequest('POST', '/test', { kind: 'json', data: {} }))
      );

      times.sort((a, b) => a - b);
      for (let i = 1; i < times.length; i++) {
        expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(50); // 60ms delay, small margin
      }
    });

    it('should allow custom rate limit delay', () => {
      const testApi = new OpenAIImageAPI({ apiKey: 'sk-test123', rateLimitDelay: 5000 });
      expect(priv(testApi).rateLimitDelay).toBe(5000);
    });

    it('should use default rate limit delay if not specified', () => {
      const testApi = new OpenAIImageAPI({ apiKey: 'sk-test123' });
      expect(priv(testApi).rateLimitDelay).toBe(1000);
    });
  });
});
