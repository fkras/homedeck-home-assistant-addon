/**
 * How HomeDeck turns a button from the YAML into what it draws.
 *
 * A port of `deep_merge`/`apply_presets` (utils.py), `PageButtonConfig.transform`
 * (dataclasses.py) and the entity-state handling in `PageElement.render_buttons`
 * (elements.py). It must stay behaviour-for-behaviour identical, quirks
 * included, or the preview shows something the deck doesn't.
 */

export type Dict = Record<string, any>;

export type HassState = {
    entity_id: string;
    state: string;
    attributes: Dict;
};

export type HassStates = Record<string, HassState>;

function isPlainObject(value: unknown): value is Dict {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function clone<T>(value: T): T {
    return value === undefined ? value : structuredClone(value);
}

/** utils.deep_merge: mutates and returns `base`. */
export function deepMerge(base: Dict, override: Dict, allowNone = false): Dict {
    for (const [key, value] of Object.entries(override)) {
        if (!(key in base)) {
            base[key] = value;
        } else if (isPlainObject(base[key]) && isPlainObject(value)) {
            base[key] = deepMerge(base[key], value);
        } else if (allowNone || (value !== null && value !== undefined)) {
            base[key] = value;
        }
    }

    return base;
}

/** The full configuration HomeDeck runs with: its base file with the user's on top. */
export function effectiveConfig(base: Dict, user: Dict): Dict {
    return deepMerge(clone(base), clone(isPlainObject(user) ? user : {}));
}

export type Resolved = {
    config: Dict;
    // Where each top-level key came from: '' for the button itself, else the preset
    origin: Record<string, string>;
};

/** utils.apply_presets, also recording which preset supplied each key. */
export function applyPresets(source: Dict, presets: Dict): Resolved {
    const origin: Record<string, string> = {};
    for (const key of Object.keys(source)) {
        if (key !== 'presets') {
            origin[key] = '';
        }
    }

    const applied = new Set<string>();
    let output = source;

    while (true) {
        let presetList = output.presets ?? [];
        delete output.presets;
        if (!presetList || (Array.isArray(presetList) && !presetList.length)) {
            break;
        }

        if (!Array.isArray(presetList)) {
            presetList = [presetList];
        }

        const merged: Dict = {};
        const mergedOrigin: Record<string, string> = {};
        for (const name of [...presetList].reverse()) {
            if (applied.has(name)) {
                continue;
            }

            applied.add(name);

            const data = presets?.[name];
            if (!data || !isPlainObject(data) || !Object.keys(data).length) {
                continue;
            }

            for (const [key, value] of Object.entries(clone(data))) {
                if (!(key in merged)) {
                    merged[key] = value;
                    mergedOrigin[key] = name;
                } else if (isPlainObject(value)) {
                    merged[key] = deepMerge(merged[key], value);
                }
            }
        }

        for (const [key, name] of Object.entries(mergedOrigin)) {
            if (!(key in origin) && key !== 'presets') {
                origin[key] = name;
            }
        }

        output = deepMerge(merged, output, true);
    }

    return { config: output, origin };
}

export function domainOf(button: Dict): string | undefined {
    const entityId: unknown = button.entity_id;
    return button.domain || (typeof entityId === 'string' && entityId.includes('.') ? entityId.split('.')[0] : undefined);
}

/**
 * The presets HomeDeck adds to a button that names none:
 * `$default` (or `$page.go_to`), `$<domain>` and `$<domain>.<device_class>`.
 */
export function implicitPresets(button: Dict, states: HassStates): string[] {
    let defaultStyle = '$default';
    if (button.tap_action?.action === '$page.go_to') {
        defaultStyle = '$page.go_to';
    }

    const list = [defaultStyle];
    const domain = domainOf(button);
    if (domain) {
        list.push(`$${domain}`);

        const entityId = button.entity_id;
        if (entityId && (domain === 'binary_sensor' || domain === 'sensor')) {
            const deviceClass = states[entityId]?.attributes?.device_class;
            if (deviceClass) {
                list.push(`$${domain}.${deviceClass}`);
            }
        }
    }

    return list;
}

/** PageButtonConfig.transform, minus the device-size defaults. */
export function transformButton(button: Dict, presets: Dict, states: HassStates): Resolved {
    const source = clone(button);

    if (presets && Object.keys(presets).length && !('presets' in source)) {
        source.presets = implicitPresets(source, states);
        const domain = domainOf(source);
        if (source.entity_id && !source.domain && domain) {
            source.domain = domain;
        }
    }

    let resolved: Resolved;
    if ('presets' in source) {
        resolved = applyPresets(source, presets);
    } else {
        const origin: Record<string, string> = {};
        for (const key of Object.keys(source)) {
            origin[key] = '';
        }
        resolved = { config: source, origin };
    }

    // State overrides may name presets of their own; those get no implicit ones
    const overrides = resolved.config.states;
    if (isPlainObject(overrides)) {
        for (const [state, override] of Object.entries(overrides)) {
            if (isPlainObject(override) && 'presets' in override) {
                overrides[state] = applyPresets(override, presets).config;
            }
        }
    }

    if ('name' in resolved.config && resolved.config.name !== null && resolved.config.name !== undefined) {
        resolved.config.name = String(resolved.config.name);
    }

    return resolved;
}

export const TEMPLATE_RE = /({{.*?}}|{%.*?%})/s;

export function isTemplate(value: unknown): boolean {
    return typeof value === 'string' && TEMPLATE_RE.test(value);
}

/**
 * Evaluate the few template shapes that are common enough to be worth
 * previewing - `self_binary_text('On', 'Off')`, `self_states()` and
 * `'On' if self_states() == 'on' else 'Off'` - against the entity's state.
 * Anything else is left for the deck to render.
 */
export function evaluateSimpleTemplate(value: string, entityId: string | undefined, state: string | null, states: HassStates): string | undefined {
    const binary = value.match(/^\s*{{\s*(self_)?binary_text\(\s*(?:'([^']+)'\s*,\s*)?'([^']*)'\s*,\s*'([^']*)'\s*\)\s*}}\s*$/);
    if (binary) {
        const [, self, otherEntity, onText, offText] = binary;
        const target = self ? state : (otherEntity ? states[otherEntity]?.state : undefined);
        if (target === undefined || target === null || (self && !entityId)) {
            return undefined;
        }

        return target === 'on' ? onText : offText;
    }

    if (/^\s*{{\s*self_states\(\)\s*}}\s*$/.test(value) && state !== null) {
        return state;
    }

    // $light's name: "{{ 'On' if self_states() == 'on' else 'Off' }}"
    const conditional = value.match(/^\s*{{\s*'([^']*)'\s+if\s+self_states\(\)\s*==\s*'([^']*)'\s+else\s+'([^']*)'\s*}}\s*$/);
    if (conditional && state !== null) {
        return state === conditional[2] ? conditional[1] : conditional[3];
    }

    return undefined;
}

export type DisplayOptions = {
    states: HassStates;
    // Show the button as if its entity were in this state, rather than live
    previewState?: string | null;
};

export type DisplayButton = Resolved & {
    // The entity state the preview used, if any
    state: string | null;
    // Values that are Jinja templates can't be evaluated here
    templated: string[];
};

/**
 * What a button looks like on the deck: presets applied, then the entity's
 * state override and its Home Assistant icon and name filled in, as
 * render_buttons does.
 */
export function resolveForDisplay(button: Dict, presets: Dict, options: DisplayOptions): DisplayButton {
    const { config, origin } = transformButton(button, presets, options.states);
    let output = config;

    const entityId: string | undefined = output.entity_id;
    const hass = entityId ? options.states[entityId] : undefined;
    const state = options.previewState ?? hass?.state ?? null;

    if (hass && !('icon' in output) && hass.attributes?.icon) {
        output.icon = hass.attributes.icon;
        origin.icon = 'entity';
    }

    if (state !== null && isPlainObject(output.states) && state in output.states) {
        const override = output.states[state];
        if (isPlainObject(override)) {
            for (const key of Object.keys(override)) {
                origin[key] = `state: ${state}`;
            }
            output = deepMerge(output, clone(override));
        }
    }

    if (hass && !('name' in output) && hass.attributes?.friendly_name) {
        output.name = hass.attributes.friendly_name;
        origin.name = 'entity';
    }

    const templated: string[] = [];
    for (const [key, value] of Object.entries(output)) {
        if (key === 'states' || !isTemplate(value)) {
            continue;
        }

        const evaluated = evaluateSimpleTemplate(value, entityId, state, options.states);
        if (evaluated === undefined) {
            templated.push(key);
        } else {
            output[key] = evaluated;
        }
    }

    return { config: output, origin, state, templated };
}

/** The visibility HomeDeck derives in render_buttons, for values known without templates. */
export function staticVisibility(button: Dict, presets: Dict, states: HassStates): 'visible' | 'hidden' | 'gone' | 'template' {
    if (!button || typeof button !== 'object') {
        return 'visible';
    }

    const { config } = transformButton(button, presets, states);
    const visibility = 'visibility' in config ? config.visibility : true;

    if (isTemplate(visibility)) {
        return 'template';
    }

    if (visibility === false || visibility === 'False' || visibility === 'hidden') {
        return 'hidden';
    }

    if (visibility === null || visibility === 'None' || visibility === 'gone') {
        return 'gone';
    }

    return 'visible';
}
