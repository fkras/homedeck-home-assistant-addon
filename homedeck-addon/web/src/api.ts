/** Calls to the add-on's own server, which proxies the deck and Home Assistant. */
import type { HassStates } from './deck/presets';

export type Device = {
    address: string;
    name: string;
    port: number;
    properties: {
        api_version: string;
        version: string;
    };
};

export type WsMessage = {
    type: 'status';
    payload: { status: 'running' | 'stopped' };
} | {
    type: 'logs';
    payload: { message: string; timestamp: number };
};

export type HassServices = Record<string, Record<string, string>>;

// Ingress serves the add-on under a per-session path, so every URL is
// relative to wherever index.html was loaded from
const BASE = window.location.pathname.replace(/[^/]*$/, '');

export function deviceBase(device: Device): string {
    return `${BASE}proxy/${device.address}:${device.port}/v${device.properties.api_version}`;
}

export function deviceLabel(device: Device): string {
    return `${device.name.replace(/\._homedeck\._tcp\.local\.?$/, '')} (${device.address})`;
}

async function getJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    const json = await response.json();
    if (json?.error) {
        throw new Error(json.error);
    }

    return json as T;
}

export async function fetchDevices(): Promise<Device[]> {
    return (await getJson<{ data: Device[] }>(`${BASE}devices`)).data;
}

export async function fetchConfiguration(device: Device): Promise<string> {
    return (await getJson<{ data: { content: string } }>(`${deviceBase(device)}/configuration`)).data.content;
}

/** HomeDeck's built-in defaults. Null when the deck's HomeDeck predates the endpoint. */
export async function fetchBaseConfiguration(device: Device): Promise<string | null> {
    try {
        return (await getJson<{ data: { content: string } }>(`${deviceBase(device)}/base_configuration`)).data.content;
    } catch {
        return null;
    }
}

export async function fetchSchema(device: Device): Promise<any> {
    return getJson(`${deviceBase(device)}/schema`);
}

export async function saveConfiguration(device: Device, content: string): Promise<void> {
    const response = await fetch(`${deviceBase(device)}/configuration`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
    });

    const json = await response.json();
    if (json?.error) {
        throw new Error(json.error);
    }
}

export async function controlDeck(device: Device, command: 'start' | 'stop'): Promise<void> {
    await fetch(`${deviceBase(device)}/${command}`, { method: 'POST' });
}

export function openDeckSocket(device: Device): WebSocket {
    // Ingress is usually HTTPS, where a ws:// URL is blocked as mixed content
    const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return new WebSocket(`${scheme}://${window.location.host}${deviceBase(device)}/ws`);
}

export async function fetchHassStates(): Promise<HassStates> {
    const { data } = await getJson<{ data: HassStates[keyof HassStates][] }>(`${BASE}ha/states`);
    return Object.fromEntries(data.map(s => [s.entity_id, s]));
}

export async function fetchHassServices(): Promise<HassServices> {
    return (await getJson<{ data: HassServices }>(`${BASE}ha/services`)).data;
}
