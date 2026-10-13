/**
 * The configuration as a YAML document.
 *
 * The YAML text is the only source of truth: it is what the YAML editor
 * shows and what gets POSTed to the deck. The visual editor never keeps its
 * own copy - it parses the text, changes the parsed document, and writes the
 * text back. Using yaml's Document (rather than plain objects) keeps comments,
 * quoting and key order, so a GUI edit only touches the lines it changed.
 */
import { Document, isMap, isScalar, isSeq, parseDocument, YAMLMap, YAMLSeq } from 'yaml';

export type Path = (string | number)[];

// HomeDeck reads its config with PyYAML, which is YAML 1.1. Parsing as 1.1
// makes the library treat 22:00 as a number and 000000 as an integer, so it
// quotes them on output - exactly the two gotchas that cost real debugging
// time on the Python side. Under YAML 1.2 rules both would be written bare.
const PARSE_OPTIONS = { version: '1.1' as const, prettyErrors: true };

export type ParseResult =
    | { ok: true; doc: Document }
    | { ok: false; error: string; line?: number };

export function parseConfig(text: string): ParseResult {
    const doc = parseDocument(text, PARSE_OPTIONS);
    if (doc.errors.length) {
        const err = doc.errors[0];
        return { ok: false, error: err.message.split('\n')[0], line: err.linePos?.[0].line };
    }

    // An empty file parses to a null document; give it a map to edit
    if (!isMap(doc.contents)) {
        if (doc.contents === null || (isScalar(doc.contents) && doc.contents.value === null)) {
            doc.contents = doc.createNode({}) as any;
        } else {
            return { ok: false, error: 'The configuration must be a mapping (key: value pairs) at the top level' };
        }
    }

    return { ok: true, doc };
}

/** Whether block sequences are indented under their key in this text. */
function detectIndentSeq(text: string): boolean {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length - 1; i++) {
        const m = lines[i].match(/^(\s*)[^\s#-][^#]*:\s*(#.*)?$/);
        if (!m) {
            continue;
        }

        const next = lines.slice(i + 1).find(l => l.trim() && !l.trim().startsWith('#'));
        const n = next?.match(/^(\s*)- /);
        if (n) {
            return n[1].length > m[1].length;
        }
    }

    return true;
}

/**
 * Serialise a document, keeping the original text's formatting wherever the
 * content didn't change.
 */
export function stringifyConfig(doc: Document, original: string): string {
    const regenerated = doc.toString({
        lineWidth: 0,
        minContentWidth: 0,
        indentSeq: detectIndentSeq(original),
        singleQuote: true,
    })
        // A blank line before a list's first item comes out indented
        .replace(/^[ \t]+$/gm, '');

    return restoreUnchangedLines(original, regenerated);
}

// The serialiser normalises the gap before a trailing comment to one space,
// which un-aligns hand-aligned comments ("0      # never blank"). Lines that
// differ only in that gap are taken from the original text instead.
function lineKey(line: string): string {
    return line.replace(/\s+(#[^'"]*)$/, ' $1').trimEnd();
}

export function restoreUnchangedLines(original: string, regenerated: string): string {
    const a = original.split('\n');
    const b = regenerated.split('\n');
    const ka = a.map(lineKey);
    const kb = b.map(lineKey);

    // Trim the common head and tail so the LCS table stays small: a GUI edit
    // usually touches a handful of lines in the middle.
    let head = 0;
    while (head < a.length && head < b.length && ka[head] === kb[head]) {
        head++;
    }

    let tail = 0;
    while (tail < a.length - head && tail < b.length - head && ka[a.length - 1 - tail] === kb[b.length - 1 - tail]) {
        tail++;
    }

    const midA = ka.slice(head, a.length - tail);
    const midB = kb.slice(head, b.length - tail);
    const n = midA.length;
    const m = midB.length;

    // LCS over the changed middle
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
            dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
    }

    const out: string[] = a.slice(0, head);
    let i = 0;
    let j = 0;
    while (j < m) {
        if (i < n && midA[i] === midB[j]) {
            out.push(a[head + i]);
            i++;
            j++;
        } else if (i < n && dp[i + 1][j] >= dp[i][j + 1]) {
            i++;
        } else {
            out.push(b[head + j]);
            j++;
        }
    }

    out.push(...a.slice(a.length - tail));
    return out.join('\n');
}

/** The smallest single replacement that turns `before` into `after`. */
export function minimalEdit(before: string, after: string): { start: number; end: number; text: string } | null {
    if (before === after) {
        return null;
    }

    let start = 0;
    const max = Math.min(before.length, after.length);
    while (start < max && before[start] === after[start]) {
        start++;
    }

    let endBefore = before.length;
    let endAfter = after.length;
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
        endBefore--;
        endAfter--;
    }

    return { start, end: endBefore, text: after.slice(start, endAfter) };
}

function isEmptyValue(value: unknown): boolean {
    return value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

/**
 * Set a value, or delete the key when the value is empty. Deleting also
 * removes any map it leaves empty, so clearing the last override of a
 * `tap_action` doesn't leave `tap_action: {}` behind.
 */
export function setIn(doc: Document, path: Path, value: unknown) {
    if (isEmptyValue(value)) {
        deleteIn(doc, path);
        return;
    }

    const current = doc.getIn(path, true);
    if (isScalar(current) && (value === null || typeof value !== 'object')) {
        // Keep the node, its comment and its quoting style
        current.value = value;
        return;
    }

    doc.setIn(path, doc.createNode(value));
}

/** Set a value as given - an empty string stays an empty string. */
export function replaceIn(doc: Document, path: Path, value: unknown) {
    const current = doc.getIn(path, true);
    if (isScalar(current) && (value === null || typeof value !== 'object')) {
        current.value = value;
        return;
    }

    doc.setIn(path, doc.createNode(value));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true;
    }

    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
        return false;
    }

    if (Array.isArray(a) !== Array.isArray(b)) {
        return false;
    }

    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    return ka.length === kb.length && ka.every(k => deepEqual((a as any)[k], (b as any)[k]));
}

/**
 * Write `after` over the node at `path`, which currently holds `before`,
 * touching only what differs. Untouched keys keep their comments and style,
 * so editing one field of a button leaves the rest of its YAML alone.
 */
export function applyDiff(doc: Document, path: Path, before: unknown, after: unknown) {
    if (deepEqual(before, after)) {
        return;
    }

    if (after === undefined) {
        doc.deleteIn(path);
        return;
    }

    const node = doc.getIn(path, true);

    if (isPlainObject(before) && isPlainObject(after) && isMap(node)) {
        for (const key of Object.keys(before)) {
            if (!(key in after)) {
                doc.deleteIn([...path, key]);
            }
        }

        for (const [key, value] of Object.entries(after)) {
            applyDiff(doc, [...path, key], before[key], value);
        }
        return;
    }

    if (Array.isArray(before) && Array.isArray(after) && isSeq(node) && after.length >= before.length) {
        before.forEach((item, i) => applyDiff(doc, [...path, i], item, after[i]));
        for (let i = before.length; i < after.length; i++) {
            node.add(doc.createNode(after[i]));
        }
        return;
    }

    replaceIn(doc, path, after);
}

export function deleteIn(doc: Document, path: Path) {
    if (!doc.hasIn(path)) {
        return;
    }

    doc.deleteIn(path);

    // Prune parents that are now empty maps
    for (let i = path.length - 1; i > 0; i--) {
        const parentPath = path.slice(0, i);
        const parent = doc.getIn(parentPath, true);
        if (isMap(parent) && parent.items.length === 0) {
            doc.deleteIn(parentPath);
        } else {
            break;
        }
    }
}

export function getIn<T = unknown>(doc: Document, path: Path): T | undefined {
    const node = doc.getIn(path, true);
    if (node === undefined) {
        return undefined;
    }

    return (isScalar(node) ? node.value : (node as any).toJSON?.() ?? node) as T;
}

export function getSeq(doc: Document, path: Path): YAMLSeq | null {
    const node = doc.getIn(path, true);
    return isSeq(node) ? node : null;
}

export function getMap(doc: Document, path: Path): YAMLMap | null {
    const node = doc.getIn(path, true);
    return isMap(node) ? node : null;
}

/** Ensure there's a block sequence at `path`, creating it if missing. */
export function ensureSeq(doc: Document, path: Path): YAMLSeq {
    const existing = getSeq(doc, path);
    if (existing) {
        return existing;
    }

    const seq = doc.createNode([]) as YAMLSeq;
    doc.setIn(path, seq);
    return seq;
}

/** Ensure there's a map at `path`, creating it if missing. */
export function ensureMap(doc: Document, path: Path): YAMLMap {
    const existing = getMap(doc, path);
    if (existing) {
        return existing;
    }

    const map = doc.createNode({}) as YAMLMap;
    doc.setIn(path, map);
    return map;
}

/** Drop trailing nulls from a sequence - they're empty slots at the end. */
export function trimTrailingNulls(seq: YAMLSeq) {
    while (seq.items.length) {
        const last = seq.items[seq.items.length - 1];
        const value = isScalar(last) ? last.value : last;
        if (value === null || value === undefined) {
            seq.items.pop();
        } else {
            break;
        }
    }
}

/**
 * Parse a YAML fragment (e.g. one button) into a node that can be dropped into
 * the main document, keeping the fragment's own comments.
 */
export function parseFragment(text: string): { ok: true; value: unknown; node: unknown } | { ok: false; error: string } {
    const doc = parseDocument(text, PARSE_OPTIONS);
    if (doc.errors.length) {
        return { ok: false, error: doc.errors[0].message.split('\n')[0] };
    }

    return { ok: true, value: doc.toJS(), node: doc.contents };
}

/** Serialise a node of the main document on its own, e.g. for the button YAML tab. */
export function stringifyFragment(value: unknown): string {
    const doc = new Document(value, PARSE_OPTIONS);
    if (value === null || value === undefined) {
        return '';
    }

    return doc.toString({ lineWidth: 0, minContentWidth: 0, singleQuote: true });
}

export type Spaced = { spaceBefore?: boolean; commentBefore?: string | null };

/** Whether this list separates its entries with blank lines. */
export function listSpacing(seq: YAMLSeq): boolean {
    const rest = seq.items.slice(1) as Spaced[];
    return rest.length > 0 && rest.filter(n => n?.spaceBefore).length * 2 >= rest.length;
}

/**
 * Swap two entries. Blank lines are layout and stay where they were; a
 * comment above an entry describes it, so it travels with it, along with the
 * blank line above it.
 */
export function swapItems(seq: YAMLSeq, i: number, j: number) {
    const a = seq.items[i] as Spaced;
    const b = seq.items[j] as Spaced;
    const spaceAtI = a?.spaceBefore;
    const spaceAtJ = b?.spaceBefore;

    seq.items[i] = b as any;
    seq.items[j] = a as any;

    if (b && !b.commentBefore) {
        b.spaceBefore = spaceAtI;
    }
    if (a && !a.commentBefore) {
        a.spaceBefore = spaceAtJ;
    }
}

/** Add an entry to the end of a list, spaced like the rest of it. */
export function appendItem(doc: Document, seq: YAMLSeq, value: unknown, spaced: boolean) {
    const node = doc.createNode(value) as Spaced;
    if (spaced && value !== null) {
        node.spaceBefore = true;
    }
    seq.items.push(node as any);
}

export { Document, isMap, isScalar, isSeq, YAMLMap, YAMLSeq };
