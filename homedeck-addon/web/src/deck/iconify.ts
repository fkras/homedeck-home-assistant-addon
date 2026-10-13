/**
 * Icon art from Iconify, fetched in bulk.
 *
 * Requesting each SVG on its own got this network rate-limited (HTTP 429)
 * after a few icon grids: a grid is 240 icons. Iconify's JSON API returns
 * many icons' path data in one response, so every icon wanted in the same
 * tick is batched into one request per icon set, and the SVG is built here.
 */

const ICONIFY = 'https://api.iconify.design';
// Keeps the request URL well under common length limits
const BATCH = 80;

export type IconData = {
    body: string;
    left: number;
    top: number;
    width: number;
    height: number;
};

type Waiter = { resolve: (data: IconData | null) => void; reject: (error: Error) => void };

const cache = new Map<string, Promise<IconData | null>>();
const pending = new Map<string, Map<string, Waiter[]>>();
let scheduled = false;

export function getIconData(prefix: string, name: string): Promise<IconData | null> {
    const key = `${prefix}:${name}`;
    const cached = cache.get(key);
    if (cached) {
        return cached;
    }

    const promise = new Promise<IconData | null>((resolve, reject) => {
        const names = pending.get(prefix) ?? new Map<string, Waiter[]>();
        pending.set(prefix, names);
        names.set(name, [...(names.get(name) ?? []), { resolve, reject }]);
    });

    // A failure (offline, rate-limited) shouldn't stick: drop it so a later render retries
    promise.catch(() => cache.delete(key));
    cache.set(key, promise);

    if (!scheduled) {
        scheduled = true;
        setTimeout(flush, 0);
    }

    return promise;
}

type IconSet = {
    prefix: string;
    icons?: Record<string, Partial<IconData> & { body: string }>;
    aliases?: Record<string, { parent: string } & Partial<IconData>>;
    not_found?: string[];
    left?: number;
    top?: number;
    width?: number;
    height?: number;
};

function resolveIcon(set: IconSet, name: string, depth = 0): IconData | null {
    const icon = set.icons?.[name];
    if (icon) {
        return {
            body: icon.body,
            left: icon.left ?? set.left ?? 0,
            top: icon.top ?? set.top ?? 0,
            width: icon.width ?? set.width ?? 16,
            height: icon.height ?? set.height ?? 16,
        };
    }

    const alias = set.aliases?.[name];
    if (alias && depth < 5) {
        const parent = resolveIcon(set, alias.parent, depth + 1);
        return parent && {
            ...parent,
            ...(alias.width !== undefined ? { width: alias.width } : {}),
            ...(alias.height !== undefined ? { height: alias.height } : {}),
        };
    }

    return null;
}

async function flush() {
    scheduled = false;
    const work = [...pending.entries()];
    pending.clear();

    for (const [prefix, names] of work) {
        const list = [...names.keys()];
        for (let i = 0; i < list.length; i += BATCH) {
            const chunk = list.slice(i, i + BATCH);
            try {
                const response = await fetch(`${ICONIFY}/${prefix}.json?icons=${chunk.map(encodeURIComponent).join(',')}`);
                if (!response.ok) {
                    throw new Error(response.status === 429 ? 'Iconify is rate-limiting this network - try again in a few minutes' : `Iconify answered ${response.status}`);
                }

                const set = await response.json() as IconSet;
                for (const name of chunk) {
                    const data = resolveIcon(set, name);
                    names.get(name)!.forEach(w => w.resolve(data));
                }
            } catch (e) {
                const error = e instanceof Error ? e : new Error(String(e));
                for (const name of chunk) {
                    names.get(name)!.forEach(w => w.reject(error));
                }
            }
        }
    }
}

/** An SVG data URL for icon data, coloured the way HomeDeck's apply_color does. */
export function svgDataUrl(data: IconData, options: { color?: string | null; width: number; height: number }): string {
    // The sets draw with currentColor; HomeDeck recolours every visible pixel,
    // which for these single-colour sets comes to the same thing
    const body = options.color ? data.body.replaceAll('currentColor', `#${options.color}`) : data.body;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${options.width}" height="${options.height}" viewBox="${data.left} ${data.top} ${data.width} ${data.height}">${body}</svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
