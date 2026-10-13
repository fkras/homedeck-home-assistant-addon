/**
 * The configuration as the visual editor sees it, and every change it can
 * make. Reads are derived from the YAML text; writes go through editConfig(),
 * i.e. into the YAML document.
 */
import { parse as parseYaml } from 'yaml';

import bundledBase from './deck/configuration.base.yml?raw';
import { BUTTON_COUNT, layoutPage, placeAt, type LayoutOptions, type PageLayout, type SystemAction, type SystemPositions } from './deck/layout';
import { clone, effectiveConfig, implicitPresets, resolveForDisplay, staticVisibility, type DisplayButton, type Dict, type HassStates } from './deck/presets';
import { editConfig, type EditResult } from './editor';
import {
    appendItem, applyDiff, deleteIn, ensureMap, ensureSeq, getMap, getSeq, isMap, isScalar, listSpacing, parseConfig,
    replaceIn, setIn, swapItems, trimTrailingNulls, type Document, type ParseResult, type Path, type Spaced,
} from './yaml/document';

export const BUNDLED_BASE = bundledBase;

export type PageInfo = { id: string; name: string | null };

export type Model = {
    parsed: ParseResult;
    user: Dict;
    base: Dict;
    effective: Dict;
    pages: PageInfo[];
    presets: Dict;
    positions: SystemPositions;
    labelStyle: Dict;
};

let cache: { text: string; baseText: string; model: Model } | null = null;

function parseBase(baseText: string): Dict {
    try {
        return (parseYaml(baseText || BUNDLED_BASE, { version: '1.1' }) as Dict) ?? {};
    } catch {
        return parseYaml(BUNDLED_BASE, { version: '1.1' }) as Dict;
    }
}

export function deriveModel(text: string, baseText: string): Model {
    if (cache && cache.text === text && cache.baseText === baseText) {
        return cache.model;
    }

    const parsed = parseConfig(text);
    const user: Dict = parsed.ok ? (parsed.doc.toJS() ?? {}) : (cache?.model.user ?? {});
    const base = cache && cache.baseText === baseText ? cache.model.base : parseBase(baseText);
    const effective = effectiveConfig(base, user);

    const userPages = user.pages && typeof user.pages === 'object' ? Object.keys(user.pages) : [];
    const ids = ['$root', ...userPages.filter(id => id !== '$root')];
    const pages = ids.map(id => ({ id, name: user.pages?.[id]?.name != null ? String(user.pages[id].name) : null }));

    const system = effective.system_buttons ?? {};
    const positions: SystemPositions = {
        '$page.back': Number(system['$page.back']?.position ?? 0),
        '$page.previous': Number(system['$page.previous']?.position ?? 0),
        '$page.next': Number(system['$page.next']?.position ?? 0),
    };

    const model: Model = {
        parsed,
        user,
        base,
        effective,
        pages,
        presets: effective.presets ?? {},
        positions,
        labelStyle: effective.label_style ?? {},
    };

    cache = { text, baseText, model };
    return model;
}

export function pageEntries(model: Model, pageId: string): unknown[] {
    const buttons = model.user.pages?.[pageId]?.buttons;
    return Array.isArray(buttons) ? buttons : [];
}

export function layoutOptions(model: Model, pageId: string, hass: HassStates): LayoutOptions {
    return {
        isSubPage: pageId !== '$root',
        positions: model.positions,
        visibility: entry => staticVisibility(entry as Dict, model.presets, hass),
    };
}

export function pageLayout(model: Model, pageId: string, hass: HassStates): PageLayout {
    return layoutPage(pageEntries(model, pageId), layoutOptions(model, pageId, hass));
}

/** `preview` is 'live' for the entity's real state, or a state to show it in. */
export function displayButton(model: Pick<Model, 'presets'>, entry: Dict, hass: HassStates, preview: string): DisplayButton {
    const display = resolveForDisplay(entry, model.presets, { states: hass, previewState: preview === 'live' ? null : preview });
    // transform()'s device defaults
    display.config.icon_size ??= [196, 196];
    return display;
}

export function systemButton(model: Model, action: SystemAction, hass: HassStates): DisplayButton {
    const button = model.effective.system_buttons?.[action]?.button ?? {};
    return displayButton(model, button, hass, 'live');
}

/**
 * The presets a button resolves through, in priority order - its own, or the
 * implicit $default/$domain ones when it names none.
 */
export function presetChain(model: Model, entry: Dict, hass: HassStates): { names: string[]; implicit: boolean } {
    const implicit = !('presets' in entry);
    const own = implicit ? implicitPresets(entry, hass) : entry.presets;
    const queue: string[] = (Array.isArray(own) ? own : [own]).filter(Boolean).map(String).reverse();

    const names: string[] = [];
    while (queue.length) {
        const name = queue.shift()!;
        if (names.includes(name)) {
            continue;
        }

        names.push(name);
        const inner = model.presets[name]?.presets;
        if (inner) {
            queue.push(...(Array.isArray(inner) ? inner : [inner]).map(String).reverse());
        }
    }

    return { names, implicit };
}

// ---------------------------------------------------------------- writes ----

const buttonsPath = (pageId: string): Path => ['pages', pageId, 'buttons'];

export function saveButton(pageId: string, index: number, before: Dict, after: Dict): EditResult {
    return editConfig(doc => applyDiff(doc, [...buttonsPath(pageId), index], before, after));
}

/** Put a new button on the empty key at `position` (sub-page * 13 + key). */
export function createButtonAt(model: Model, hass: HassStates, pageId: string, position: number, value: Dict): EditResult {
    const entries = pageEntries(model, pageId);
    const options = layoutOptions(model, pageId, hass);
    const layout = layoutPage(entries, options);
    const slot = layout.pages[Math.floor(position / BUTTON_COUNT)]?.[position % BUTTON_COUNT];

    return editConfig(doc => {
        ensurePage(doc, pageId);
        const seq = ensureSeq(doc, buttonsPath(pageId));

        if (slot?.kind === 'null') {
            seq.set(slot.index, doc.createNode(value));
            return;
        }

        const placed = placeAt(entries, position, value, options);
        if (!placed) {
            throw new Error('A system button sits on that key');
        }

        const spaced = listSpacing(seq);
        for (let i = entries.length; i < placed.length; i++) {
            appendItem(doc, seq, placed[i], spaced);
        }
    });
}

function ensurePage(doc: Document, pageId: string) {
    const page = ensureMap(doc, ['pages', pageId]);
    if (!page.has('buttons')) {
        page.set('buttons', doc.createNode([]));
    }
}

/** Swap two keys, or move one onto an empty key. */
export function moveButton(model: Model, hass: HassStates, pageId: string, fromIndex: number, to: { index?: number; position: number }): EditResult {
    const entries = pageEntries(model, pageId);
    const options = layoutOptions(model, pageId, hass);

    return editConfig(doc => {
        const seq = getSeq(doc, buttonsPath(pageId));
        if (!seq) {
            return;
        }

        if (to.index !== undefined) {
            swapItems(seq, fromIndex, to.index);
        } else {
            const node = seq.items[fromIndex] as Spaced;
            const without = [...entries];
            without[fromIndex] = null;

            const placed = placeAt(without, to.position, entries[fromIndex], options);
            if (!placed) {
                throw new Error('A system button sits on that key');
            }

            // The gap it leaves keeps the spacing of where it was
            const gap = doc.createNode(null) as Spaced;
            gap.spaceBefore = node.spaceBefore;
            seq.items[fromIndex] = gap as any;

            const spaced = listSpacing(seq);
            for (let i = entries.length; i < placed.length - 1; i++) {
                appendItem(doc, seq, null, spaced);
            }
            if (!node.commentBefore) {
                node.spaceBefore = spaced;
            }
            seq.items.push(node as any);
        }

        trimTrailingNulls(seq);
    });
}

/** `shift` closes the gap; `clear` leaves an empty key where it was. */
export function removeButton(pageId: string, index: number, mode: 'shift' | 'clear'): EditResult {
    return editConfig(doc => {
        const seq = getSeq(doc, buttonsPath(pageId));
        if (!seq) {
            return;
        }

        if (mode === 'shift') {
            seq.items.splice(index, 1);
        } else {
            seq.items[index] = doc.createNode(null) as any;
        }

        trimTrailingNulls(seq);
    });
}

export type CopyResult = EditResult & { index?: number; position?: number };

/** The first free key on a page, at or after `from` (sub-page * 13 + key). */
function freeKey(layout: PageLayout, from: number): { position: number; nullIndex?: number } | null {
    for (let p = 0; p < layout.reachable; p++) {
        for (let k = 0; k < BUTTON_COUNT; k++) {
            const position = p * BUTTON_COUNT + k;
            const slot = layout.pages[p][k];
            if (position < from) {
                continue;
            }
            if (slot.kind === 'null') {
                return { position, nullIndex: slot.index };
            }
            if (slot.kind === 'empty') {
                return { position };
            }
        }
    }

    return null;
}

/**
 * Copy a button into the next free key - on its own page after the original,
 * or on another page - so nothing else moves. With no free key the copy goes
 * right after the original on its page, or at the end of another page.
 */
export function copyButton(model: Model, hass: HassStates, pageId: string, index: number, targetPageId = pageId, at?: number): CopyResult {
    const entries = pageEntries(model, pageId);
    const value = entries[index];
    if (!value || typeof value !== 'object') {
        return { ok: false, error: 'Nothing to copy' };
    }

    const targetEntries = pageEntries(model, targetPageId);
    const options = layoutOptions(model, targetPageId, hass);
    const layout = layoutPage(targetEntries, options);

    let from = 0;
    if (at !== undefined) {
        from = at;
    } else if (targetPageId === pageId) {
        layout.pages.forEach((slots, p) => slots.forEach((slot, k) => {
            if (slot.kind === 'button' && slot.index === index) {
                from = p * BUTTON_COUNT + k + 1;
            }
        }));
    }

    const free = freeKey(layout, from);
    if (at !== undefined && free?.position !== at) {
        return { ok: false, error: 'Drop the copy on an empty key' };
    }

    let placedIndex: number | undefined;
    let placedPosition = free?.position;
    let placed: unknown[] | null = null;
    if (free && free.nullIndex === undefined) {
        placed = placeAt(targetEntries, free.position, value, options);
    }

    const result = editConfig(doc => {
        ensurePage(doc, targetPageId);
        const source = getSeq(doc, buttonsPath(pageId))!;
        const seq = getSeq(doc, buttonsPath(targetPageId))!;
        const node = source.items[index] as any;
        const copy = node.clone ? node.clone() : doc.createNode(node);
        // The copy shouldn't repeat a comment that labels the original
        copy.commentBefore = undefined;
        copy.spaceBefore = listSpacing(seq);

        if (free?.nullIndex !== undefined) {
            const gap = seq.items[free.nullIndex] as Spaced;
            copy.spaceBefore = gap?.spaceBefore ?? copy.spaceBefore;
            seq.items[free.nullIndex] = copy;
            placedIndex = free.nullIndex;
        } else if (placed) {
            const spaced = listSpacing(seq);
            for (let i = targetEntries.length; i < placed.length - 1; i++) {
                appendItem(doc, seq, null, spaced);
            }
            seq.items.push(copy);
            placedIndex = seq.items.length - 1;
        } else if (targetPageId === pageId) {
            seq.items.splice(index + 1, 0, copy);
            placedIndex = index + 1;
            placedPosition = undefined;
        } else {
            seq.items.push(copy);
            placedIndex = seq.items.length - 1;
            placedPosition = undefined;
        }
    });

    return result.ok ? { ...result, index: placedIndex, position: placedPosition } : result;
}

export const PAGE_ID_RE = /^[$a-z0-9_\-.]+$/;

export function addPage(id: string, name: string): EditResult {
    return editConfig(doc => {
        const page: Dict = {};
        if (name) {
            page.name = name;
        }
        page.buttons = [];
        ensureMap(doc, ['pages']);
        doc.setIn(['pages', id], doc.createNode(page));
    });
}

export function renamePage(id: string, name: string): EditResult {
    return editConfig(doc => {
        ensurePage(doc, id);
        if (name) {
            replaceIn(doc, ['pages', id, 'name'], name);
        } else {
            doc.deleteIn(['pages', id, 'name']);
        }
    });
}

/** Every `$page.go_to` action, anywhere, that targets `pageId`. */
function goToPaths(doc: Document, pageId: string): Path[] {
    const found: Path[] = [];
    const visit = (node: unknown, path: Path) => {
        if (isMap(node)) {
            const action = node.get('action');
            const data = node.get('data');
            if (action === '$page.go_to' && data === pageId) {
                found.push([...path, 'data']);
            }
            for (const pair of node.items) {
                const key = isScalar(pair.key) ? pair.key.value : pair.key;
                visit(pair.value, [...path, key as string]);
            }
        } else if (node && typeof node === 'object' && 'items' in (node as any)) {
            (node as any).items.forEach((item: unknown, i: number) => visit(item, [...path, i]));
        }
    };

    visit(doc.contents, []);
    return found;
}

export function countPageLinks(text: string, pageId: string): number {
    const parsed = parseConfig(text);
    return parsed.ok ? goToPaths(parsed.doc, pageId).length : 0;
}

/** Rename a page's id, and repoint every button that goes to it. */
export function changePageId(oldId: string, newId: string): EditResult {
    return editConfig(doc => {
        const pages = getMap(doc, ['pages']);
        const pair = pages?.items.find(p => (isScalar(p.key) ? p.key.value : p.key) === oldId);
        if (!pair) {
            return;
        }

        for (const path of goToPaths(doc, oldId)) {
            replaceIn(doc, path, newId);
        }

        pair.key = doc.createNode(newId) as any;
    });
}

export function deletePage(id: string): EditResult {
    return editConfig(doc => doc.deleteIn(['pages', id]));
}

export function savePreset(name: string, before: Dict, after: Dict): EditResult {
    return editConfig(doc => {
        if (!doc.hasIn(['presets', name])) {
            ensureMap(doc, ['presets']);
            doc.setIn(['presets', name], doc.createNode(after));
            return;
        }

        applyDiff(doc, ['presets', name], before, after);
    });
}

export function deletePreset(name: string): EditResult {
    return editConfig(doc => deleteIn(doc, ['presets', name]));
}

/** How many buttons and presets name `preset` in their `presets`. */
export function presetUsage(model: Model, preset: string): number {
    let count = 0;
    const uses = (entry: unknown) => {
        const list = (entry as Dict)?.presets;
        return list === preset || (Array.isArray(list) && list.includes(preset));
    };

    for (const page of Object.values<Dict>(model.user.pages ?? {})) {
        count += (page?.buttons ?? []).filter(uses).length;
    }
    count += Object.values(model.user.presets ?? {}).filter(uses).length;
    return count;
}

// Keys the schema requires whenever their parent block is present. HomeDeck
// merges the user's file onto its defaults, so it would cope without them, but
// the editor validates the file alone and would refuse to save.
const REQUIRED: Record<string, string[]> = {
    sleep: ['dim_brightness', 'dim_timeout', 'sleep_timeout'],
    label_style: ['align', 'color', 'font', 'show_title', 'size', 'weight'],
};

// New deck-wide settings go above these, rather than after a long pages block
const TRAILING_BLOCKS = ['system_buttons', 'presets', 'pages'];

function ensureTopLevelKey(doc: Document, key: string, value: unknown) {
    const root = doc.contents;
    if (!isMap(root) || root.has(key)) {
        return;
    }

    const at = root.items.findIndex(pair => TRAILING_BLOCKS.includes(String(isScalar(pair.key) ? pair.key.value : pair.key)));
    const pair = doc.createPair(key, value);
    if (at === -1) {
        root.items.push(pair as any);
    } else {
        root.items.splice(at, 0, pair as any);
    }
}

/** Set (or with `undefined`, reset) a deck-wide setting. */
export function setSetting(model: Model, path: Path, value: unknown): EditResult {
    return editConfig(doc => {
        const block = String(path[0]);
        const required = REQUIRED[block];

        if (value !== undefined && !doc.has(block)) {
            ensureTopLevelKey(doc, block, path.length === 1 ? value : {});
            if (path.length === 1) {
                return;
            }
        }

        if (required && path.length > 1 && required.includes(String(path[1])) && value === undefined) {
            // Resetting a required key means its default, not its absence
            value = clone(model.base[block]?.[path[1]]);
        }

        if (required && path.length > 1) {
            for (const key of required) {
                if (!doc.hasIn([block, key])) {
                    replaceIn(doc, [block, key], clone(model.effective[block]?.[key]));
                }
            }
        }

        if (Array.isArray(value)) {
            const before = (doc.getIn(path) as any)?.toJSON?.() ?? undefined;
            if (Array.isArray(before) && value.length) {
                applyDiff(doc, path, before, value);
                const seq = getSeq(doc, path);
                while (seq && seq.items.length > value.length) {
                    seq.items.pop();
                }
                return;
            }
            if (!value.length) {
                if (doc.hasIn(path)) {
                    doc.setIn(path, doc.createNode([]));
                }
                return;
            }
        }

        setIn(doc, path, value);
    });
}
