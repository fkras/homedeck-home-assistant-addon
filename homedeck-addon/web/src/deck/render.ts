/**
 * Draw a key the way HomeDeck does.
 *
 * Follows the Pillow pipeline in icons.py step for step - icon at icon_size,
 * padding, background, border and corner radius, offset, brightness, then a
 * centred crop to the key - so sizes, paddings and offsets land where they will
 * on the deck. The label (`name`) is not part of the image: the deck's firmware
 * draws it, so the UI overlays it separately.
 */
import { iconArt, parseIcon } from './icons';
import type { Dict } from './presets';

export const KEY_SIZE = 196;

// PageButtonConfig fields with metadata icon / text_icon (dataclasses.py)
const ICON_FIELDS = [
    'material_you_color', 'material_you_scheme', 'icon_variant', 'icon', 'icon_size', 'icon_size_mode',
    'icon_padding', 'icon_color', 'icon_background_color', 'icon_offset', 'icon_border_radius',
    'icon_border_width', 'icon_border_color', 'icon_brightness',
];
const TEXT_FIELDS = [
    'material_you_color', 'material_you_scheme', 'text', 'text_color', 'text_align', 'text_font', 'text_size', 'text_offset',
];

/** utils.normalize_hex_color */
export function normalizeColor(color: unknown): string | null {
    if (color === null || color === undefined || color === '' || color === 0 || color === false) {
        return null;
    }

    let value = String(color);
    if (value.startsWith('/')) {
        value = value.slice(1);
    }

    value = value.padEnd(6, '0').toUpperCase();
    return /[0-9A-F]{6}/.test(value) ? value.slice(0, 6) : null;
}

/** utils.normalize_tuple */
export function normalizeTuple(value: unknown): [number, number] {
    if (Array.isArray(value) && value.length === 2) {
        return [Number(value[0]) || 0, Number(value[1]) || 0];
    }

    if (typeof value === 'number' && Number.isInteger(value)) {
        return [value, value];
    }

    if (typeof value === 'string') {
        const parts = value.split(' ');
        const a = Number.parseInt(parts[0], 10);
        const b = Number.parseInt(parts[1], 10);
        if (Number.isFinite(a) && Number.isFinite(b) && /^-?\d+$/.test(parts[0]) && /^-?\d+$/.test(parts[1] ?? '')) {
            return [a, b];
        }
    }

    return [0, 0];
}

function present(value: unknown) {
    return value !== null && value !== undefined;
}

/** IconProvider.get_icon: the button split into its layers, in drawing order. */
export function layersOf(config: Dict): Dict[] {
    const main: Dict = { icon_size_mode: 'cover', icon_offset: [0, 0] };
    const text: Dict = {};

    for (const key of ICON_FIELDS) {
        if (present(config[key])) {
            main[key] = config[key];
        }
    }

    for (const key of TEXT_FIELDS) {
        if (present(config[key])) {
            text[key] = config[key];
        }
    }

    const layers = [main];
    if (Object.keys(text).length) {
        layers.push(text);
    }

    for (const extra of config.additional_icons ?? []) {
        if (extra && typeof extra === 'object') {
            layers.push(extra);
        }
    }

    // sorted(key=z_index) is stable, lowest first, later layers on top
    return layers
        .map((layer, order) => ({ layer, order }))
        .sort((a, b) => (Number(a.layer.z_index) || 0) - (Number(b.layer.z_index) || 0) || a.order - b.order)
        .map(({ layer }) => layer);
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(url: string): Promise<HTMLImageElement> {
    let cached = imageCache.get(url);
    if (!cached) {
        cached = new Promise((resolve, reject) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error(`Could not load ${url}`));
            img.src = url;
        });
        cached.catch(() => imageCache.delete(url));
        imageCache.set(url, cached);
    }

    return cached;
}

function canvas(width: number, height: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(width));
    c.height = Math.max(1, Math.round(height));
    return c;
}

function ctx2d(c: HTMLCanvasElement) {
    return c.getContext('2d')!;
}

function pad(src: HTMLCanvasElement, padding: number): HTMLCanvasElement {
    if (!padding || padding <= 0) {
        return src;
    }

    const out = canvas(src.width + padding * 2, src.height + padding * 2);
    ctx2d(out).drawImage(src, padding, padding);
    return out;
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
    c.beginPath();
    c.roundRect(x, y, Math.max(0, w), Math.max(0, h), Math.max(0, Math.min(r, w / 2, h / 2)));
}

export type RenderIssue = { layer: number; message: string };

/**
 * IconEditor.resize for raster images (svg art is drawn straight at its size).
 */
function drawResized(c: CanvasRenderingContext2D, img: HTMLImageElement, mode: string, w: number, h: number) {
    const iw = img.naturalWidth || w;
    const ih = img.naturalHeight || h;
    const imgAspect = iw / ih;
    const targetAspect = w / h;

    if (mode === 'stretch') {
        c.drawImage(img, 0, 0, w, h);
    } else if (mode === 'contain') {
        const scale = Math.min(1, w / iw, h / ih);  // thumbnail() never enlarges
        const dw = Math.floor(iw * scale);
        const dh = Math.floor(ih * scale);
        c.drawImage(img, Math.floor((w - dw) / 2), Math.floor((h - dh) / 2), dw, dh);
    } else {
        let dw: number;
        let dh: number;
        if (imgAspect > targetAspect) {
            dh = h;
            dw = Math.floor(h * imgAspect);
        } else {
            dw = w;
            dh = Math.floor(w / imgAspect);
        }
        c.drawImage(img, Math.floor((w - dw) / 2), Math.floor((h - dh) / 2), dw, dh);
    }
}

async function rasterizeIcon(layer: Dict, issues: string[]): Promise<HTMLCanvasElement> {
    let [w, h] = normalizeTuple(layer.icon_size ?? [KEY_SIZE, KEY_SIZE]);
    if (w === 0) {
        w = KEY_SIZE;
    }
    if (h === 0) {
        h = KEY_SIZE;
    }

    let img = canvas(w, h);
    const ref = parseIcon(layer.icon);
    const color = normalizeColor(layer.icon_color ?? 'FFFFFF');

    if (ref.source === 'template') {
        issues.push('icon is a template, evaluated on the deck');
    } else if (ref.source === 'local') {
        issues.push(`local file ${ref.name} can't be previewed`);
    } else if (ref.source === 'invalid') {
        issues.push(`"${ref.name}" isn't a valid icon - use mdi:, cbi:, pi:, url: or local:`);
    } else {
        try {
            const url = await iconArt(ref, { variant: layer.icon_variant, color, width: w, height: h });
            if (url) {
                const art = await loadImage(url);
                const c = ctx2d(img);
                if (ref.source === 'url') {
                    drawResized(c, art, layer.icon_size_mode ?? 'cover', w, h);
                } else {
                    c.drawImage(art, 0, 0, w, h);
                }
            }
        } catch (e) {
            issues.push(ref.source === 'url' ? `couldn't load ${layer.icon}` : (e as Error).message);
        }
    }

    img = pad(img, Number(layer.icon_padding) || 0);

    const background = normalizeColor(layer.icon_background_color);
    if (background) {
        const out = canvas(img.width, img.height);
        const c = ctx2d(out);
        c.fillStyle = `#${background}`;
        c.fillRect(0, 0, out.width, out.height);
        c.drawImage(img, 0, 0);
        img = out;
    }

    // Border and corner radius. The border colour falls back to the icon
    // colour, then the background, then white - as _normalize_icon does.
    const borderWidth = Number(layer.icon_border_width) || 0;
    const radius = Number(layer.icon_border_radius) || 0;
    const borderColor = normalizeColor(layer.icon_border_color) ?? color ?? background ?? 'FFFFFF';
    {
        img = pad(img, borderWidth);
        const W = img.width;
        const H = img.height;
        const out = canvas(W, H);
        const c = ctx2d(out);

        c.save();
        roundRect(c, 0, 0, W, H, radius);
        c.clip();
        c.fillStyle = `#${borderColor}`;
        c.fillRect(0, 0, W, H);
        c.restore();

        c.save();
        roundRect(c, borderWidth, borderWidth, W - 2 * borderWidth, H - 2 * borderWidth, Math.max(0, radius - borderWidth));
        c.clip();
        c.clearRect(0, 0, W, H);
        c.drawImage(img, 0, 0);
        c.restore();

        img = out;
    }

    const [ox, oy] = normalizeTuple(layer.icon_offset);
    if (ox !== 0 || oy !== 0) {
        const out = canvas(img.width + Math.abs(ox), img.height + Math.abs(oy));
        ctx2d(out).drawImage(img, Math.max(ox, 0), Math.max(oy, 0));
        img = out;
    }

    const brightness = Number(layer.icon_brightness);
    if (brightness && brightness > 0 && brightness <= 100) {
        // ImageEnhance.Brightness blends towards transparent black, so the
        // alpha drops along with the colour
        const out = canvas(img.width, img.height);
        const c = ctx2d(out);
        c.filter = `brightness(${brightness / 100})`;
        c.globalAlpha = brightness / 100;
        c.drawImage(img, 0, 0);
        img = out;
    }

    return img;
}

export const DEFAULT_FONT = 'Roboto-SemiBold';

function rasterizeText(layer: Dict): HTMLCanvasElement | null {
    const out = canvas(KEY_SIZE, KEY_SIZE);
    const text = layer.text;
    const color = normalizeColor(layer.text_color ?? 'FFFFFF');
    const size = Number(layer.text_size ?? 20);
    const font = layer.text_font ?? DEFAULT_FONT;
    const align = layer.text_align ?? 'center';
    const [ox, oy] = normalizeTuple(layer.text_offset ?? [0, 0]);

    if (!text || !color || !font || !size) {
        return null;
    }

    const c = ctx2d(out);
    c.font = `${size}px "${font}", "${DEFAULT_FONT}", sans-serif`;
    c.textBaseline = 'top';
    c.fillStyle = `#${color}`;

    // Pillow's textbbox from (0, 0) gives the ink's right and bottom edges
    const lines = String(text).split('\n');
    const lineHeight = size + 4;
    const metrics = lines.map(line => c.measureText(line));
    const width = Math.max(...metrics.map(m => m.actualBoundingBoxRight));
    const height = (lines.length - 1) * lineHeight + metrics[metrics.length - 1].actualBoundingBoxDescent;

    const x = Math.floor((KEY_SIZE - width) / 2) + ox;
    let y = align === 'top' ? 0 : align === 'center' ? Math.floor((KEY_SIZE - height) / 2) : KEY_SIZE - height;
    y += oy;

    lines.forEach((line, i) => c.fillText(line, x, y + i * lineHeight));
    return out;
}

/** Render a resolved button into `target` (any size; drawn at 196 and scaled). */
export async function renderKey(target: HTMLCanvasElement, config: Dict | null): Promise<string[]> {
    const issues: string[] = [];
    const out = canvas(KEY_SIZE, KEY_SIZE);
    const c = ctx2d(out);

    if (config) {
        await document.fonts?.load(`20px "${DEFAULT_FONT}"`).catch(() => undefined);

        for (const layer of layersOf(config)) {
            // _normalize_icon: an icon wins over text; with neither it's a
            // blank icon, which still draws its background and border
            if (!layer.icon && layer.text) {
                const img = rasterizeText(layer);
                if (img) {
                    c.drawImage(img, 0, 0);
                }
                continue;
            }

            const img = await rasterizeIcon(layer, issues);
            // IconEditor.crop: centred, floor division as in Python
            c.drawImage(img, Math.floor((KEY_SIZE - img.width) / 2), Math.floor((KEY_SIZE - img.height) / 2));
        }
    }

    target.width = KEY_SIZE;
    target.height = KEY_SIZE;
    const t = ctx2d(target);
    t.clearRect(0, 0, KEY_SIZE, KEY_SIZE);
    t.drawImage(out, 0, 0);

    return issues;
}
