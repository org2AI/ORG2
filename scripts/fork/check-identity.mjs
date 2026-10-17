#!/usr/bin/env node
// CI gate for fork desktop identity. No dependencies or network access.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const base = JSON.parse(read('src-tauri/tauri.conf.json'));
const dev = JSON.parse(read('src-tauri/tauri.dev.conf.json'));
const windows = JSON.parse(read('src-tauri/tauri.windows.conf.json'));
const macos = JSON.parse(read('src-tauri/tauri.macos.conf.json'));

assert.equal(base.identifier, 'com.theerasakping.tpagentstudio');
assert.equal(dev.identifier, 'com.theerasakping.tpagentstudio.dev');
assert.equal(base.productName, 'TP Agent Studio');
assert.equal(dev.productName, 'TP Agent Studio Dev');
assert.equal(base.app.windows.find((w) => w.label === 'main')?.title, base.productName);
assert.equal(windows.app.windows.find((w) => w.label === 'main')?.title, base.productName);
assert.deepEqual(base.plugins['deep-link'].desktop.schemes, ['tpagentstudio']);
assert.deepEqual(dev.plugins['deep-link'].desktop.schemes, ['tpagentstudio-dev']);
assert.equal(macos.bundle.macOS.signingIdentity, undefined,
  'Do not inherit upstream Apple signing identity');
assert.equal(macos.bundle.macOS.providerShortName, undefined,
  'Do not inherit upstream Apple team short name');
assert.equal(base.plugins.updater.active, false);
assert.equal(base.bundle.createUpdaterArtifacts, false);

const scopes = base.app.security.assetProtocol.scope;
assert.ok(scopes.includes('$HOME/.tp-agent-studio/**'));
assert.ok(scopes.includes('$HOME/.tp-agent-studio-dev/**'));
assert.ok(!scopes.includes('$HOME/.orgii/**'));

const nodeProfiles = read('scripts/tauri/instance-profile.cjs');
assert.match(nodeProfiles, /const PRIMARY_IDE_PORT = 23847;/);
assert.match(nodeProfiles, /const PRIMARY_PROXY_PORT = 27888;/);
assert.match(nodeProfiles, /\.tp-agent-studio-dev/);
assert.match(nodeProfiles, /com\.theerasakping\.tpagentstudio/);

const runtime = read('src-tauri/src/runtime_instance.rs');
assert.match(runtime, /const FORK_IDE_SERVER_PORT: u16 = 23_847;/);
assert.match(runtime, /const FORK_CLI_PROXY_PORT: u16 = 27_888;/);
assert.match(runtime, /\.tp-agent-studio-dev/);
assert.match(runtime, /\.tp-agent-studio-instance/);
assert.match(runtime, /validate_explicit_home/);
assert.match(runtime, /resolve_profile_candidate/);
assert.match(runtime, /symlink_metadata/);
assert.match(runtime, /profile_path_contains/);
assert.match(runtime, /rejects_missing_suffix_and_parent_traversal_into_upstream_data/);
assert.match(runtime, /rejects_symlinked_parent_into_upstream_profile/);

const bootstrap = read('src-tauri/src/app/bootstrap.rs');
assert.match(bootstrap, /runtime_profile\.is_fork\(\)/);
assert.match(bootstrap, /validate_explicit_home/);
assert.match(bootstrap, /std::env::set_var\("ORGII_EXTERNAL_HISTORY_HOME", &history_home\)/);
assert.match(bootstrap, /std::env::set_var\("ORGII_NATIVE_TRANSCRIPT_HOME", &history_home\)/);
assert.match(read('src-tauri/crates/app-paths/src/data_root.rs'),
  /home_dir\(\)\.join\("\.tp-agent-studio"\)/);
assert.match(read('src-tauri/src/app_update.rs'),
  /const FORK_UPDATER_READY: bool = false;/);
process.stdout.write('Fork desktop identity checks passed. Full profile isolation still requires integration testing.\n');
