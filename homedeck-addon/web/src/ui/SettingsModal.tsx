import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';

import { BUTTON_COUNT, COLUMNS } from '../deck/layout';
import type { Dict } from '../deck/presets';
import { deriveModel, setSetting, type Model } from '../model';
import { setState, type SettingsSection, type State } from '../store';
import type { Path } from '../yaml/document';
import { report, showInYaml } from './DeckView';
import { Button, Callout, ColorInput, Field, Glyph, Modal, Segmented, Select, TextInput, Toggle } from './primitives';
import type { GlyphName } from './glyphs';

const SECTIONS: { id: SettingsSection; label: string; icon: GlyphName; blurb: string }[] = [
    { id: 'display', label: 'Display', icon: 'brightness-6', blurb: 'Brightness and labels' },
    { id: 'dimming', label: 'Dimming & night', icon: 'weather-night', blurb: 'Idle dimming and the night schedule' },
    { id: 'deck', label: 'Deck hardware', icon: 'tablet', blurb: 'Firmware sleep, error alerts, screensaver' },
    { id: 'navigation', label: 'Navigation keys', icon: 'arrow-u-left-top', blurb: 'Back, previous and next' },
];

function getPath(source: Dict, path: Path): unknown {
    return path.reduce<any>((v, k) => (v === null || v === undefined ? undefined : v[k]), source);
}

function setting(model: Model, path: Path) {
    return {
        value: getPath(model.effective, path),
        isSet: getPath(model.user, path) !== undefined,
        base: getPath(model.base, path),
        set: (value: unknown) => report(setSetting(model, path, value)),
        reset: () => report(setSetting(model, path, undefined)),
    };
}

/** Wraps a field with "default"/"reset" depending on whether the user's file sets it. */
function SettingField({ model, path, label, hint, children }: { model: Model; path: Path; label: ComponentChildren; hint?: ComponentChildren; children: ComponentChildren }) {
    const s = setting(model, path);
    return (
        <Field label={label} hint={hint} onReset={s.isSet ? s.reset : undefined} inherited={s.isSet ? null : 'default'}>
            {children}
        </Field>
    );
}

/** A number that only writes once it's valid, so clearing the box doesn't snap it back. */
function SettingNumber({ value, onCommit, min, max, unit }: { value: unknown; onCommit: (v: number) => void; min?: number; max?: number; unit?: string }) {
    const [text, setText] = useState(value === undefined || value === null ? '' : String(value));
    const [focused, setFocused] = useState(false);

    useEffect(() => {
        if (!focused) {
            setText(value === undefined || value === null ? '' : String(value));
        }
    }, [value, focused]);

    const valid = (t: string) => /^-?\d+$/.test(t) && (min === undefined || Number(t) >= min) && (max === undefined || Number(t) <= max);

    return (
        <div class="number-unit">
            <input
                class={`input ${text !== '' && !valid(text) ? 'invalid' : ''}`}
                type="number"
                value={text}
                min={min}
                max={max}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onInput={e => {
                    const t = (e.target as HTMLInputElement).value;
                    setText(t);
                    if (valid(t) && Number(t) !== value) {
                        onCommit(Number(t));
                    }
                }}
            />
            {unit && <span class="dim">{unit}</span>}
        </div>
    );
}

export function SettingsModal({ state, section }: { state: State; section: SettingsSection }) {
    const model = deriveModel(state.text, state.baseText);
    const readOnly = !model.parsed.ok;
    const close = () => setState({ settings: null });

    return (
        <Modal
            wide
            class="settings-modal"
            title="Deck settings"
            subtitle="Changes go straight into the YAML - Save sends them to the deck."
            onClose={close}
            footer={(
                <>
                    <Button icon="code-braces" variant="ghost" onClick={() => showInYaml([sectionPath(section)])}>Show in YAML</Button>
                    <span class="spacer" />
                    <Button variant="primary" onClick={close}>Done</Button>
                </>
            )}
        >
            <div class="settings-layout">
                <nav class="settings-nav">
                    {SECTIONS.map(s => (
                        <button key={s.id} type="button" class={section === s.id ? 'active' : ''} onClick={() => setState({ settings: s.id })}>
                            <Glyph name={s.icon} size={18} />
                            <span>
                                <b>{s.label}</b>
                                <span class="dim">{s.blurb}</span>
                            </span>
                        </button>
                    ))}
                </nav>
                <div class={`settings-body ${readOnly ? 'disabled' : ''}`}>
                    {readOnly && <Callout kind="error">The YAML doesn't parse - fix it in the YAML editor first.</Callout>}
                    {section === 'display' && <DisplaySection model={model} />}
                    {section === 'dimming' && <DimmingSection model={model} />}
                    {section === 'deck' && <DeckSection model={model} />}
                    {section === 'navigation' && <NavigationSection model={model} />}
                </div>
            </div>
        </Modal>
    );
}

function sectionPath(section: SettingsSection): string {
    return { display: 'brightness', dimming: 'sleep', deck: 'deck_sleep_timeout', navigation: 'system_buttons' }[section];
}

function DisplaySection({ model }: { model: Model }) {
    const brightness = setting(model, ['brightness']);
    const label = (key: string) => setting(model, ['label_style', key]);
    const show = label('show_title');
    const align = label('align');
    const color = label('color');
    const size = label('size');
    const font = label('font');
    const weight = label('weight');

    return (
        <div class="settings-section">
            <h3>Brightness</h3>
            <SettingField model={model} path={['brightness']} label="Normal brightness" hint="What the deck shows while in use. Dimming never goes above this.">
                <div class="slider-row">
                    <input type="range" min={1} max={100} value={Number(brightness.value ?? 100)} onChange={e => brightness.set(Number((e.target as HTMLInputElement).value))} />
                    <SettingNumber value={brightness.value} min={1} max={100} unit="%" onCommit={brightness.set} />
                </div>
            </SettingField>

            <h3>Labels</h3>
            <p class="dim section-intro">
                A button's <b>label</b> is drawn by the deck's own firmware, with one style for every key. To place
                text freely on a single key, use its <i>Text</i> tab instead.
            </p>
            <div class="label-sample">
                {['Kitchen', 'Lamp', 'Fan'].map(name => (
                    <div key={name} class="key key-sample">
                        <div class={`key-label key-label-${align.value ?? 'bottom'}`} style={{ color: `#${String(color.value ?? 'FFFFFF').replace('/', '')}`, fontSize: `calc(var(--key) * ${(Number(size.value) || 9) * 1.15 / 100})`, display: show.value === false ? 'none' : undefined }}>{name}</div>
                    </div>
                ))}
            </div>
            <div class="form-grid">
                <SettingField model={model} path={['label_style', 'show_title']} label="Show labels">
                    <Toggle checked={show.value !== false} onChange={show.set} />
                </SettingField>
                <SettingField model={model} path={['label_style', 'align']} label="Position">
                    <Segmented value={String(align.value ?? 'bottom') as 'top'} onChange={align.set} options={[{ value: 'top', label: 'Top' }, { value: 'center', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} />
                </SettingField>
                <SettingField model={model} path={['label_style', 'color']} label="Colour">
                    <ColorInput value={color.isSet ? color.value as string : undefined} placeholder={String(color.value ?? 'FFFFFF')} onChange={v => v ? color.set(v) : color.reset()} />
                </SettingField>
                <SettingField model={model} path={['label_style', 'size']} label="Size" hint="The firmware's own units.">
                    <SettingNumber value={size.value} min={1} onCommit={size.set} />
                </SettingField>
                <SettingField model={model} path={['label_style', 'font']} label="Font" hint="Index of one of the deck's built-in fonts.">
                    <SettingNumber value={font.value} min={0} onCommit={font.set} />
                </SettingField>
                <SettingField model={model} path={['label_style', 'weight']} label="Weight">
                    <SettingNumber value={weight.value} min={0} onCommit={weight.set} />
                </SettingField>
            </div>
        </div>
    );
}

type Window = { from: string; to: string; brightness?: number };

function minutes(t: string): number {
    const [h, m] = String(t).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

function inWindow(now: number, w: Window): boolean {
    const a = minutes(w.from);
    const b = minutes(w.to);
    return a <= b ? now >= a && now < b : now >= a || now < b;
}

function Timeline({ windows, fallback }: { windows: Window[]; fallback: number }) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const segments: { left: number; width: number; w: Window }[] = [];

    for (const w of windows) {
        if (typeof w?.from !== 'string' || typeof w?.to !== 'string') {
            continue;
        }
        const a = minutes(w.from);
        const b = minutes(w.to);
        if (a <= b) {
            segments.push({ left: a, width: b - a, w });
        } else {
            segments.push({ left: a, width: 1440 - a, w });
            segments.push({ left: 0, width: b, w });
        }
    }

    return (
        <div class="timeline" aria-hidden="true">
            <div class="timeline-track">
                {segments.map((s, i) => (
                    <div key={i} class="timeline-window" style={{ left: `${(s.left / 1440) * 100}%`, width: `${(s.width / 1440) * 100}%` }} title={`${s.w.from}–${s.w.to}: ${s.w.brightness ?? fallback}%`}>
                        <span>{s.w.brightness ?? fallback}%</span>
                    </div>
                ))}
                <div class="timeline-now" style={{ left: `${(nowMin / 1440) * 100}%` }} title="Now" />
            </div>
            <div class="timeline-scale">
                {[0, 6, 12, 18, 24].map(h => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{String(h).padStart(2, '0')}:00</span>)}
            </div>
        </div>
    );
}

function DimmingSection({ model }: { model: Model }) {
    const sleep: Dict = model.effective.sleep ?? {};
    const dimTimeout = setting(model, ['sleep', 'dim_timeout']);
    const dimBrightness = setting(model, ['sleep', 'dim_brightness']);
    const sleepTimeout = setting(model, ['sleep', 'sleep_timeout']);
    const schedule = setting(model, ['sleep', 'schedule']);
    const windows: Window[] = Array.isArray(schedule.value) ? schedule.value as Window[] : [];
    const brightness = Number(model.effective.brightness ?? 100);
    const dim = Number(sleep.dim_brightness ?? 0);

    const setWindows = (next: Window[]) => schedule.set(next);
    const updateWindow = (i: number, patch: Partial<Window>) => {
        const next = windows.map((w, j) => {
            if (j !== i) {
                return w;
            }
            const merged: Window = { ...w, ...patch };
            if (patch.brightness === undefined && 'brightness' in patch) {
                delete merged.brightness;
            }
            return merged;
        });
        setWindows(next);
    };

    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const active = windows.find(w => typeof w?.from === 'string' && inWindow(nowMin, w));
    const badTimes = windows.some(w => typeof w?.from !== 'string' || typeof w?.to !== 'string');

    const summary = [
        windows.length
            ? <>Outside the windows below the deck stays at <b>{brightness}%</b> - it doesn't dim during the day.</>
            : Number(sleep.dim_timeout) > 0
                ? <>After <b>{sleep.dim_timeout}s</b> without a touch the deck dims to <b>{dim}%</b>.</>
                : <>The deck never dims.</>,
        Number(sleep.sleep_timeout) > 0
            ? <>After <b>{sleep.sleep_timeout}s</b> idle the screen turns off.</>
            : <>The screen never turns off.</>,
        active ? <>Right now a window is active: idle brightness is <b>{active.brightness ?? dim}%</b>.</> : null,
    ].filter(Boolean);

    return (
        <div class="settings-section">
            <Callout kind="info">
                <div class="summary">{summary.map((s, i) => <span key={i}>{s} </span>)}</div>
            </Callout>

            <h3>Idle</h3>
            <div class="form-grid">
                <SettingField model={model} path={['sleep', 'dim_timeout']} label="Dim after" hint="Seconds without a touch. 0 never dims.">
                    <SettingNumber value={dimTimeout.value} min={0} unit="s" onCommit={dimTimeout.set} />
                </SettingField>
                <SettingField model={model} path={['sleep', 'dim_brightness']} label="Dim to" hint={`Capped at the normal brightness (${brightness}%).`}>
                    <SettingNumber value={dimBrightness.value} min={0} max={100} unit="%" onCommit={dimBrightness.set} />
                </SettingField>
                <SettingField model={model} path={['sleep', 'sleep_timeout']} label="Screen off after" hint="Seconds idle. 0 keeps it on - right for a wall-mounted deck.">
                    <SettingNumber value={sleepTimeout.value} min={0} unit="s" onCommit={sleepTimeout.set} />
                </SettingField>
            </div>

            <h3>Night schedule</h3>
            <p class="dim section-intro">
                Time windows, in the deck's local time, when idling dims to a set brightness. A touch always
                brings back {brightness}%. Windows may cross midnight; the first match wins. With any window set,
                the deck doesn't dim outside them.
            </p>

            <Timeline windows={windows} fallback={dim} />

            {badTimes && (
                <Callout kind="error">
                    A time isn't text. Unquoted, YAML reads <code>22:00</code> as the number 1320 - re-enter the time
                    below, or quote it in the YAML: <code>'22:00'</code>.
                </Callout>
            )}

            <div class="schedule">
                {windows.map((w, i) => (
                    <div key={i} class="schedule-row">
                        <label>
                            <span class="dim">From</span>
                            <input class="input" type="time" value={typeof w.from === 'string' ? w.from.padStart(5, '0') : ''} onChange={e => updateWindow(i, { from: (e.target as HTMLInputElement).value })} />
                        </label>
                        <label>
                            <span class="dim">to</span>
                            <input class="input" type="time" value={typeof w.to === 'string' ? (w.to === '24:00' ? '23:59' : w.to.padStart(5, '0')) : ''} onChange={e => updateWindow(i, { to: (e.target as HTMLInputElement).value })} />
                        </label>
                        <label>
                            <span class="dim">idle at</span>
                            <SettingNumber value={w.brightness} min={0} max={100} unit="%" onCommit={v => updateWindow(i, { brightness: v })} />
                        </label>
                        <Button small variant="ghost" icon="trash-can-outline" aria-label="Remove window" onClick={() => setWindows(windows.filter((_, j) => j !== i))} />
                    </div>
                ))}
                <Button small icon="plus" onClick={() => setWindows([...windows, windows.length ? { from: '12:00', to: '13:00', brightness: dim || 10 } : { from: '22:00', to: '06:00', brightness: dim || 10 }])}>
                    Add window
                </Button>
            </div>
        </div>
    );
}

const DECK_SLEEP_OPTIONS = [0, 5, 15, 30, 60, 120];

function DeckSection({ model }: { model: Model }) {
    const deckSleep = setting(model, ['deck_sleep_timeout']);
    const alert = setting(model, ['alert_on_error']);
    const screensaver = setting(model, ['screensaver']);
    const current = Number(deckSleep.value ?? 0);
    const options = DECK_SLEEP_OPTIONS.includes(current) ? DECK_SLEEP_OPTIONS : [...DECK_SLEEP_OPTIONS, current].sort((a, b) => a - b);

    return (
        <div class="settings-section">
            <p class="dim section-intro">
                Settings of the D200 itself, sent the way Ulanzi Studio sends them. They're separate from
                HomeDeck's dimming.
            </p>
            <div class="form-grid">
                <SettingField model={model} path={['deck_sleep_timeout']} label="Firmware sleep" hint={(
                    <>
                        The deck's own sleep timer. Ulanzi Studio sends <i>Never</i>. It doesn't stop the deck falling
                        back to its screensaver when HomeDeck goes quiet - HomeDeck's keep-alive handles that.
                    </>
                )}>
                    <Select
                        value={String(current)}
                        onChange={v => deckSleep.set(Number(v ?? 0))}
                        options={options.map(m => ({ value: String(m), label: m === 0 ? 'Never' : `${m} minutes` }))}
                    />
                </SettingField>

                <SettingField model={model} path={['alert_on_error']} label="Flag failed actions" hint={(
                    <>
                        Flashes the deck's "!" on a key whose Home Assistant action failed - including ones Home
                        Assistant refuses without an error, like a service on the wrong domain.
                    </>
                )}>
                    <Toggle checked={alert.value !== false} onChange={alert.set} />
                </SettingField>

                <SettingField model={model} path={['screensaver']} label="Screensaver image" hint={(
                    <>
                        A file in HomeDeck's <code>assets/</code> folder. Ulanzi Studio uses a 1220 × 708 JPEG; other
                        formats are converted. Uploaded only when it changes. Empty leaves the deck's own.
                    </>
                )}>
                    <TextInput value={screensaver.isSet ? (screensaver.value as string | null) ?? '' : ''} mono placeholder="screensaver.jpg" onChange={v => v.trim() ? screensaver.set(v.trim()) : screensaver.reset()} />
                </SettingField>
            </div>

            <h3>The small window</h3>
            <Callout kind="info">
                The wide key at the bottom right is drawn entirely by the deck's firmware: stats, a clock, or the
                page background. Tap it on the deck to cycle through them. It can't show custom text or icons - put
                those on a normal button.
            </Callout>
        </div>
    );
}

function NavigationSection({ model }: { model: Model }) {
    const back = setting(model, ['system_buttons', '$page.back', 'position']);
    const previous = setting(model, ['system_buttons', '$page.previous', 'position']);
    const next = setting(model, ['system_buttons', '$page.next', 'position']);

    const marks: Record<number, string> = {};
    if (Number(back.value) > 0) {
        marks[Number(back.value) - 1] = 'Back';
    }
    if (Number(previous.value) > 0) {
        marks[Number(previous.value) - 1] = (marks[Number(previous.value) - 1] ? `${marks[Number(previous.value) - 1]} / ` : '') + 'Prev';
    }
    if (Number(next.value) > 0) {
        marks[Number(next.value) - 1] = (marks[Number(next.value) - 1] ? `${marks[Number(next.value) - 1]} / ` : '') + 'Next';
    }

    return (
        <div class="settings-section">
            <p class="dim section-intro">
                HomeDeck inserts these keys itself: <b>Back</b> on every page except Home, and <b>Previous</b> / <b>Next</b> when
                a page has more buttons than fit. Your buttons move along to make room. Positions count from 1, left to
                right, top to bottom.
            </p>
            <div class="nav-layout">
                <div class="form-grid">
                    <SettingField model={model} path={['system_buttons', '$page.back', 'position']} label="Back" hint="0 hides it - then a sub-page has no way back.">
                        <SettingNumber value={back.value} min={0} max={BUTTON_COUNT} onCommit={back.set} />
                    </SettingField>
                    <SettingField model={model} path={['system_buttons', '$page.previous', 'position']} label="Previous" hint="0 hides it.">
                        <SettingNumber value={previous.value} min={0} max={BUTTON_COUNT} onCommit={previous.set} />
                    </SettingField>
                    <SettingField model={model} path={['system_buttons', '$page.next', 'position']} label="Next">
                        <SettingNumber value={next.value} min={1} max={BUTTON_COUNT} onCommit={next.set} />
                    </SettingField>
                </div>
                <div class="nav-grid" style={{ gridTemplateColumns: `repeat(${COLUMNS}, 1fr)` }} aria-hidden="true">
                    {Array.from({ length: BUTTON_COUNT }, (_, i) => (
                        <div key={i} class={`nav-cell ${marks[i] ? 'marked' : ''}`}>{marks[i] ?? i + 1}</div>
                    ))}
                    <div class="nav-cell nav-window">window</div>
                </div>
            </div>
            <Callout kind="info">The look of these keys is under <code>system_buttons</code> in the YAML.</Callout>
        </div>
    );
}
