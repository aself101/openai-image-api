#!/usr/bin/env node
/**
 * Release gate, run by `prepublishOnly` (and by hand: `npm run check:release`).
 *
 * Refuses to publish when any of these is false:
 *   1. CHANGELOG.md has a `## [<version>]` heading for package.json's version
 *   2. `## [Unreleased]` holds no entries (everything moved under the version)
 *   3. the committed dist/ matches a fresh `npm run build`
 *   4. `npm pack --dry-run` lists nothing outside dist/, src/, README.md,
 *      LICENSE, package.json
 *
 * `--control` runs the same checks against a version that does not exist and
 * must fail — proof the gate can fire. Exit 1 on any failure.
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const control = process.argv.includes('--control');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = control ? '99.99.99' : pkg.version;
const changelog = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const failures = [];

// 1. heading for this version
if (!new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm').test(changelog)) {
  failures.push(`CHANGELOG.md has no "## [${version}] - YYYY-MM-DD" heading`);
}

// 2. [Unreleased] is empty
const unreleased = /^## \[Unreleased\]\s*\n([\s\S]*?)(?=^## \[|\s*$)/m.exec(changelog);
if (unreleased && unreleased[1].replace(/\s+/g, '') !== '') {
  failures.push('CHANGELOG.md [Unreleased] still holds entries; move them under the version heading');
}

// 3. dist/ matches a fresh build
try {
  execSync('npm run build --silent', { cwd: root, stdio: 'ignore' });
  const drift = execSync('git status --porcelain -- dist/', { cwd: root, encoding: 'utf8' }).trim();
  if (drift) failures.push(`dist/ differs from a fresh build (commit it):\n${drift}`);
} catch (error) {
  failures.push(`build failed: ${error.message}`);
}

// 4. tarball contents
const allowed = /^(dist\/|src\/|README\.md$|LICENSE$|package\.json$)/;
try {
  const json = execSync('npm pack --dry-run --json --silent', { cwd: root, encoding: 'utf8' });
  const files = JSON.parse(json)[0].files.map((f) => f.path);
  const stray = files.filter((f) => !allowed.test(f));
  if (control) stray.push('control/planted-file.txt');
  if (stray.length) failures.push(`npm pack would ship files outside the allow-list:\n  ${stray.join('\n  ')}`);
} catch (error) {
  failures.push(`npm pack --dry-run failed: ${error.message}`);
}

if (failures.length) {
  console.error(`check-release: ${failures.length} failure(s) for ${version}${control ? ' (control)' : ''}`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(control ? 0 : 1);
}
if (control) {
  console.error('check-release --control: expected failures and saw none — the gate is inert');
  process.exit(1);
}
console.log(`check-release: ${version} ready (changelog heading, empty [Unreleased], dist in sync, tarball clean)`);
