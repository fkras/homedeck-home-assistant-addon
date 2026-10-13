/**
 * Icon names as HomeDeck understands them, and where the preview gets the art.
 *
 * HomeDeck downloads `mdi:` from the MaterialDesign repo, `pi:` from Phosphor's
 * repo and `cbi:` from Iconify. The glyphs are the same in all three places, so
 * the preview uses Iconify for everything: one CORS-enabled API that serves
 * path data in bulk, and can search.
 */
import { getIconData, svgDataUrl } from './iconify';
import { isTemplate } from './presets';

export type IconSource = 'mdi' | 'pi' | 'cbi' | 'local' | 'url' | 'template' | 'blank' | 'invalid';

export type IconRef = { source: IconSource; name: string };

export const ICON_SOURCES: { id: 'mdi' | 'cbi' | 'pi'; label: string; iconify: string }[] = [
    { id: 'mdi', label: 'Material Design', iconify: 'mdi' },
    { id: 'cbi', label: 'Brand icons', iconify: 'cbi' },
    { id: 'pi', label: 'Phosphor', iconify: 'ph' },
];

export const PHOSPHOR_VARIANTS = ['regular', 'thin', 'light', 'bold', 'fill', 'duotone'] as const;

const ICONIFY = 'https://api.iconify.design';

export function parseIcon(icon: unknown): IconRef {
    if (icon === null || icon === undefined || icon === '') {
        return { source: 'blank', name: '' };
    }

    if (typeof icon !== 'string') {
        return { source: 'invalid', name: String(icon) };
    }

    if (isTemplate(icon)) {
        return { source: 'template', name: icon };
    }

    // A bare URL passes the schema but HomeDeck draws nothing for it: the
    // source is the text before the first colon, so it must be `url:https://...`
    const match = icon.trim().match(/^(mdi|pi|cbi|local|url):(.+)$/);
    if (!match) {
        return { source: 'invalid', name: icon };
    }

    return { source: match[1] as IconSource, name: match[2] };
}

/**
 * The art for an icon at a pixel size, as an image URL: a data URL built from
 * Iconify's path data, or the image itself for `url:`. Null when there's
 * nothing to show (blank, template, local file). Rejects when the icon doesn't
 * exist or Iconify can't be reached.
 */
export async function iconArt(ref: IconRef, options: { variant?: string | null; color?: string | null; width: number; height: number }): Promise<string | null> {
    let prefix: string;
    let name = ref.name;
    switch (ref.source) {
        case 'mdi':
            prefix = 'mdi';
            break;
        case 'cbi':
            prefix = 'cbi';
            break;
        case 'pi':
            // HomeDeck appends the weight to the name, except for regular
            prefix = 'ph';
            if (options.variant && options.variant !== 'regular') {
                name += `-${options.variant}`;
            }
            break;
        case 'url':
            return ref.name;
        default:
            return null;
    }

    const data = await getIconData(prefix, name);
    if (!data) {
        throw new Error(`There's no icon called ${ref.source}:${name}`);
    }

    return svgDataUrl(data, options);
}

const PHOSPHOR_SUFFIX = /-(thin|light|bold|fill|duotone)$/;

/**
 * Iconify lists every Phosphor weight as its own icon. HomeDeck takes the
 * weight from `icon_variant`, so keep only the regular names: those whose
 * "-bold" sibling is also present. (Stripping suffixes blindly would turn
 * "traffic-light" into "traffic".)
 */
function regularPhosphorNames(names: string[]): string[] {
    const set = new Set(names);
    const regular = names.filter(n => set.has(`${n}-bold`));
    return regular.length ? regular : names.filter(n => !PHOSPHOR_SUFFIX.test(n));
}

function toHomeDeck(source: 'mdi' | 'cbi' | 'pi', iconifyNames: string[]): string[] {
    const names = iconifyNames.map(n => n.includes(':') ? n.split(':')[1] : n);
    const filtered = source === 'pi' ? regularPhosphorNames(names) : names;
    return filtered.map(n => `${source}:${n}`);
}

const collectionCache = new Map<string, Promise<string[]>>();

/** Every icon in a set, for browsing without a search term. */
export function listIcons(source: 'mdi' | 'cbi' | 'pi'): Promise<string[]> {
    const prefix = ICON_SOURCES.find(s => s.id === source)!.iconify;
    let cached = collectionCache.get(prefix);
    if (!cached) {
        cached = fetch(`${ICONIFY}/collection?prefix=${prefix}`)
            .then(r => r.json())
            .then((json: { uncategorized?: string[]; categories?: Record<string, string[]> }) => {
                const names = new Set<string>(json.uncategorized ?? []);
                for (const list of Object.values(json.categories ?? {})) {
                    list.forEach(n => names.add(n));
                }
                return toHomeDeck(source, [...names].sort());
            });
        cached.catch(() => collectionCache.delete(prefix));
        collectionCache.set(prefix, cached);
    }

    return cached;
}

export async function searchIcons(source: 'mdi' | 'cbi' | 'pi', query: string, signal?: AbortSignal): Promise<string[]> {
    const prefix = ICON_SOURCES.find(s => s.id === source)!.iconify;
    const url = `${ICONIFY}/search?query=${encodeURIComponent(query)}&prefix=${prefix}&limit=999`;
    const json = await (await fetch(url, { signal })).json() as { icons?: string[] };
    return toHomeDeck(source, json.icons ?? []);
}
