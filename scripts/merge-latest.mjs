#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const inputs = [];
let output = resolve(root, 'latest.json');

for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-o' || arg === '--output') {
        output = resolve(root, args[++i] || 'latest.json');
    } else if (arg === '-h' || arg === '--help') {
        console.log(
            'Usage: node scripts/merge-latest.mjs [latest-linux.json latest-win.json latest-mac.json] [-o latest.json]',
        );
        process.exit(0);
    } else {
        inputs.push(arg);
    }
}

if (inputs.length === 0) {
    for (const name of ['latest-linux.json', 'latest-win.json', 'latest-mac.json']) {
        const path = resolve(root, name);
        if (existsSync(path)) {
            inputs.push(name);
        }
    }
}

if (inputs.length === 0) {
    console.error('No manifests to merge. Pass latest-linux.json/latest-win.json/latest-mac.json.');
    process.exit(1);
}

let version = null;
let notes = null;
let pubDate = null;
const platforms = {};
const bundles = new Map();
let mergedFiles = 0;

for (const input of inputs) {
    const path = resolve(root, input);
    if (!existsSync(path)) {
        console.warn(`Skipping missing manifest: ${input}`);
        continue;
    }

    let data;
    try {
        data = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
        console.error(`Cannot read ${input}: ${err.message}`);
        process.exit(1);
    }

    if (typeof data.version !== 'string') {
        console.warn(`Skipping ${input}: no version.`);
        continue;
    }
    if (version === null) {
        version = data.version;
    } else if (version !== data.version) {
        console.error(
            `Version mismatch: ${input} is ${data.version}, expected ${version}.`,
        );
        process.exit(1);
    }

    if (!notes && typeof data.notes === 'string') {
        notes = data.notes;
    }
    if (
        typeof data.pub_date === 'string' &&
        (!pubDate || data.pub_date > pubDate)
    ) {
        pubDate = data.pub_date;
    }

    if (!data.platforms || typeof data.platforms !== 'object') {
        console.warn(
            `${input} has no platforms map (bundle-only manifest?); skipping for the updater.`,
        );
        continue;
    }

    if (Array.isArray(data.bundles)) {
        for (const bundle of data.bundles) {
            if (
                bundle &&
                typeof bundle.name === 'string' &&
                typeof bundle.url === 'string' &&
                typeof bundle.signature === 'string'
            ) {
                bundles.set(bundle.name, bundle);
            }
        }
    }

    for (const [platform, entry] of Object.entries(data.platforms)) {
        if (
            !entry ||
            typeof entry.url !== 'string' ||
            typeof entry.signature !== 'string'
        ) {
            console.warn(`Skipping invalid ${platform} entry in ${input}.`);
            continue;
        }
        const previous = platforms[platform];
        if (
            previous &&
            (previous.url !== entry.url || previous.signature !== entry.signature)
        ) {
            console.warn(`Replacing ${platform} entry from ${input}.`);
        }
        platforms[platform] = entry;
    }
    mergedFiles += 1;
}

if (version === null) {
    console.error('No valid update manifests found.');
    process.exit(1);
}
if (Object.keys(platforms).length === 0) {
    console.error('No platforms were merged. Rebuild the per-OS manifests with the current script.');
    process.exit(1);
}

const manifest = {
    version,
    notes:
        notes ||
        'See the full release notes: https://github.com/drlight17/ribbons-tauri/releases',
    pub_date: pubDate || new Date().toISOString(),
    platforms: Object.fromEntries(
        Object.entries(platforms).sort(([a], [b]) => a.localeCompare(b)),
    ),
};
if (bundles.size > 0) {
    manifest.bundles = [...bundles.values()].sort((a, b) =>
        `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`),
    );
}

writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
    `Merged ${Object.keys(platforms).length} platform(s) and ${bundles.size} signed bundle(s) from ${mergedFiles} manifest(s) into ${output}`,
);
