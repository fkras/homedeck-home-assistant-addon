import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';

import { effectiveConfig, evaluateSimpleTemplate, resolveForDisplay, staticVisibility, transformButton } from '../src/deck/presets';

const load = (path: string) => parse(readFileSync(join(import.meta.dir, path), 'utf8'), { version: '1.1' });

// The add-on's bundled copy of HomeDeck's defaults, and the user's real deck
const base = load('../src/deck/configuration.base.yml');
const user = load('fixtures/full-deck.yml');
const config = effectiveConfig(base, user);
const presets = config.presets;

describe('transformButton', () => {
    test('a button without presets gets $default and its domain preset', () => {
        const { config: out } = transformButton({ entity_id: 'light.kitchen' }, presets, {});

        // From $light
        expect(out.tap_action).toEqual({ action: 'light.toggle' });
        // From $default
        expect(out.icon_padding).toBe(40);
        expect(out.domain).toBe('light');
    });

    test('a $page.go_to button uses the $page.go_to preset instead of $default', () => {
        const { config: out } = transformButton({ tap_action: { action: '$page.go_to', data: 'x' } }, presets, {});
        expect(out.icon_border_radius).toBe(10);
    });

    test('naming a preset drops the implicit ones', () => {
        const { config: out, origin } = transformButton({ presets: 'light.tile', entity_id: 'light.a', icon: 'cbi:x' }, presets, {});

        expect(out.icon_padding).toBe(42);
        expect(origin.icon_padding).toBe('tile');
        expect(out.tap_action).toEqual({ action: 'light.toggle' });
        expect(origin.tap_action).toBe('light.tile');
        expect(origin.icon).toBe('');
        expect(out.states.on.icon_background_color).toBe('B36B00');
    });

    test('later presets in a list win', () => {
        const p = { a: { icon_color: '111111' }, b: { icon_color: '222222' } };
        expect(transformButton({ presets: ['a', 'b'] }, p, {}).config.icon_color).toBe('222222');
    });

    test("the button's own values win over every preset", () => {
        const { config: out } = transformButton({ presets: 'light.tile', icon_background_color: '000000' }, presets, {});
        expect(out.icon_background_color).toBe('000000');
    });

    test('a sensor gets its device-class preset', () => {
        const states = { 'sensor.t': { entity_id: 'sensor.t', state: '21', attributes: { device_class: 'temperature' } } };
        expect(transformButton({ entity_id: 'sensor.t' }, presets, states).config.icon).toBe('mdi:thermometer');
    });

    test('presets that reference each other in a loop terminate', () => {
        const p = { a: { presets: 'b', icon: 'mdi:a' }, b: { presets: 'a', icon_color: '123456' } };
        const { config: out } = transformButton({ presets: 'a' }, p, {});
        expect(out.icon).toBe('mdi:a');
        expect(out.icon_color).toBe('123456');
    });
});

describe('resolveForDisplay', () => {
    const button = { presets: 'switch.tile', entity_id: 'switch.x', name: 'X', icon: 'mdi:lamp' };

    test('applies the override for the live state', () => {
        const states = { 'switch.x': { entity_id: 'switch.x', state: 'on', attributes: {} } };
        expect(resolveForDisplay(button, presets, { states }).config.icon_background_color).toBe('B36B00');
    });

    test('a preview state overrides the live one', () => {
        const states = { 'switch.x': { entity_id: 'switch.x', state: 'on', attributes: {} } };
        expect(resolveForDisplay(button, presets, { states, previewState: 'off' }).config.icon_background_color).toBe('3A4450');
    });

    test("takes the entity's name and icon when the button has none", () => {
        const states = { 'light.y': { entity_id: 'light.y', state: 'off', attributes: { friendly_name: 'Desk', icon: 'mdi:desk-lamp' } } };
        const out = resolveForDisplay({ presets: 'tile', entity_id: 'light.y' }, presets, { states }).config;
        expect(out.name).toBe('Desk');
        expect(out.icon).toBe('mdi:desk-lamp');
    });

    test('$light swaps the icon for a template while on', () => {
        const out = resolveForDisplay({ entity_id: 'light.z', icon: 'cbi:x' }, presets, { states: {}, previewState: 'on' });
        expect(out.templated).toContain('icon');
    });

    test('evaluates the binary_text template', () => {
        const out = resolveForDisplay({ entity_id: 'light.z' }, presets, { states: {}, previewState: 'on' });
        expect(out.config.name).toBe('On');
    });
});

describe('evaluateSimpleTemplate', () => {
    test('self_binary_text', () => {
        expect(evaluateSimpleTemplate("{{ self_binary_text('Open', 'Closed') }}", 'x.y', 'off', {})).toBe('Closed');
    });

    test('anything else is left to the deck', () => {
        expect(evaluateSimpleTemplate("{{ states('x.y') | int + 1 }}", 'x.y', 'on', {})).toBeUndefined();
    });
});

describe('staticVisibility', () => {
    test('reads the documented spellings', () => {
        expect(staticVisibility({ visibility: 'gone' }, {}, {})).toBe('gone');
        expect(staticVisibility({ visibility: null }, {}, {})).toBe('gone');
        expect(staticVisibility({ visibility: false }, {}, {})).toBe('hidden');
        expect(staticVisibility({ visibility: 'hidden' }, {}, {})).toBe('hidden');
        expect(staticVisibility({ visibility: "{{ is_state('a.b', 'on') }}" }, {}, {})).toBe('template');
        expect(staticVisibility({ name: 'x' }, {}, {})).toBe('visible');
    });

    test('inherits visibility from a preset', () => {
        expect(staticVisibility({ presets: 'p' }, { p: { visibility: 'gone' } }, {})).toBe('gone');
    });
});
