# HomeDeck Manager — Home Assistant Add-on

Edit your [HomeDeck](https://github.com/redphx/homedeck) configuration from inside
Home Assistant instead of over SSH.

This add-on adds a panel to the Home Assistant sidebar with a YAML editor for the
deck's `configuration.yml`, live validation against the device's own schema, a
start/stop control, and a live log view.

> This is a fork of [redphx/homedeck-home-assistant-addon](https://github.com/redphx/homedeck-home-assistant-addon)
> with fixes described in [Changes in this fork](#changes-in-this-fork).

## What it is (and isn't)

**It is** a schema-aware YAML editor (Monaco — the editor from VS Code). You get
autocomplete, inline error squiggles, and a Problems list, driven by the JSON
schema that the connected device serves. Saving is blocked while the config has
errors.

**It is not** a drag-and-drop button designer. You arrange buttons by editing
YAML, not by dragging tiles on a grid.

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
| Editor | Edits that device's `assets/configuration.yml`. Autocomplete: `Ctrl+Space` |
| **Update configuration** | Saves to the device. Disabled while Problems is non-empty |
| **Start** / **Stop** | Starts or stops `deck.py` on the device |
| Problems | Schema violations. Click one to jump to its line |
| Logs | Live output from `deck.py` (last 50 lines) |

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
| `web/server.ts` | mDNS scanner, HTTP/WS proxy, static file server |
| `web/src/index.ts` | Frontend — device list, Monaco editor, logs panel |
| `web/index.html` | Page structure |
| `web/src/style.styl` | Styles (Stylus) |

### Device API

The add-on proxies a deliberately small, whitelisted surface:

| Method | Path | Purpose |
|:--|:--|:--|
| `HEAD` | `/v1/status` | Liveness — gates whether a device is listed at all |
| `GET` | `/v1/configuration` | Read current YAML |
| `POST` | `/v1/configuration` | Write YAML (validated server-side) |
| `GET` | `/v1/schema` | JSON schema used by the editor |
| `POST` | `/v1/start`, `/v1/stop` | Control `deck.py` |
| `WS` | `/v1/ws` | Status and log stream |

Requests are restricted to those endpoints, and hosts must be a literal
`IPv4:port`, so the proxy can't be used to reach arbitrary addresses on your
network.

## License

Same as the upstream project.
