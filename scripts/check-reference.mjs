#!/usr/bin/env node
/**
 * Diff this package's constraint tables against OpenAI's published Image API
 * reference.
 *
 * The tables in src/config.ts are a transcription of the reference on a given
 * date. This script re-reads the reference and reports where the two now
 * disagree, so the drift the tables cannot detect at runtime is caught at
 * review time instead of by a user. It needs network access and is not part
 * of `npm test`.
 *
 * What is compared (the parts of the reference that are machine-readable):
 *   - model ids listed in the `model` parameter enum (generations and edits)
 *   - quality values listed in the `quality` parameter enum
 *   - the free-form size rules (multiple-of, aspect ratio, max edge, max size)
 *   - deprecation dates on the deprecations page for every model we list
 *
 * Exit 0 when everything matches, 1 on any difference, 2 on a fetch failure.
 * A `--control` flag corrupts one local value so the diff is proven to fire.
 */

import { MODEL_CONSTRAINTS, MODEL_ALIASES, MODEL_DEPRECATIONS } from '../dist/config.js';

const REFERENCE_URL = 'https://developers.openai.com/api/reference/resources/images.md';
const DEPRECATIONS_URL = 'https://developers.openai.com/api/docs/deprecations.md';
const control = process.argv.includes('--control');

async function fetchText(url) {
  const res = await fetch(url, { headers: { accept: 'text/markdown, text/plain;q=0.9, */*;q=0.1' } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.text();
}

/** Pull `"value"` literals out of every enum block that follows a given parameter heading */
function enumValues(md, paramName) {
  const values = new Set();
  const re = new RegExp(`^- \\\`${paramName}: .*$`, 'gm');
  for (const m of md.matchAll(re)) {
    // the enum bullets follow until the next top-level "- `" parameter line
    const rest = md.slice(m.index + m[0].length);
    const end = rest.search(/^- `[a-z_]+: /m);
    const block = end === -1 ? rest : rest.slice(0, end);
    for (const v of block.matchAll(/^\s+- `"([^"]+)"`/gm)) values.add(v[1]);
  }
  return values;
}

function diffSets(label, ours, theirs) {
  const missingHere = [...theirs].filter((v) => !ours.has(v)).sort();
  const extraHere = [...ours].filter((v) => !theirs.has(v)).sort();
  const lines = [];
  if (missingHere.length) lines.push(`  ${label}: in the reference, not in config: ${missingHere.join(', ')}`);
  if (extraHere.length) lines.push(`  ${label}: in config, not in the reference: ${extraHere.join(', ')}`);
  return lines;
}

let problems = [];
let md;
let dep;
try {
  [md, dep] = await Promise.all([fetchText(REFERENCE_URL), fetchText(DEPRECATIONS_URL)]);
} catch (error) {
  console.error(`check-reference: could not fetch the reference: ${error.message}`);
  process.exit(2);
}

// --- models -----------------------------------------------------------------
const refModels = enumValues(md, 'model');
// dall-e ids still appear in the reference text; they are shut down and out of scope here
for (const legacy of ['dall-e-2', 'dall-e-3', 'chatgpt-image-latest']) refModels.delete(legacy);
const ourModels = new Set([...Object.keys(MODEL_CONSTRAINTS), ...Object.keys(MODEL_ALIASES)]);
if (control) ourModels.add('gpt-image-0-control');
problems.push(...diffSets('models', ourModels, refModels));

// --- quality ----------------------------------------------------------------
const refQuality = enumValues(md, 'quality');
for (const legacy of ['standard', 'hd']) refQuality.delete(legacy); // dall-e only
const ourQuality = new Set(Object.values(MODEL_CONSTRAINTS).flatMap((c) => c.quality));
problems.push(...diffSets('quality', ourQuality, refQuality));

// --- flexible size rules ----------------------------------------------------
const flex = Object.values(MODEL_CONSTRAINTS).find((c) => c.flexibleSize)?.flexibleSize;
if (flex) {
  const want = [
    [`divisible by ${flex.multipleOf}`, new RegExp(`divisible by ${flex.multipleOf}\\b`)],
    [
      `aspect ratio 1:${flex.maxAspectRatio}–${flex.maxAspectRatio}:1`,
      new RegExp(`between 1:${flex.maxAspectRatio} and ${flex.maxAspectRatio}:1`),
    ],
    [`max edge ${flex.maxEdge}`, new RegExp(`maximum supported resolution is \`${flex.maxEdge}x\\d+\``)],
  ];
  for (const [label, re] of want) {
    if (!re.test(md)) problems.push(`  size rule not found in the reference text as configured: ${label}`);
  }
}

// --- deprecation dates ------------------------------------------------------
// Rows look like `| Shutdown date | Model / system | Recommended replacement |`;
// match on the MODEL cell only, or a replacement column mentioning a live
// model reads as that model's shutdown.
const months = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};
/**
 * The page mixes ISO dates ("2026-05-12") with prose dates in both short
 * ("Dec 1, 2026") and long ("October 23, 2026") month forms.
 */
function toIso(cell) {
  const iso = cell.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  if (iso) return iso;
  const human = cell.match(/([A-Z][a-z]+) (\d{1,2}), (\d{4})/);
  if (!human) return undefined;
  const month = months[human[1].slice(0, 3).toLowerCase()];
  return month ? `${human[3]}-${month}-${human[2].padStart(2, '0')}` : undefined;
}
const shutdownRows = new Map(); // model id → iso date
for (const line of dep.split('\n')) {
  const cells = line.split('|').map((c) => c.trim());
  if (cells.length < 4) continue;
  const date = toIso(cells[1]);
  if (!date) continue;
  for (const id of cells[2].matchAll(/`([^`]+)`/g)) shutdownRows.set(id[1], date);
}
for (const [model, d] of Object.entries(MODEL_DEPRECATIONS)) {
  const found = shutdownRows.get(model);
  if (!found) problems.push(`  deprecations: no shutdown row for ${model} (config says ${d.shutdown})`);
  else if (found !== d.shutdown)
    problems.push(`  deprecations: ${model} shuts down ${found} per the reference, ${d.shutdown} in config`);
}
for (const model of Object.keys(MODEL_CONSTRAINTS)) {
  if (!MODEL_DEPRECATIONS[model] && shutdownRows.has(model)) {
    problems.push(
      `  deprecations: the reference lists ${model} for shutdown on ${shutdownRows.get(model)}; config has no MODEL_DEPRECATIONS entry`
    );
  }
}

if (problems.length) {
  console.error(`check-reference: ${problems.length} difference(s) between src/config.ts and the published reference:`);
  for (const p of problems) console.error(p);
  process.exit(1);
}
console.log(
  `check-reference: config matches the reference (${ourModels.size} model ids, ${ourQuality.size} quality values, ${Object.keys(MODEL_DEPRECATIONS).length} deprecation dates)`
);
