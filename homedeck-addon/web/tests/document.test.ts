import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

import {
    appendItem, applyDiff, getSeq, listSpacing, minimalEdit, parseConfig, restoreUnchangedLines, setIn, stringifyConfig,
    swapItems, type Document,
} from '../src/yaml/document';

const fixture = (name: string) => readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8');

function edit(text: string, change: (doc: Document) => void): string {
    const parsed = parseConfig(text);
    if (!parsed.ok) {
        throw new Error(parsed.error);
    }
    change(parsed.doc);
    return stringifyConfig(parsed.doc, text);
}

function changedLines(before: string, after: string): string[] {
    const a = before.split('\n');
    const b = after.split('\n');
    const out: string[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
            out.push(`${a[i] ?? ''} => ${b[i] ?? ''}`);
        }
    }
    return out;
}

describe('round trip', () => {
    test('an untouched configuration comes back byte for byte, comments and alignment included', () => {
        const text = fixture('full-deck.yml');
        expect(edit(text, () => {})).toBe(text);
    });

    test('a GUI edit changes only its own line', () => {
        const text = fixture('full-deck.yml');
        const out = edit(text, doc => setIn(doc, ['pages', '$root', 'buttons', 0, 'icon'], 'mdi:lamp'));

        expect(changedLines(text, out)).toEqual(['        icon: cbi:ceiling-infuse =>         icon: mdi:lamp']);
    });

    test('hand-aligned trailing comments survive an edit elsewhere', () => {
        const text = fixture('full-deck.yml');
        const out = edit(text, doc => setIn(doc, ['brightness'], 70));

        expect(out).toContain('  sleep_timeout: 0      # never blank: this is a wall-mounted deck');
        expect(out).toContain('        icon_background_color: B36B00      # orange');
    });
});

describe('YAML 1.1 hazards', () => {
    test('a new time is quoted, so PyYAML does not read it as minutes', () => {
        const out = edit('sleep:\n  schedule: []\n', doc => setIn(doc, ['sleep', 'schedule'], [{ from: '22:00', to: '06:00', brightness: 10 }]));

        expect(out).toContain("from: '22:00'");
        expect(out).toContain("to: '06:00'");
    });

    test('a colour of digits is quoted, so it stays a string', () => {
        expect(edit('label_style:\n  color: FFFFFF\n', doc => setIn(doc, ['label_style', 'color'], '000000'))).toContain("color: '000000'");
    });

    test('an "on" state key is quoted, so it is not read as true', () => {
        const out = edit('pages:\n  $root:\n    buttons:\n      - entity_id: light.a\n', doc => {
            applyDiff(doc, ['pages', '$root', 'buttons', 0], { entity_id: 'light.a' }, { entity_id: 'light.a', states: { on: { icon_color: 'FFEC27' } } });
        });

        expect(out).toContain("'on':");
    });

    test('an unquoted on key parses as a boolean, like PyYAML', () => {
        const parsed = parseConfig('states:\n  on:\n    icon: x\n');
        expect(parsed.ok && parsed.doc.toJS().states).toEqual({ true: { icon: 'x' } });
    });
});

describe('applyDiff', () => {
    test('keeps comments on keys it does not touch', () => {
        const text = 'buttons:\n  - name: A   # the lamp\n    icon: mdi:lamp\n';
        const out = edit(text, doc => applyDiff(doc, ['buttons', 0], { name: 'A', icon: 'mdi:lamp' }, { name: 'A', icon: 'mdi:sofa' }));

        expect(out).toBe('buttons:\n  - name: A   # the lamp\n    icon: mdi:sofa\n');
    });

    test('removes keys that were cleared', () => {
        const out = edit('b:\n  name: A\n  icon: x\n', doc => applyDiff(doc, ['b'], { name: 'A', icon: 'x' }, { name: 'A' }));
        expect(out).toBe('b:\n  name: A\n');
    });

    test('keeps an empty name, which is how a label is hidden', () => {
        const out = edit('b:\n  name: A\n', doc => applyDiff(doc, ['b'], { name: 'A' }, { name: '' }));
        expect(out).toBe("b:\n  name: ''\n");
    });

    test('writes nested action changes in place', () => {
        const text = 'b:\n  tap_action:\n    action: light.toggle\n';
        const out = edit(text, doc => applyDiff(doc, ['b'], { tap_action: { action: 'light.toggle' } }, { tap_action: { action: 'switch.toggle' } }));
        expect(out).toBe('b:\n  tap_action:\n    action: switch.toggle\n');
    });
});

describe('setIn', () => {
    test('deleting the last key of a block removes the block', () => {
        expect(edit('a: 1\nb:\n  c: 2\n', doc => setIn(doc, ['b', 'c'], undefined))).toBe('a: 1\n');
    });
});

describe('restoreUnchangedLines', () => {
    test('prefers the original line when only comment spacing differs', () => {
        expect(restoreUnchangedLines('a: 1    # x\nb: 2\n', 'a: 1 # x\nb: 3\n')).toBe('a: 1    # x\nb: 3\n');
    });

    test('does not resurrect a line whose value changed', () => {
        expect(restoreUnchangedLines('a: 1    # x\n', 'a: 2 # x\n')).toBe('a: 2 # x\n');
    });
});

describe('minimalEdit', () => {
    test('replaces only the differing middle', () => {
        expect(minimalEdit('abcXYZdef', 'abc123def')).toEqual({ start: 3, end: 6, text: '123' });
    });

    test('is null when nothing changed', () => {
        expect(minimalEdit('same', 'same')).toBeNull();
    });
});

describe('parseConfig', () => {
    test('reports a syntax error with its line', () => {
        const parsed = parseConfig('a: 1\nb: [\n');
        expect(parsed.ok).toBe(false);
    });

    test('an empty file is an empty map', () => {
        const parsed = parseConfig('');
        expect(parsed.ok && parsed.doc.toJS()).toEqual({});
    });
});

describe('list entries', () => {
    const list = 'buttons:\n  - name: a\n\n  - name: b\n\n  # the third\n  - name: c\n';

    test('swapping keeps blank lines where they were', () => {
        const out = edit(list, doc => swapItems(getSeq(doc, ['buttons'])!, 0, 1));
        expect(out).toBe('buttons:\n  - name: b\n\n  - name: a\n\n  # the third\n  - name: c\n');
    });

    test('a comment above an entry moves with it', () => {
        const out = edit(list, doc => swapItems(getSeq(doc, ['buttons'])!, 0, 2));
        // c brings its comment and blank line; a takes the blank line of the slot it lands in
        expect(out).toBe('buttons:\n\n  # the third\n  - name: c\n\n  - name: b\n\n  - name: a\n');
    });

    test('a new entry is spaced like the rest of the list', () => {
        const out = edit(list, doc => {
            const seq = getSeq(doc, ['buttons'])!;
            appendItem(doc, seq, { name: 'd' }, listSpacing(seq));
        });
        expect(out.endsWith('  - name: c\n\n  - name: d\n')).toBe(true);
    });

    test('no whitespace-only lines are written', () => {
        const out = edit(list, doc => swapItems(getSeq(doc, ['buttons'])!, 0, 2));
        expect(out.split('\n').some(line => line.length > 0 && line.trim() === '')).toBe(false);
    });
});
