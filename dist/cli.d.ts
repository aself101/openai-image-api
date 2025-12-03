#!/usr/bin/env node
/**
 * OpenAI Image & Video Generation - Main CLI Script
 *
 * Command-line tool for generating, editing, and creating variations of images
 * using OpenAI's image generation API (DALL-E 2, DALL-E 3, GPT Image 1),
 * and generating videos using Sora (Sora 2, Sora 2 Pro).
 *
 * Image Usage:
 *   openai-img --dalle-3 --prompt "a cat" --size 1024x1024
 *   openai-img --gpt-image-1 --prompt "landscape" --background transparent
 *   openai-img --dalle-2 --edit --image photo.png --prompt "add a hat"
 *   openai-img --dalle-2 --variation --image photo.png --n 3
 *
 * Video Usage:
 *   openai-img --video --sora-2 --prompt "a cat on a motorcycle" --seconds 8
 *   openai-img --video --sora-2-pro --input-image frame.jpg --prompt "she walks away"
 *   openai-img --remix-video video_123 --prompt "change to teal colors"
 *   openai-img --list-videos --limit 20
 */
export {};
//# sourceMappingURL=cli.d.ts.map