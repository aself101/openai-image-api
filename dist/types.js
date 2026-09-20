/**
 * OpenAI Image API Type Definitions
 *
 * Type definitions for the OpenAI Image API (`/v1/images/generations`,
 * `/v1/images/edits`) as served to the GPT Image model family.
 *
 * Scope decisions recorded here (3.0.0, 2026-09-20):
 * - DALL-E 2/3 were shut down by OpenAI on 2026-05-12 and are not modelled.
 *   The `/v1/images/variations` endpoint only ever accepted `dall-e-2`, so it
 *   is gone with them; likewise `response_format`, `style`, and URL responses.
 * - The Videos API (Sora 2) shuts down 2026-09-24 and is not modelled.
 * - `gpt-image-1`, `gpt-image-1-mini`, and `gpt-image-1.5` have announced
 *   shutdown dates (see MODEL_DEPRECATIONS in config.ts) and remain supported
 *   until then.
 */
export {};
//# sourceMappingURL=types.js.map