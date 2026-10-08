# Kayak Soft-Frame

**English** · [Deutsch](#deutsch)

Run a Grass Valley Kayak DD-1 control panel **without its mainframe** and use it as a hardware
controller for **OBS Studio**.

A small Node.js program (the "soft-frame") takes the place of the Kayak mainframe on the network.
The panel boots, connects and works as usual. Its buttons, fader bar, keypad and joystick are
translated into OBS commands via obs-websocket v5.

> **Disclaimer**
> This is an independent hobby project. It is not affiliated with, endorsed by or supported by
> Grass Valley. "Grass Valley", "Kayak" and "Kayenne" are trademarks of their respective owners.
> This repository contains **no** Grass Valley software, firmware, configuration files or recorded
> network data. It does **not** bypass, change or unlock any Grass Valley licence. You need your own,
> legally owned hardware.

---

## What works

| Panel | OBS Studio |
|---|---|
| PGM / PST bus (15 buttons + Shift = 30 sources) | Program / Preview scene (Studio Mode), first 30 scenes in the OBS scene list |
| CUT | Cut transition |
| AUTO | Fade with the transition rate set on the panel |
| Fader bar | Fade, speed taken from how fast the lever is moved (see note) |
| Transition rate (AUTO and Key 1–4) | Transition duration |
| Next Transition (BKGD or Key 1–4) | CUT / AUTO act on background or the selected key |
| Transition type Mix / Wipe 1 / Wipe 2 | Fade or OBS "Luma Wipe"; wipe pattern → luma image via `kayak-wipes.json` |
| Key 1–4: delegate, key bus, Key CUT, Key MIX (own rate per key) | **Downstream Keyer** plugin (one DSK tab per key) |
| Keypad number + Enter (E-MEM 1–99) | Message to **Advanced Scene Switcher** → any OBS macro |
| Joystick / positioner (X, Y, twist) + reset button | Move / scale a source in the preview scene; reset = undo, 2nd press = fit to screen |
| Key CUT / MIX of layer 7 | Cut / fade the program to an OBS scene "Black" and back |
| Key 1–4 + DPM controls (Locate, Size, Crop) | Move, scale and crop the 1st–4th source (from the bottom) of the preview scene |
| Keyer knobs OPAC / GAIN / CLIP | OBS filters on that source: opacity and luma key |
| Tally | PGM red, PST lit, PST red during transitions, like on the real system |

Panel events (`PGM n`, `PST n`, `CUT`, `AUTO`, `KEYn ON/OFF`, `EMEM n`, `BLACK ON/OFF`) are also sent
to Advanced Scene Switcher, so you can attach your own macros to them.

**Fader bar note:** obs-websocket can move the OBS T-bar, but OBS cancels the transition on release.
The soft-frame therefore starts a normal fade as soon as the lever moves, with a duration estimated from
the lever speed.

## Requirements

**Hardware / network**
- Grass Valley Kayak DD-1 control panel, connected via Ethernet
- A computer for the soft-frame on the same network, using the IP address the panel expects for its frame
- For the one-time setup: a **working Kayak HD mainframe** (see below)
- For recordings: a switch with port mirroring (e.g. Netgear GS105E) and Wireshark

**Software**
- Node.js 22 or newer (built-in WebSocket; older versions need `npm install ws`)
- OBS Studio 30+ with the obs-websocket server enabled (Tools → WebSocket Server Settings)
- Optional OBS plugins (by exeldro / WarmUpTill):
  - [Downstream Keyer](https://github.com/exeldro/obs-downstream-keyer) for Key 1–4
  - [Advanced Scene Switcher](https://github.com/WarmUpTill/SceneSwitcher) for E-MEM macros
- Optional: OBS transition "Luma Wipe" (Wipe) for panel wipes, a scene "Black" (outside the first 30 scenes)

## What you need from a real mainframe

The soft-frame needs data that only your own Kayak mainframe can provide. That data is
**not** part of this repository and must not be published.

1. **The panel's start-up files.** While booting, the panel loads its application and configuration
   from the frame. These come from your frame and your licence, and they stay on your machine.
2. **A reference recording of your frame.** Use port mirroring and Wireshark, and record the panel
   booting with the real frame and a few button presses. The soft-frame's answers are based on it.
3. **Your panel settings.** The button assignment, Personality settings (XBar tally, async blinking)
   and the application in use are set on the panel itself.

All of this goes into a local file `softframe_data.json` next to the scripts. The file is listed in
`.gitignore` and is never committed.

Once this data exists, the mainframe is no longer needed.

## Files

| File | Purpose |
|---|---|
| `kayak-softframe-vX.js` | The soft-frame (handshake, file serving, mixer state, tally, panel buttons) |
| `kayak-obs.js` | OBS link (obs-websocket v5, Downstream Keyer, Advanced Scene Switcher, joystick, wipes, black) |
| `kayak-wipes.json` | Your table: panel wipe pattern number → OBS luma image |
| `softframe_data.json` | **Local only, not in the repo:** data from your own frame |

## Start

```powershell
cd "path\to\soft-frame"
$env:KAYAK_OBS_URL  = "ws://192.168.5.100:4455"   # OBS computer
$env:KAYAK_OBS_PASS = "your-password"              # only if authentication is enabled in OBS
node .\kayak-softframe-vX.js
```

Then (re)start the panel. The log shows the handshake, the scene mapping (button 1–30 → OBS scene)
and the plugins that were found.

## Settings (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `KAYAK_OBS_URL` | `ws://192.168.5.100:4455` | Address of OBS |
| `KAYAK_OBS_PASS` | – | obs-websocket password |
| `KAYAK_OBS` | – | `0` = run without OBS |
| `KAYAK_OBS_SCENES` | `30` | Number of OBS scenes mapped to panel buttons |
| `KAYAK_OBS_EXTRA` | built-in | Map extra panel sources to scenes 25–30 |
| `KAYAK_OBS_FADE` | first fade | Name of the OBS transition used for AUTO / MIX |
| `KAYAK_OBS_LEVER` | `speed` | Fader bar mode: `speed`, `end` (cut at the end), `tbar` (OBS T-bar) |
| `KAYAK_DSK1` … `KAYAK_DSK4` | first 4 DSK tabs | Downstream Keyer tab per key |
| `KAYAK_JOY` / `KAYAK_JOY_ITEM` / `KAYAK_JOY_PX` | on / topmost source / 8 | Joystick on/off, source name, pixels per step |
| `KAYAK_ASS` | on | `0` = no Advanced Scene Switcher messages |
| `KAYAK_BLACK_SCENE` | `Black` | Scene used by layer 7 CUT/MIX |
| `KAYAK_APPNAME` | – | Application name reported to the panel (`orig` = as recorded) |

## Limitations

- 30 panel sources: 15 buttons × 2 (Shift). The DD-1 has no freely assignable 2nd/3rd shift buttons.
  More sources can be reached via E-MEM numbers and Advanced Scene Switcher.
- The number of inputs licensed on your frame stays as it is. This project does not touch licences.
- No feedback from OBS to the panel yet: scenes switched directly in OBS do not light the panel buttons.
- Saving the button assignment to USB still needs the real frame.

## Roadmap

- Feedback from OBS to the panel (button lamps, key lamps from the DSK state)
- Printable button label strips generated from the OBS scene list
- Configurable network range for other studios

---

<a name="deutsch"></a>

# Kayak Soft-Frame (Deutsch)

[English](#kayak-soft-frame) · **Deutsch**

Ein Grass Valley Kayak DD-1 Bedienpanel **ohne Mainframe** betreiben und als Hardware-Pult für
**OBS Studio** nutzen.

Ein kleines Node.js-Programm, das „Soft-Frame“, übernimmt im Netzwerk die Rolle des Kayak-Mainframes.
Das Panel bootet, verbindet sich und arbeitet ganz normal. Tasten, Blendenhebel, Ziffernblock und
Joystick werden über obs-websocket v5 in OBS-Befehle übersetzt.

> **Hinweis**
> Dies ist ein unabhängiges Hobbyprojekt. Es steht in keiner Verbindung zu Grass Valley und wird von
> Grass Valley weder unterstützt noch empfohlen. „Grass Valley“, „Kayak“ und „Kayenne“ sind Marken
> ihrer jeweiligen Inhaber. Dieses Repository enthält **keine** Software, Firmware,
> Konfigurationsdateien oder aufgezeichneten Netzwerkdaten von Grass Valley. Es umgeht, verändert oder
> erweitert **keine** Grass-Valley-Lizenz. Du brauchst eigene, rechtmäßig erworbene Hardware.

---

## Was funktioniert

| Panel | OBS Studio |
|---|---|
| PGM-/PST-Bus (15 Tasten + Shift = 30 Quellen) | Programm-/Vorschau-Szene (Studio-Modus), die ersten 30 Szenen der OBS-Szenenliste |
| CUT | Schnitt |
| AUTO | Überblendung mit der am Panel eingestellten Blendzeit |
| Blendenhebel | Überblendung, Tempo aus der Hebelbewegung (siehe Hinweis) |
| Blendzeit (AUTO und Key 1–4) | Übergangsdauer |
| Next Transition (BKGD oder Key 1–4) | CUT/AUTO wirken auf den Hintergrund oder den gewählten Key |
| Transitions-Typ Mix / Wipe 1 / Wipe 2 | Überblenden oder OBS „Wischen“ (Luma Wipe); Wipe-Muster → Luma-Bild über `kayak-wipes.json` |
| Key 1–4: Delegate, Key-Bus, Key CUT, Key MIX (eigene Blendzeit je Key) | Plugin **Downstream Keyer** (ein DSK-Tab pro Key) |
| Ziffernblock Nummer + Enter (E-MEM 1–99) | Meldung an den **Advanced Scene Switcher** → beliebiges OBS-Makro |
| Joystick/Positioner (X, Y, Twist) + Reset-Taste | Quelle in der Vorschau-Szene verschieben und skalieren; Reset = rückgängig, 2. Druck = an Bildschirm anpassen |
| Key CUT / MIX der Ebene 7 | Programm auf eine OBS-Szene „Black“ schneiden/blenden und zurück |
| Key 1–4 + DPM-Regler (Locate, Size, Crop) | 1.–4. Quelle (von unten) der Vorschau-Szene verschieben, skalieren, beschneiden |
| Keyer-Regler OPAC / GAIN / CLIP | OBS-Filter an dieser Quelle: Deckkraft und Luma Key |
| Tally | PGM rot, PST hell, PST rot während der Blende, wie am echten System |

Panel-Ereignisse (`PGM n`, `PST n`, `CUT`, `AUTO`, `KEYn ON/OFF`, `EMEM n`, `BLACK ON/OFF`) gehen
zusätzlich an den Advanced Scene Switcher. Daran lassen sich eigene Makros hängen.

**Hinweis zum Blendenhebel:** obs-websocket kann die OBS-T-Bar zwar bewegen, OBS bricht die Blende aber
beim Loslassen ab. Das Soft-Frame startet deshalb eine normale Überblendung, sobald der Hebel bewegt
wird. Die Dauer schätzt es aus dem Hebel-Tempo.

## Voraussetzungen

**Hardware / Netzwerk**
- Grass Valley Kayak DD-1 Bedienpanel, per Ethernet angeschlossen
- Ein Rechner für das Soft-Frame im selben Netz, mit der IP-Adresse, die das Panel für seinen Frame erwartet
- Für die einmalige Einrichtung: ein **funktionierender Kayak-HD-Mainframe** (siehe unten)
- Für Mitschnitte: ein Switch mit Port-Mirroring (z. B. Netgear GS105E) und Wireshark

**Software**
- Node.js 22 oder neuer (eingebautes WebSocket; ältere Versionen brauchen `npm install ws`)
- OBS Studio 30+ mit eingeschaltetem WebSocket-Server (Werkzeuge → WebSocket-Server-Einstellungen)
- Optionale OBS-Plugins (von exeldro bzw. WarmUpTill):
  - [Downstream Keyer](https://github.com/exeldro/obs-downstream-keyer) für Key 1–4
  - [Advanced Scene Switcher](https://github.com/WarmUpTill/SceneSwitcher) für E-MEM-Makros
- Optional: OBS-Übergang „Wischen“ (Luma Wipe) für Panel-Wipes, eine Szene „Black“ (nicht unter den ersten 30 Szenen)

## Was man von einem echten Mainframe braucht

Das Soft-Frame braucht Daten, die nur dein eigener Kayak-Mainframe liefern kann. Diese Daten sind
**nicht** Teil des Repositorys und dürfen nicht veröffentlicht werden.

1. **Die Startdateien des Panels.** Beim Booten lädt das Panel seine Applikation und Konfiguration vom
   Frame. Sie stammen von deinem Frame und deiner Lizenz und bleiben bei dir.
2. **Ein Referenz-Mitschnitt deines Frames.** Mit Port-Mirroring und Wireshark den Panel-Start am echten
   Frame und einige Tastendrücke aufzeichnen. Darauf bauen die Antworten des Soft-Frames auf.
3. **Deine Panel-Einstellungen.** Tastenbelegung, Personality (XBar Tally, Async Blinking) und die
   verwendete Applikation stellst du am Panel selbst ein.

Alles zusammen landet in einer lokalen Datei `softframe_data.json` neben den Skripten. Sie steht in der
`.gitignore` und wird nie eingecheckt.

Sind diese Daten einmal vorhanden, wird der Mainframe nicht mehr gebraucht.

## Dateien

| Datei | Zweck |
|---|---|
| `kayak-softframe-vX.js` | Das Soft-Frame (Handshake, Dateiauslieferung, Mischer-Zustand, Tally, Panel-Tasten) |
| `kayak-obs.js` | OBS-Anbindung (obs-websocket v5, Downstream Keyer, Advanced Scene Switcher, Joystick, Wipes, Black) |
| `kayak-wipes.json` | Deine Tabelle: Panel-Wipe-Muster → OBS-Luma-Bild |
| `softframe_data.json` | **Nur lokal, nicht im Repo:** Daten deines eigenen Frames |

## Start

```powershell
cd "Pfad\zum\Soft-Frame"
$env:KAYAK_OBS_URL  = "ws://192.168.5.100:4455"   # OBS-Rechner
$env:KAYAK_OBS_PASS = "dein-passwort"              # nur falls in OBS Authentifizierung aktiv ist
node .\kayak-softframe-vX.js
```

Danach das Panel (neu) starten. Das Log zeigt den Handshake, die Szenen-Zuordnung (Taste 1–30 →
OBS-Szene) und die gefundenen Plugins.

## Einstellungen (Umgebungsvariablen)

| Variable | Standard | Bedeutung |
|---|---|---|
| `KAYAK_OBS_URL` | `ws://192.168.5.100:4455` | Adresse von OBS |
| `KAYAK_OBS_PASS` | – | Passwort für obs-websocket |
| `KAYAK_OBS` | – | `0` = ohne OBS |
| `KAYAK_OBS_SCENES` | `30` | Anzahl OBS-Szenen auf den Panel-Tasten |
| `KAYAK_OBS_EXTRA` | eingebaut | Zusätzliche Panel-Quellen auf die Szenen 25–30 legen |
| `KAYAK_OBS_FADE` | erste Überblendung | Name des OBS-Übergangs für AUTO/MIX |
| `KAYAK_OBS_LEVER` | `speed` | Blendenhebel: `speed`, `end` (am Anschlag schneiden), `tbar` (OBS-T-Bar) |
| `KAYAK_DSK1` … `KAYAK_DSK4` | erste 4 DSK-Tabs | Downstream-Keyer-Tab je Key |
| `KAYAK_JOY` / `KAYAK_JOY_ITEM` / `KAYAK_JOY_PX` | an / oberste Quelle / 8 | Joystick an/aus, Quellenname, Pixel pro Schritt |
| `KAYAK_ASS` | an | `0` = keine Meldungen an den Advanced Scene Switcher |
| `KAYAK_BLACK_SCENE` | `Black` | Szene für Ebene 7 CUT/MIX |
| `KAYAK_APPNAME` | – | Applikationsname, der dem Panel gemeldet wird (`orig` = wie aufgezeichnet) |

## Grenzen

- 30 Panel-Quellen: 15 Tasten × 2 (Shift). Das DD-1 hat keine frei belegbaren 2nd/3rd-Shift-Tasten.
  Weitere Quellen gehen über E-MEM-Nummern und den Advanced Scene Switcher.
- Die Zahl der auf deinem Frame lizenzierten Eingänge bleibt, wie sie ist. Das Projekt verändert keine Lizenzen.
- Noch keine Rückmeldung von OBS ans Panel: Direkt in OBS geschaltete Szenen leuchten nicht am Panel.
- Das Sichern der Tastenbelegung auf USB braucht noch den echten Frame.

## Ausblick

- Rückmeldung von OBS ans Panel (Tastenlampen, Key-Lampen nach DSK-Zustand)
- Druckbare Beschriftungsstreifen aus der OBS-Szenenliste
- Einstellbarer Adressbereich für andere Studios
