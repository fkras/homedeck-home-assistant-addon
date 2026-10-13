import { useState } from 'preact/hooks';

import { BUTTON_COUNT, type Slot, type SystemAction } from '../deck/layout';
import { transformButton, type Dict } from '../deck/presets';
import { setState, toast, type State } from '../store';
import {
    addPage, changePageId, countPageLinks, deletePage, deriveModel, displayButton, duplicateButton, moveButton,
    PAGE_ID_RE, pageEntries, pageLayout, presetUsage, removeButton, renamePage, systemButton, type Model,
} from '../model';
import type { EditResult } from '../editor';
import { KeyBadge, KeyCanvas, KeyLabel, SmallWindow } from './Key';
import { Button, Callout, confirmDialog, Glyph, Menu, promptDialog, Segmented, type MenuItem } from './primitives';

const SYSTEM_LABELS: Record<SystemAction, string> = {
    '$page.back': 'Back',
    '$page.previous': 'Previous',
    '$page.next': 'Next',
};

export function report(result: EditResult, success?: string) {
    if (!result.ok) {
        toast('error', result.error);
    } else if (success) {
        toast('ok', success, 2500);
    }
    return result.ok;
}

export function showInYaml(path: (string | number)[]) {
    setState({ view: 'yaml', reveal: path, editing: null });
}

function pageTitle(page: { id: string; name: string | null }) {
    return page.name || (page.id === '$root' ? 'Home' : page.id);
}

export function DeckView({ state }: { state: State }) {
    const model = deriveModel(state.text, state.baseText);
    const pageExists = model.pages.some(p => p.id === state.pageId);
    const pageId = pageExists ? state.pageId : '$root';
    const layout = pageLayout(model, pageId, state.hass);
    const subPage = Math.min(state.subPage, layout.pages.length - 1);
    const slots = layout.pages[subPage];
    const entries = pageEntries(model, pageId);
    const readOnly = !model.parsed.ok;

    const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
    const [dragFrom, setDragFrom] = useState<number | null>(null);
    const [dropTarget, setDropTarget] = useState<number | null>(null);

    const used = entries.filter(e => e && typeof e === 'object').length;

    const openPage = (id: string) => setState({ pageId: id, subPage: 0 });

    const onDrop = (slot: Slot, position: number) => {
        const from = dragFrom;
        setDragFrom(null);
        setDropTarget(null);
        if (from === null || readOnly) {
            return;
        }
        if (slot.kind === 'button' && slot.index === from) {
            return;
        }
        if (slot.kind === 'system') {
            toast('info', 'System keys stay where they are - change their positions in Deck settings → Navigation');
            return;
        }

        const index = slot.kind === 'button' || slot.kind === 'null' ? slot.index : undefined;
        report(moveButton(model, state.hass, pageId, from, { index, position }));
    };

    const keyMenu = (slot: Slot, position: number, x: number, y: number) => {
        let items: MenuItem[];
        if (slot.kind === 'button') {
            const entry = entries[slot.index] as Dict;
            const target = entry?.tap_action?.action === '$page.go_to' ? String(entry.tap_action.data ?? '') : null;
            items = [
                { label: 'Edit…', icon: 'pencil', onSelect: () => setState({ editing: { kind: 'button', pageId, index: slot.index } }) },
                { label: 'Duplicate', icon: 'content-copy', disabled: readOnly, onSelect: () => report(duplicateButton(pageId, slot.index), 'Duplicated') },
                ...(target && model.pages.some(p => p.id === target) ? [{ label: `Open page "${target}"`, icon: 'chevron-right' as const, onSelect: () => openPage(target) }] : []),
                { label: 'Show in YAML', icon: 'code-braces', onSelect: () => showInYaml(['pages', pageId, 'buttons', slot.index]) },
                'separator',
                { label: 'Clear key (keep the gap)', icon: 'close', disabled: readOnly, onSelect: () => report(removeButton(pageId, slot.index, 'clear')) },
                { label: 'Remove (move later keys up)', icon: 'trash-can-outline', danger: true, disabled: readOnly, onSelect: () => report(removeButton(pageId, slot.index, 'shift')) },
            ];
        } else if (slot.kind === 'system') {
            items = [{ label: 'Navigation settings…', icon: 'cog', onSelect: () => setState({ settings: 'navigation' }) }];
        } else {
            items = [
                { label: 'Add a button here…', icon: 'plus', disabled: readOnly, onSelect: () => setState({ editing: { kind: 'new-button', pageId, position } }) },
                ...(slot.kind === 'null' ? [{ label: 'Remove gap (move later keys up)', icon: 'trash-can-outline' as const, disabled: readOnly, onSelect: () => report(removeButton(pageId, slot.index, 'shift')) }] : []),
            ];
        }
        setMenu({ x, y, items });
    };

    const pageMenu = (x: number, y: number) => {
        const page = model.pages.find(p => p.id === pageId)!;
        const isRoot = pageId === '$root';
        setMenu({
            x,
            y,
            items: [
                { label: 'Rename…', icon: 'pencil', disabled: readOnly, onSelect: () => renamePagePrompt(page) },
                { label: 'Change ID…', icon: 'link-variant', disabled: readOnly || isRoot, onSelect: () => changeIdPrompt(model, pageId) },
                { label: 'Show in YAML', icon: 'code-braces', onSelect: () => showInYaml(['pages', pageId]) },
                'separator',
                { label: 'Delete page…', icon: 'trash-can-outline', danger: true, disabled: readOnly || isRoot, onSelect: () => deletePagePrompt(state.text, pageId, () => openPage('$root')) },
            ],
        });
    };

    return (
        <div class="deck-view">
            <div class="page-bar" role="tablist">
                {model.pages.map(page => (
                    <button
                        key={page.id}
                        type="button"
                        role="tab"
                        aria-selected={page.id === pageId}
                        class={`page-tab ${page.id === pageId ? 'active' : ''}`}
                        onClick={() => openPage(page.id)}
                        onContextMenu={e => {
                            e.preventDefault();
                            openPage(page.id);
                            pageMenu(e.clientX, e.clientY);
                        }}
                        title={page.id}
                    >
                        {page.id === '$root' && <Glyph name="home" size={15} />}
                        <span>{pageTitle(page)}</span>
                        {page.id === pageId && (
                            <span
                                class="page-tab-menu"
                                role="button"
                                aria-label="Page options"
                                onClick={e => {
                                    e.stopPropagation();
                                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    pageMenu(r.left, r.bottom + 4);
                                }}
                            >
                                <Glyph name="dots-vertical" size={15} />
                            </span>
                        )}
                    </button>
                ))}
                <Button icon="plus" variant="ghost" small disabled={readOnly} onClick={() => addPagePrompt(model, openPage)}>Page</Button>
            </div>

            <div class="deck-toolbar">
                <div class="deck-toolbar-group">
                    {layout.pages.length > 1 && (
                        <div class="pager">
                            <Button icon="chevron-left" variant="ghost" small disabled={subPage === 0} onClick={() => setState({ subPage: subPage - 1 })} aria-label="Previous sub-page" />
                            <span>Keys {subPage * BUTTON_COUNT + 1}–{(subPage + 1) * BUTTON_COUNT} <span class="dim">· sub-page {subPage + 1} of {layout.pages.length}</span></span>
                            <Button icon="chevron-right" variant="ghost" small disabled={subPage >= layout.pages.length - 1} onClick={() => setState({ subPage: subPage + 1 })} aria-label="Next sub-page" />
                        </div>
                    )}
                    {layout.pages.length === 1 && <span class="dim">{used} {used === 1 ? 'button' : 'buttons'} on this page</span>}
                </div>
                <div class="deck-toolbar-group">
                    <span class="dim">Preview</span>
                    <Segmented
                        size="small"
                        value={state.previewState}
                        onChange={v => setState({ previewState: v })}
                        options={[
                            { value: 'live', label: 'Live', title: Object.keys(state.hass).length ? 'Entity states from Home Assistant, right now' : 'No Home Assistant states available' },
                            { value: 'on', label: 'On', title: 'Show every entity as on' },
                            { value: 'off', label: 'Off', title: 'Show every entity as off' },
                        ]}
                    />
                </div>
            </div>

            {readOnly && (
                <Callout kind="error">
                    The YAML doesn't parse, so the visual editor is read-only.{' '}
                    <a href="#" onClick={e => {
                        e.preventDefault();
                        setState({ view: 'yaml' });
                    }}>Fix it in the YAML editor</a>.
                </Callout>
            )}

            {subPage >= layout.reachable && (
                <Callout kind="warning">
                    This sub-page can't be reached on the deck: HomeDeck only adds a <b>Next</b> key when the
                    previous sub-page overflows before its own system keys are inserted. Free up a key earlier on
                    the page, or move these buttons to another page.
                </Callout>
            )}

            <div class="deck-stage">
                <div class="deck">
                    {slots.map((slot, i) => {
                        const position = subPage * BUTTON_COUNT + i;
                        return (
                            <DeckKey
                                key={i}
                                slot={slot}
                                position={position}
                                model={model}
                                state={state}
                                entries={entries}
                                dragging={dragFrom !== null}
                                dropping={dropTarget === position}
                                readOnly={readOnly}
                                onOpen={() => {
                                    if (slot.kind === 'button') {
                                        setState({ editing: { kind: 'button', pageId, index: slot.index } });
                                    } else if (slot.kind === 'system') {
                                        setState({ settings: 'navigation' });
                                    } else if (!readOnly) {
                                        setState({ editing: { kind: 'new-button', pageId, position } });
                                    }
                                }}
                                onMenu={(x, y) => keyMenu(slot, position, x, y)}
                                onDragStart={() => slot.kind === 'button' && setDragFrom(slot.index)}
                                onDragEnd={() => {
                                    setDragFrom(null);
                                    setDropTarget(null);
                                }}
                                onDragOver={() => setDropTarget(position)}
                                onDrop={() => onDrop(slot, position)}
                            />
                        );
                    })}
                    <SmallWindow onClick={() => toast('info', 'The small window is drawn by the deck\'s firmware. Tap it on the deck to cycle stats, clock and background - it can\'t be set from the configuration.', 7000)} />
                </div>
                <div class="deck-hint">Click a key to edit · drag to move · right-click for more</div>
            </div>

            {layout.gone.length > 0 && (
                <div class="tray">
                    <h3><Glyph name="eye-off-outline" size={16} /> Not on the deck <span class="dim">visibility: gone</span></h3>
                    <div class="tray-items">
                        {layout.gone.map(index => {
                            const entry = entries[index] as Dict;
                            const display = displayButton(model, entry, state.hass, state.previewState);
                            return (
                                <button key={index} type="button" class="tray-item" onClick={() => setState({ editing: { kind: 'button', pageId, index } })}>
                                    <div class="key key-mini"><KeyCanvas config={display.config} /></div>
                                    <span>{String(display.config.name ?? entry.entity_id ?? `#${index + 1}`)}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            <PresetsStrip model={model} state={state} readOnly={readOnly} />

            {menu && <Menu {...menu} onClose={() => setMenu(null)} />}
        </div>
    );
}

function DeckKey({ slot, position, model, state, entries, dragging, dropping, readOnly, onOpen, onMenu, onDragStart, onDragEnd, onDragOver, onDrop }: {
    slot: Slot;
    position: number;
    model: Model;
    state: State;
    entries: unknown[];
    dragging: boolean;
    dropping: boolean;
    readOnly: boolean;
    onOpen: () => void;
    onMenu: (x: number, y: number) => void;
    onDragStart: () => void;
    onDragEnd: () => void;
    onDragOver: () => void;
    onDrop: () => void;
}) {
    const [issues, setIssues] = useState<string[]>([]);
    const dropHandlers = {
        onDragOver: (e: DragEvent) => {
            if (!dragging || slot.kind === 'system') {
                return;
            }
            e.preventDefault();
            onDragOver();
        },
        onDrop: (e: DragEvent) => {
            e.preventDefault();
            onDrop();
        },
    };
    const common = {
        onContextMenu: (e: MouseEvent) => {
            e.preventDefault();
            onMenu(e.clientX, e.clientY);
        },
        onClick: onOpen,
        'data-key': position % BUTTON_COUNT,
    };

    if (slot.kind === 'system') {
        const display = systemButton(model, slot.action, state.hass);
        return (
            <button type="button" class="key key-system" title={`${SYSTEM_LABELS[slot.action]} - added by HomeDeck on this page`} {...common}>
                <KeyCanvas config={display.config} />
                <KeyLabel name={display.config.name} labelStyle={model.labelStyle} />
                <span class="key-badges"><KeyBadge icon="lock-outline" title="System key" /></span>
            </button>
        );
    }

    if (slot.kind !== 'button') {
        return (
            <button
                type="button"
                class={`key key-empty ${dropping ? 'drop' : ''}`}
                title={slot.kind === 'null' ? 'Empty key (null in the YAML)' : 'Empty key'}
                disabled={readOnly && !dragging}
                {...common}
                {...dropHandlers}
            >
                <Glyph name="plus" size={22} class="key-plus" />
            </button>
        );
    }

    const entry = entries[slot.index] as Dict;
    const display = displayButton(model, entry, state.hass, state.previewState);
    const entityState = display.state;
    const templatedName = display.templated.includes('name');
    const problems = [...issues, ...display.templated.filter(k => k !== 'name').map(k => `${k} is a template, evaluated on the deck`)];

    return (
        <button
            type="button"
            class={`key ${slot.hidden ? 'key-hidden' : ''} ${dropping ? 'drop' : ''}`}
            draggable={!readOnly}
            onDragStart={e => {
                e.dataTransfer?.setData('text/plain', String(slot.index));
                onDragStart();
            }}
            onDragEnd={onDragEnd}
            title={tooltip(entry, display.config, entityState)}
            {...common}
            {...dropHandlers}
        >
            <KeyCanvas config={slot.hidden ? null : display.config} onIssues={setIssues} />
            {!slot.hidden && <KeyLabel name={display.config.name} labelStyle={model.labelStyle} templated={templatedName} />}
            <span class="key-badges">
                {slot.hidden && <KeyBadge icon="eye-off-outline" title="visibility: hidden - the key shows blank" />}
                {problems.length > 0 && <KeyBadge icon="code-braces" tone="warning" title={problems.join('\n')} />}
                {entityState === 'on' && <span class="key-state-dot" title={`${entry.entity_id}: on`} />}
            </span>
        </button>
    );
}

function tooltip(entry: Dict, config: Dict, state: string | null): string {
    const lines = [String(config.name ?? entry.entity_id ?? 'Button')];
    if (entry.entity_id) {
        lines.push(`${entry.entity_id}${state ? ` · ${state}` : ''}`);
    }
    const tap = config.tap_action?.action;
    if (tap) {
        lines.push(`Tap: ${tap}${tap === '$page.go_to' ? ` → ${config.tap_action.data}` : ''}`);
    }
    const hold = config.hold_action?.action;
    if (hold) {
        lines.push(`Hold: ${hold}${hold === '$page.go_to' ? ` → ${config.hold_action.data}` : ''}`);
    }
    return lines.join('\n');
}

function PresetsStrip({ model, state, readOnly }: { model: Model; state: State; readOnly: boolean }) {
    const names = Object.keys(model.user.presets ?? {});

    return (
        <section class="presets">
            <header>
                <h3>Presets</h3>
                <span class="dim">Shared looks and actions. A button inherits everything it doesn't set itself.</span>
                <span class="spacer" />
                <Button icon="plus" variant="ghost" small disabled={readOnly} onClick={async () => {
                    const values = await promptDialog({
                        title: 'New preset',
                        confirm: 'Create',
                        fields: [{
                            key: 'name',
                            label: 'Name',
                            value: '',
                            placeholder: 'e.g. light.tile',
                            hint: 'Lowercase letters, digits, and _ - . only',
                            validate: v => !v ? 'Required' : !/^[a-z0-9_\-.]+$/.test(v) ? 'Lowercase letters, digits, _ - . only' : model.presets[v] && names.includes(v) ? 'Already exists' : null,
                        }],
                    });
                    if (values) {
                        setState({ editing: { kind: 'preset', name: values.name, isNew: true } });
                    }
                }}>Preset</Button>
            </header>
            {names.length === 0
                ? <div class="dim presets-empty">No presets of your own yet. Buttons use HomeDeck's built-in ones ($default, $light, …).</div>
                : (
                    <div class="preset-list">
                        {names.map(name => {
                            const { config } = transformButton({ presets: name }, model.presets, state.hass);
                            config.icon_size ??= [196, 196];
                            const uses = presetUsage(model, name);
                            return (
                                <button key={name} type="button" class="preset-card" onClick={() => setState({ editing: { kind: 'preset', name } })}>
                                    <div class="key key-mini"><KeyCanvas config={config} /></div>
                                    <div class="preset-meta">
                                        <span class="preset-name">{name}</span>
                                        <span class="dim">{uses ? `used ${uses}×` : 'unused'}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}
        </section>
    );
}

async function addPagePrompt(model: Model, open: (id: string) => void) {
    const values = await promptDialog({
        title: 'New page',
        confirm: 'Create page',
        fields: [
            {
                key: 'name',
                label: 'Name',
                value: '',
                placeholder: 'e.g. Bedroom',
                hint: 'Shown here in the editor',
            },
            {
                key: 'id',
                label: 'ID',
                value: '',
                placeholder: 'e.g. bedroom',
                hint: 'Used by "go to page" actions. Lowercase letters, digits, and _ - . only',
                validate: v => !v ? 'Required' : !PAGE_ID_RE.test(v) ? 'Lowercase letters, digits, _ - . only' : model.pages.some(p => p.id === v) ? 'A page with this ID exists' : null,
            },
        ],
    });

    if (values && report(addPage(values.id, values.name.trim()), `Page "${values.name || values.id}" added`)) {
        open(values.id);
    }
}

async function renamePagePrompt(page: { id: string; name: string | null }) {
    const values = await promptDialog({
        title: 'Rename page',
        confirm: 'Rename',
        fields: [{ key: 'name', label: 'Name', value: page.name ?? '', placeholder: page.id }],
    });

    if (values) {
        report(renamePage(page.id, values.name.trim()));
    }
}

async function changeIdPrompt(model: Model, pageId: string) {
    const values = await promptDialog({
        title: 'Change page ID',
        message: 'Buttons that go to this page are updated to the new ID.',
        confirm: 'Change ID',
        fields: [{
            key: 'id',
            label: 'ID',
            value: pageId,
            validate: v => !v ? 'Required' : !PAGE_ID_RE.test(v) ? 'Lowercase letters, digits, _ - . only' : v !== pageId && model.pages.some(p => p.id === v) ? 'A page with this ID exists' : null,
        }],
    });

    if (values && values.id !== pageId && report(changePageId(pageId, values.id), 'Page ID changed')) {
        setState({ pageId: values.id });
    }
}

async function deletePagePrompt(text: string, pageId: string, after: () => void) {
    const links = countPageLinks(text, pageId);
    const ok = await confirmDialog({
        title: `Delete page "${pageId}"?`,
        message: links
            ? `${links} ${links === 1 ? 'button goes' : 'buttons go'} to this page and will stop working. You can undo this.`
            : 'Its buttons are removed with it. You can undo this.',
        confirm: 'Delete page',
        danger: true,
    });

    if (ok && report(deletePage(pageId), 'Page deleted')) {
        after();
    }
}
