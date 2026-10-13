/**
 * The layout port against outputs recorded from HomeDeck's own
 * PageElement.render_buttons. A randomised run of 400 pages x 7 sub-pages
 * matched it exactly; these are the shapes worth keeping.
 */
import { describe, expect, test } from 'bun:test';

import { layoutPage, placeAt, type LayoutOptions, type Slot } from '../src/deck/layout';

const positions = { '$page.back': 1, '$page.previous': 2, '$page.next': 3 };

const options = (isSubPage: boolean): LayoutOptions => ({
    isSubPage,
    positions,
    visibility: (e: any) => e?.visibility ?? 'visible',
});

const buttons = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `b${i}` }));

function names(slots: Slot[], entries: any[]): string[] {
    return slots.map(s => s.kind === 'empty' ? '-' : s.kind === 'null' ? 'null' : s.kind === 'system' ? s.action.slice(6) : entries[s.index].name);
}

describe('layoutPage', () => {
    test('the root page has no back key', () => {
        const entries = buttons(3);
        const { pages } = layoutPage(entries, options(false));
        expect(names(pages[0], entries).slice(0, 4)).toEqual(['b0', 'b1', 'b2', '-']);
    });

    test('a sub-page gets back at position 1 and the buttons move along', () => {
        const entries = buttons(3);
        const { pages } = layoutPage(entries, options(true));
        expect(names(pages[0], entries).slice(0, 5)).toEqual(['back', 'b0', 'b1', 'b2', '-']);
    });

    test('overflow adds next, then previous on the following sub-page', () => {
        const entries = buttons(20);
        const { pages, reachable } = layoutPage(entries, options(false));

        expect(pages.length).toBe(2);
        expect(reachable).toBe(2);
        expect(names(pages[0], entries)).toEqual(['b0', 'b1', 'next', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10', 'b11']);
        expect(names(pages[1], entries).slice(0, 4)).toEqual(['b12', 'previous', 'b13', 'b14']);
    });

    test('gone buttons are skipped and listed', () => {
        const entries = [{ name: 'a' }, { name: 'b', visibility: 'gone' }, { name: 'c' }];
        const { pages, gone } = layoutPage(entries, options(false));
        expect(names(pages[0], entries).slice(0, 3)).toEqual(['a', 'c', '-']);
        expect(gone).toEqual([1]);
    });

    test('hidden buttons keep their key', () => {
        const entries = [{ name: 'a', visibility: 'hidden' }, { name: 'b' }];
        const { pages } = layoutPage(entries, options(false));
        expect(pages[0][0]).toEqual({ kind: 'button', index: 0, hidden: true });
    });

    test("a null placed after a gone button keeps its original index, as in Python", () => {
        // Python: new_raws[index] = None uses the raw index, then the next
        // button lands on real_index - the same key - and replaces it
        const entries = [{ name: 'a', visibility: 'gone' }, null, { name: 'c' }];
        const { pages } = layoutPage(entries, options(false));
        expect(names(pages[0], entries).slice(0, 3)).toEqual(['-', 'c', '-']);
    });

    test('a sub-page with exactly 13 buttons strands the last one', () => {
        // Back pushes b12 onto a second sub-page, but Next is decided from the
        // count before Back was inserted - so nothing leads there
        const entries = buttons(13);
        const { pages, reachable } = layoutPage(entries, options(true));
        expect(pages.length).toBe(2);
        expect(reachable).toBe(1);
        expect(names(pages[0], entries)).not.toContain('next');
        expect(names(pages[1], entries)[0]).toBe('b12');
    });
});

describe('placeAt', () => {
    test('pads with nulls to reach an empty key', () => {
        expect(placeAt([{ name: 'a' }], 4, { name: 'x' }, options(false))).toEqual([{ name: 'a' }, null, null, null, { name: 'x' }]);
    });

    test('accounts for the back key on a sub-page', () => {
        // Key 3 on a sub-page: back takes key 0, so the entry is list index 2
        expect(placeAt([{ name: 'a' }], 3, { name: 'x' }, options(true))).toEqual([{ name: 'a' }, null, { name: 'x' }]);
    });

    test('refuses the key a system button takes', () => {
        expect(placeAt([], 0, { name: 'x' }, options(true))).toBeNull();
    });
});
