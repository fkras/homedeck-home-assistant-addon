/**
 * dist/ is committed and shipped as-is - the Home Assistant machine no longer
 * bundles the frontend. Fails when it's stale: run `bun run build` and commit
 * dist/ with the change.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { sourceHash } from '../source-hash';

const root = join(import.meta.dir, '..');
const dist = join(root, 'dist');

describe('the committed build', () => {
    test('was built from the current source', () => {
        const recorded = readFileSync(join(dist, 'source-hash.txt'), 'utf8').trim();
        expect(recorded, 'dist/ is stale - run `bun run build` and commit dist/').toBe(sourceHash(root));
    });

    test('has every file index.html loads', () => {
        const html = readFileSync(join(dist, 'index.html'), 'utf8');
        const refs = [...html.matchAll(/(?:src|href)="\.\/([^"]+)"/g)].map(m => m[1]);
        expect(refs.length).toBeGreaterThan(0);
        for (const ref of refs) {
            expect(existsSync(join(dist, ref))).toBe(true);
        }
    });
});
