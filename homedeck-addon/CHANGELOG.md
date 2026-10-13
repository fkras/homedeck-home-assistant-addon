# Changelog

## 0.2.0

- A visual editor for the D200, alongside the YAML editor. It shows each page's
  13 keys and small window as HomeDeck will draw them, and edits buttons
  (entity, label, presets, icon, text, actions, per-state looks), pages,
  presets and the deck-wide settings - including the firmware sleep, error
  alert and screensaver options. Every change is written into the YAML, which
  is still what gets saved; comments and formatting are kept.
- Icon search over Material Design, brand (`cbi:`) and Phosphor icons.
- Entity and action suggestions from Home Assistant. The add-on now asks for
  `homeassistant_api` access for this.
- Saving reports whether HomeDeck accepted the configuration. It used to
  ignore the answer, so a rejected save looked like a successful one.
- The log view works when Home Assistant is served over HTTPS (e.g. Nabu
  Casa). It opened a `ws://` socket, which browsers block on an HTTPS page.

## 0.1.2

- Paste YAML verbatim. Monaco re-indents pasted text by default, which added
  indentation to lines that already had it - in YAML that silently changes the
  nesting, so a pasted configuration came out shifted right and invalid.
  `autoIndent`, `formatOnPaste` and `formatOnType` are now off, and the editor
  is pinned to 2-space indentation rather than guessing it from the document.

## 0.1.1

- Fix device discovery finding nothing. The mDNS scanner read the SRV/A/TXT
  records only from a response's `additionals` section, but python-zeroconf —
  which HomeDeck's `server.py` uses to announce itself — puts every record in
  `answers` and leaves `additionals` empty. Devices were discovered by name but
  never got an address or port, so the list was always empty and the UI sat on
  "Scanning for devices. Please wait...".
- Apply SRV records before A records. The A handler matches on the SRV target,
  so it silently dropped the address when records arrived in the other order.
- Add a README covering installation, usage and troubleshooting.

## 0.1.0

- Initial release.
