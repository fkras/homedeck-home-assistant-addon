# HomeDeck Manager — Home Assistant Add-on

Edit your [HomeDeck](https://github.com/redphx/homedeck) configuration from inside
Home Assistant instead of over SSH.

This add-on adds a panel to the Home Assistant sidebar with a **visual editor**
that shows the Ulanzi D200 as it will look - every key, every page - plus the
YAML editor for the deck's `configuration.yml`, live validation against the
device's own schema, a start/stop control, and a live log view.

> This is a fork of [redphx/homedeck-home-assistant-addon](https://github.com/redphx/homedeck-home-assistant-addon)
> with fixes described in [Changes in this fork](#changes-in-this-fork).

## What it is (and isn't)

**It is** two views of one YAML file:

- **Visual** - the D200's 13 keys and small window, rendered the way HomeDeck
  draws them (presets, entity state, icons, text). Click a key to edit its
  icon, label, actions and per-state looks; drag keys to rearrange them; manage
  pages and presets; and set the deck-wide options in **Deck settings** -
  brightness, labels, dimming and the night schedule, and the D200's own
  firmware sleep, error alert and screensaver.
- **YAML** - a schema-aware editor (Monaco, the editor from VS Code) with
  autocomplete, inline errors, and a Problems list, driven by the JSON schema
  the connected device serves.

The YAML stays the only source of truth, and it's what gets saved. Every visual
change is written into it as a normal edit - comments, quoting and formatting
are kept, so a change touches only its own lines - and undo works across both
views. Saving is blocked while the config has errors.

**It is not** a renderer of the deck itself: the preview is drawn in your
browser by a port of HomeDeck's own pipeline. It matches HomeDeck's output
closely, but Jinja templates (other than a few common shapes) and `local:`
images are shown as placeholders, and the label font is an approximation of the
firmware's.

**The deck does not plug into your Home Assistant machine.** The add-on finds
HomeDeck devices on your LAN over mDNS and talks to them over HTTP. The deck
stays plugged into its own SBC (Orange Pi, Raspberry Pi, …).

## How it works

```
Home Assistant                          Orange Pi / SBC
┌──────────────────────────┐            ┌────────────────────────┐
│ HomeDeck Manager add-on  │            │ server.py  (port 3325) │
│  ├─ mDNS scan ───────────┼── finds ──▶│  _homedeck._tcp.local  │
│  ├─ Ingress UI (:4663)   │            │                        │
│  └─ HTTP/WS proxy ───────┼── talks ──▶│  /v1/configuration     │
└──────────────────────────┘   to       │  /v1/schema            │
                                        │  /v1/start  /v1/stop   │
        your browser                    │  /v1/ws (logs/status)  │
                                        │        │               │
                                        │        ▼               │
                                        │   deck.py ──USB──▶ D200│
                                        └────────────────────────┘
```

The add-on never talks to the deck hardware itself — it only reads and writes the
configuration file on the SBC and starts/stops the process that owns the USB
connection.

## Requirements

- Home Assistant OS or Supervised (the add-on store is required; HA Container
  cannot install add-ons).
- A HomeDeck device on the **same subnet**, running `server.py`.
- mDNS traffic (UDP 5353) allowed between Home Assistant and the device. Many
  routers block multicast between VLANs or between wired and wireless clients.

## Setup

### 1. Run the API server on the SBC

The add-on can only see devices that are running `server.py` — not just `deck.py`.
Using the [service unit from the fork](https://github.com/fkras/homedeck):

```bash
sudo cp homedeck-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now homedeck-server
```

Check it is listening on the LAN, not just localhost:

```bash
curl -I http://<SBC-IP>:3325/v1/status     # expect: HTTP/1.1 200 OK
```

> [!IMPORTANT]
> `server.py` **starts and manages `deck.py` itself**, and the add-on's
> Start/Stop buttons control that child process. Run **either**
> `homedeck.service` **or** `homedeck-server.service`, not both — otherwise
> systemd will immediately restart a deck you stopped from the UI.

> [!NOTE]
> Give the SBC a **static DHCP lease**. The add-on addresses devices by IPv4 and
> rejects hostnames, so the saved device changes identity if its address moves.

### 2. Install the add-on

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store**.
2. Open the **⋮** menu (top right) → **Repositories**.
3. Add this repository URL and click **Add**:
   ```
   https://github.com/fkras/homedeck-home-assistant-addon
   ```
4. Close the dialog, refresh, and find **HomeDeck Manager** in the store.
5. Click **Install**. It builds from source on first install, which takes a few
   minutes on a Pi — this is normal.
6. Enable **Show in sidebar**, then **Start**.

### 3. Open it

Click **HomeDeck Manager** in the sidebar. It scans for devices on load; when one
is found you get the editor, otherwise a "No devices found" message with a
Refresh button.

## Using it

| Control | What it does |
|:--|:--|
| Device dropdown | Selects which deck to edit, when several are on the network |
| **Visual** / **YAML** | Switches between the deck view and the YAML editor - same file |
| A key | Opens the button editor: entity, label, presets, icon (searchable MDI, brand and Phosphor sets), text, tap and hold actions, per-state overrides, and a fade between states. Empty fields show what the button inherits and from where |
| Drag a key | Swaps it with another key, or moves it to an empty one. Alt/Option-drag drops a copy |
| Copy icon on a key | Duplicates it into the next free key |
| Right-click a key | Duplicate, copy to another page, clear, remove, show in YAML, open the page it links to |
| Page tabs | Switch pages; **+ Page** adds one; the ⋮ menu renames it, changes its ID (updating every button that links to it) or deletes it |
| **Preview** Live / On / Off | Shows entities in their current Home Assistant state, or all on / all off |
| **Deck settings** | Brightness, label style, dimming and night schedule, firmware sleep, error alerts, screensaver, navigation key positions |
| **Save** (`Ctrl/⌘ S`) | Saves to the device. Disabled while there are errors |
| Undo / Redo | Covers visual and YAML edits alike |
| **Start** / **Stop** | Starts or stops `deck.py` on the device |
| Problems | Schema violations. Click one to jump to its line |
| Logs | Live output from `deck.py` |

The button editor also warns about the mistakes that are easy to make and
silent on the deck: an action whose domain doesn't match the entity's
(`light.toggle` on a `switch.*` does nothing), the `$light` preset replacing your
icon while the light is on, a bare `https://` icon (it needs `url:`), and an
unquoted `on` state key, which YAML reads as `true`.

Entity and action suggestions come from Home Assistant's API, which is why the
add-on asks for `homeassistant_api` access. Without it everything still works,
minus the suggestions and the live state in the preview.

The deck hot-reloads its configuration on save — no restart needed, and the
screen redraws in place.

Saving is a **full overwrite** of the file, and the add-on keeps no history.
Keep your configuration in git on the SBC if you want to be able to roll back.

### Validation

The schema comes from the connected device (`GET /v1/schema`), not from the
add-on, so validation always matches the version of HomeDeck actually running.
Features added on the device — like the `sleep.schedule` night-dimming block in
[the fork](https://github.com/fkras/homedeck) — autocomplete and validate here
with no add-on change.

Invalid configurations are rejected **twice**: once live in the editor, and again
by `server.py` on save. A rejected save leaves the previous configuration intact.

## Troubleshooting

### "No devices found"

Work through it in this order:

1. **Is `server.py` running?**
   `systemctl status homedeck-server` on the SBC.
2. **Is it reachable from Home Assistant?** From an HA terminal:
   ```bash
   curl -I http://<SBC-IP>:3325/v1/status
   ```
   A non-200 means the add-on will filter the device out — discovery only lists
   devices whose `HEAD /v1/status` returns 200.
   - **404** → you are on upstream `redphx/homedeck`, which registers that route
     under a literal `/v{API_VERSION}/status` path. Use [the fork](https://github.com/fkras/homedeck),
     which fixes it.
   - **Connection refused** → `server.py` is bound to localhost only, or a
     firewall is in the way.
3. **Is mDNS crossing the network?** This is the most common cause. Check that
   Home Assistant and the SBC are on the same subnet/VLAN and that the router
   isn't blocking multicast. Add-on logs list each interface it scans.
4. **Give it ~10 seconds.** The scanner queries on an interval; a device that
   just booted may take one cycle to appear. Use the Refresh button.

### The panel is blank or the editor doesn't load

Hard-refresh the browser (`Ctrl+Shift+R`). The editor bundle is large and a
partial cache can break it.

### Stop doesn't work — the deck restarts immediately

Both `homedeck.service` and `homedeck-server.service` are enabled. Disable the
former: `sudo systemctl disable --now homedeck`.

## Changes in this fork

| Change | Why |
|:--|:--|
| mDNS discovery reads `answers` as well as `additionals` | python-zeroconf (used by `server.py`) puts every record in `answers` and leaves `additionals` empty, so devices were discovered by name but never got an address or port — `/devices` always returned an empty list and the UI sat on "Scanning for devices" |
| SRV records are applied before A records | The A handler matches on the SRV target, so it silently dropped the address if the records arrived in the other order |
| Pasted YAML is kept verbatim | Monaco re-indented pasted lines, which in YAML changes the nesting |
| Visual editor | See [What it is](#what-it-is-and-isnt) |
| Logs use `wss://` over HTTPS | When Home Assistant is served over HTTPS (e.g. Nabu Casa), the browser blocks a `ws://` socket as mixed content, so the log view stayed empty |

Both were verified against a live `server.py`: discovery now returns the device
with its address, port, and version, and the proxy reaches `/v1/configuration`
and `/v1/schema`.

## Development

```bash
cd homedeck-addon/web
bun install
bun run build        # outputs to dist/, which server.ts serves
bun run server.ts    # http://localhost:4663
```

The server needs host networking to receive mDNS, so run it directly on your
machine rather than in a container while developing.

| File | Role |
|:--|:--|
| `homedeck-addon/config.yaml` | Add-on manifest — Ingress, ports, architectures |
| `homedeck-addon/Dockerfile` | Build (Bun) |
| `web/server.ts` | mDNS scanner, HTTP/WS proxy, Home Assistant lookups, static file server |
| `web/src/yaml/document.ts` | The YAML document: parsing as YAML 1.1, comment-preserving edits, minimal diffs |
| `web/src/deck/` | Ports of HomeDeck's preset resolution, page layout and icon rendering |
| `web/src/editor.ts` | Monaco, and the single path every change goes through |
| `web/src/model.ts` | Reads and writes the visual editor makes |
| `web/src/ui/` | The interface (Preact) |
| `web/tests/` | `bun test` |

`src/deck/layout.ts` and `presets.ts` must behave exactly like HomeDeck's
`render_buttons` and `apply_presets`, quirks included, or the preview shows keys
the deck doesn't. The layout port was checked against the Python on 400 random
pages; `src/deck/configuration.base.yml` is a copy of HomeDeck's defaults, used
only when the device doesn't serve them.

For development without a deck or Home Assistant:

| Variable | Effect |
|:--|:--|
| `HOMEDECK_DEVICES=ip:port,…` | Lists these devices, besides any mDNS finds |
| `HOMEDECK_MDNS=0` | Turns mDNS discovery off - so a test instance can't find, and save to, a real deck |
| `HA_API_URL`, `HA_TOKEN` | Home Assistant API to use outside Supervisor |

### Device API

The add-on proxies a deliberately small, whitelisted surface:

| Method | Path | Purpose |
|:--|:--|:--|
| `HEAD` | `/v1/status` | Liveness — gates whether a device is listed at all |
| `GET` | `/v1/configuration` | Read current YAML |
| `POST` | `/v1/configuration` | Write YAML (validated server-side) |
| `GET` | `/v1/schema` | JSON schema used by the editor |
| `GET` | `/v1/base_configuration` | HomeDeck's defaults, for the preview (optional; newer HomeDeck) |
| `POST` | `/v1/start`, `/v1/stop` | Control `deck.py` |
| `WS` | `/v1/ws` | Status and log stream |

Requests are restricted to those endpoints, and hosts must be a literal
`IPv4:port`, so the proxy can't be used to reach arbitrary addresses on your
network.

## License

Same as the upstream project.
