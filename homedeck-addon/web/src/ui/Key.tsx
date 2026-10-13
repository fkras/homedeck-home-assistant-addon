import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import type { Dict } from '../deck/presets';
import { normalizeColor, renderKey } from '../deck/render';
import { Glyph } from './primitives';

// HomeDeck's transitions.py: one frame per 100 ms, at most 20, smoothstep
const FRAME_INTERVAL = 0.1;
const MAX_FRAMES = 20;
const ease = (t: number) => t * t * (3 - 2 * t);

/**
 * Cross-fade `target` to `next` the way HomeDeck fades a key on the deck:
 * in the same few steps, rather than smoothly, so the preview doesn't
 * promise more than the deck shows.
 */
function crossfade(target: HTMLCanvasElement, next: HTMLCanvasElement, duration: number, timer: { current?: ReturnType<typeof setTimeout> }) {
    const from = document.createElement('canvas');
    from.width = target.width;
    from.height = target.height;
    from.getContext('2d')!.drawImage(target, 0, 0);

    const ctx = target.getContext('2d')!;
    const steps = Math.max(1, Math.min(MAX_FRAMES, Math.round(duration / FRAME_INTERVAL)));
    let step = 0;

    const tick = () => {
        step++;
        ctx.clearRect(0, 0, target.width, target.height);
        ctx.globalAlpha = 1;
        ctx.drawImage(from, 0, 0);
        ctx.globalAlpha = ease(step / steps);
        ctx.drawImage(next, 0, 0);
        ctx.globalAlpha = 1;
        if (step < steps) {
            timer.current = setTimeout(tick, (duration * 1000) / steps);
        }
    };
    tick();
}

/**
 * The key art, drawn the way HomeDeck draws it. When `fadeKey` (the entity
 * state shown) changes and the button has a `transition`, it fades into the
 * new look as the deck would; any other change - editing a colour - is
 * drawn at once.
 */
export function KeyCanvas({ config, onIssues, fadeKey }: { config: Dict | null; onIssues?: (issues: string[]) => void; fadeKey?: string | null }) {
    const ref = useRef<HTMLCanvasElement>(null);
    const shownFadeKey = useRef<string | null | undefined>(undefined);
    const timer = useRef<ReturnType<typeof setTimeout>>();
    const signature = JSON.stringify(config);

    useEffect(() => {
        let cancelled = false;
        // Draw offscreen so a slow icon can't land after a newer render
        const scratch = document.createElement('canvas');
        renderKey(scratch, config).then(issues => {
            if (cancelled || !ref.current) {
                return;
            }

            const target = ref.current;
            const duration = Number(config?.transition) || 0;
            const fade = duration > 0 && shownFadeKey.current !== undefined && fadeKey !== shownFadeKey.current;
            shownFadeKey.current = fadeKey;

            clearTimeout(timer.current);
            if (fade && target.width === scratch.width) {
                crossfade(target, scratch, Math.min(duration, 5), timer);
            } else {
                target.width = scratch.width;
                target.height = scratch.height;
                target.getContext('2d')!.drawImage(scratch, 0, 0);
            }
            onIssues?.(issues);
        });

        return () => {
            cancelled = true;
        };
    }, [signature, fadeKey]);

    useEffect(() => () => clearTimeout(timer.current), []);

    return <canvas class="key-canvas" ref={ref} width={196} height={196} />;
}

/**
 * The label is drawn by the deck's firmware from `name`, styled by the
 * deck-wide `label_style` - HomeDeck only sends the text.
 */
export function KeyLabel({ name, labelStyle, templated }: { name: unknown; labelStyle: Dict; templated?: boolean }) {
    if (labelStyle.show_title === false || name === null || name === undefined || String(name).trim() === '') {
        return null;
    }

    const color = normalizeColor(labelStyle.color) ?? 'FFFFFF';
    const size = Number(labelStyle.size) || 9;

    return (
        <div
            class={`key-label key-label-${labelStyle.align ?? 'bottom'} ${templated ? 'templated' : ''}`}
            style={{ color: `#${color}`, fontSize: `calc(var(--key) * ${(size * 1.15) / 100})` }}
        >
            {templated ? 'ƒ template' : String(name).trim()}
        </div>
    );
}

export function KeyBadge({ icon, title, tone = 'default' }: { icon: Parameters<typeof Glyph>[0]['name']; title: string; tone?: 'default' | 'warning' | 'accent' }) {
    return (
        <span class={`key-badge key-badge-${tone}`} title={title}>
            <Glyph name={icon} size={12} />
        </span>
    );
}

/** The bottom-right double-width key. Drawn entirely by the deck's firmware. */
export function SmallWindow({ onClick }: { onClick: () => void }) {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 15_000);
        return () => clearInterval(timer);
    }, []);

    const minutes = now.getMinutes();
    const hours = now.getHours() % 12;

    return (
        <button type="button" class="key small-window" onClick={onClick} title="The small window - drawn by the deck's firmware">
            <svg class="sw-clock" viewBox="0 0 40 40" aria-hidden="true">
                <circle cx="20" cy="20" r="18" />
                {Array.from({ length: 12 }, (_, i) => (
                    <line key={i} x1="20" y1="4.5" x2="20" y2={i % 3 === 0 ? 7.5 : 6} transform={`rotate(${i * 30} 20 20)`} />
                ))}
                <line class="sw-hour" x1="20" y1="20" x2="20" y2="11" transform={`rotate(${hours * 30 + minutes / 2} 20 20)`} />
                <line class="sw-minute" x1="20" y1="20" x2="20" y2="7" transform={`rotate(${minutes * 6} 20 20)`} />
                <circle cx="20" cy="20" r="1.4" class="sw-pin" />
            </svg>
            <span class="sw-time">{String(now.getHours()).padStart(2, '0')}:{String(minutes).padStart(2, '0')}</span>
            <span class="sw-badge">firmware</span>
        </button>
    );
}

export function KeyFrame({ children, class: className, ...rest }: { children?: ComponentChildren; class?: string } & Record<string, any>) {
    return <div class={`key ${className ?? ''}`} {...rest}>{children}</div>;
}
