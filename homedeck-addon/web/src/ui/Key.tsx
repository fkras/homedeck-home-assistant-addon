import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import type { Dict } from '../deck/presets';
import { normalizeColor, renderKey } from '../deck/render';
import { Glyph } from './primitives';

/** The key art, drawn the way HomeDeck draws it. */
export function KeyCanvas({ config, onIssues }: { config: Dict | null; onIssues?: (issues: string[]) => void }) {
    const ref = useRef<HTMLCanvasElement>(null);
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
            target.width = scratch.width;
            target.height = scratch.height;
            target.getContext('2d')!.drawImage(scratch, 0, 0);
            onIssues?.(issues);
        });

        return () => {
            cancelled = true;
        };
    }, [signature]);

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
