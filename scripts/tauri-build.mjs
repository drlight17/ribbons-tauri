#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const isLinux = process.platform === 'linux';
const isWindows = process.platform === 'win32';
const localTauri = join(
    root,
    'node_modules',
    '.bin',
    isWindows ? 'tauri.cmd' : 'tauri',
);
const tauri = existsSync(localTauri) ? localTauri : 'tauri';

let useFakeroot = false;
if (isLinux) {
    useFakeroot =
        spawnSync('fakeroot', ['--version'], { stdio: 'ignore' }).status === 0;
    if (!useFakeroot) {
        console.warn(
            'Warning: fakeroot not found. A .deb built with large UID/GID values may be corrupt.',
        );
    }
}

const command = useFakeroot ? 'fakeroot' : tauri;
const commandArgs = useFakeroot ? [tauri, ...args] : args;
const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    shell: isWindows && !useFakeroot,
});

if (result.error) {
    console.error(result.error.message);
    process.exit(1);
}
process.exit(result.status ?? 1);
