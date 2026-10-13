/**
 * App state. Deliberately has no copy of the configuration besides its text:
 * `text` mirrors the YAML editor, and everything the visual editor shows is
 * derived from it.
 */
import { useLayoutEffect, useState } from 'preact/hooks';

import type { Device, HassServices } from './api';
import type { HassStates } from './deck/presets';
import type { Path } from './yaml/document';

export type Problem = { message: string; line: number; column: number; severity: 'error' | 'warning' };
export type LogLine = { timestamp: number; message: string };

export type Editing =
    | { kind: 'button'; pageId: string; index: number }
    // A new button for an empty key, at an absolute position (sub-page * 13 + key)
    | { kind: 'new-button'; pageId: string; position: number }
    | { kind: 'preset'; name: string; isNew?: boolean };

export type SettingsSection = 'display' | 'dimming' | 'deck' | 'navigation';

export type Toast = { kind: 'ok' | 'error' | 'info'; message: string; id: number };

export type State = {
    phase: 'scanning' | 'no-devices' | 'loading' | 'ready' | 'unreachable';
    devices: Device[];
    device: Device | null;
    status: 'running' | 'stopped' | 'unavailable';

    text: string;
    savedText: string;
    baseText: string;
    baseIsBundled: boolean;
    schema: any;

    hass: HassStates;
    services: HassServices;
    hassError: string | null;

    problems: Problem[];
    logs: LogLine[];

    view: 'visual' | 'yaml';
    pageId: string;
    subPage: number;
    previewState: 'live' | 'on' | 'off';

    editing: Editing | null;
    settings: SettingsSection | null;
    toast: Toast | null;
    saving: boolean;
    // A path to reveal in the YAML editor once it's visible
    reveal: Path | null;
};

const initial: State = {
    phase: 'scanning',
    devices: [],
    device: null,
    status: 'unavailable',

    text: '',
    savedText: '',
    baseText: '',
    baseIsBundled: false,
    schema: null,

    hass: {},
    services: {},
    hassError: null,

    problems: [],
    logs: [],

    view: 'visual',
    pageId: '$root',
    subPage: 0,
    previewState: 'live',

    editing: null,
    settings: null,
    toast: null,
    saving: false,
    reveal: null,
};

let state = initial;
const listeners = new Set<() => void>();

export function getState(): State {
    return state;
}

export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
    const update = typeof patch === 'function' ? patch(state) : patch;
    state = { ...state, ...update };
    listeners.forEach(fn => fn());
}

export function useAppState(): State {
    const [, force] = useState(0);
    const rendered = state;

    // A layout effect, not useEffect: Preact runs effects after the next
    // animation frame, which a background tab never gets - so the app sat on
    // its splash screen if the panel was opened in a tab that wasn't in front.
    useLayoutEffect(() => {
        const listener = () => force(n => n + 1);
        listeners.add(listener);
        // Catch up on anything that changed between render and subscribing
        if (state !== rendered) {
            listener();
        }
        return () => {
            listeners.delete(listener);
        };
    }, []);

    return state;
}

let toastId = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(kind: Toast['kind'], message: string, ms = 4000) {
    clearTimeout(toastTimer);
    const id = ++toastId;
    setState({ toast: { kind, message, id } });
    toastTimer = setTimeout(() => {
        if (state.toast?.id === id) {
            setState({ toast: null });
        }
    }, ms);
}

export function isDirty(s: State = state): boolean {
    return s.text !== s.savedText;
}
