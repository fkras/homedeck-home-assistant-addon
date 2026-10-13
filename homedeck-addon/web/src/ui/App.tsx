import { useEffect, useRef } from 'preact/hooks';

import {
    controlDeck, deviceBase, deviceLabel, fetchBaseConfiguration, fetchConfiguration, fetchDevices, fetchHassServices,
    fetchHassStates, fetchSchema, openDeckSocket, saveConfiguration, type Device, type WsMessage,
} from '../api';
import { canRedo, canUndo, loadText, mountEditor, redo, revealLine, revealPath, setReadOnly, setSchemaUrl, undo } from '../editor';
import { getState, isDirty, setState, toast, useAppState, type State } from '../store';
import { ButtonEditor } from './ButtonEditor';
import { DeckView } from './DeckView';
import { Button, confirmDialog, DialogHost, Glyph, Segmented } from './primitives';
import { SettingsModal } from './SettingsModal';

const MAX_LOGS = 200;
let socket: WebSocket | null = null;

export async function boot() {
    let devices: Device[] = [];
    try {
        devices = await fetchDevices();
    } catch {
        devices = [];
    }

    if (!devices.length) {
        setState({ phase: 'no-devices' });
        return;
    }

    setState({ devices });
    loadHass();
    await selectDevice(devices[0]);
}

async function loadHass() {
    try {
        const [hass, services] = await Promise.all([fetchHassStates(), fetchHassServices()]);
        setState({ hass, services, hassError: null });
    } catch (e) {
        setState({ hassError: (e as Error).message });
    }
}

async function selectDevice(device: Device) {
    const current = getState();
    if (current.device && isDirty(current) && !(await confirmDialog({
        title: 'Discard unsaved changes?',
        message: `Switching to ${deviceLabel(device)} loses the changes you haven't saved.`,
        confirm: 'Discard and switch',
        danger: true,
    }))) {
        return;
    }

    socket?.close();
    socket = null;
    setReadOnly(true);
    setState({ device, phase: 'loading', logs: [], problems: [], editing: null, settings: null, status: 'unavailable' });
    setSchemaUrl(`${deviceBase(device)}/schema`);

    try {
        const [text, baseText, schema] = await Promise.all([
            fetchConfiguration(device),
            fetchBaseConfiguration(device),
            fetchSchema(device).catch(() => null),
        ]);

        loadText(text);
        setState({
            phase: 'ready',
            savedText: text,
            baseText: baseText ?? '',
            baseIsBundled: baseText === null,
            schema,
            pageId: '$root',
            subPage: 0,
        });
        setReadOnly(false);
    } catch {
        setState({ phase: 'unreachable' });
        return;
    }

    socket = openDeckSocket(device);
    socket.onmessage = event => {
        try {
            const message = JSON.parse(event.data) as WsMessage;
            if (message.type === 'status') {
                setState({ status: message.payload.status });
            } else if (message.type === 'logs') {
                setState(s => ({ logs: [...s.logs.slice(-(MAX_LOGS - 1)), message.payload] }));
            }
        } catch {
            // Not ours
        }
    };
    socket.onclose = () => {
        if (getState().device === device) {
            setState({ status: 'unavailable' });
        }
    };
}

async function save() {
    const s = getState();
    if (!s.device || s.saving || !isDirty(s)) {
        return;
    }

    if (s.problems.some(p => p.severity === 'error')) {
        toast('error', 'Fix the problems in the YAML before saving.');
        return;
    }

    setState({ saving: true });
    const text = s.text;
    try {
        await saveConfiguration(s.device, text);
        setState({ savedText: text });
        toast('ok', 'Saved - HomeDeck picks it up within a second.');
    } catch (e) {
        toast('error', `Not saved - HomeDeck said: ${(e as Error).message}`, 8000);
    } finally {
        setState({ saving: false });
    }
}

function isEditable(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || !!el.closest('.monaco-editor'));
}

export function App() {
    const state = useAppState();
    const editorRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (editorRef.current) {
            mountEditor(editorRef.current);
        }
    }, [state.phase]);

    useEffect(() => {
        if (state.view === 'yaml' && state.reveal) {
            const path = state.reveal;
            setState({ reveal: null });
            requestAnimationFrame(() => revealPath(path));
        }
    }, [state.view, state.reveal]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const mod = e.metaKey || e.ctrlKey;
            if (mod && e.key.toLowerCase() === 's') {
                e.preventDefault();
                save();
                return;
            }

            const s = getState();
            if (mod && s.view === 'visual' && !s.editing && !s.settings && !isEditable(e.target) && !document.querySelector('.modal-layer')) {
                if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
                    e.preventDefault();
                    undo();
                } else if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y') {
                    e.preventDefault();
                    redo();
                }
            }
        };

        const onUnload = (e: BeforeUnloadEvent) => {
            if (isDirty()) {
                e.preventDefault();
            }
        };

        const refresh = setInterval(() => {
            if (document.visibilityState === 'visible' && getState().phase === 'ready' && !getState().hassError) {
                loadHass();
            }
        }, 30_000);

        window.addEventListener('keydown', onKey, true);
        window.addEventListener('beforeunload', onUnload);
        return () => {
            window.removeEventListener('keydown', onKey, true);
            window.removeEventListener('beforeunload', onUnload);
            clearInterval(refresh);
        };
    }, []);

    if (state.phase === 'scanning' || state.phase === 'no-devices') {
        return <Splash state={state} />;
    }

    const dirty = isDirty(state);
    const errors = state.problems.filter(p => p.severity === 'error').length;

    return (
        <div class="app">
            <header class="topbar">
                <div class="brand">
                    <Glyph name="view-grid-outline" size={22} />
                    <span>HomeDeck</span>
                </div>

                <div class="device-picker">
                    <select
                        class="input"
                        value={String(state.devices.indexOf(state.device!))}
                        onChange={e => selectDevice(state.devices[Number((e.target as HTMLSelectElement).value)])}
                        aria-label="Device"
                    >
                        {state.devices.map((d, i) => <option key={i} value={String(i)}>{deviceLabel(d)}</option>)}
                    </select>
                    <span class={`status-pill status-${state.status}`} title={state.device ? `HomeDeck ${state.device.properties.version} · API v${state.device.properties.api_version}` : undefined}>
                        <span class="status-dot" />
                        {{ running: 'Running', stopped: 'Stopped', unavailable: 'Offline' }[state.status]}
                    </span>
                    {state.status === 'running'
                        ? <Button small icon="stop" variant="ghost" onClick={async () => {
                            if (state.device && await confirmDialog({ title: 'Stop HomeDeck?', message: 'The deck stops responding until you start it again.', confirm: 'Stop', danger: true })) {
                                controlDeck(state.device, 'stop');
                            }
                        }}>Stop</Button>
                        : <Button small icon="play" variant="ghost" disabled={state.status === 'unavailable'} onClick={() => state.device && controlDeck(state.device, 'start')}>Start</Button>}
                </div>

                <Segmented
                    value={state.view}
                    onChange={view => setState({ view })}
                    options={[{ value: 'visual', label: 'Visual' }, { value: 'yaml', label: 'YAML' }]}
                />

                <div class="topbar-actions">
                    <Button icon="undo" variant="ghost" disabled={!canUndo()} onClick={undo} title="Undo (Ctrl/⌘ Z)" aria-label="Undo" />
                    <Button icon="redo" variant="ghost" disabled={!canRedo()} onClick={redo} title="Redo (Ctrl/⌘ Shift Z)" aria-label="Redo" />
                    <Button icon="cog" onClick={() => setState({ settings: 'display' })} disabled={state.phase !== 'ready'}>Deck settings</Button>
                    <Button
                        icon="content-save"
                        variant="primary"
                        class={dirty ? 'dirty' : ''}
                        disabled={!dirty || state.saving || errors > 0}
                        onClick={save}
                        title={errors ? 'Fix the problems first' : 'Save to the deck (Ctrl/⌘ S)'}
                    >
                        {state.saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
                    </Button>
                </div>
            </header>

            <div class="workspace">
                <main class="main">
                    {state.phase === 'loading' && <div class="placeholder">Loading the configuration…</div>}
                    {state.phase === 'unreachable' && (
                        <div class="placeholder">
                            <Glyph name="alert-circle-outline" size={32} />
                            <p>Couldn't load the configuration from {state.device && deviceLabel(state.device)}.</p>
                            <Button icon="refresh" onClick={() => state.device && selectDevice(state.device)}>Try again</Button>
                        </div>
                    )}
                    {state.phase === 'ready' && state.view === 'visual' && <DeckView state={state} />}
                    <div class={`yaml-view ${state.phase === 'ready' && state.view === 'yaml' ? '' : 'gone'}`}>
                        <div class="yaml-hint dim">
                            The same configuration as the visual editor - changes in either show up in the other, and
                            undo covers both.
                        </div>
                        <div class="yaml-editor" ref={editorRef} />
                    </div>
                </main>

                <Sidebar state={state} />
            </div>

            {state.editing && <ButtonEditor key={JSON.stringify(state.editing)} state={state} editing={state.editing} />}
            {state.settings && <SettingsModal state={state} section={state.settings} />}
            <DialogHost />

            {state.toast && (
                <div class={`toast toast-${state.toast.kind}`} role="status" key={state.toast.id}>
                    <Glyph name={state.toast.kind === 'ok' ? 'check-circle-outline' : state.toast.kind === 'error' ? 'alert-circle-outline' : 'information-outline'} size={18} />
                    <span>{state.toast.message}</span>
                    <button type="button" aria-label="Dismiss" onClick={() => setState({ toast: null })}><Glyph name="close" size={16} /></button>
                </div>
            )}

            <datalist id="ha-entities">
                {Object.values(state.hass).map(s => <option key={s.entity_id} value={s.entity_id}>{s.attributes.friendly_name}</option>)}
            </datalist>
        </div>
    );
}

function Sidebar({ state }: { state: State }) {
    const logRef = useRef<HTMLUListElement>(null);
    const stick = useRef(true);

    useEffect(() => {
        const el = logRef.current;
        if (el && stick.current) {
            el.scrollTop = el.scrollHeight;
        }
    }, [state.logs]);

    return (
        <aside class="sidebar">
            <section class="panel">
                <h3>
                    Problems
                    {state.problems.length > 0 && <span class={`count ${state.problems.some(p => p.severity === 'error') ? 'count-error' : 'count-warning'}`}>{state.problems.length}</span>}
                </h3>
                {state.problems.length === 0
                    ? <div class="dim panel-empty"><Glyph name="check-circle-outline" size={16} /> The configuration is valid.</div>
                    : (
                        <ul class="problems">
                            {state.problems.map((p, i) => (
                                <li key={i}>
                                    <button type="button" class={`problem problem-${p.severity}`} onClick={() => {
                                        setState({ view: 'yaml', editing: null, settings: null });
                                        requestAnimationFrame(() => revealLine(p.line, p.column));
                                    }}>
                                        <span class="problem-line">{p.line}</span>
                                        <span>{p.message}</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
            </section>

            <section class="panel panel-logs">
                <h3>Logs</h3>
                <ul
                    class="logs"
                    ref={logRef}
                    onScroll={e => {
                        const el = e.currentTarget;
                        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
                    }}
                >
                    {state.logs.length === 0 && <li class="dim">Nothing yet. HomeDeck's output appears here while it runs.</li>}
                    {state.logs.map((log, i) => {
                        const d = new Date(log.timestamp * 1000);
                        const t = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
                        return <li key={i}><span class="log-time">{t}</span>{log.message}</li>;
                    })}
                </ul>
            </section>

            <div class="sidebar-foot dim">
                {state.hassError
                    ? <span title={state.hassError}>Home Assistant not connected - no entity suggestions.</span>
                    : <span>{Object.keys(state.hass).length} Home Assistant entities</span>}
                {state.baseIsBundled && <span title="This HomeDeck doesn't serve its defaults yet, so previews use the copy bundled with the add-on"> · bundled defaults</span>}
            </div>
        </aside>
    );
}

function Splash({ state }: { state: State }) {
    return (
        <div class="splash">
            <Glyph name="view-grid-outline" size={40} />
            <h1>HomeDeck</h1>
            {state.phase === 'scanning'
                ? <p class="dim">Looking for decks on the network…</p>
                : (
                    <>
                        <p>No HomeDeck devices found.</p>
                        <p class="dim">
                            The add-on finds decks over mDNS, so HomeDeck's server (<code>homedeck-server.service</code>)
                            must be running, on the same network as Home Assistant.
                        </p>
                        <Button icon="refresh" onClick={() => window.location.reload()}>Look again</Button>
                    </>
                )}
        </div>
    );
}
