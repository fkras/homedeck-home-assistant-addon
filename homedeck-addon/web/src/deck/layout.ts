/**
 * Which YAML entry ends up on which key.
 *
 * A port of the paging loop in `PageElement.render_buttons` (elements.py):
 * `gone` buttons are skipped, the system buttons (back, previous, next) are
 * inserted at their positions, and anything past 13 keys spills onto further
 * sub-pages. Kept identical so a key in the editor is the key on the deck -
 * tests/layout.test.ts checks it against outputs recorded from the Python.
 */

export const BUTTON_COUNT = 13;
export const COLUMNS = 5;
export const ROWS = 3;

export type SystemAction = '$page.back' | '$page.previous' | '$page.next';

export type Slot =
    | { kind: 'button'; index: number; hidden: boolean }
    // A `null` (or other empty) entry in the YAML list
    | { kind: 'null'; index: number }
    | { kind: 'system'; action: SystemAction }
    // Nothing in the list reaches this key
    | { kind: 'empty' };

export type SystemPositions = Record<SystemAction, number>;

export type LayoutOptions = {
    isSubPage: boolean;
    positions: SystemPositions;
    // The visibility HomeDeck would compute for an entry
    visibility: (entry: unknown, index: number) => 'visible' | 'hidden' | 'gone' | 'template';
    perPage?: number;
};

export type PageLayout = {
    // One array of `perPage` slots per sub-page
    pages: Slot[][];
    // How many of those the deck can get to, through Next keys. HomeDeck
    // before the fix in a3c0080 could strand entries past the last one, and a
    // Next key at position 0 still can; they're kept in `pages` to be seen.
    reachable: number;
    // Entries the deck skips entirely (visibility: gone)
    gone: number[];
};

type Item = Exclude<Slot, { kind: 'empty' }>;

function isEmptyEntry(entry: unknown): boolean {
    // Python's `if not button`
    return entry === null || entry === undefined || entry === '' || entry === false
        || (typeof entry === 'object' && !Array.isArray(entry) && Object.keys(entry as object).length === 0);
}

function shiftRight(items: Map<number, Item>, start: number): Map<number, Item> {
    const out = new Map<number, Item>();
    for (const [key, value] of items) {
        out.set(key + (key >= start ? 1 : 0), value);
    }

    return out;
}

export function layoutPage(entries: unknown[], options: LayoutOptions): PageLayout {
    const perPage = options.perPage ?? BUTTON_COUNT;
    const gone: number[] = [];

    let raws = new Map<number, Item>();
    let skipped = 0;

    entries.forEach((entry, index) => {
        if (isEmptyEntry(entry)) {
            // Moves up past gone buttons like any other entry
            raws.set(index - skipped, { kind: 'null', index });
            return;
        }

        const visibility = options.visibility(entry, index);
        if (visibility === 'gone') {
            skipped++;
            gone.push(index);
            return;
        }

        raws.set(index - skipped, { kind: 'button', index, hidden: visibility === 'hidden' });
    });

    let current = raws;
    const insert = (item: Item, at: number) => {
        current = shiftRight(current, at);
        current.set(at, item);
    };
    // Keys the page spans so far: one past the last one used
    const extent = () => (current.size ? Math.max(...current.keys()) + 1 : 0);

    let start = 0;
    let pageNumber = 1;
    while (start < extent()) {
        if (options.isSubPage && pageNumber === 1) {
            const position = options.positions['$page.back'];
            if (position > 0) {
                insert({ kind: 'system', action: '$page.back' }, start + (position - 1));
            }
        }

        if (pageNumber > 1) {
            const position = options.positions['$page.previous'];
            if (position > 0) {
                insert({ kind: 'system', action: '$page.previous' }, start + (position - 1));
            }
        }

        // After this pass's own Back or Previous: either can push the last
        // button of a full sub-page onto the next one
        if (start + perPage < extent()) {
            insert({ kind: 'system', action: '$page.next' }, start + (options.positions['$page.next'] - 1));
        }

        start += perPage;
        pageNumber++;
    }

    const lastKey = Math.max(-1, ...current.keys());
    const pageCount = Math.max(1, pageNumber - 1, Math.ceil((lastKey + 1) / perPage));
    const pages: Slot[][] = [];
    for (let p = 0; p < pageCount; p++) {
        const slots: Slot[] = [];
        for (let i = 0; i < perPage; i++) {
            slots.push(current.get(p * perPage + i) ?? { kind: 'empty' });
        }
        pages.push(slots);
    }

    // The deck only moves to a sub-page through a Next key on the one before
    let reachable = 1;
    while (reachable < pages.length && pages[reachable - 1].some(s => s.kind === 'system' && s.action === '$page.next')) {
        reachable++;
    }

    return { pages, reachable, gone };
}

/** Grid coordinates of a key: the D200 is 5 x 3, with the small window in the last two cells. */
export function keyPosition(slot: number): { col: number; row: number } {
    return { col: slot % COLUMNS, row: Math.floor(slot / COLUMNS) };
}

const MARK = { __mark: true };

function findMark(layout: PageLayout): number {
    for (let p = 0; p < layout.pages.length; p++) {
        const slot = layout.pages[p].findIndex(s => s.kind === 'button' && s.index === -1);
        if (slot >= 0) {
            return p * BUTTON_COUNT + slot;
        }
    }

    return -1;
}

/**
 * The list that puts `entry` on the key at absolute position `target`
 * (sub-page * 13 + key), padding with nulls as needed. Null when no padding
 * can get it there - a system button occupies that key.
 */
export function placeAt(entries: unknown[], target: number, entry: unknown, options: LayoutOptions): unknown[] | null {
    const visibility = (e: unknown, i: number) => e === MARK ? 'visible' as const : options.visibility(e, i);

    for (let pad = 0; pad <= target + BUTTON_COUNT * 2; pad++) {
        const candidate = [...entries, ...Array(pad).fill(null), MARK];
        const layout = layoutPage(candidate, { ...options, visibility });
        // Re-label the mark so it can be found
        for (const page of layout.pages) {
            for (const slot of page) {
                if (slot.kind === 'button' && candidate[slot.index] === MARK) {
                    slot.index = -1;
                }
            }
        }

        const position = findMark(layout);
        if (position === target) {
            candidate[candidate.length - 1] = entry;
            return candidate;
        }

        if (position > target) {
            return null;
        }
    }

    return null;
}
