#!/usr/bin/env node

/**
 * OpenAI Image Generation - `openai-img` bin entry
 *
 * The thin process boundary: reads the package version, hands process.argv to
 * runCli() in cli-core.ts, and turns the returned exit code into process.exit
 * once winston has flushed. Everything else lives in cli-core.ts so it can be
 * unit-tested in-process.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { runCli } from './cli-core.js';
import { logger } from './utils.js';
import { loadEnvConfig } from './config.js';

// Read version from package.json dynamically
// Note: In compiled output, package.json is one level up from dist/
interface PackageJson {
  version: string;
}
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let version = '0.0.0';
try {
  version = (JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')) as PackageJson).version;
} catch {
  // A missing or malformed manifest only affects --version output
}

/**
 * Exit once winston has flushed.
 *
 * `process.exit` right after `logger.error` drops the final line when stdout is
 * a pipe with more than the 64 KB kernel buffer queued behind a slow reader —
 * exactly the CI capture where the reason for a non-zero exit matters most.
 * The timer is a backstop for a transport that never emits 'finish'.
 */
function exitAfterFlush(code: number): void {
  const timer = setTimeout(() => process.exit(code), 2000);
  logger.once('finish', () => {
    clearTimeout(timer);
    process.exit(code);
  });
  logger.end();
}

// The CLI's documented key lookup includes ./.env and ~/.openai/.env; the
// library loads them lazily, the CLI up front so OPENAI_OUTPUT_DIR is seen too.
loadEnvConfig();

runCli(process.argv, version).then(exitAfterFlush, (error: unknown) => {
  logger.error(`\n✗ Error: ${error instanceof Error ? error.message : String(error)}\n`);
  exitAfterFlush(1);
});
