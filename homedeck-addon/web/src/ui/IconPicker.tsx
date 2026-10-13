import { useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { iconArt, ICON_SOURCES, listIcons, parseIcon, searchIcons } from '../deck/icons';
import { Button, Callout, Glyph, TextInput } from './primitives';

type Tab = 'mdi' | 'cbi' | 'pi' | 'other';

// One grid is one bulk request to Iconify
const LIMIT = 160;

export function IconPreview({ icon, variant, size = 28 }: { icon: unknown; variant?: string | null; size?: number }) {
    const ref = parseIcon(icon);
    const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });

    useEffect(() => {
        let cancelled = false;
        setState({ url: null, failed: false });
        iconArt(ref, { variant: variant ?? undefined, color: 'E7E9EE', width: size * 2, height: size * 2 })
            .then(url => !cancelled && setState({ url, failed: false }))
            .catch(() => !cancelled && setState({ url: null, failed: true }));
        return () => {
            cancelled = true;
        };
    }, [ref.source, ref.name, variant, size]);

    if (!state.url) {
        const glyph = state.failed ? 'alert-circle-outline' : ref.source === 'template' ? 'code-braces' : ref.source === 'local' ? 'image-outline' : null;
        return (
            <span class="icon-preview icon-preview-none" style={{ width: `${size}px`, height: `${size}px` }} title={state.failed ? 'Not found, or Iconify unreachable' : undefined}>
                {glyph && <Glyph name={glyph} size={size * 0.6} />}
            </span>
        );
    }

    return <img class="icon-preview" src={state.url} width={size} height={size} alt="" />;
}

/** Pick an icon. Writes it the way HomeDeck reads it: mdi:, cbi:, pi:, url: or local:. */
export function IconPicker({ value, variant, onPick, onClose }: {
    value: string | null | undefined;
    variant?: string | null;
    onPick: (icon: string) => void;
    onClose: () => void;
}) {
    const current = parseIcon(value);
    const initialTab: Tab = current.source === 'mdi' || current.source === 'cbi' || current.source === 'pi' ? current.source : (current.source === 'url' || current.source === 'local' ? 'other' : 'mdi');
    const [tab, setTab] = useState<Tab>(initialTab);
    const [query, setQuery] = useState('');
    const [debounced, setDebounced] = useState('');
    const [results, setResults] = useState<{ names: string[]; total: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [custom, setCustom] = useState(current.source === 'url' || current.source === 'local' ? String(value) : '');
    const searchRef = useRef<HTMLInputElement>(null);

    // autoFocus only works on page load, not for an element added later
    useEffect(() => {
        searchRef.current?.focus();
    }, [tab]);

    useEffect(() => {
        const timer = setTimeout(() => setDebounced(query.trim()), 250);
        return () => clearTimeout(timer);
    }, [query]);

    useEffect(() => {
        if (tab === 'other') {
            return;
        }

        const controller = new AbortController();
        setResults(null);
        setError(null);

        const request = debounced ? searchIcons(tab, debounced, controller.signal) : listIcons(tab);
        request
            .then(names => {
                if (!controller.signal.aborted) {
                    setResults({ names: names.slice(0, LIMIT), total: names.length });
                }
            })
            .catch(e => {
                if (!controller.signal.aborted) {
                    setError((e as Error).message);
                }
            });

        return () => controller.abort();
    }, [tab, debounced]);

    const source = ICON_SOURCES.find(s => s.id === tab);
    const previewVariant = tab === 'pi' ? (variant ?? 'regular') : undefined;

    const grid = useMemo(() => results?.names.map(name => (
        <button
            key={name}
            type="button"
            class={`icon-tile ${name === value ? 'selected' : ''}`}
            title={name}
            onClick={() => onPick(name)}
        >
            <IconPreview icon={name} variant={previewVariant} size={28} />
            <span>{name.split(':')[1]}</span>
        </button>
    )), [results, value, previewVariant]);

    return (
        <div class="icon-picker">
            <div class="icon-picker-head">
                <div class="tabs tabs-small">
                    {ICON_SOURCES.map(s => (
                        <button key={s.id} type="button" class={tab === s.id ? 'active' : ''} onClick={() => setTab(s.id)}>{s.label}</button>
                    ))}
                    <button type="button" class={tab === 'other' ? 'active' : ''} onClick={() => setTab('other')}>Image</button>
                </div>
                <Button icon="close" variant="ghost" small onClick={onClose} aria-label="Close icon picker" />
            </div>

            {tab === 'other'
                ? (
                    <div class="icon-picker-other">
                        <label class="field">
                            <span class="field-label">Image</span>
                            <TextInput
                                value={custom}
                                mono
                                placeholder="url:https://example.com/icon.png  or  local:icon.png"
                                onChange={setCustom}
                            />
                            <span class="field-hint">
                                <code>url:</code> downloads the image. <code>local:</code> is a file in HomeDeck's <code>assets/icons</code> folder (or an absolute path) - it can't be previewed here.
                            </span>
                        </label>
                        <Button
                            variant="primary"
                            disabled={!/^(url:https?:\/\/|local:).+/.test(custom)}
                            onClick={() => onPick(custom.trim())}
                        >Use image</Button>
                        {/^https?:\/\//.test(custom) && <Callout kind="warning">Prefix it with <code>url:</code> - a bare link passes validation but HomeDeck draws nothing.</Callout>}
                    </div>
                )
                : (
                    <>
                        <div class="icon-search">
                            <Glyph name="magnify" size={18} />
                            <input
                                class="input"
                                ref={searchRef}
                                value={query}
                                placeholder={`Search ${source?.label.toLowerCase() ?? ''}…`}
                                onInput={e => setQuery((e.target as HTMLInputElement).value)}
                            />
                        </div>
                        {error && <Callout kind="error">Couldn't reach the icon catalogue ({error}). You can still type an icon name in the field.</Callout>}
                        {!error && !results && <div class="icon-grid-status dim">Loading…</div>}
                        {results && results.names.length === 0 && <div class="icon-grid-status dim">No icons match "{debounced}".</div>}
                        {results && results.names.length > 0 && (
                            <>
                                <div class="icon-grid">{grid}</div>
                                {results.total > results.names.length && (
                                    <div class="icon-grid-status dim">Showing {results.names.length} of {results.total} - search to narrow it down.</div>
                                )}
                            </>
                        )}
                    </>
                )}
        </div>
    );
}
