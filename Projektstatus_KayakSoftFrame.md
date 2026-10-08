# Kayak Soft-Frame – Projektstatus

**Stand: Donnerstag, 08.10.2026, 11:45 Uhr — v5d: Quellenwahl Key 1–4, Locate/Size/Crop je Key (bestätigt), OPAC/GAIN/CLIP → OBS-Filter. Davor v4l: Ebene 7 CUT/MIX → Szene „Black“ (bestätigt), Joystick-Reset. v4h: Keys/DSK, Joystick (beide Formate) am Panel bestätigt; Wipes → OBS „Wischen“. Davor v4f/v4e: OBS + Advanced Scene Switcher (bestätigt), Joystick → Bild-im-Bild (ungetestet): PGM/PST 1–30, CUT, AUTO, Blendenhebel, Blendzeit, Key-Delegation funktionieren mit echtem OBS. Davor (v3w): PGM/PST-Bus, Key-Delegate, Blendzeiten (AUTO + Key 1–4), Key-Bus, Key CUT/MIX, Next Transition, Wipe-Auswahl, CUT/AUTO/Hebel – alles am Panel bestätigt.**

> Hinweis: Auf dem Mac (OneDrive) liegt ein Stand vom Samstag (v7) mit Fahrplan und CasparCG-Notizen.
> Dieser Stand hier ist neuer und enthält die Punkte daraus (Abschnitt 8). Beim Zusammenführen diesen Stand nehmen.

---

## 1. Ergebnis von heute (05.10.) in Kürze

- **Tastenfarben stimmen jetzt wie am echten Frame:** PGM rot, PST hell (XBar Tally = Red Light).
  Während AUTO/Hebel-Blende wird auch die PST-Quelle rot, danach tauschen PGM/PST.
- **Szenen-Namen:** Das Soft-Frame liefert eine geänderte `appli.ini` aus: Eingänge 1–96 heißen
  `Sz01`–`Sz96` (4 Zeichen) bzw. `Szene 01`–`Szene 96` (8 Zeichen). Das Panel zeigt sie an.
- **Tastenzuordnung am Panel geändert:** PGM/PST-Tasten 1–24 = Szenen 1–24 (mit Shift-Ebene).
  Tastencode = Szenennummer (01 = Sz01 … 18 = Sz24). Funktioniert inkl. Shift (Test WellDone1).
- **Blinken/UNCAL** durch asynchrone Quellen beseitigt (Statusbits werden vom Soft-Frame bereinigt).
- Blendenhebel mit Totzone, AUTO, CUT – alles mit eigenem Mischzustand im Soft-Frame.
- **Nachmittag (Mitschnitte am echten Frame → v3s…v3v):** Blendzeit AUTO und Key 1–4 (Trans Rate),
  Key-Delegate, Key-Bus, Wipe-Pattern 1/2 (TFT), Key CUT / Key MIX, Next Transition, Transitions-Typ.
  **Am Panel mit v3v bestätigt (14:24):** PGM-Bus, PST-Bus, Key-Delegate, Key-Bus, Blendzeit, Key CUT, Key MIX,
  Next Transition, Wipes, CUT/AUTO/Blendenhebel.

---

## 2. Die wichtigste Erkenntnis (02.10.): Unicast war unsichtbar

An einem normalen Switch-Port sieht Wireshark nur Broadcast/Multicast. Tastendrücke,
Anfragen/Antworten und TFTP laufen aber per **Unicast** zwischen Panel und Frame.
**Lösung: Port-Mirroring am Netgear GS105E.**

> ⚠️ Für jeden Referenz-Mitschnitt mit echtem Frame: IMMER mit Mirroring!

---

## 3. Das Protokoll (verifiziert)

### Adressen
| Gerät | IP | MAC |
|---|---|---|
| Panel (KayakCP-63) | 192.168.5.63 | e0:00:0d:4b:50:59 |
| Echter Frame (KAYAK_HD-60) | 192.168.5.60 | 00:e0:4b:42:16:f9 |
| Windows-Laptop, Adapter "Kayak" | .60 (als Soft-Frame) bzw. .1 (zum Mitschneiden) | b0:0c:d1:34:99:81 |
| Netgear GS105E | 192.168.5.250 | – |

Multicast: `239.0.0.0` (allgemein) und `239.168.5.60` (= 239 + letzte 3 Stellen der Frame-IP),
TTL 5. Unicast/Broadcast TTL 64.

### Ports
| Port | Richtung | Inhalt |
|---|---|---|
| 56629 | beide | Handshake (Multicast), Anfragen/Antworten + Tasten (Unicast), Zustandsstrom (Multicast 239.168.5.60) |
| 56631 | beide | Pings (Panel von 1026, Frame von 1025) |
| 56712 / 56713 | Panel→:56712, Frame→:56713 (von Port 1024) | Boot-Announce / Keepalive alle 5 s |
| 69 | Panel→Frame | TFTP: Panel lädt seine 12 Dateien vom Frame |
| 111 / 1003 | Panel→Frame | RPC Portmapper + Mount |

### Boot-Announce (Magic `35 dd 35 dd`, Typ in Byte 32–35)
- `02 01 03 01` = "wer ist da?" → volles Announce `8350` + `b507` (Broadcast)
- `02 01 02 01` = Keepalive → Antwort `03 01 82 00` (Unicast)
- `03 01 83 50` = Panel hat neu gebootet → Zustand zurücksetzen

### Handshake
ITry (`1b 00 3a 30 01 01 …`) → IAm (`2a 00 3f 27`) → nach 174 ms Confirm → Panel-Anfrage 0x04 →
Frame-Antwort 0x05 `0a 00 89 30 01 05 ef a8 05 3c 00 06` → Panel-Confirm (`25 00 3f 22`) → TFTP.

### Zustandspakete (Frame → Panel, Multicast 239.168.5.60)
```
[Länge 2 Byte LE = Gesamt-2] [Records …] [Trailer 2d 30 04 0a 01 35 00 00 00 00 + Nummer 4 Byte LE]
Record = Kopfbyte (Flags | Länge; Länge 0x1f = nächstes Byte ist die Länge) + Inhalt
```
| Record | Bedeutung |
|---|---|
| `87 00 01 01 [Code] 00 00 00` | PGM-Bus = Quelle |
| `87 00 01 02 [Code] 00 00 00` | PST-Bus = Quelle |
| `85 00 08 0b [Wert]` | Hebel-Rohwert |
| `85 00 08 0d [0..32767]` | Blendenposition |
| `87 00 08 31 06800000 / 02000000` | Blende läuft / Ruhe |
| `9f 44 00 18 00 02 [n] …` | Tally-Block n (68 Byte), siehe unten |
| `3f aa 00 22 11 01 a6 …` | Status-Array (Byte 5/6 = UNCAL-Lampen PGM/PST) |

### Tally-Blöcke (heute entschlüsselt) – entscheiden über die Tastenfarben
- Inhalt ab Kopf `00 18 00 02`: Byte 4 = Block-Nr., Byte 5–8 = **Eingangsmaske** (Bit 0 = Eingang 1),
  Byte 12/13 = Status, Byte 28 und 44 = Maske der internen RAM-Rekorder.
- Byte 12 untere Bits (`7d`/`fd`) = Quelle asynchron → Taste blinkt/UNCAL. Soft-Frame setzt sie auf 0.
- **Block 0** = PGM-Quelle (auf Sendung, rot). Ruhe: Form `00 04`. **Während einer Blende** schickt der
  echte Frame die Form `80 75` + `f8` + `ffffff0f` ("Blende läuft") → PST-Taste rot. Soft-Frame macht
  das ab v3p genauso (Hebel und AUTO); danach wieder Ruhe-Form, neue PST hell.
- **Block 1** muss **leer** bleiben. Befüllt (PGM-Maske) → Tasten springen zurück bzw. reagieren nicht.
- **Block 2** = PST-Quelle (Status `00 06`).
- Black (Code 00) / RAM-Rekorder: eigene Vorlage mit Status `80 7x`.

### Tasten (Panel → Frame, Unicast 56629)
```
06 00 25 00 01 [Reihe] [Code] [01 = gedrückt / 00 = losgelassen]
Reihe: 01 = PGM, 02 = PST
Code:  = Eingangsnummer der zugeordneten Quelle (seit Szenen-Zuordnung: 01..18 = Sz01..Sz24)
       00 = Black, 89/8a = interne Quellen (RAM-Rekorder)
Shift-Ebene: Panel schickt direkt den Code der geshifteten Quelle (z. B. 10..18 = Sz16..Sz24)
```
| Bedienelement | Panel sendet |
|---|---|
| CUT | `05 00 e4 00 08 06 00` |
| AUTO | `05 00 e4 00 08 05 00` |
| Blendenhebel | `06 00 a5 00 08 0b [Wert 2 Byte LE]`, Rohwert ca. 3100..32767 |
| Ziffernblock Ziffer | `06 00 25 1e 00 01 01 [Zahl]` (aktuelle Zahl, max. 2-stellig) → Frame: Unicast `06 00 85 1e 00 01 00 06` + Multicast-Record `1e 00 01 01 [Zahl]` |
| Ziffernblock Enter | `07 00 e6 1e 00 03 [Zahl] fe ff` (E-MEM/Register abrufen) – ab v3q im Log `[ZIFFERN] Enter -> …`, Andockpunkt für OBS/Companion |
| Ziffernblock CLEAR | `04 00 e3 1e 00 33` |

### Transitions-Ebenen ("Sel") – gemeinsame Nummerierung
`0` = Bkgd (Haupt-CUT/AUTO), `1/2` = Bkgd A/B, `3..6` = **Key 1..4**, `7` = 5. Ebene (unklar, evtl. FTB),
`0x0f` = Bkgd-Hilfsebene. On-Air-Maske `00 08 31 [u32]`: Bit n = Ebene n (Ruhe `02`, Bkgd-Blende `06 80`).

| Funktion | Panel sendet | Frame antwortet (Multicast) |
|---|---|---|
| Blendzeit (Trans Rate → AUTO/Key-Mix blinkt → Zahl) | `07 00 26 00 08 0a [Sel] [u16 Frames]` (jede Ziffer einzeln: 1, 10, 100) | ganze Tabelle `00 08 0a [Sel] [u16]`, Sel 0–31, Default 25 |
| E-MEM-Blendzeit (Trans Dur + E-MEM) | `06 00 25 1e 00 18 [u16]` | `1e 00 18 [u16]` + `1e 00 1e 00 00` – **nicht** die AUTO-Zeit! |
| Key CUT | `05 00 e4 00 08 06 [Sel 3..7]` | `00 08 0e [Sel] [Pegel 0/7fff]`, `00 08 31 [Maske]`, Tabelle `00 08 0f [Sel] 00=an/01=aus`, Tabelle `00 08 18` |
| Key MIX | `05 00 e4 00 08 05 [Sel 3..7]` | alle 60 ms: `00 08 0d 0000`, `00 08 0e [Sel] [Pegel]`, `00 08 31`, `00 08 18 [Sel] [Rest-Frames]`; am Ende + `0f`-Tabelle |
| Next Transition | `09 00 28 00 08 03 [u32 Maske]` (06 = Bkgd, 08/10/20/40 = Key 1–4) | `00 08 03 [Maske]` + Tabelle `00 08 04` |
| Transitions-Typ | `06 00 25 00 08 04 [Sel] [01/02/03]` (vermutl. Mix/Wipe1/Wipe2) | Tabelle `00 08 04 [Sel] [Typ]` + `00 08 1a 00` |
| Key-Delegate | `06 00 25 00 a0 26 [01/02/04/08] 00` (Key 1–4) | `00 a0 26 [Maske] 00` |
| Key-Gruppen-Abfrage | `05 00 24 00 [20..23] [50/13/84]` | alle Gruppen `00 [20..23,74,75] [01 Typ / 13 / 50 / 84]` |
| Key-Bus-Taste | `06 00 25 00 [20..23 = Key1..4] 02 [Code] 01` | `00 g 01 [Typ]`, `00 g 02 [Code]000000` (Source), `00 g 03 [Code]000000` (Fill), `00 a4 27/28/2a/2b` |
| Wipe-Pattern (TFT) | `06 00 25 00 [10 = Wipe1 / 11 = Wipe2] 01 [u16 Pattern]` | `00 g 01 [u16]`, `00 g 04 0d [13 Flags]` (Flag 5 = 00 bei Pattern 1–6, 29/2a, 3d–40, 47/48), `00 g 11/12/79/7d 00` |

Key-Bus: unbekannter Code (z. B. d8) wird vom echten Frame ignoriert – Soft-Frame genauso.

E-MEM/MaKe-Modus und Panel-Macros (1–96) laufen komplett im Panel, kein Verkehr zum Frame
(Mitschnitt EMEM_MaKe.pcapng, echter Frame). Idee: Panel-Macro ruft E-MEM auf → kommt als Enter beim Soft-Frame an.

### Adressen in Dateien (für späteren Adressbereichs-Wechsel)
- `appli.ini`: `ServerIP`/`ReportIP` = Panel-IP; `[Resources] VideoInput = 0-96,…`
- `state.bin`: Panel-IP 5×, einmal `192.168.5.80`
- ITry, Confirm, Boot-Announce enthalten die Frame-IP

---

## 4. Testaufbau

- Windows-11-Laptop, Adapter **"Kayak"**, Ordner `C:\Users\Wireshark\Desktop\Grass Valley Kayak`
- Netgear GS105E (192.168.5.250), Mirroring: Quelle = Frame-Port, Ziel = Laptop-Port
- Mitschnitt mit echtem Frame: Laptop `192.168.5.1`, kein Skript
- Test mit Soft-Frame: echten Frame vom Netz, Laptop `192.168.5.60`
- Nach jedem Wechsel echt ↔ Soft: **Panel neu starten** (ARP-Cache), nie zwei Geräte mit .60

Soft-Frame starten (frisches PowerShell-Fenster):
```
cd "C:\Users\Wireshark\Desktop\Grass Valley Kayak"
node .\kayak-softframe.js
```
Im Log: `Tally-Bloecke: Block0=bright, Block1=zero`, `appli.ini komplett gesendet (141852 Byte)`.

Test-Schalter (nur für Fehlersuche, gelten nur im aktuellen Fenster):
| Schalter | Wirkung |
|---|---|
| `$env:KAYAK_N0="v3f"` | alter Block 0 (PST rot) |
| `$env:KAYAK_N1="bright"` / `"v3f"` | Block 1 befüllt (Tasten springen zurück) |
| `$env:KAYAK_APPLI="orig"` | Original-appli.ini (alte Namen) statt Sz-Fassung |
| `$env:KAYAK_IDLE_LOOP="0"` | Ruhe-Strom des echten Frames abschalten |
| `$env:KAYAK_AUTO_MS="1000"` | Dauer AUTO |
| `$env:KAYAK_LEVER_MIN` / `KAYAK_LEVER_DEADBAND` | Hebel-Kalibrierung (3100 / 400) |

Zurücksetzen: `Remove-Item Env:KAYAK_*` oder neues Fenster.

---

## 5. Dateien (Windows-Ordner)

| Datei | Zweck |
|---|---|
| `kayak-softframe-v5d.js` + `kayak-obs.js` + `kayak-wipes.json` | **v5d = aktueller Stand** (Version 5: Quellen-Bearbeitung je Key + Keyer-Encoder) |
| `kayak-softframe-v5c.js` | v5c (ohne OPAC/GAIN/CLIP) |
| `kayak-softframe-v4l.js` | v4l (v4j Joystick-Reset, v4l Ebene 7 → Black) |
| `kayak-softframe-v4j.js` | v4j (FTB-Taste noch belegt) |
| `README.md`, `gitignore.txt` | GitHub-README (EN/DE, ohne Protokolldaten), .gitignore-Vorschlag |
| `kayak-softframe-v4h.js` | v4h (v4g Wipes, v4h Joystick-Format 2; DSK nur aktuelle Key-Quelle) |
| `kayak-softframe-v4f.js` | **v4f: v4e + Applikationsname „21Broadcast“ (`KAYAK_APPNAME`, „orig“ = alt)** |
| `Lesbar\` (aus dem Chat) | lesbare Kopien: softframe_data_lesbar.json, appli-aenderungen.diff, appli-Sz-Fassung.ini, appli-original.ini |
| `kayak-softframe-v4e.js` | **v4e: v4d + Joystick → Bild-im-Bild, DSK Show/Hide** |
| `kayak-softframe-v4d.js` | **v4d: v4c + Advanced Scene Switcher, OBS-Standardadresse 192.168.5.100** |
| `kayak-softframe-v4c.js` | **v4c = aktueller Stand: v3w + OBS-Anbindung, Hebel nach Tempo, Szenen 25–30 über interne Codes** (beide Dateien im selben Ordner) |
| `kayak-softframe-v4b.js` | v4b (Szenen nur 1–24) |
| `kayak-softframe-v4a.js` | v4a (Hebel noch per T-Bar, OBS-Fehler) |
| `kayak-softframe-v3w.js` | **Soft-Frame v3w – aktueller Stand** (= v3v + CUT/AUTO folgen Next Transition) |
| `kayak-softframe-v3v.js` | Soft-Frame v3v (v3s Blendzeit, v3t Keys, v3u Wipes, v3v Key CUT/MIX) |
| `kayak-softframe.js` | v3r (Vormittag + Ziffernblock) |
| `softframe_data.json` | Antworten, TFTP-Dateien (inkl. Sz-appli.ini + Sicherung des Originals), Tally-Vorlagen |
| `kayak-softframe-v3f.js` | Zwischenstand (PST rot) zum Vergleich |
| `kayak-softframe-v21.js` | Stand Freitag |
| `GV Dateien\appli.ini` | Sz01–Sz96-Fassung |
| `GV Dateien\appli-bak.ini` | **Original** (Sicherung) |
| `Wireshark\Soft3.pcapng` | Referenz echter Frame: alle Tasten, CUT, AUTO, Hebel |
| `Wireshark\BrightPST.pcapng` | Referenz echter Frame: PST-Tasten (PST hell) – Quelle der Tally-Vorlagen |
| `Wireshark\Ref1/Ref2.pcapng` | echter Frame, REF-/Signalwechsel |
| `Wireshark\Montag1–3, BrightPST2/3, Szenen1/2` | Soft-Frame-Tests heute |
| `Wireshark\WellDone1.pcapng` | **Soft-Frame v3n, alles ok inkl. Shift** |
| `Transition1/2, Key-Delegate, Wipe-PatternSelect, KeyCutMix` | Referenz echter Frame (Nachmittag) |

---

## 6. Verlauf heute (05.10.) – was jeweils die Ursache war

| Version | Symptom | Ursache / Lösung |
|---|---|---|
| v3 | rot/grün-Blinken bei Hebel am Anschlag | Hebel-Zittern → Totzone 400 |
| v3e | PGM1/2 blinken + UNCAL | asynchrone Quelle (REF an Eingang 1) → Statusbits bereinigt |
| v3f | PST rot statt hell | Block 0 in alter Form ("alles auf Sendung") |
| v3g | alles rot | Vorlage stammte aus Mitschnitt mit halb gezogenem Hebel |
| v3h/i | Tasten springen auf BLACK/15 zurück | Block 1 befüllt; RAM-Rekorder-Maske fest in Vorlage |
| v3k | Tasten reagieren gar nicht | Block 1 befüllt |
| v3n | alles ok, aber PST beim Blenden hell | Block 0 wie echter Frame, Block 1 leer, Block 2 wie echter Frame |
| **v3p** | **alles ok, PST beim Blenden rot** | Block 0 während Blende im "f8/ffffff0f"-Stil (wie echter Frame) |
| v3r | Blendzeit ohne Wirkung am echten Frame | `1e 00 18` ist die E-MEM-Blendzeit, nicht AUTO |
| v3s | – | AUTO-Blendzeit = `07 00 26 00 08 0a 00 [Frames]` (Transition2) |
| v3t/u/v | – | Key-Delegate/Bus, Wipes, Key CUT/MIX; **v3v am Panel bestätigt** (siehe Abschnitt 1) |
| v3v | CUT bei Next Transition = Key 1 schneidet trotzdem PST | Haupt-CUT/AUTO ignorierte Next Transition |
| **v3w** | **bestätigt (14:33)** | CUT/AUTO wirken auf die gewählte Ebene: BGD → PGM/PST-Tausch, Key n → nur Key n (AUTO mit AUTO-Blendzeit) |

---

## 7. Offene Punkte

- ~~E-Box-Timing "alles asynchron" (Sekunden-Takt `22 01 03 0d 00` fehlt im Soft-Frame)~~ → **nicht mehr nötig**:
  am Panel *Personality → Async Blinking = OFF* gesetzt, damit kein Blinken/UNCAL mehr.
- Noch unklar: Transitions-Typ (Bedeutung 01/02/03). Ebene 7 = BGD laut Thomas (Bedeutung des Pegels noch offen).
- Next Transition: **entweder BGD oder genau ein Key** (nie zusammen).
- Blendenhebel blendet nur Bkgd, auch wenn ein Key gewählt ist (Verhalten echter Frame ungeprüft).
- FTB (Fade to Black) und Black Preset im Transition-Bereich (Mitschnitt mit echtem Frame nötig).
- Keys 1–4 → später **CasparCG** (Mitschnitt mit echtem Frame für Keyer und Joystick nötig).
- Macros über den Ziffernblock.
- Eingangsanzahl: 4RU = 48 Eingänge; Frage, ob 96 (8RU) möglich ist – appli.ini kennt bereits 0–96.
- Log-Beschriftung: interne Quellen (89/8a) noch als "intern" angezeigt.
- **Tastenbelegung dauerhaft speichern:** Belegung steht in `appli_cp.ini` (`[DefaultBusAssign]`, KEYnn =
  Eingangsnummer, KEY16 = Shift, KEY17–25 = Shift-Ebene Taste 1–9). Vorbereitet: `GV Dateien\appli_cp_obs.ini`
  (Taste 1–15 = Sz01–15, Shift+1–9 = Sz16–24). Save/Save As unter Config → Application Control nur mit
  USB-Stick am Panel (nicht SPARE-Buchse) → Test steht aus. Panel zeigt Application "20230209 DUPLEX1-NORM",
  lädt aber per TFTP `20230203 DUPLEX1-NORM`.

---

## 8. Fahrplan

1. ✅ CUT, AUTO, Blendenhebel – mit v3p am Panel bestätigt (PST rot während Blende, danach Tausch, neue PST hell)
2. ✅ Shift-Ebene (Szenen 17–24). ShiftShift am DD-1 vermutlich nicht möglich → ganz an den Schluss (nächste Woche)
   Ebenfalls zum Schluss (nächste Woche): **Beschriftungsstreifen** für die Tasten aus der OBS-Szenenliste drucken
   (Panel hat keine Tasten-Displays; Tastenabstand in mm nötig)
3. ✅ Ziffernblock (v3q, getestet) – Macros laufen im Panel
3a. ✅ Blendzeit, Delegates, Key-Bus, Key CUT/MIX, Next Transition, Wipes (v3v), CUT/AUTO nach Next Transition (v3w) – alles bestätigt
4. Eingangsanzahl / Szenen bis 96
5. **OBS-Anbindung** (obs-websocket v5) – **06.10. mit echtem OBS bestätigt: PGM, PST, CUT, AUTO, Blendenhebel (v4b)**
   - Panel: 15 Tasten × 2 (Shift) = **30 Szenen**; DD-1 hat keine frei belegbaren 2nd/3rd-Shift-Tasten (nur Kayenne XL).
     `kayak-obs.js` legt die ersten 30 OBS-Szenen (Reihenfolge der OBS-Liste, oben = 1) auf Eingang 1–30 (`KAYAK_OBS_SCENES`).
   - Frame-Lizenz nur 24 Eingänge: Shift+10…15 liegen auf internen Quellen. Codes (ShiftPST.pcapng):
     00 (Black) → Sz25, 90/91/92 (Col1–3) → Sz26–28, 99 (Col4/"Colt") → Sz29, f0 (Testbild) → Sz30.
     ✅ v4c, am Panel bestätigt (PGM/PST 1–30). Ändern: `$env:KAYAK_OBS_EXTRA="00=25,90=26,…"`.
   - TFT springt bei Col/Testbild ins Quellen-Menü = Panel-Funktion **Auto Menu** → abschalten mit
     **Home** + **Menu Lock** (Handbuch S. 145/434).
   - `appli_cp.ini` `[DefaultBusAssign]`: KEY1–15 = Tasten, KEY16 = Shift, **KEY17–31 = Shift-Ebene Taste 1–15**.
   - USB Save As mit Soft-Frame: legt nur leere Ordner an (Panel holt Inhalt vom Frame, vermutl. per NFS) →
     Test am echten Frame mit Mitschnitt offen.
   - **Blendenhebel:** OBS-Fehler – `SetTBarPosition` bewegt nur die Blende, nicht den T-Bar-Regler; beim Loslassen
     liest OBS den Regler (0) und bricht ab ("Manual transition cancelled", Programm springt zurück).
     v4b: ab 10 % Hebelweg normale Überblendung, Dauer aus Hebel-Tempo (150–5000 ms); Hebel zurück → zurückschneiden.
     `KAYAK_OBS_LEVER` = speed (Standard) / end / tbar.
   - Studio-Modus: PST = Vorschau, PGM = Programm (Schnitt), CUT = Übergang "Schnitt",
     AUTO = Fade mit Panel-Blendzeit (50–20000 ms), Hebel = T-Bar
   - Key 1–4 → Downstream-Keyer-Plugin (exeldro), DSK 1–4 = erste 4 Tabs: Key-Bus-Quelle wird als Szene
     eingetragen (`dsk_add_scene`), Key CUT/MIX = `dsk_select_scene` (leer = aus) mit `dsk_set_transition`
   - Schalter: `KAYAK_OBS_URL` (ws://127.0.0.1:4455), `KAYAK_OBS_PASS`, `KAYAK_OBS=0`, `KAYAK_DSK1..4`, `KAYAK_OBS_FADE`
   - ✅ Blendzeit Panel → OBS-Übergangsdauer bestätigt (06.10.)
   - **OBS-Adresse:** Standard `ws://192.168.5.100:4455` (Testaufbau), Heimstudio später `KAYAK_OBS_URL=ws://10.89.64.x:4455`.
   - **Advanced Scene Switcher** (v1.36.1 getestet): Soft-Frame schickt Vendor-Request `AdvancedSceneSwitcherMessage`
     mit Text `EMEM n` (Ziffernblock + Enter), `PGM n`, `PST n`, `CUT`, `AUTO`, `KEYk ON/OFF`. In ASS: Bedingung
     Websocket → „Anfrage wurde empfangen: EMEM 1“ (Regex möglich). ✅ 06.10. bestätigt.
     ASS 1.36.1 kennt `AdvancedSceneSwitcherVersion` nicht („No request was found by that name“) → gilt trotzdem
     als vorhanden. `AdvancedSceneSwitcherRunMacro` (Makro „EMEM n“ direkt) wird versucht, sonst nur Meldungen.
     ASS-Aktion „Websocket-Meldung senden“ erscheint im Log als `[ASS] Meldung von OBS: …`. Aus: `KAYAK_ASS=0`.
   - **Joystick/Positionier** (Log 06.10.): Panel `06 00 c5 00 [Gruppe] [Achse] [int16 Schritt]`, ca. alle 25 ms.
     Achse `14` = X (links −1/rechts +1), `15` = Y (runter −1/hoch +1), `17` = Twist (gegen Uhrzeiger bis −5,
     mit Uhrzeiger bis +5). Gruppe `10` = Joystick auf Wipe 1 delegiert. Beschleunigung macht das Panel selbst.
     v4e: verschiebt/skaliert per `SetSceneItemTransform` die oberste Quelle der **Vorschau-Szene**
     (`KAYAK_JOY_ITEM` = Quellenname), 8 px/Schritt (`KAYAK_JOY_PX`), Twist mit Uhrzeiger = größer, aus: `KAYAK_JOY=0`.
     Noch offen: Test am Panel, Rücksetzen auf Ausgangsposition.
   - **Downstream Keyer:** Key CUT = Übergang „Schnitt“, Key MIX = „Überblenden“ mit Key-Blendzeit;
     v4e setzt dafür zusätzlich den Show-/Hide-Übergang des DSK (die hätten sonst Vorrang). Im DSK „Tie“ aus lassen.
     Kein Fork nötig (alles über die vorhandenen Vendor-Requests).
   - **Applikationsname:** Frame meldet ihn im Record `23 00 01 [Länge] [Name]` (Antwort auf `04 00 63 23 00 01` und
     Anfangsstrom), dazu `Name`/`Path` in appli.ini. v4f ersetzt beim Laden „20230203 DUPLEX1-NORM“ → „21Broadcast“
     (Längenfelder angepasst). TFTP liefert nach Dateiname, Ordner egal. Test am Panel offen
     (Fallback: `KAYAK_APPNAME=21Broadcast_Standard`).
   - **Lizenz (24 Eingänge):** bleibt so – keine Umgehung. 30 Tasten + E-MEM/ASS reichen.
   - ✅ **Key 1–4 → Downstream Keyer** am Panel bestätigt (07.10.). Neue Key-Bus-Quelle: neue Szene eintragen,
     (falls Key an) umschalten, danach alle anderen Szenen aus dem DSK-Tab entfernen.
   - ✅ **Joystick** bestätigt. 2. Format (Joystick im PST-/Key-Bereich): `07 00 46 00 a1 02 [Achse] [int16]`,
     Achse `02` = X (±2), `03` = Y (±2), `04` = Twist (gegen Uhrzeiger +, bis ±10) → halbiert, Twist umgedreht.
   - **Wipes (v4g):** Panel-Transitions-Typ 01 Mix → „Überblenden“, 02/03 Wipe 1/2 → OBS-Übergang „Wischen“ (Luma Wipe,
     in OBS einmal anlegen). Pattern-Nummer → Luma-Bild über `kayak-wipes.json` („patterns“, „softness“, „invert“,
     „fallback“). Funktioniert, Tabelle wird noch befüllt.
   - **Move-Plugin (exeldro):** keine eigenen Websocket-Befehle; steuerbar nur indirekt (Filter ein/aus, Filter-Settings,
     Move als Übergang). Für Wipes nicht nötig.
   - **FTB (v4i):** Panel `06 00 25 00 08 07 00 02` (ein Paket pro Druck) → OBS-Schnellübergang „Schwarzüberblende“
     per `TriggerHotkeyByName` „OBSBasic.QuickTransition.3“ (`KAYAK_FTB`), Umschalten; ASS-Meldung `FTB ON/OFF`.
     DSK-Grafiken bleiben über dem Schwarz sichtbar. FTB-Lampe noch nicht (bräuchte Frame-Mitschnitt).
   - **Ebene 7 → „Black“ (v4k/v4l, ✅ bestätigt):** Key CUT/MIX der Ebene 7 schneidet/blendet das Programm auf die
     OBS-Szene „Black“ (Szene 97, `KAYAK_BLACK_SCENE`) und beim zweiten Druck zurück auf die vorherige Programm-Szene.
     MIX mit der Blendzeit von Ebene 7. Weg: Übergang setzen + `SetCurrentProgramScene` (wie PGM-Bus); Vorschau
     unberührt. v4k (Vorschau setzen + Trigger) lief nicht – OBS übernimmt die neue Vorschau verzögert.
     ASS-Meldung `BLACK ON/OFF`. **FTB-Taste dafür nicht mehr belegt** (wieder an: `KAYAK_FTB_KEY=1`).
   - **Version 5 – Quellen in der Vorschau-Szene bearbeiten (✅ 08.10. bestätigt):**
     - Key 1–4 (Delegate-Feld und Keyer-Subpanel schicken dasselbe) wählen die 1.–4. Quelle **von unten** in PST.
       Delegate Key 1 schickt kein `a0 26` – erkennbar an der Abfrage-Salve `05 00 24 00 [20..23] 50` für die
       drei anderen Keys (die fehlende Gruppe = delegierter Key; gilt für alle).
     - DPM-/Keyer-Regler (TFT-Digipots): `07 00 46 00 [a1..a4 = Key 1..4] [Untergruppe] [Achse] [int16]`.
       Untergruppe `02`: Achse `01` Size, `02` X, `03` Y, `04` Twist (Locate, ±2, Twist umgekehrt).
       Untergruppe `29`: Crop Edge, Achse `06` rechts, `07` links, `08` oben, `09` unten (Uhrzeiger + = mehr).
       Werte > 1 = Drehtempo. Key-Nummer steht in der Nachricht → Ziel ohne Delegate eindeutig.
     - OBS: `SetSceneItemTransform` (Position, Scale, cropLeft/Right/Top/Bottom); `KAYAK_SIZE_STEP` (0.01),
       `KAYAK_CROP_PX` (4). OBS kann Quellen per Fernsteuerung **nicht markieren** (keine Auswahl im UI).
     - Crop Soft (weiche Kanten) kann OBS nicht ohne Plugin; Codes noch nicht erfasst. TFT-Werte von OBS zurück
       ans Panel bräuchten einen Frame-Mitschnitt (Rückmelde-Records unbekannt).
     - Unbekannte Regler-Varianten erscheinen einmal pro Muster als `[REGLER] neu/unbekannt`.
     - **Keyer-Encoder (v5d):** `06 00 c5 00 [20..23 = Key 1..4] [Parameter] [int16]`. OPAC = `0d`;
       GAIN/CLIP je Key-Typ: `30/2f` (Key 1), `2d/2c` (Key 2, 3), `28/27` (Key 4).
       OBS: Filter an der Quelle (gilt in allen Szenen!): „Kayak Opacity“ (color_filter_v2, opacity 0..1),
       „Kayak Luma“ (luma_key_filter_v2: CLIP → luma_min, GAIN → luma_min_smooth umgekehrt). Werden beim ersten
       Drehen angelegt. `KAYAK_OPAC_STEP` (0.02), `KAYAK_LUMA_STEP` (0.005). Test am Panel steht aus.
   - **Joystick-Reset (v4j):** Panel `05 00 24 00 10 16 00` → 1. Druck: Quelle auf Lage vor der ersten Joystick-Bewegung,
     2. Druck: an Bildschirm anpassen (Seitenverhältnis, zentriert).
   - ✅ **Applikationsname „21Broadcast“** (v4f): Panel holt `/appli/21Broadcast/…`.
   - **ASS-Makros:** Einstellungsdatei mit E-MEM 1–99 (Bedingung „EMEM n“) erzeugt (`advss_EMEMs_1-99.txt`). (Plugin nicht auf Firmen-Mac → privat testen)
   - Noch nicht: Rückmeldung OBS → Panel (Klick in OBS ändert Panel nicht)
6. **CasparCG** (AMCP, Port 5250) für Keys 1–4
7. **Adressbereich 10.89.64.x** als eigener Schritt: Frame 10.89.64.2, Panel 10.89.64.50,
   Broadcast 10.89.64.255. Soft-Frame muss IPs/Multicast-Gruppe in allen Daten umschreiben,
   appli.ini mit ServerIP/ReportIP = Panel-IP ausliefern.

---

## 9. Widerlegt / nicht nochmal versuchen

- MAC-Adresse ist egal
- TTL, Timing, Windows vs. macOS, Firewall, Switch: nicht die Ursache
- Reines Abspielen echter Pakete reicht nicht – der Frame muss antworten
- Kurze Pakete aus Mitschnitten per UDP-Längenfeld zuschneiden (Ethernet-Füllbytes)
- Tally-Block 1 befüllen (bricht die Tasten)
- Tally-Vorlagen aus Mitschnitten mit laufender Blende verwenden

## 10. Arbeits-Hinweise

- Nach jeder Dateiübertragung auf den Laptop Dateigröße prüfen.
- Soft-Frame-Log und Mitschnitt immer zusammen auswerten.
- Immer nur eine Änderung pro Test (heute zweimal zwei Dinge gleichzeitig → Ursache nicht trennbar).
- Arbeitsstand liegt im OneDrive/Windows-Ordner; GitHub nur zur Veröffentlichung
  (keine GV-/Arbeitgeber-Konfigurationsdateien ins öffentliche Repo).
