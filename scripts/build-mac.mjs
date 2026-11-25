#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

if (args.includes('-h') || args.includes('--help')) {
    console.log(
        'Usage: npm run build-mac [-- --universal]\n\n' +
            'Builds signed macOS artifacts for x86_64 and aarch64 (default), or one universal app with --universal.',
    );
    process.exit(0);
}
if (process.platform !== 'darwin') {
    console.error('build-mac must run on macOS.');
    process.exit(1);
}

const universal =
    args.includes('--universal') || process.env.MAC_UNIVERSAL === '1';
const buildTargets = universal
    ? ['universal-apple-darwin']
    : ['x86_64-apple-darwin', 'aarch64-apple-darwin'];
const rustTargets = universal
    ? ['x86_64-apple-darwin', 'aarch64-apple-darwin']
    : buildTargets;

function run(command, commandArgs, env = {}) {
    const result = spawnSync(command, commandArgs, {
        stdio: 'inherit',
        cwd: root,
        env: { ...process.env, ...env },
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`${command} exited with code ${result.status}`);
    }
}

function setBlock(blocked) {
    run('node', ['scripts/update-block.mjs', blocked ? 'block' : 'unblock']);
}

try {
    for (const target of rustTargets) {
        console.log(`\nEnsuring Rust target: ${target}`);
        run('rustup', ['target', 'add', target]);
    }

    for (const target of buildTargets) {
        const bundleDir = join(
            root,
            'src-tauri',
            'target',
            target,
            'release',
            'bundle',
        );
        const postEnv = {
            TAURI_ENV_TARGET_TRIPLE: target,
            TAURI_BUNDLE_DIR: bundleDir,
        };

        console.log(`\n=== ${target}: portable zip (update-blocked) ===`);
        setBlock(true);
        try {
            run(
                'node',
                ['scripts/tauri-build.mjs', 'build', '--target', target, '--bundles', 'app'],
            );
            run('node', ['scripts/rename-artifacts.mjs'], postEnv);
            run('node', ['scripts/latest-json.mjs'], postEnv);
            run('node', ['scripts/archive.mjs', 'zip-mac'], postEnv);
        } finally {
            setBlock(false);
        }

        console.log(`\n=== ${target}: DMG and updater artifacts ===`);
        run(
            'node',
            ['scripts/tauri-build.mjs', 'build', '--target', target, '--bundles', 'app,dmg'],
        );
        run('node', ['scripts/rename-artifacts.mjs'], postEnv);
        run('node', ['scripts/latest-json.mjs'], postEnv);
    }

    console.log(
        '\nDone. DMG/updater artifacts are under src-tauri/target/<target>/release/bundle;',
    );
    console.log(
        'portable zips are under src-tauri/target/<target>/release. latest.json and latest-mac.json include all built architectures.',
    );
} catch (err) {
    try {
        setBlock(false);
    } catch {
        // ignore unblock failure while already reporting the build error
    }
    console.error(err?.message || err);
    process.exit(1);
}
