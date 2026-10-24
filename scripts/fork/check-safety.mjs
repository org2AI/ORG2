#!/usr/bin/env node
// Fork-specific guard. No dependencies or network access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const config = JSON.parse(read('src-tauri/tauri.conf.json'));
const rust = read('src-tauri/src/app_update.rs');
const readme = read('README.md');

assert.equal(config.plugins?.updater?.active, false,
  'Fork must not activate Tauri updater until signed fork-only channels exist');
assert.equal(config.bundle?.createUpdaterArtifacts, false,
  'Fork must not create unsigned or upstream-key updater artifacts');
assert.match(rust, /const FORK_UPDATER_READY:\s*bool\s*=\s*false\s*;/,
  'Rust custom updater must stay fail-closed until independent publishing');
assert.match(rust, /pub async fn check_app_update\([\s\S]*?require_fork_updater_ready\(\)\?;/,
  'Custom check_app_update path must enforce fork update guard');
assert.match(readme, /Independent community fork/);
assert.deepEqual(config.plugins?.updater?.endpoints, [],
  'Until independent signing is configured, no updater manifest URL may be active');
assert.ok(!readme.includes('https://github.com/org2AI/ORG2/releases/'),
  'Fork README must not offer binaries published by the original upstream');
assert.match(readme, /No independently signed TP Agent Studio installers are available yet/);

const upstreamRelease = read('.github/workflows/release.yaml');
const releaseLines = upstreamRelease.split('\n');
for (const job of ['build-and-release', 'build-windows', 'build-linux']) {
  const anchor = releaseLines.findIndex((line) => line === '  ' + job + ':');
  assert.notEqual(anchor, -1, 'Missing release job: ' + job);
  const block = releaseLines.slice(anchor, anchor + 8).join('\n');
  assert.ok(block.includes("if: ${{ github.repository == 'org2AI/ORG2' }}"),
    'Inherited upstream release job must be disabled in fork: ' + job);
}
process.stdout.write('Fork release-safety checks passed. Independent installation is not yet validated.\n');
