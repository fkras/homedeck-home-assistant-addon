import type { ComponentChildren, JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

import { GLYPHS, type GlyphName } from './glyphs';

export function Glyph({ name, size = 18, class: className }: { name: GlyphName; size?: number; class?: string }) {
    return (
        <svg
            class={`glyph ${className ?? ''}`}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: GLYPHS[name] }}
        />
    );
}

type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: GlyphName;
    variant?: 'primary' | 'ghost' | 'danger' | 'default';
    small?: boolean;
};

export function Button({ icon, variant = 'default', small, children, class: className, ...rest }: ButtonProps) {
    return (
        <button type="button" class={`btn btn-${variant} ${small ? 'btn-small' : ''} ${children ? '' : 'btn-icon'} ${className ?? ''}`} {...rest}>
            {icon && <Glyph name={icon} size={small ? 16 : 18} />}
            {children && <span>{children}</span>}
        </button>
    );
}

export function Modal({ title, subtitle, onClose, children, footer, wide, class: className }: {
    title: ComponentChildren;
    subtitle?: ComponentChildren;
    onClose: () => void;
    children: ComponentChildren;
    footer?: ComponentChildren;
    wide?: boolean;
    class?: string;
}) {
    const ref = useRef<HTMLDivElement>(null);
    // Callers pass a new onClose on every render; keep the latest without
    // re-running the effect below
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    // Once, when it opens. Re-running this on every render moved focus from
    // whatever input was being typed in back to the modal, after each key.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const layers = document.querySelectorAll('.modal-layer');
            const topmost = layers[layers.length - 1]?.contains(ref.current);
            if (e.key === 'Escape' && topmost && !document.querySelector('.menu')) {
                e.stopPropagation();
                onCloseRef.current();
            }
        };
        window.addEventListener('keydown', onKey);
        (ref.current?.querySelector<HTMLElement>('[data-autofocus]') ?? ref.current)?.focus();
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    return createPortal(
        <div class="modal-layer" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div class={`modal ${wide ? 'modal-wide' : ''} ${className ?? ''}`} role="dialog" aria-modal="true" tabIndex={-1} ref={ref}>
                <header class="modal-header">
                    <div>
                        <h2>{title}</h2>
                        {subtitle && <div class="modal-subtitle">{subtitle}</div>}
                    </div>
                    <Button icon="close" variant="ghost" onClick={onClose} aria-label="Close" />
                </header>
                <div class="modal-body">{children}</div>
                {footer && <footer class="modal-footer">{footer}</footer>}
            </div>
        </div>,
        document.body,
    );
}

export type MenuItem = { label: string; icon?: GlyphName; danger?: boolean; disabled?: boolean; onSelect: () => void } | 'separator';

export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
    const ref = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ x, y });

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) {
            return;
        }
        const rect = el.getBoundingClientRect();
        setPos({
            x: Math.min(x, window.innerWidth - rect.width - 8),
            y: Math.min(y, window.innerHeight - rect.height - 8),
        });
    }, [x, y]);

    useEffect(() => {
        const close = (e: Event) => {
            if (!ref.current?.contains(e.target as Node)) {
                onClose();
            }
        };
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('mousedown', close, true);
        window.addEventListener('keydown', onKey);
        window.addEventListener('blur', onClose);
        return () => {
            window.removeEventListener('mousedown', close, true);
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('blur', onClose);
        };
    }, [onClose]);

    return createPortal(
        <div class="menu" role="menu" ref={ref} style={{ left: `${pos.x}px`, top: `${pos.y}px` }}>
            {items.map((item, i) => item === 'separator'
                ? <div key={i} class="menu-separator" />
                : (
                    <button
                        key={i}
                        type="button"
                        role="menuitem"
                        class={`menu-item ${item.danger ? 'danger' : ''}`}
                        disabled={item.disabled}
                        onClick={() => {
                            onClose();
                            item.onSelect();
                        }}
                    >
                        {item.icon ? <Glyph name={item.icon} size={16} /> : <span class="glyph-space" />}
                        {item.label}
                    </button>
                ))}
        </div>,
        document.body,
    );
}

// --------------------------------------------------------------- dialogs ----

type DialogRequest =
    | { kind: 'confirm'; title: string; message: ComponentChildren; confirm: string; danger?: boolean; resolve: (ok: boolean) => void }
    | {
        kind: 'prompt';
        title: string;
        message?: ComponentChildren;
        fields: { key: string; label: string; value: string; placeholder?: string; hint?: string; validate?: (v: string, all: Record<string, string>) => string | null }[];
        confirm: string;
        resolve: (values: Record<string, string> | null) => void;
    };

let pushDialog: ((d: DialogRequest) => void) | null = null;

export function confirmDialog(options: { title: string; message: ComponentChildren; confirm: string; danger?: boolean }): Promise<boolean> {
    return new Promise(resolve => pushDialog?.({ kind: 'confirm', ...options, resolve }));
}

export function promptDialog(options: Omit<Extract<DialogRequest, { kind: 'prompt' }>, 'kind' | 'resolve'>): Promise<Record<string, string> | null> {
    return new Promise(resolve => pushDialog?.({ kind: 'prompt', ...options, resolve }));
}

export function DialogHost() {
    const [dialogs, setDialogs] = useState<DialogRequest[]>([]);

    useEffect(() => {
        pushDialog = d => setDialogs(list => [...list, d]);
        return () => {
            pushDialog = null;
        };
    }, []);

    const close = (d: DialogRequest) => setDialogs(list => list.filter(x => x !== d));

    return (
        <>
            {dialogs.map((d, i) => d.kind === 'confirm'
                ? <ConfirmDialog key={i} request={d} onDone={() => close(d)} />
                : <PromptDialog key={i} request={d} onDone={() => close(d)} />)}
        </>
    );
}

function ConfirmDialog({ request, onDone }: { request: Extract<DialogRequest, { kind: 'confirm' }>; onDone: () => void }) {
    const finish = (ok: boolean) => {
        request.resolve(ok);
        onDone();
    };

    return (
        <Modal
            title={request.title}
            onClose={() => finish(false)}
            class="dialog"
            footer={(
                <>
                    <span class="spacer" />
                    <Button onClick={() => finish(false)}>Cancel</Button>
                    <Button variant={request.danger ? 'danger' : 'primary'} onClick={() => finish(true)}>{request.confirm}</Button>
                </>
            )}
        >
            <div class="dialog-message">{request.message}</div>
        </Modal>
    );
}

function PromptDialog({ request, onDone }: { request: Extract<DialogRequest, { kind: 'prompt' }>; onDone: () => void }) {
    const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(request.fields.map(f => [f.key, f.value])));
    const errors = Object.fromEntries(request.fields.map(f => [f.key, f.validate?.(values[f.key], values) ?? null]));
    const valid = Object.values(errors).every(e => !e);

    const finish = (ok: boolean) => {
        if (ok && !valid) {
            return;
        }
        request.resolve(ok ? values : null);
        onDone();
    };

    return (
        <Modal
            title={request.title}
            onClose={() => finish(false)}
            class="dialog"
            footer={(
                <>
                    <span class="spacer" />
                    <Button onClick={() => finish(false)}>Cancel</Button>
                    <Button variant="primary" disabled={!valid} onClick={() => finish(true)}>{request.confirm}</Button>
                </>
            )}
        >
            {request.message && <div class="dialog-message">{request.message}</div>}
            <form onSubmit={e => {
                e.preventDefault();
                finish(true);
            }}>
                {request.fields.map((f, i) => (
                    <label class="field" key={f.key}>
                        <span class="field-label">{f.label}</span>
                        <input
                            class={`input ${errors[f.key] ? 'invalid' : ''}`}
                            value={values[f.key]}
                            placeholder={f.placeholder}
                            data-autofocus={i === 0 ? true : undefined}
                            onInput={e => setValues({ ...values, [f.key]: (e.target as HTMLInputElement).value })}
                        />
                        {errors[f.key] ? <span class="field-error">{errors[f.key]}</span> : f.hint && <span class="field-hint">{f.hint}</span>}
                    </label>
                ))}
                <button type="submit" hidden />
            </form>
        </Modal>
    );
}

// ---------------------------------------------------------------- fields ----

export function Field({ label, hint, inherited, children, wide, onReset }: {
    label: ComponentChildren;
    hint?: ComponentChildren;
    // Where the effective value comes from when this field is left empty
    inherited?: string | null;
    children: ComponentChildren;
    wide?: boolean;
    onReset?: () => void;
}) {
    return (
        <div class={`field ${wide ? 'field-wide' : ''}`}>
            <div class="field-label">
                <span>{label}</span>
                {onReset && <button type="button" class="field-reset" onClick={onReset} title="Remove this override">reset</button>}
                {!onReset && inherited && <span class="field-origin" title="Inherited value">{inherited}</span>}
            </div>
            {children}
            {hint && <div class="field-hint">{hint}</div>}
        </div>
    );
}

export function TextInput({ value, placeholder, onChange, list, mono, ...rest }: {
    value: string | number | null | undefined;
    placeholder?: string;
    onChange: (value: string) => void;
    list?: string;
    mono?: boolean;
} & Omit<JSX.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'list'>) {
    return (
        <input
            class={`input ${mono ? 'mono' : ''}`}
            value={value ?? ''}
            placeholder={placeholder}
            list={list}
            spellcheck={false}
            onInput={e => onChange((e.target as HTMLInputElement).value)}
            {...rest}
        />
    );
}

export function NumberInput({ value, placeholder, onChange, min, max, step }: {
    value: number | string | null | undefined;
    placeholder?: string;
    onChange: (value: number | undefined) => void;
    min?: number;
    max?: number;
    step?: number;
}) {
    return (
        <input
            class="input"
            type="number"
            value={value ?? ''}
            placeholder={placeholder}
            min={min}
            max={max}
            step={step ?? 1}
            onInput={e => {
                const raw = (e.target as HTMLInputElement).value;
                onChange(raw === '' ? undefined : Number(raw));
            }}
        />
    );
}

export function Select<T extends string>({ value, options, onChange, placeholder }: {
    value: T | '' | null | undefined;
    options: { value: T; label: string }[];
    onChange: (value: T | undefined) => void;
    placeholder?: string;
}) {
    return (
        <select class="input" value={value ?? ''} onChange={e => {
            const v = (e.target as HTMLSelectElement).value;
            onChange(v === '' ? undefined : v as T);
        }}>
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
    );
}

export function Segmented<T extends string>({ value, options, onChange, size }: {
    value: T | undefined;
    options: { value: T; label: string; title?: string }[];
    onChange: (value: T) => void;
    size?: 'small';
}) {
    return (
        <div class={`segmented ${size === 'small' ? 'segmented-small' : ''}`} role="radiogroup">
            {options.map(o => (
                <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={value === o.value}
                    class={value === o.value ? 'active' : ''}
                    title={o.title}
                    onClick={() => onChange(o.value)}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
    return (
        <label class="toggle">
            <input type="checkbox" checked={checked} onChange={e => onChange((e.target as HTMLInputElement).checked)} />
            <span class="toggle-track"><span class="toggle-thumb" /></span>
            {label && <span>{label}</span>}
        </label>
    );
}

const HEX_RE = /^\/?[0-9a-fA-F]{6}$/;

/** A colour as HomeDeck writes it: 6 hex digits without '#', or a Material You role. */
export function ColorInput({ value, placeholder, onChange, allowRoles }: {
    value: string | number | null | undefined;
    placeholder?: string | null;
    onChange: (value: string | undefined) => void;
    allowRoles?: boolean;
}) {
    const text = value === null || value === undefined ? '' : String(value);
    const swatch = HEX_RE.test(text) ? text.replace('/', '') : (placeholder && HEX_RE.test(placeholder) ? placeholder.replace('/', '') : null);
    const invalid = text !== '' && !HEX_RE.test(text) && !(allowRoles && /^[a-z-]+$/.test(text)) && !text.includes('{');

    return (
        <div class={`color-input ${invalid ? 'invalid' : ''}`}>
            <label class={`color-swatch ${swatch ? '' : 'empty'} ${text ? '' : 'inherited'}`} style={swatch ? { background: `#${swatch}` } : undefined}>
                <input
                    type="color"
                    value={`#${(swatch ?? 'ffffff').toLowerCase()}`}
                    onInput={e => onChange((e.target as HTMLInputElement).value.slice(1).toUpperCase())}
                />
            </label>
            <input
                class="input mono"
                value={text}
                placeholder={placeholder ?? 'none'}
                spellcheck={false}
                maxLength={allowRoles ? 40 : 7}
                onInput={e => {
                    const v = (e.target as HTMLInputElement).value.trim().replace(/^#/, '');
                    onChange(v === '' ? undefined : (HEX_RE.test(v) ? v.toUpperCase() : v));
                }}
            />
        </div>
    );
}

/** "x y" offsets and "w h" sizes. A single number means both. */
export function PairInput({ value, placeholder, onChange, labels = ['x', 'y'], blank = 'zero' }: {
    value: unknown;
    placeholder?: unknown;
    onChange: (value: number | string | undefined) => void;
    labels?: [string, string];
    // What an empty half means: 0 (offsets) or the same as the other (sizes)
    blank?: 'zero' | 'same';
}) {
    const [a, b] = toPair(value);
    const [pa, pb] = toPair(placeholder);

    const emit = (x: string, y: string) => {
        if (x === '' && y === '') {
            onChange(undefined);
            return;
        }

        const nx = Number(x === '' ? (blank === 'same' ? y : 0) : x);
        const ny = Number(y === '' ? (blank === 'same' ? x : 0) : y);
        onChange(nx === ny ? nx : `${nx} ${ny}`);
    };

    return (
        <div class="pair-input">
            <span>{labels[0]}</span>
            <input class="input" type="number" value={a} placeholder={pa} onInput={e => emit((e.target as HTMLInputElement).value, b)} />
            <span>{labels[1]}</span>
            <input class="input" type="number" value={b} placeholder={pb} onInput={e => emit(a, (e.target as HTMLInputElement).value)} />
        </div>
    );
}

function toPair(value: unknown): [string, string] {
    if (value === undefined || value === null || value === '') {
        return ['', ''];
    }
    if (typeof value === 'number') {
        return [String(value), String(value)];
    }
    if (Array.isArray(value)) {
        return [String(value[0]), String(value[1])];
    }
    const parts = String(value).trim().split(/\s+/);
    return [parts[0] ?? '', parts[1] ?? parts[0] ?? ''];
}

export function Callout({ kind = 'info', children }: { kind?: 'info' | 'warning' | 'error'; children: ComponentChildren }) {
    return (
        <div class={`callout callout-${kind}`}>
            <Glyph name={kind === 'info' ? 'information-outline' : kind === 'warning' ? 'alert' : 'alert-circle-outline'} size={16} />
            <div>{children}</div>
        </div>
    );
}
