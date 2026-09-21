/**
 * CLI Tests
 *
 * Subprocess smoke tests against the built dist/cli.js. The CLI module runs
 * main() on import, so it cannot be unit-imported; exercising the binary with
 * --dry-run covers option parsing, model resolution, and the validator wiring
 * without any network call. Requires `npm run build` to have produced dist/.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const CLI = path.resolve('dist/cli.js');

function run(...args: string[]): { code: number | null; out: string } {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, OPENAI_API_KEY: 'sk-test-key-for-cli' },
  });
  return { code: result.status, out: `${result.stdout}\n${result.stderr}` };
}

describe('CLI (dist/cli.js)', () => {
  it('build output exists', () => {
    expect(existsSync(CLI)).toBe(true);
  });

  it('--dry-run validates a good request and exits 0', () => {
    const { code, out } = run('--dry-run', '--sunburst', '--prompt', 'a cat', '--quality', 'max', '--size', '1536x864');
    expect(code).toBe(0);
    expect(out).toContain('Dry run - request validated successfully');
    expect(out).toContain('"model": "gpt-image-2.5-sunburst"');
  });

  it('--dry-run defaults to gpt-image-2.5-flare', () => {
    const { code, out } = run('--dry-run', '--prompt', 'a cat');
    expect(code).toBe(0);
    expect(out).toContain('Using model: gpt-image-2.5-flare');
  });

  it('--dry-run fails on a per-model rule with the validator message', () => {
    const { code, out } = run('--dry-run', '--gpt-image-2', '--prompt', 'a cat', '--quality', 'max');
    expect(code).toBe(1);
    expect(out).toContain('Invalid quality "max" for gpt-image-2');
  });

  it('--dry-run fails on a bad flexible size', () => {
    const { code, out } = run('--dry-run', '--gpt-image-2', '--prompt', 'a cat', '--size', '1000x1000');
    expect(code).toBe(1);
    expect(out).toContain('width and height must both be multiples of 16');
  });

  it('--model rejects removed and unknown ids', () => {
    const { code, out } = run('--dry-run', '--model', 'dall-e-3', '--prompt', 'a cat');
    expect(code).toBe(1);
    expect(out).toContain('Unknown model "dall-e-3". Supported: gpt-image-2.5-sunburst');
  });

  it('--model accepts dated snapshots', () => {
    const { code, out } = run('--dry-run', '--model', 'gpt-image-2.5-flare-2026-09-08', '--prompt', 'a cat');
    expect(code).toBe(0);
    expect(out).toContain('"model": "gpt-image-2.5-flare-2026-09-08"');
  });

  it('rejects an invalid enum flag before doing anything else', () => {
    const { code, out } = run('--dry-run', '--prompt', 'a cat', '--quality', 'bogus');
    expect(code).toBe(1);
    expect(out).toContain('Invalid value "bogus" for --quality');
    expect(out).not.toContain('Using model');
  });

  it('rejects an invalid --log-level', () => {
    const { code, out } = run('--dry-run', '--prompt', 'a cat', '--log-level', 'LOUD');
    expect(code).toBe(1);
    expect(out).toContain('Invalid value "LOUD" for --log-level');
  });

  it('accepts a lower-case --log-level', () => {
    const { code } = run('--dry-run', '--prompt', 'a cat', '--log-level', 'debug');
    expect(code).toBe(0);
  });

  it('requires --stream for --partial-images', () => {
    const { code, out } = run('--dry-run', '--prompt', 'a cat', '--partial-images', '2');
    expect(code).toBe(1);
    expect(out).toContain('--partial-images requires --stream');
  });

  it('requires --image for --edit', () => {
    const { code, out } = run('--dry-run', '--edit', '--prompt', 'a cat');
    expect(code).toBe(1);
    expect(out).toContain('--image is required for --edit');
  });

  it('rejects input_fidelity on gpt-image-2 at dry-run', () => {
    const { code, out } = run(
      '--dry-run',
      '--gpt-image-2',
      '--edit',
      '--image',
      'x.png',
      '--prompt',
      'a',
      '--input-fidelity',
      'high'
    );
    expect(code).toBe(1);
    expect(out).toContain('input_fidelity is not accepted by gpt-image-2');
  });

  it('warns on a deprecated model', () => {
    const { code, out } = run('--dry-run', '--gpt-image-1', '--prompt', 'a cat');
    expect(code).toBe(0);
    expect(out).toContain('is scheduled for removal from the OpenAI API on 2026-10-23');
  });

  it('rejects path traversal in --output-dir', () => {
    const { code, out } = run('--dry-run', '--prompt', 'a cat', '--output-dir', 'out/../../etc');
    expect(code).toBe(1);
    expect(out).toContain('Path traversal sequences');
  });

  it('exits non-zero when every prompt in a batch fails, and names them', () => {
    // Over-long prompts fail client-side validation inside the request path, so no network is touched
    const tooLong = 'a'.repeat(32001);
    const { code, out } = run('--prompt', tooLong, '--prompt', `${tooLong}b`);
    expect(code).toBe(1);
    expect(out).toContain('2 of 2 prompt(s) failed');
    expect(out).not.toContain('All operations completed successfully');
  });

  it('exits non-zero when some prompts in a batch fail', () => {
    // First prompt is only validated (dry-run does not apply here), so make both invalid but distinct sizes
    const { code, out } = run('--gpt-image-2', '--prompt', 'ok', '--prompt', 'x'.repeat(32001), '--size', '1000x1000');
    expect(code).toBe(1);
    expect(out).toContain('of 2 prompt(s) failed');
  });

  it('--no-validate lets an unknown model id through the dry-run with a warning', () => {
    const { code, out } = run('--dry-run', '--no-validate', '--model', 'gpt-image-9-2027-01-01', '--prompt', 'a cat');
    expect(code).toBe(0);
    expect(out).toContain("is not in this package's catalogue; sending unvalidated");
    expect(out).toContain('constraint check skipped (--no-validate)');
    expect(out).toContain('"model": "gpt-image-9-2027-01-01"');
  });

  it('points at --no-validate when rejecting an unknown model', () => {
    const { code, out } = run('--dry-run', '--model', 'gpt-image-9', '--prompt', 'a cat');
    expect(code).toBe(1);
    expect(out).toContain('pass --no-validate to send it to the API anyway');
  });

  it('--no-validate skips the per-model rules at dry-run', () => {
    const { code } = run('--dry-run', '--no-validate', '--gpt-image-2', '--prompt', 'a cat', '--quality', 'max');
    expect(code).toBe(0);
  });

  it('--dry-run rejects an empty prompt in a batch, as the real call would', () => {
    const { code, out } = run('--dry-run', '--prompt', 'a red apple', '--prompt', '', '--prompt', 'a banana');
    expect(code).toBe(1);
    expect(out).toContain('Prompt is required');
  });

  it('--dry-run rejects a missing --image file, as the real call would', () => {
    const { code, out } = run('--dry-run', '--edit', '--image', 'definitely-missing.png', '--prompt', 'x');
    expect(code).toBe(1);
    expect(out).toContain('Image file not found: definitely-missing.png');
  });

  it('exposes no Sora or DALL-E flags', () => {
    const { out } = run('--help');
    expect(out).not.toMatch(/--video|--sora|--dalle|--variation|--response-format|--style/);
    expect(out).toMatch(/--stream/);
    expect(out).toMatch(/--partial-images/);
  });
});
