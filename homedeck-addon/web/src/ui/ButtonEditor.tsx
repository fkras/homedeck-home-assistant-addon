import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { parseIcon, PHOSPHOR_VARIANTS } from '../deck/icons';
import { BUTTON_COUNT } from '../deck/layout';
import { clone, deepMerge, domainOf, isTemplate, transformButton, type Dict, type HassStates } from '../deck/presets';
import type { HassServices } from '../api';
import { setState, type Editing, type State } from '../store';
import {
    createButtonAt, deletePreset, deriveModel, displayButton, pageEntries, presetChain, presetUsage, removeButton,
    saveButton, savePreset, type Model,
} from '../model';
import { deepEqual } from '../yaml/document';
import { report, showInYaml } from './DeckView';
import { IconPicker, IconPreview } from './IconPicker';
import { KeyCanvas, KeyLabel } from './Key';
import {
    Button, Callout, ColorInput, confirmDialog, Field, Glyph, Modal, NumberInput, PairInput, Segmented, Select, TextInput,
} from './primitives';

type Tab = 'general' | 'icon' | 'text' | 'actions' | 'states';

// HA actions that legitimately take entities of any domain
const CROSS_DOMAIN = new Set(['homeassistant', 'script', 'scene', 'automation', 'notify', 'tts', 'input_boolean']);

const COMMON_STATES = ['on', 'off', 'open', 'closed', 'locked', 'unlocked', 'playing', 'paused', 'idle', 'home', 'not_home', 'unavailable'];

function pick(source: Dict, keys: string[]): Dict {
    return Object.fromEntries(keys.filter(k => k in source).map(k => [k, source[k]]));
}

function without(source: Dict, key: string): Dict {
    const copy = { ...source };
    delete copy[key];
    return copy;
}

function originLabel(origin: string | undefined): string | null {
    if (origin === undefined || origin === '') {
        return null;
    }
    if (origin === 'entity') {
        return 'from entity';
    }
    return `from ${origin}`;
}

function show(value: unknown): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (Array.isArray(value)) {
        return value.join(' ');
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function ButtonEditor({ state, editing }: { state: State; editing: Editing }) {
    const model = deriveModel(state.text, state.baseText);
    const isPreset = editing.kind === 'preset';

    const original: Dict = useMemo(() => {
        if (editing.kind === 'preset') {
            return clone(model.user.presets?.[editing.name] ?? {});
        }
        if (editing.kind === 'button') {
            const entry = pageEntries(model, editing.pageId)[editing.index];
            return entry && typeof entry === 'object' ? clone(entry as Dict) : {};
        }
        return {};
    }, [editing]);

    const [draft, setDraft] = useState<Dict>(original);
    const [tab, setTab] = useState<Tab>('general');
    const [preview, setPreview] = useState<string>('live');
    const [issues, setIssues] = useState<string[]>([]);

    const changed = !deepEqual(draft, original);
    const close = async () => {
        if (changed && !(await confirmDialog({ title: 'Discard changes?', message: 'Your edits to this button haven\'t been applied.', confirm: 'Discard', danger: true }))) {
            return;
        }
        setState({ editing: null });
    };

    const set = (key: string, value: unknown) => {
        setDraft(d => {
            const next = { ...d };
            if (value === undefined) {
                delete next[key];
            } else {
                next[key] = value;
            }
            return next;
        });
    };

    // Presets as HomeDeck will see them, with this preset's draft in place
    const presets: Dict = useMemo(() => {
        if (!isPreset) {
            return model.presets;
        }
        const name = (editing as { name: string }).name;
        return { ...model.presets, [name]: deepMerge(clone(model.base.presets?.[name] ?? {}), clone(draft)) };
    }, [model, draft, isPreset]);

    // What each field resolves to if this button doesn't set it
    const inherited = useMemo(() => {
        if (isPreset) {
            const name = (editing as { name: string }).name;
            const chain = transformButton({ presets: draft.presets ?? [] }, model.presets, state.hass);
            const base = model.base.presets?.[name] ?? {};
            return {
                config: deepMerge(chain.config, clone(base)),
                origin: { ...chain.origin, ...Object.fromEntries(Object.keys(base).map(k => [k, `built-in ${name}`])) },
                tap: base.tap_action ?? chain.config.tap_action,
                hold: base.hold_action ?? chain.config.hold_action,
            };
        }

        const resolved = transformButton(pick(draft, ['presets', 'entity_id', 'domain', 'tap_action']), presets, state.hass);
        const hass = draft.entity_id ? state.hass[draft.entity_id] : undefined;
        if (hass?.attributes.icon && !('icon' in resolved.config)) {
            resolved.config.icon = hass.attributes.icon;
            resolved.origin.icon = 'entity';
        }
        if (hass?.attributes.friendly_name && !('name' in resolved.config)) {
            resolved.config.name = hass.attributes.friendly_name;
            resolved.origin.name = 'entity';
        }
        const forActions = transformButton(pick(draft, ['presets', 'entity_id', 'domain']), presets, state.hass);
        return { ...resolved, tap: forActions.config.tap_action, hold: forActions.config.hold_action };
    }, [draft, presets, state.hass, isPreset]);

    const display = useMemo(() => {
        const entry = isPreset ? { presets: (editing as { name: string }).name } : draft;
        return displayButton({ ...model, presets }, entry, state.hass, preview);
    }, [draft, presets, state.hass, preview]);

    const warnings = warningsFor(draft, display.config, isPreset);

    const placeholder = (key: string) => show(inherited.config[key]);
    const origin = (key: string) => originLabel(inherited.origin[key]);
    const field = (key: string) => ({
        inherited: key in draft ? null : origin(key),
        onReset: key in draft ? () => set(key, undefined) : undefined,
    });

    const empty = Object.keys(draft).length === 0;
    const apply = () => {
        let ok: boolean;
        if (editing.kind === 'preset') {
            ok = report(savePreset(editing.name, original, draft), editing.isNew ? `Preset "${editing.name}" created` : undefined);
        } else if (editing.kind === 'button') {
            ok = report(saveButton(editing.pageId, editing.index, original, draft));
        } else {
            ok = report(createButtonAt(model, state.hass, editing.pageId, editing.position, draft), 'Button added');
        }
        if (ok) {
            setState({ editing: null });
        }
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && changed && !empty) {
                e.preventDefault();
                apply();
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    const title = editing.kind === 'preset'
        ? <>Preset <code>{editing.name}</code></>
        : editing.kind === 'new-button' ? 'New button' : (show(display.config.name) || draft.entity_id || 'Button');

    const pageName = (id: string) => model.pages.find(p => p.id === id)?.name || (id === '$root' ? 'Home' : id);
    const subtitle = editing.kind === 'preset'
        ? (presetUsage(model, editing.name) ? `Used by ${presetUsage(model, editing.name)} buttons or presets - changes apply to all of them` : 'Not used yet')
        : editing.kind === 'button'
            ? `${pageName(editing.pageId)} · entry ${editing.index + 1} in the YAML list`
            : `${pageName(editing.pageId)} · key ${(editing.position % BUTTON_COUNT) + 1}${editing.position >= BUTTON_COUNT ? `, sub-page ${Math.floor(editing.position / BUTTON_COUNT) + 1}` : ''}`;

    const yamlPath = editing.kind === 'preset' ? ['presets', editing.name] : editing.kind === 'button' ? ['pages', editing.pageId, 'buttons', editing.index] : null;

    const stateKeys = [...new Set([...Object.keys(display.config.states ?? {}), ...Object.keys(inherited.config.states ?? {})])];

    return (
        <Modal
            wide
            class="button-editor"
            title={title}
            subtitle={subtitle}
            onClose={close}
            footer={(
                <>
                    {editing.kind === 'button' && (
                        <Button icon="trash-can-outline" variant="danger" onClick={() => {
                            if (report(removeButton(editing.pageId, editing.index, 'shift'), 'Button removed')) {
                                setState({ editing: null });
                            }
                        }}>Remove</Button>
                    )}
                    {editing.kind === 'preset' && !editing.isNew && (
                        <Button icon="trash-can-outline" variant="danger" onClick={async () => {
                            const uses = presetUsage(model, editing.name);
                            const ok = await confirmDialog({
                                title: `Delete preset "${editing.name}"?`,
                                message: uses ? `${uses} buttons or presets use it and will lose its styling. You can undo this.` : 'Nothing uses it.',
                                confirm: 'Delete preset',
                                danger: true,
                            });
                            if (ok && report(deletePreset(editing.name), 'Preset deleted')) {
                                setState({ editing: null });
                            }
                        }}>Delete</Button>
                    )}
                    {yamlPath && !(editing.kind === 'preset' && editing.isNew) && (
                        <Button icon="code-braces" variant="ghost" onClick={async () => {
                            if (changed && !(await confirmDialog({ title: 'Leave without applying?', message: 'Your edits to this button haven\'t been applied.', confirm: 'Discard and show YAML', danger: true }))) {
                                return;
                            }
                            showInYaml(yamlPath);
                        }}>Show in YAML</Button>
                    )}
                    <span class="spacer" />
                    <Button onClick={close}>Cancel</Button>
                    <Button variant="primary" disabled={!changed || empty} onClick={apply} title="Ctrl/⌘ + Enter">
                        {editing.kind === 'new-button' ? 'Add button' : editing.kind === 'preset' && editing.isNew ? 'Create preset' : 'Apply'}
                    </Button>
                </>
            )}
        >
            <div class="editor-layout">
                <aside class="editor-preview">
                    <div class="key key-large">
                        <KeyCanvas config={display.config} onIssues={setIssues} />
                        {!isPreset && <KeyLabel name={display.config.name} labelStyle={model.labelStyle} templated={display.templated.includes('name')} />}
                        {isPreset && <KeyLabel name={editing.kind === 'preset' ? editing.name : ''} labelStyle={model.labelStyle} />}
                    </div>

                    {(draft.entity_id || stateKeys.length > 0 || isPreset) && (
                        <div class="preview-states">
                            <span class="dim">Preview as</span>
                            <div class="chips">
                                {['live', ...new Set(['on', 'off', ...stateKeys])].map(s => (
                                    <button key={s} type="button" class={`chip ${preview === s ? 'active' : ''}`} onClick={() => setPreview(s)}>
                                        {s === 'live' ? (draft.entity_id && state.hass[draft.entity_id] ? `live: ${state.hass[draft.entity_id].state}` : 'default') : s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {!isPreset && <PresetChain model={model} draft={draft} hass={state.hass} />}

                    {[...issues, ...warnings].length > 0 && (
                        <div class="preview-issues">
                            {issues.map(i => <Callout key={i} kind="info">{i}</Callout>)}
                            {warnings.map((w, i) => <Callout key={i} kind="warning">{w}</Callout>)}
                        </div>
                    )}
                </aside>

                <div class="editor-main">
                    <div class="tabs" role="tablist">
                        {([
                            ['general', 'General', 'cursor-default-click'],
                            ['icon', 'Icon', 'palette'],
                            ['text', 'Text', 'format-text'],
                            ['actions', 'Actions', 'gesture-tap'],
                            ['states', 'States', 'swap-horizontal'],
                        ] as const).map(([id, label, icon]) => (
                            <button key={id} type="button" role="tab" aria-selected={tab === id} class={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                                <Glyph name={icon} size={16} />{label}
                                {id === 'states' && Object.keys(draft.states ?? {}).length > 0 && <span class="tab-count">{Object.keys(draft.states).length}</span>}
                            </button>
                        ))}
                    </div>

                    <div class="tab-body">
                        {tab === 'general' && (
                            <GeneralTab draft={draft} set={set} model={model} state={state} placeholder={placeholder} field={field} selfName={editing.kind === 'preset' ? editing.name : null} />
                        )}
                        {tab === 'icon' && <IconTab draft={draft} set={set} placeholder={placeholder} field={field} inheritedIcon={inherited.config.icon} inheritedVariant={inherited.config.icon_variant} />}
                        {tab === 'text' && <TextTab draft={draft} set={set} placeholder={placeholder} field={field} />}
                        {tab === 'actions' && (
                            <div class="form-grid">
                                <ActionEditor
                                    label="Tap"
                                    value={draft.tap_action}
                                    inherited={inherited.tap}
                                    inheritedFrom={origin('tap_action')}
                                    entityId={draft.entity_id ?? inherited.config.entity_id}
                                    domain={domainOf(draft) ?? domainOf(inherited.config)}
                                    model={model}
                                    services={state.services}
                                    onChange={v => set('tap_action', v)}
                                />
                                <ActionEditor
                                    label="Hold"
                                    hint="Held for half a second."
                                    value={draft.hold_action}
                                    inherited={inherited.hold}
                                    inheritedFrom={origin('hold_action')}
                                    entityId={draft.entity_id ?? inherited.config.entity_id}
                                    domain={domainOf(draft) ?? domainOf(inherited.config)}
                                    model={model}
                                    services={state.services}
                                    onChange={v => set('hold_action', v)}
                                />
                            </div>
                        )}
                        {tab === 'states' && (
                            <StatesTab draft={draft} set={set} inheritedStates={inherited.config.states ?? {}} entityId={draft.entity_id} hass={state.hass} onPreview={setPreview} />
                        )}

                        <OtherKeys draft={draft} />
                    </div>
                </div>
            </div>
        </Modal>
    );
}

type FieldHelpers = {
    placeholder: (key: string) => string | undefined;
    field: (key: string) => { inherited: string | null; onReset?: () => void };
};

type TabProps = FieldHelpers & {
    draft: Dict;
    set: (key: string, value: unknown) => void;
};

function GeneralTab({ draft, set, model, state, placeholder, field, selfName }: TabProps & { model: Model; state: State; selfName: string | null }) {
    const isPreset = selfName !== null;
    const entityId: string | undefined = draft.entity_id;
    const hass = entityId ? state.hass[entityId] : undefined;
    const haLoaded = Object.keys(state.hass).length > 0;
    // A preset can't inherit from itself
    const userPresets = Object.keys(model.presets).filter(p => p !== selfName);
    const presets: string[] = draft.presets === undefined ? [] : (Array.isArray(draft.presets) ? draft.presets : [draft.presets]);

    const setPresets = (list: string[]) => set('presets', list.length === 0 ? undefined : list.length === 1 ? list[0] : list);
    const visibility = draft.visibility;
    const visibilityValue = visibility === undefined || visibility === true || visibility === 'visible' ? 'visible'
        : visibility === false || visibility === 'hidden' || visibility === 'False' ? 'hidden'
            : visibility === null || visibility === 'gone' || visibility === 'None' ? 'gone' : 'template';

    return (
        <div class="form-grid">
            <Field label="Entity" wide {...field('entity_id')} hint={
                hass
                    ? <><b>{hass.attributes.friendly_name ?? entityId}</b> · {hass.state}{hass.attributes.unit_of_measurement ? ` ${hass.attributes.unit_of_measurement}` : ''}</>
                    : entityId && haLoaded
                        ? <span class="warn-text">Home Assistant has no entity called {entityId}</span>
                        : 'The Home Assistant entity this key shows and controls. Its state drives the "States" tab.'
            }>
                <TextInput value={entityId} mono list="ha-entities" placeholder={placeholder('entity_id') ?? 'e.g. light.kitchen'} onChange={v => set('entity_id', v.trim() || undefined)} />
            </Field>

            <Field label="Label" {...field('name')} hint={<>Drawn by the deck itself, under <i>Deck settings → Display</i>. {draft.name === '' ? 'Hidden.' : 'Leave empty to use the entity\'s name.'}</>}>
                <div class="input-row">
                    <TextInput
                        value={draft.name === '' ? '' : draft.name}
                        disabled={draft.name === ''}
                        placeholder={draft.name === '' ? '(hidden)' : placeholder('name') ?? 'No label'}
                        onChange={v => set('name', v === '' ? undefined : v)}
                    />
                    <label class="checkbox" title='Writes name: "" - no label, even if the entity has a name'>
                        <input type="checkbox" checked={draft.name === ''} onChange={e => set('name', (e.target as HTMLInputElement).checked ? '' : undefined)} />
                        Hide
                    </label>
                </div>
            </Field>

            <Field label="Visibility" hint={visibilityValue === 'template' ? <>A template: <code>{String(visibility)}</code></> : visibilityValue === 'gone' ? 'Skipped: the keys after it move up one.' : visibilityValue === 'hidden' ? 'The key stays, blank.' : undefined}>
                <Segmented
                    value={visibilityValue === 'template' ? undefined : visibilityValue}
                    onChange={v => set('visibility', v === 'visible' ? undefined : v)}
                    options={[
                        { value: 'visible', label: 'Visible' },
                        { value: 'hidden', label: 'Blank', title: 'visibility: hidden - the key shows nothing but keeps its place' },
                        { value: 'gone', label: 'Gone', title: 'visibility: gone - the key is skipped and later keys move up' },
                    ]}
                />
            </Field>

            <Field label="Presets" wide hint={presets.length === 0 && !isPreset
                ? 'None set, so HomeDeck applies $default and the entity\'s domain preset ($light, $switch, …).'
                : 'Later presets win over earlier ones; the button\'s own settings win over all of them.'}>
                <div class="preset-picker">
                    {presets.map((name, i) => (
                        <span key={name} class={`chip chip-removable ${model.presets[name] ? '' : 'chip-missing'}`} title={model.presets[name] ? undefined : 'No preset with this name'}>
                            {name}
                            {i > 0 && (
                                <button type="button" aria-label={`Move ${name} earlier`} onClick={() => {
                                    const next = [...presets];
                                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                                    setPresets(next);
                                }}>
                                    <Glyph name="chevron-left" size={14} />
                                </button>
                            )}
                            <button type="button" aria-label={`Remove ${name}`} onClick={() => setPresets(presets.filter(p => p !== name))}>
                                <Glyph name="close" size={14} />
                            </button>
                        </span>
                    ))}
                    <select class="input input-inline" value="" onChange={e => {
                        const name = (e.target as HTMLSelectElement).value;
                        if (name) {
                            setPresets([...presets, name]);
                        }
                    }}>
                        <option value="">+ Add preset</option>
                        <optgroup label="Yours">
                            {userPresets.filter(p => !p.startsWith('$') && !presets.includes(p)).map(p => <option key={p} value={p}>{p}</option>)}
                        </optgroup>
                        <optgroup label="Built-in">
                            {userPresets.filter(p => p.startsWith('$') && !presets.includes(p)).map(p => <option key={p} value={p}>{p}</option>)}
                        </optgroup>
                    </select>
                </div>
            </Field>

            <Field label="Domain" {...field('domain')} hint="Only needed when it can't be read from the entity ID.">
                <TextInput value={draft.domain} mono placeholder={placeholder('domain') ?? (entityId?.split('.')[0] || 'auto')} onChange={v => set('domain', v.trim() || undefined)} />
            </Field>
        </div>
    );
}

function IconTab({ draft, set, placeholder, field, inheritedIcon, inheritedVariant }: TabProps & { inheritedIcon: unknown; inheritedVariant: unknown }) {
    const [picking, setPicking] = useState(false);
    const icon = draft.icon ?? inheritedIcon;
    const ref = parseIcon(icon);
    const variant = draft.icon_variant ?? inheritedVariant;
    const isRaster = ref.source === 'url' || ref.source === 'local';

    return (
        <div class="form-grid">
            <Field label="Icon" wide {...field('icon')}>
                <div class="icon-field">
                    <button type="button" class="icon-field-preview" onClick={() => setPicking(p => !p)} title="Browse icons">
                        <IconPreview icon={icon} variant={ref.source === 'pi' ? String(variant ?? 'regular') : undefined} size={36} />
                    </button>
                    <TextInput
                        value={draft.icon === null ? '' : draft.icon}
                        mono
                        placeholder={placeholder('icon') ?? 'mdi:lightbulb, cbi:spotify, pi:house…'}
                        onChange={v => set('icon', v.trim() === '' ? undefined : v.trim())}
                    />
                    <Button icon="magnify" onClick={() => setPicking(p => !p)}>Browse</Button>
                </div>
                {picking && (
                    <IconPicker
                        value={draft.icon}
                        variant={String(variant ?? 'regular')}
                        onPick={name => {
                            set('icon', name);
                            setPicking(false);
                        }}
                        onClose={() => setPicking(false)}
                    />
                )}
            </Field>

            {ref.source === 'pi' && (
                <Field label="Phosphor weight" {...field('icon_variant')}>
                    <Select
                        value={draft.icon_variant}
                        placeholder={`${placeholder('icon_variant') ?? 'regular'}${draft.icon_variant ? '' : ' (inherited)'}`}
                        options={PHOSPHOR_VARIANTS.map(v => ({ value: v, label: v }))}
                        onChange={v => set('icon_variant', v)}
                    />
                </Field>
            )}

            <Field label="Icon colour" {...field('icon_color')} hint={isRaster ? 'Not applied to images.' : undefined}>
                <ColorInput allowRoles value={draft.icon_color} placeholder={placeholder('icon_color') ?? 'FFFFFF'} onChange={v => set('icon_color', v)} />
            </Field>
            <Field label="Background" {...field('icon_background_color')}>
                <ColorInput allowRoles value={draft.icon_background_color} placeholder={placeholder('icon_background_color')} onChange={v => set('icon_background_color', v)} />
            </Field>

            <Field label="Size" {...field('icon_size')} hint="In pixels; the key is 196 × 196. 0 means the full key.">
                <PairInput labels={['w', 'h']} blank="same" value={draft.icon_size} placeholder={placeholder('icon_size') ?? '196'} onChange={v => set('icon_size', v)} />
            </Field>
            <Field label="Padding" {...field('icon_padding')} hint="Space around the icon, inside the background.">
                <NumberInput value={draft.icon_padding} placeholder={placeholder('icon_padding') ?? '0'} min={0} onChange={v => set('icon_padding', v)} />
            </Field>

            <Field label="Corner radius" {...field('icon_border_radius')}>
                <NumberInput value={draft.icon_border_radius} placeholder={placeholder('icon_border_radius') ?? '0'} min={0} onChange={v => set('icon_border_radius', v)} />
            </Field>
            <Field label="Border width" {...field('icon_border_width')}>
                <NumberInput value={draft.icon_border_width} placeholder={placeholder('icon_border_width') ?? '0'} min={0} onChange={v => set('icon_border_width', v)} />
            </Field>
            <Field label="Border colour" {...field('icon_border_color')} hint="Defaults to the icon colour.">
                <ColorInput allowRoles value={draft.icon_border_color} placeholder={placeholder('icon_border_color')} onChange={v => set('icon_border_color', v)} />
            </Field>
            <Field label="Offset" {...field('icon_offset')} hint="Moves the icon; one number moves both ways.">
                <PairInput value={draft.icon_offset} placeholder={placeholder('icon_offset') ?? '0'} onChange={v => set('icon_offset', v)} />
            </Field>
            <Field label="Brightness" {...field('icon_brightness')} hint="1–100 dims the icon layer.">
                <NumberInput value={draft.icon_brightness} placeholder={placeholder('icon_brightness') ?? '100'} min={1} max={100} onChange={v => set('icon_brightness', v)} />
            </Field>
            {isRaster && (
                <Field label="Fit" {...field('icon_size_mode')}>
                    <Segmented
                        value={draft.icon_size_mode ?? undefined}
                        onChange={v => set('icon_size_mode', v)}
                        options={[{ value: 'cover', label: 'Cover' }, { value: 'contain', label: 'Contain' }, { value: 'stretch', label: 'Stretch' }]}
                    />
                </Field>
            )}
        </div>
    );
}

function TextTab({ draft, set, placeholder, field }: TabProps) {
    return (
        <div class="form-grid">
            <Callout kind="info">
                Text drawn into the key image by HomeDeck - unlike the label, it can be positioned and sized,
                and it's where readings like <code>{'{{ self_states() }}'}</code> go.
            </Callout>
            <Field label="Text" wide {...field('text')}>
                <TextInput value={draft.text} placeholder={placeholder('text') ?? 'e.g. 21.5°'} onChange={v => set('text', v === '' ? undefined : v)} />
            </Field>
            <Field label="Colour" {...field('text_color')}>
                <ColorInput allowRoles value={draft.text_color} placeholder={placeholder('text_color') ?? 'FFFFFF'} onChange={v => set('text_color', v)} />
            </Field>
            <Field label="Position" {...field('text_align')}>
                <Segmented
                    value={draft.text_align ?? undefined}
                    onChange={v => set('text_align', v)}
                    options={[{ value: 'top', label: 'Top' }, { value: 'center', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]}
                />
            </Field>
            <Field label="Size" {...field('text_size')}>
                <NumberInput value={draft.text_size} placeholder={placeholder('text_size') ?? '20'} min={1} onChange={v => set('text_size', v)} />
            </Field>
            <Field label="Font" {...field('text_font')} hint="A .ttf in HomeDeck's assets/fonts, without the extension.">
                <TextInput value={draft.text_font} placeholder={placeholder('text_font') ?? 'Roboto-SemiBold'} onChange={v => set('text_font', v.trim() || undefined)} />
            </Field>
            <Field label="Offset" {...field('text_offset')}>
                <PairInput value={draft.text_offset} placeholder={placeholder('text_offset') ?? '0'} onChange={v => set('text_offset', v)} />
            </Field>
        </div>
    );
}

type ActionMode = 'inherit' | 'none' | 'service' | 'page' | '$page.back' | '$page.previous' | '$page.next';

function actionMode(value: unknown): ActionMode {
    if (value === undefined) {
        return 'inherit';
    }
    if (value === null) {
        return 'none';
    }
    const action = (value as Dict)?.action;
    if (action === '$page.go_to') {
        return 'page';
    }
    if (action === '$page.back' || action === '$page.previous' || action === '$page.next') {
        return action;
    }
    return 'service';
}

function describeAction(value: unknown): string {
    if (value === undefined || value === null) {
        return 'nothing';
    }
    const action = (value as Dict).action;
    return action === '$page.go_to' ? `go to page "${(value as Dict).data}"` : String(action);
}

const SUGGESTED_SERVICES: Record<string, string[]> = {
    light: ['toggle', 'turn_on', 'turn_off'],
    switch: ['toggle', 'turn_on', 'turn_off'],
    fan: ['toggle', 'turn_on', 'turn_off'],
    input_boolean: ['toggle', 'turn_on', 'turn_off'],
    cover: ['toggle', 'open_cover', 'close_cover', 'stop_cover'],
    lock: ['lock', 'unlock'],
    button: ['press'],
    scene: ['turn_on'],
    script: ['turn_on', 'toggle'],
    media_player: ['media_play_pause', 'media_next_track', 'volume_mute'],
    climate: ['toggle', 'turn_on', 'turn_off'],
    vacuum: ['start', 'return_to_base'],
};

function ActionEditor({ label, hint, value, inherited, inheritedFrom, entityId, domain, model, services, onChange }: {
    label: string;
    hint?: string;
    value: unknown;
    inherited: unknown;
    inheritedFrom: string | null;
    entityId?: string;
    domain?: string;
    model: Model;
    services: HassServices;
    onChange: (value: unknown) => void;
}) {
    const mode = actionMode(value);
    const action = (value as Dict | null)?.action as string | undefined;
    const data = (value as Dict | null)?.data;
    const [dataText, setDataText] = useState(() => data === undefined ? '' : stringifyYaml(data).trim());
    const [dataError, setDataError] = useState<string | null>(null);

    useEffect(() => {
        setDataText(data === undefined ? '' : (typeof data === 'string' ? data : stringifyYaml(data).trim()));
    }, [mode]);

    const setMode = (m: ActionMode) => {
        switch (m) {
            case 'inherit':
                return onChange(undefined);
            case 'none':
                return onChange(null);
            case 'page':
                return onChange({ action: '$page.go_to', data: model.pages.find(p => p.id !== '$root')?.id ?? '$root' });
            case 'service':
                return onChange({ action: domain && SUGGESTED_SERVICES[domain] ? `${domain}.${SUGGESTED_SERVICES[domain][0]}` : '' });
            default:
                return onChange({ action: m });
        }
    };

    const serviceDomain = action?.includes('.') && !action.startsWith('$') ? action.split('.')[0] : undefined;
    const known = Object.keys(services).length > 0;
    const unknownService = known && mode === 'service' && action && !(serviceDomain && services[serviceDomain]?.[action.split('.')[1]]);
    const mismatch = mode === 'service' && entityId && domain && serviceDomain && serviceDomain !== domain && !CROSS_DOMAIN.has(serviceDomain);

    const serviceOptions = useMemo(() => {
        const all = Object.entries(services).flatMap(([d, s]) => Object.keys(s).map(name => `${d}.${name}`));
        return domain ? [...all.filter(s => s.startsWith(`${domain}.`)), ...all.filter(s => !s.startsWith(`${domain}.`))] : all;
    }, [services, domain]);

    const quick = domain ? (SUGGESTED_SERVICES[domain] ?? Object.keys(services[domain] ?? {}).slice(0, 4)) : [];
    const listId = `services-${label}`;

    return (
        <fieldset class="action-editor field-wide">
            <legend>{label}</legend>
            <Select
                value={mode}
                onChange={m => setMode(m ?? 'inherit')}
                options={[
                    { value: 'inherit', label: inherited !== undefined ? `Inherit: ${describeAction(inherited)}${inheritedFrom ? ` (${inheritedFrom})` : ''}` : 'Not set (does nothing)' },
                    { value: 'none', label: 'Do nothing' },
                    { value: 'service', label: 'Run a Home Assistant action' },
                    { value: 'page', label: 'Go to page' },
                    { value: '$page.back', label: 'Go back' },
                    { value: '$page.previous', label: 'Previous sub-page' },
                    { value: '$page.next', label: 'Next sub-page' },
                ]}
            />
            {hint && <div class="field-hint">{hint}</div>}

            {mode === 'service' && (
                <>
                    <Field label="Action" wide>
                        <TextInput value={action} mono list={listId} placeholder="domain.service, e.g. light.toggle" onChange={v => onChange({ ...(value as Dict), action: v.trim() })} />
                        <datalist id={listId}>{serviceOptions.map(s => <option key={s} value={s} />)}</datalist>
                        {quick.length > 0 && (
                            <div class="chips">
                                {quick.map(s => (
                                    <button key={s} type="button" class={`chip ${action === `${domain}.${s}` ? 'active' : ''}`} onClick={() => onChange({ ...(value as Dict), action: `${domain}.${s}` })}>
                                        {domain}.{s}
                                    </button>
                                ))}
                            </div>
                        )}
                    </Field>
                    {mismatch && (
                        <Callout kind="warning">
                            Home Assistant picks the service by the action's domain, not the entity's: <code>{action}</code> on
                            a <code>{domain}</code> entity does nothing, and reports no error. Use <code>{domain}.{action!.split('.')[1]}</code>.
                        </Callout>
                    )}
                    {unknownService && !mismatch && <Callout kind="warning">Home Assistant has no action called <code>{action}</code>.</Callout>}
                    <Field label="Data" wide hint={entityId ? <>Optional, as YAML. <code>entity_id: {entityId}</code> is added automatically.</> : 'Optional, as YAML.'}>
                        <textarea
                            class={`input mono ${dataError ? 'invalid' : ''}`}
                            rows={3}
                            value={dataText}
                            spellcheck={false}
                            placeholder={'brightness_pct: 50'}
                            onInput={e => {
                                const text = (e.target as HTMLTextAreaElement).value;
                                setDataText(text);
                                if (text.trim() === '') {
                                    setDataError(null);
                                    const { data: _, ...rest } = value as Dict;
                                    onChange(rest);
                                    return;
                                }
                                try {
                                    const parsed = parseYaml(text, { version: '1.1' });
                                    setDataError(null);
                                    onChange({ ...(value as Dict), data: parsed });
                                } catch (err) {
                                    setDataError((err as Error).message.split('\n')[0]);
                                }
                            }}
                        />
                        {dataError && <span class="field-error">{dataError}</span>}
                    </Field>
                </>
            )}

            {mode === 'page' && (
                <Field label="Page" wide>
                    <Select
                        value={String(data ?? '')}
                        onChange={v => onChange({ action: '$page.go_to', data: v })}
                        options={[
                            ...model.pages.map(p => ({ value: p.id, label: p.name ? `${p.name} (${p.id})` : p.id })),
                            ...(data && !model.pages.some(p => p.id === data) ? [{ value: String(data), label: `${data} - no such page` }] : []),
                        ]}
                    />
                    {data !== undefined && !model.pages.some(p => p.id === data) && model.base.pages?.[String(data)] === undefined && (
                        <Callout kind="warning">There's no page called <code>{String(data)}</code>.</Callout>
                    )}
                </Field>
            )}
        </fieldset>
    );
}

function StatesTab({ draft, set, inheritedStates, entityId, hass, onPreview }: {
    draft: Dict;
    set: (key: string, value: unknown) => void;
    inheritedStates: Dict;
    entityId?: string;
    hass: HassStates;
    onPreview: (state: string) => void;
}) {
    const own: Dict = draft.states ?? {};
    const [adding, setAdding] = useState('');

    const update = (next: Dict) => set('states', Object.keys(next).length ? next : undefined);
    const setStateField = (state: string, key: string, value: unknown) => {
        const entry = { ...(own[state] ?? {}) };
        if (value === undefined) {
            delete entry[key];
        } else {
            entry[key] = value;
        }
        update({ ...own, [state]: entry });
    };

    const current = entityId ? hass[entityId]?.state : undefined;
    const suggestions = [...new Set([current, ...COMMON_STATES].filter(Boolean) as string[])].filter(s => !(s in own));
    const all = [...new Set([...Object.keys(inheritedStates), ...Object.keys(own)])];

    return (
        <div class="states-tab">
            <p class="dim">
                Change how the key looks while its entity is in a given state. Only the fields you set are
                overridden; everything else comes from the button.
                {!entityId && ' This button has no entity, so these never apply.'}
            </p>

            {all.length === 0 && <div class="empty-note">No state overrides.</div>}

            {all.map(name => {
                const mine = own[name];
                const theirs = inheritedStates[name] ?? {};
                const suspicious = name === 'true' || name === 'false';
                return (
                    <div key={name} class={`state-card ${mine ? '' : 'state-card-inherited'}`}>
                        <header>
                            <span class="chip">{name}</span>
                            {!mine && <span class="dim">inherited from presets</span>}
                            {current === name && <span class="state-live">live now</span>}
                            <span class="spacer" />
                            <Button small variant="ghost" onClick={() => onPreview(name)}>Preview</Button>
                            {mine
                                ? <Button small variant="ghost" icon="trash-can-outline" onClick={() => update(without(own, name))} aria-label={`Remove ${name}`} />
                                : <Button small onClick={() => update({ ...own, [name]: {} })}>Override</Button>}
                        </header>
                        {suspicious && (
                            <Callout kind="warning">
                                A state named <code>{name}</code> usually means <code>on</code>/<code>off</code> was written
                                without quotes - YAML reads that as a boolean, so it never matches. Quote it: <code>'on':</code>.
                            </Callout>
                        )}
                        {mine && (
                            <div class="form-grid compact">
                                <Field label="Icon">
                                    <div class="icon-field">
                                        <IconPreview icon={mine.icon ?? theirs.icon ?? draft.icon} size={28} />
                                        <TextInput value={mine.icon} mono placeholder={show(theirs.icon) ?? 'unchanged'} onChange={v => setStateField(name, 'icon', v.trim() || undefined)} />
                                    </div>
                                </Field>
                                <Field label="Label">
                                    <TextInput value={mine.name} placeholder={show(theirs.name) ?? 'unchanged'} onChange={v => setStateField(name, 'name', v === '' ? undefined : v)} />
                                </Field>
                                <Field label="Icon colour">
                                    <ColorInput allowRoles value={mine.icon_color} placeholder={show(theirs.icon_color) ?? 'unchanged'} onChange={v => setStateField(name, 'icon_color', v)} />
                                </Field>
                                <Field label="Background">
                                    <ColorInput allowRoles value={mine.icon_background_color} placeholder={show(theirs.icon_background_color) ?? 'unchanged'} onChange={v => setStateField(name, 'icon_background_color', v)} />
                                </Field>
                                <Field label="Text" wide>
                                    <TextInput value={mine.text} placeholder={show(theirs.text) ?? 'unchanged'} onChange={v => setStateField(name, 'text', v === '' ? undefined : v)} />
                                </Field>
                            </div>
                        )}
                        {!mine && Object.keys(theirs).length > 0 && (
                            <div class="dim mono state-summary">{Object.entries(theirs).map(([k, v]) => `${k}: ${show(v)}`).join(' · ')}</div>
                        )}
                    </div>
                );
            })}

            <div class="add-state">
                <input
                    class="input"
                    list="state-suggestions"
                    value={adding}
                    placeholder="State, e.g. on"
                    onInput={e => setAdding((e.target as HTMLInputElement).value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && adding.trim()) {
                            update({ ...own, [adding.trim()]: own[adding.trim()] ?? {} });
                            setAdding('');
                        }
                    }}
                />
                <datalist id="state-suggestions">{suggestions.map(s => <option key={s} value={s} />)}</datalist>
                <Button icon="plus" disabled={!adding.trim()} onClick={() => {
                    update({ ...own, [adding.trim()]: own[adding.trim()] ?? {} });
                    setAdding('');
                }}>Add state</Button>
            </div>
        </div>
    );
}

function PresetChain({ model, draft, hass }: { model: Model; draft: Dict; hass: HassStates }) {
    const { names, implicit } = presetChain(model, draft, hass);
    if (!names.length) {
        return null;
    }

    return (
        <div class="preset-chain">
            <span class="dim">{implicit ? 'Inherits (implicitly)' : 'Inherits'}</span>
            <div class="chips">
                {names.map(n => (
                    <span key={n} class={`chip ${model.presets[n] ? '' : 'chip-missing'}`} title={model.presets[n] ? undefined : 'No preset with this name - ignored'}>{n}</span>
                ))}
            </div>
        </div>
    );
}

const FORM_KEYS = new Set([
    'presets', 'entity_id', 'domain', 'name', 'visibility', 'tap_action', 'hold_action', 'states',
    'icon', 'icon_variant', 'icon_size', 'icon_padding', 'icon_offset', 'icon_border_radius', 'icon_border_width',
    'icon_border_color', 'icon_brightness', 'icon_color', 'icon_background_color', 'icon_size_mode',
    'text', 'text_color', 'text_align', 'text_font', 'text_size', 'text_offset',
]);

/** Keys this form doesn't edit, which are kept as they are. */
function OtherKeys({ draft }: { draft: Dict }) {
    const others = Object.keys(draft).filter(k => !FORM_KEYS.has(k));
    if (!others.length) {
        return null;
    }

    return (
        <div class="other-keys dim">
            Also set on this button, kept as is: {others.map(k => <code key={k}>{k}</code>)} - edit those in YAML.
        </div>
    );
}

// Domains whose entities are normally pressed to do something
const ACTIONABLE = new Set(['light', 'switch', 'fan', 'cover', 'lock', 'button', 'input_boolean', 'scene', 'script', 'media_player']);

function warningsFor(draft: Dict, config: Dict, isPreset: boolean): ComponentChildren[] {
    const out: ComponentChildren[] = [];
    const presets: string[] = draft.presets === undefined ? [] : (Array.isArray(draft.presets) ? draft.presets : [draft.presets]);

    if (!isPreset && Object.keys(draft).length === 0) {
        out.push('An empty button is an empty key - set an entity, icon or label.');
    }

    if (typeof draft.icon === 'string' && /^https?:\/\//.test(draft.icon)) {
        out.push(<>The icon is a bare link, which HomeDeck draws as nothing. Write <code>url:{draft.icon}</code>.</>);
    }

    const usesLight = presets.includes('$light') || (draft.presets === undefined && domainOf(draft) === 'light');
    if (usesLight && draft.icon && !isTemplate(draft.icon)) {
        out.push(<>The <code>$light</code> preset replaces the icon with a brightness bulb while the light is on, so your icon only shows when it's off.</>);
    }

    if (draft.entity_id && config.tap_action === undefined && !isPreset && ACTIONABLE.has(domainOf(draft) ?? '')) {
        out.push('Tapping does nothing: no tap action is set here or in its presets.');
    }

    if (draft.name === null) {
        out.push(<>A <code>null</code> label fails validation - use an empty label (Hide) instead.</>);
    }

    return out;
}
