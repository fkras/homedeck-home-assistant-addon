/**
 * A fingerprint of everything the frontend build is made from.
 *
 * dist/ is committed, so the Home Assistant machine doesn't have to bundle
 * the editor at every update (it needs ~1 GB of RAM, and an HA box swapped
 * for 20+ minutes doing it). The build writes this fingerprint to
 * dist/source-hash.txt, and tests/dist.test.ts fails when the committed build
 * no longer matches the source - so a stale dist/ can't be released.
 */
import { createHash } from 'crypto';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const INPUTS = ['src', 'index.html', 'package.json', 'bun.lock', 'vite.config.ts', 'tsconfig.json'];

function files(root: string, path: string): string[] {
    const full = join(root, path);
    if (!statSync(full).isDirectory()) {
        return [path];
    }
    return readdirSync(full).sort().flatMap(name => files(root, join(path, name)));
}

export function sourceHash(root: string): string {
    const hash = createHash('sha256');
    for (const path of INPUTS.flatMap(input => files(root, input))) {
        hash.update(relative(root, join(root, path)).replaceAll('\\', '/'));
        hash.update('\0');
        hash.update(readFileSync(join(root, path)));
        hash.update('\0');
    }
    return hash.digest('hex');
}
