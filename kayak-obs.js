// kayak-obs.js – OBS-Anbindung fuer das Kayak Soft-Frame (obs-websocket v5, ab OBS 28)
//
// - Beim Verbinden: Szenenliste aus OBS holen; die ersten 30 (Reihenfolge wie in der OBS-Szenenliste,
//   oben = 1) liegen auf den Eingaengen 1..30 (PGM, PST, Key-Bus).
// - OBS laeuft im Studio-Modus: PST = Vorschau, PGM = Programm.
// - CUT / AUTO -> Studio-Modus-Uebergang (Cut / Fade); Blendenhebel -> Ueberblendung nach Hebel-Tempo (KAYAK_OBS_LEVER).
// - Blendzeit vom Panel (Trans Rate, AUTO) -> Uebergangsdauer in OBS (50..20000 ms).
// - Key 1..4 -> Downstream-Keyer-Plugin (exeldro): Key-Bus-Quelle wird als Szene im DSK eingetragen,
//   Key CUT/MIX schaltet sie im DSK ein/aus. DSK 1..4 = die ersten 4 Tabs im DSK-Dock.
//
// Einstellungen (PowerShell, vor dem Start):
//   $env:KAYAK_OBS_URL  = "ws://192.168.5.100:4455" (Standard, Testaufbau; Studio spaeter 10.89.64.x)
//   $env:KAYAK_OBS_PASS = "passwort"             (falls in OBS Authentifizierung aktiv)
//   $env:KAYAK_OBS      = "0"                    (OBS-Anbindung aus)
//   $env:KAYAK_DSK1..4  = "Name"                 (DSK-Name statt Tab-Reihenfolge)
//   $env:KAYAK_OBS_FADE = "Name"                 (Uebergang fuer AUTO/Hebel/MIX, sonst erster "Fade"-Uebergang)

const crypto = require('crypto');

const URL = process.env.KAYAK_OBS_URL || 'ws://192.168.5.100:4455';
const PASS = process.env.KAYAK_OBS_PASS || '';
const ENABLED = process.env.KAYAK_OBS !== '0';
const MAX_SCENES = parseInt(process.env.KAYAK_OBS_SCENES || '30', 10);   // 15 Tasten x 2 (mit Shift)

let log = (...a) => console.log(...a);
let ws = null, ready = false, reqId = 0;
const pending = new Map();
const st = {
  scenes: [], allScenes: [],          // Index 0 = Eingang 1
  cutName: null, fadeName: null,
  dsk: [null, null, null, null],
  keySrc: [0, 0, 0, 0], keyOn: [false, false, false, false],
  durationMs: 1000, tbarActive: false, pendingPreview: null,
};

function getWS() {
  if (typeof WebSocket !== 'undefined') return WebSocket;   // Node 22+
  try { return require('ws'); } catch (e) { return null; }
}

function sha256b64(s) { return crypto.createHash('sha256').update(s).digest('base64'); }

function send(obj) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); }

function request(type, data) {
  return new Promise((resolve) => {
    if (!ready) return resolve(null);
    const id = 'r' + (++reqId);
    pending.set(id, resolve);
    send({ op: 6, d: { requestType: type, requestId: id, requestData: data || {} } });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(null); } }, 3000);
  });
}
// mehrere Anfragen garantiert in Reihenfolge
function batch(reqs) {
  return new Promise((resolve) => {
    if (!ready) return resolve(null);
    const id = 'b' + (++reqId);
    pending.set(id, resolve);
    send({ op: 8, d: { requestId: id, haltOnFailure: false, executionType: 0,
      requests: reqs.map(([t, d]) => ({ requestType: t, requestData: d || {} })) } });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(null); } }, 3000);
  });
}
// wie request(), liefert aber {ok, comment, data} und loggt keinen Fehler
function requestRaw(type, data) {
  return new Promise((resolve) => {
    if (!ready) return resolve({ ok: false, comment: 'nicht verbunden', data: {} });
    const id = 'q' + (++reqId);
    const cb = (r) => resolve(r); cb.raw = true;
    pending.set(id, cb);
    send({ op: 6, d: { requestType: type, requestId: id, requestData: data || {} } });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ ok: false, comment: 'Zeitueberschreitung', data: {} }); } }, 3000);
  });
}
function vendor(type, data) {
  return request('CallVendorRequest', { vendorName: 'downstream-keyer', requestType: type,
    requestData: Object.assign({ view_name: '' }, data) });
}

// Panel-Tasten Shift+10..15 liegen auf internen Quellen (Frame-Lizenz nur 24 Eingaenge).
// Deren Codes (ShiftPST, 06.10.) werden auf die OBS-Szenen 25..30 gelegt.
// Aendern: $env:KAYAK_OBS_EXTRA = "00=25,90=26,91=27,92=28,99=29,f0=30" (Code hex = Szene)
const EXTRA = {};
(process.env.KAYAK_OBS_EXTRA || '00=25,90=26,91=27,92=28,99=29,f0=30').split(',').forEach(p => {
  const [c, n] = p.split('='); if (c && n) EXTRA[parseInt(c, 16)] = parseInt(n, 10);
});
function sceneNo(code) {
  if (code in EXTRA) return EXTRA[code];
  return (code >= 1 && code <= 24) ? code : 0;
}
function sceneOf(code) { const n = sceneNo(code); return (n >= 1 && n <= st.scenes.length) ? st.scenes[n - 1] : null; }
function clampMs(ms) { return Math.max(50, Math.min(20000, Math.round(ms))); }

async function setup() {
  const r = await request('GetSceneList');
  if (r && r.scenes) {
    // OBS liefert unten->oben; Anzeige in OBS ist oben->unten
    const list = r.scenes.slice().sort((a, b) => b.sceneIndex - a.sceneIndex).map(s => s.sceneName);
    st.allScenes = list;
    st.scenes = list.slice(0, MAX_SCENES);
    log(`[OBS] ${list.length} Szenen, Eingang 1..${st.scenes.length}:`);
    st.scenes.forEach((n, i) => {
      const c = Object.keys(EXTRA).find(k => EXTRA[k] === i + 1);
      log(`[OBS]   ${String(i + 1).padStart(2, '0')} = ${n}${c !== undefined ? `  (Panel-Code ${Number(c).toString(16).padStart(2, '0')})` : ''}`);
    });
  }
  const t = await request('GetSceneTransitionList');
  if (t && t.transitions) {
    const cut = t.transitions.find(x => x.transitionKind === 'cut_transition');
    const fade = process.env.KAYAK_OBS_FADE
      ? t.transitions.find(x => x.transitionName === process.env.KAYAK_OBS_FADE)
      : t.transitions.find(x => x.transitionKind === 'fade_transition');
    st.cutName = cut ? cut.transitionName : null;
    st.fadeName = fade ? fade.transitionName : (t.currentSceneTransitionName || null);
    const wipe = WIPES.transition ? t.transitions.find(x => x.transitionName === WIPES.transition)
                                  : t.transitions.find(x => x.transitionKind === 'wipe_transition');
    st.wipeName = wipe ? wipe.transitionName : null;
    log(`[OBS] Uebergaenge: CUT = "${st.cutName}", AUTO/MIX = "${st.fadeName}", WIPE = "${st.wipeName || '-'}"`);
    if (!st.wipeName) log('[OBS] Kein Wipe-Uebergang in OBS - fuer Panel-Wipes im Uebergangs-Dock "+" -> "Wischen" (Luma Wipe) anlegen');
  }
  await request('SetStudioModeEnabled', { studioModeEnabled: true });
  const d = await vendor('get_downstream_keyers', {});
  const keyers = d && d.responseData && d.responseData.downstream_keyers;
  for (let i = 0; i < 4; i++) {
    st.dsk[i] = process.env['KAYAK_DSK' + (i + 1)] || (keyers && keyers[i] ? keyers[i].name : null);
  }
  if (keyers) log(`[OBS] Downstream Keyer: ${st.dsk.map((n, i) => `Key${i + 1}=${n || '-'}`).join(', ')}`);
  else log('[OBS] Downstream-Keyer-Plugin nicht gefunden (Keys 1-4 ohne OBS)');
  // ASS erkennen: Version abfragen. Manche Versionen kennen die Versions-Anfrage nicht
  // ("No request was found by that name") - dann ist der Vendor trotzdem da.
  st.ass = false;
  if (ASS_ON) {
    const a = await requestRaw('CallVendorRequest', { vendorName: 'AdvancedSceneSwitcher',
      requestType: 'AdvancedSceneSwitcherVersion', requestData: {} });
    const vendorMissing = !a.ok && /vendor/i.test(a.comment);
    st.ass = a.ok || (!vendorMissing && /request/i.test(a.comment));
    const ver = a.ok && a.data.responseData ? a.data.responseData.version : '';
    log(st.ass ? `[ASS] Advanced Scene Switcher gefunden${ver ? ' (Version ' + ver + ')' : ''}`
               : `[ASS] Advanced Scene Switcher nicht gefunden (${a.comment || 'keine Antwort'}) – Meldungen aus`);
  }
  if (hooks.onReady) hooks.onReady();
}

function connect() {
  const WS = getWS();
  if (!WS) { log('[OBS] Kein WebSocket verfuegbar (Node 22+ oder "npm install ws") – OBS-Anbindung aus'); return; }
  try { ws = new WS(URL); } catch (e) { log('[OBS] Verbindung fehlgeschlagen:', e.message); return retry(); }
  const on = (ev, fn) => ws.addEventListener ? ws.addEventListener(ev, fn) : ws.on(ev, fn);
  on('message', (ev) => {
    const msg = JSON.parse(typeof ev === 'string' ? ev : (ev.data !== undefined ? ev.data : ev).toString());
    const d = msg.d || {};
    if (msg.op === 0) {                       // Hello
      const ident = { rpcVersion: 1 };
      if (d.authentication) {
        if (!PASS) log('[OBS] OBS verlangt ein Passwort: $env:KAYAK_OBS_PASS setzen');
        const secret = sha256b64(PASS + d.authentication.salt);
        ident.authentication = sha256b64(secret + d.authentication.challenge);
      }
      send({ op: 1, d: ident });
    } else if (msg.op === 2) {                // Identified
      ready = true; log(`[OBS] verbunden mit ${URL}`);
      setup().catch(e => log('[OBS] Setup-Fehler:', e.message));
    } else if (msg.op === 7 || msg.op === 9) {
      const fn = pending.get(d.requestId);
      if (!fn) return;
      pending.delete(d.requestId);
      if (msg.op === 7) {
        if (fn.raw) return fn({ ok: !!d.requestStatus.result, comment: d.requestStatus.comment || '', data: d.responseData || {} });
        if (!d.requestStatus.result) log(`[OBS] Fehler ${d.requestType}: ${d.requestStatus.comment || d.requestStatus.code}`);
        fn(d.requestStatus.result ? (d.responseData || {}) : null);
      } else {
        for (const r of d.results || []) if (!r.requestStatus.result) log(`[OBS] Fehler ${r.requestType}: ${r.requestStatus.comment || r.requestStatus.code}`);
        fn(d.results);
      }
    } else if (msg.op === 5) {                // Event
      if (d.eventType === 'SceneTransitionVideoEnded' || d.eventType === 'SceneTransitionEnded') {
        if (st.pendingPreview) { const p = st.pendingPreview; st.pendingPreview = null;
          setTimeout(() => request('SetCurrentPreviewScene', { sceneName: p }), 50); }
      } else if (d.eventType === 'VendorEvent' && d.eventData && d.eventData.vendorName === 'AdvancedSceneSwitcher') {
        const m = d.eventData.eventData && d.eventData.eventData.message;
        if (m !== undefined) { log(`[ASS] Meldung von OBS: ${m}`); if (hooks.onAssMessage) hooks.onAssMessage(String(m)); }
      } else if (d.eventType === 'SceneListChanged') {
        log('[OBS] Szenenliste geaendert – neu einlesen'); setup();
      }
    }
  });
  on('close', () => { if (ready) log('[OBS] Verbindung getrennt'); ready = false; retry(); });
  on('error', () => {});
}
let retryTimer = null;
function retry() { if (retryTimer) return; retryTimer = setTimeout(() => { retryTimer = null; connect(); }, 5000); }

// ---------------- Schnittstelle fuer das Soft-Frame ----------------
const hooks = {};
function nameFor(code) { const s = sceneOf(code); return s ? `"${s}"` : '(keine Szene)'; }

function preview(code) {
  const s = sceneOf(code); if (!s) return;
  request('SetCurrentPreviewScene', { sceneName: s });
}
function program(code) {
  const s = sceneOf(code); if (!s) return;
  const r = []; if (st.cutName) r.push(['SetCurrentSceneTransition', { transitionName: st.cutName }]);
  r.push(['SetCurrentProgramScene', { sceneName: s }]);
  batch(r);
}
// nach dem Tausch: newPgm = bisherige PST, newPst = bisheriges PGM
function cut(newPgm, newPst) {
  const p = sceneOf(newPgm); if (!p) return;
  const r = [['SetCurrentPreviewScene', { sceneName: p }]];
  if (st.cutName) r.push(['SetCurrentSceneTransition', { transitionName: st.cutName }]);
  r.push(['TriggerStudioModeTransition']);
  st.pendingPreview = sceneOf(newPst);
  batch(r);
}
function auto(newPgm, newPst, ms) {
  const p = sceneOf(newPgm); if (!p) return;
  const r = [['SetCurrentPreviewScene', { sceneName: p }]];
  const w = wipeRequests();
  if (w) r.push(...w);
  else if (st.fadeName) r.push(['SetCurrentSceneTransition', { transitionName: st.fadeName }]);
  r.push(['SetCurrentSceneTransitionDuration', { transitionDuration: clampMs(ms) }]);
  r.push(['TriggerStudioModeTransition']);
  st.pendingPreview = sceneOf(newPst);
  batch(r);
}
function setDuration(ms) {
  st.durationMs = clampMs(ms);
  request('SetCurrentSceneTransitionDuration', { transitionDuration: st.durationMs });
  log(`[OBS] Uebergangsdauer ${st.durationMs} ms`);
}
// Blendenhebel.
// OBS-Fehler: SetTBarPosition bewegt nur die Blende, nicht den T-Bar-Regler in OBS. Beim Loslassen
// liest OBS den Regler (0) und bricht ab -> Programm springt zurueck ("Manual transition cancelled").
// Darum Standard KAYAK_OBS_LEVER=speed: ab 10 % Hebelweg startet eine normale Ueberblendung, deren Dauer
// aus dem Hebel-Tempo geschaetzt wird. Hebel ganz zurueck -> OBS schneidet zurueck.
//   end  = erst am Anschlag schneiden     tbar = alte T-Bar-Steuerung (mit OBS-Fehler)
const LEVER_MODE = (process.env.KAYAK_OBS_LEVER || 'speed').toLowerCase();
const LEVER_TRIGGER = 0.10;
const lever = { active: false, started: false, t0: 0, p0: 0 };
function tbar(pos, newPgm, newPst) {
  if (!ready) return;
  if (!lever.active) { lever.active = true; lever.started = false; lever.t0 = Date.now(); lever.p0 = pos;
    if (LEVER_MODE === 'tbar' && st.fadeName) request('SetCurrentSceneTransition', { transitionName: st.fadeName }); }
  if (LEVER_MODE === 'tbar') { request('SetTBarPosition', { position: Math.max(0, Math.min(0.999, pos)), release: false }); return; }
  if (LEVER_MODE !== 'speed' || lever.started || pos < LEVER_TRIGGER) return;
  const dt = Math.max(1, Date.now() - lever.t0), dp = Math.max(0.01, pos - lever.p0);
  const est = Math.max(150, Math.min(5000, Math.round(dt / dp)));
  lever.started = true;
  auto(newPgm, newPst, est);
  setTimeout(() => request('SetCurrentSceneTransitionDuration', { transitionDuration: st.durationMs }), est + 300);
  log(`[OBS] Hebel -> Ueberblendung ${est} ms (aus Hebel-Tempo)`);
}
// am Anschlag; newPgm/newPst = Zustand NACH dem Tausch
function tbarEnd(newPgm, newPst) {
  if (!lever.active) return;
  const started = lever.started; lever.active = false; lever.started = false;
  if (LEVER_MODE === 'tbar') { st.pendingPreview = sceneOf(newPst); request('SetTBarPosition', { position: 1, release: true }); return; }
  if (!started) cut(newPgm, newPst);           // Hebel schneller als die Schwelle bzw. Modus "end"
}
// Hebel zurueck an den Start; pgm/pst = unveraenderter Zustand
function tbarAbort(pgm, pst) {
  if (!lever.active) return;
  const started = lever.started; lever.active = false; lever.started = false;
  if (LEVER_MODE === 'tbar') { request('SetTBarPosition', { position: 0, release: true }); return; }
  if (started) { cut(pgm, pst); log('[OBS] Hebel zurueck -> zurueckgeschnitten'); }
}

// ---------------- Advanced Scene Switcher (WarmUpTill) ----------------
// Panel-Ereignisse gehen als Websocket-Meldung an ASS. In ASS: Makro mit Bedingung
// "Websocket" -> "Meldung empfangen" (Text z. B. "EMEM 12", Regex moeglich: "EMEM (\d+)").
// Zusaetzlich bei E-MEM: Makro mit genau diesem Namen ("EMEM 12") wird direkt gestartet, falls vorhanden.
// Meldungen: EMEM n | PGM n | PST n | CUT | AUTO | LEVER | KEYk ON/OFF   (n = Szenen-Nr. 1..30)
// Abschalten: $env:KAYAK_ASS = "0"
const ASS_ON = process.env.KAYAK_ASS !== '0';
function assMessage(text) {
  if (!ASS_ON || !ready || !st.ass) return;
  request('CallVendorRequest', { vendorName: 'AdvancedSceneSwitcher', requestType: 'AdvancedSceneSwitcherMessage',
    requestData: { message: text } });
}
function assRunMacro(name) {
  if (!ASS_ON || !ready || !st.ass || st.assNoRun) return;
  requestRaw('CallVendorRequest', { vendorName: 'AdvancedSceneSwitcher', requestType: 'AdvancedSceneSwitcherRunMacro',
    requestData: { name } }).then(r => {
      if (!r.ok && /request/i.test(r.comment)) { st.assNoRun = true; log('[ASS] Diese ASS-Version kann Makros nicht direkt starten – nur Meldungen'); }
    });
}
function emem(n) { assMessage(`EMEM ${n}`); assRunMacro(`EMEM ${n}`); log(`[ASS] EMEM ${n}`); }

// ---------------- Joystick (Positionier) -> Bild-im-Bild ----------------
// Panel: 06 00 c5 00 [Gruppe] [Achse 14=X, 15=Y, 17=Z/Twist] [int16 Schritt], ca. alle 25 ms solange bewegt.
// Schritte 1:1 uebernehmen (Beschleunigung macht das Panel selbst). Twist -5..+5 (im Uhrzeigersinn +).
// Pixel pro Schritt: $env:KAYAK_JOY_PX (Standard 8).
// Ziel: Quelle in der aktuellen VORSCHAU-Szene (PST). Name per $env:KAYAK_JOY_ITEM, sonst die oberste Quelle.
// X/Y verschieben, Twist im Uhrzeigersinn = groesser. Abschalten: $env:KAYAK_JOY="0"
const JOY_ON = process.env.KAYAK_JOY !== '0';
const JOY_ITEM = process.env.KAYAK_JOY_ITEM || '';
const JOY_PX = parseFloat(process.env.KAYAK_JOY_PX || '8'), JOY_SCALE_STEP = 0.004;
// TFT-Regler (v5b): Size = Groesse, Crop = Beschnitt in Pixel der Quelle (im Uhrzeigersinn = mehr)
const JOY_SIZE_STEP = parseFloat(process.env.KAYAK_SIZE_STEP || '0.01');
const JOY_CROP_PX = parseFloat(process.env.KAYAK_CROP_PX || '4');
const JOY_CROP_AXES = { 0x41: 'cropRight', 0x42: 'cropLeft', 0x43: 'cropTop', 0x44: 'cropBottom' };
const joyState = { scene: null, id: null, name: '', tf: null, loading: false, last: 0,
  dx: 0, dy: 0, ds: 0, crop: { cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0 }, dcrop: false,
  timer: null, group: null };
async function joyTarget(scene) {
  const r = await request('GetSceneItemList', { sceneName: scene });
  if (!r || !r.sceneItems || !r.sceneItems.length) return null;
  const items = r.sceneItems.slice().sort((a, b) => b.sceneItemIndex - a.sceneItemIndex);   // oben -> unten
  let it;
  if (JOY_ITEM) it = items.find(x => x.sourceName === JOY_ITEM);
  else if (joySel.idx != null) it = items.slice().reverse()[joySel.idx];                       // Key n = n-te von unten
  else it = items[0];
  if (!it) return null;
  const t = await request('GetSceneItemTransform', { sceneName: scene, sceneItemId: it.sceneItemId });
  if (!t || !t.sceneItemTransform) return null;
  return { id: it.sceneItemId, name: it.sourceName, tf: t.sceneItemTransform };
}
function joyFlush() {
  joyState.timer = null;
  const j = joyState;
  if (!j.tf || (!j.dx && !j.dy && !j.ds && !j.dcrop)) return;
  j.tf.positionX += j.dx; j.tf.positionY += j.dy;
  if (j.ds) { const f = Math.max(0.05, j.tf.scaleX * (1 + j.ds)); const k = f / j.tf.scaleX;
    j.tf.scaleX = f; j.tf.scaleY = Math.max(0.05, j.tf.scaleY * k); }
  const tfOut = { positionX: j.tf.positionX, positionY: j.tf.positionY, scaleX: j.tf.scaleX, scaleY: j.tf.scaleY };
  if (j.dcrop) {
    const sw = j.tf.sourceWidth || 1920, sh = j.tf.sourceHeight || 1080;
    for (const k of ['cropLeft', 'cropRight', 'cropTop', 'cropBottom']) {
      const max = (k === 'cropLeft' || k === 'cropRight') ? sw - 2 : sh - 2;
      j.tf[k] = Math.max(0, Math.min(max, Math.round((j.tf[k] || 0) + j.crop[k])));
      j.crop[k] = 0; tfOut[k] = j.tf[k];
    }
  }
  j.dx = j.dy = j.ds = 0; j.dcrop = false;
  request('SetSceneItemTransform', { sceneName: j.scene, sceneItemId: j.id, sceneItemTransform: tfOut });
}
async function joy(group, axis, val, pstCode) {
  if (!JOY_ON || !ready || !val) return;
  const now = Date.now(), j = joyState;
  const scene = sceneOf(pstCode);
  if (!scene) return;
  if (j.group !== group) { j.group = group; log(`[JOY] Joystick-Gruppe ${hex2(group)} -> Bild-im-Bild in der Vorschau`); }
  // nach 1 s Pause (oder neuer Szene) Ziel neu lesen, falls in OBS von Hand verschoben
  if (j.scene !== scene || now - j.last > 1000 || !j.tf) {
    if (j.loading) return;
    j.loading = true;
    const t = await joyTarget(scene);
    j.loading = false;
    if (!t) { if (j.scene !== scene) log(`[JOY] keine Quelle in "${scene}" gefunden`); j.scene = scene; j.tf = null; return; }
    if (j.scene !== scene || j.name !== t.name) log(`[JOY] bewegt "${t.name}" in "${scene}"`);
    Object.assign(j, { scene, id: t.id, name: t.name, tf: t.tf });
    const key = scene + '|' + t.id;
    if (!joySnap.has(key)) joySnap.set(key, Object.assign({}, t.tf));   // Ausgangslage fuer "Reset" merken
  }
  j.last = now;
  if (axis === 0x14) j.dx += val * JOY_PX;
  else if (axis === 0x15) j.dy -= val * JOY_PX;   // hoch = positiv, OBS-Y zaehlt nach unten
  else if (axis === 0x17) j.ds += val * JOY_SCALE_STEP;
  else if (axis === 0x30) j.ds += val * JOY_SIZE_STEP;                       // TFT Size
  else if (JOY_CROP_AXES[axis]) { j.crop[JOY_CROP_AXES[axis]] += val * JOY_CROP_PX; j.dcrop = true; }   // TFT Crop
  else return;
  if (!j.timer) j.timer = setTimeout(joyFlush, 50);
}
function hex2(n) { return (n & 0xff).toString(16).padStart(2, '0'); }

// Joystick-Reset (Panel-Taste im Joystick-Feld, Log 07.10.):
// 1. Druck: Quelle auf die Lage vor der ersten Joystick-Bewegung zuruecksetzen ("rueckgaengig").
// Weiterer Druck (oder nichts zum Zuruecksetzen): "An Bildschirm anpassen" (Seitenverhaeltnis bleibt, zentriert).
const joySnap = new Map();
// Delegate Key 1..4 (Delegate- und Keyer-Panel) waehlt die 1..4. Quelle von UNTEN in der Vorschau-Szene
// als Ziel fuer Joystick, Reset und TFT-Regler (v5).
const joySel = { idx: null };
async function selectItem(i, pstCode) {
  joySel.idx = i; joyState.last = 0; joyState.tf = null;
  const scene = sceneOf(pstCode);
  if (!ready || !scene) { log(`[JOY] Ziel: ${i + 1}. Quelle von unten`); return; }
  const t = await joyTarget(scene);
  log(t ? `[JOY] Ziel Key${i + 1}: "${t.name}" (${i + 1}. von unten in "${scene}")`
        : `[JOY] Ziel Key${i + 1}: in "${scene}" gibt es keine ${i + 1}. Quelle`);
}
async function joyReset(pstCode) {
  if (!JOY_ON || !ready) return;
  const scene = sceneOf(pstCode); if (!scene) return;
  const t = await joyTarget(scene);
  if (!t) { log(`[JOY] Reset: keine Quelle in "${scene}"`); return; }
  const key = scene + '|' + t.id, snap = joySnap.get(key), tf = t.tf;
  const same = snap && Math.abs(snap.positionX - tf.positionX) < 0.5 && Math.abs(snap.positionY - tf.positionY) < 0.5
    && Math.abs(snap.scaleX - tf.scaleX) < 1e-4;
  let set, what;
  if (snap && !same) {
    set = { positionX: snap.positionX, positionY: snap.positionY, scaleX: snap.scaleX, scaleY: snap.scaleY };
    what = 'zurueck auf Ausgangslage';
  } else {
    const v = await request('GetVideoSettings');
    const cw = v ? v.baseWidth : 1920, ch = v ? v.baseHeight : 1080;
    const sw = tf.sourceWidth || cw, sh = tf.sourceHeight || ch;
    const k = Math.min(cw / sw, ch / sh), w = sw * k, h = sh * k;
    const al = tf.alignment || 0;                       // 1 links, 2 rechts, 4 oben, 8 unten, 0 Mitte
    const x0 = (cw - w) / 2, y0 = (ch - h) / 2;
    const px = (al & 1) ? x0 : (al & 2) ? x0 + w : x0 + w / 2;
    const py = (al & 4) ? y0 : (al & 8) ? y0 + h : y0 + h / 2;
    set = { positionX: px, positionY: py, scaleX: k, scaleY: k };
    what = 'an Bildschirm angepasst';
  }
  joySnap.delete(key);
  await request('SetSceneItemTransform', { sceneName: scene, sceneItemId: t.id, sceneItemTransform: set });
  Object.assign(joyState, { scene, id: t.id, name: t.name, tf: Object.assign({}, tf, set), last: 0 });
  log(`[JOY] Reset "${t.name}" in "${scene}": ${what}`);
}

// ---------------- Wipes (Panel) -> OBS-Uebergang "Wischen" (Luma Wipe) ----------------
// Panel-Transitions-Typ (Bkgd): 01 = Mix -> Ueberblenden, 02 = Wipe 1, 03 = Wipe 2 -> Luma Wipe.
// Panel-Pattern-Nummer -> Luma-Bild ueber Tabelle in kayak-wipes.json (gleicher Ordner), sonst Standardtabelle.
// Luma-Bilder in OBS: barndoor-botleft/-h/-topleft/-v, blinds-h, box-botleft/-botright/-topleft/-topright, burst,
// checkerboard-small, circles, clock, cloud, curtain, fan, fractal, iris, linear-h/-topleft/-topright/-v,
// parallel-zigzag-h/-v, sinus9, spiral, square, squares, stripes, strips-h/-v, watercolor, zigzag-h/-v (.png)
const WIPES = (() => {
  const def = { transition: '', softness: 0.03, invert: false, fallback: 'linear-h.png',
    patterns: { 1: 'linear-h.png', 2: 'linear-v.png', 3: 'box-topleft.png', 4: 'box-topright.png',
      5: 'box-botright.png', 6: 'box-botleft.png', 7: 'barndoor-v.png', 9: 'barndoor-h.png',
      20: 'iris.png', 21: 'circles.png', 22: 'square.png', 47: 'clock.png' } };
  try {
    const f = require('path').join(__dirname, 'kayak-wipes.json');
    const j = JSON.parse(require('fs').readFileSync(f, 'utf8'));
    return Object.assign(def, j, { patterns: Object.assign({}, j.patterns || def.patterns) });
  } catch (e) { return def; }
})();
const wipeState = { type: 1, pattern: { 1: 1, 2: 1 } };
function lumaFor(pat) { return WIPES.patterns[pat] || WIPES.patterns[String(pat)] || WIPES.fallback; }
function wipeRequests() {
  if (wipeState.type !== 2 && wipeState.type !== 3) return null;
  if (!st.wipeName) return null;
  const pat = wipeState.pattern[wipeState.type - 1];
  return [['SetCurrentSceneTransition', { transitionName: st.wipeName }],
          ['SetCurrentSceneTransitionSettings', { transitionSettings: { luma_image: lumaFor(pat),
            luma_softness: WIPES.softness, luma_invert: !!WIPES.invert }, overlay: true }]];
}
function setTransType(typ) {
  wipeState.type = typ;
  const n = { 1: 'Mix', 2: 'Wipe 1', 3: 'Wipe 2' }[typ] || typ;
  log(`[OBS] Transitions-Typ ${n}${typ >= 2 ? ` -> "${st.wipeName || 'kein Wipe-Uebergang!'}" mit ${lumaFor(wipeState.pattern[typ - 1])}` : ''}`);
}
function setWipePattern(w, pat) {
  wipeState.pattern[w] = pat;
  log(`[OBS] Wipe ${w} Pattern ${pat} -> ${lumaFor(pat)}${WIPES.patterns[pat] ? '' : ' (nicht in Tabelle, Standard)'}`);
}

// ---------------- FTB (Fade to Black) ----------------
// Panel FTB -> OBS-Schnellübergang "Schwarzüberblende" (Studio-Modus). OBS legt die Standard-Schnellübergänge
// mit IDs 1 = Schnitt, 2 = Überblenden, 3 = Schwarzüberblende an; jeder hat ein internes Tastenkürzel
// "OBSBasic.QuickTransition.<ID>", das per TriggerHotkeyByName ausgelöst wird (keine Taste in OBS nötig).
// Andere ID: $env:KAYAK_FTB = "4". Dauer = Dauer des Schnellübergangs in OBS (Standard 300 ms).
const FTB_HOTKEY = 'OBSBasic.QuickTransition.' + (process.env.KAYAK_FTB || '3');
let ftbOn = false;
function ftb() {
  if (!ready) return;
  ftbOn = !ftbOn;
  request('TriggerHotkeyByName', { hotkeyName: FTB_HOTKEY });
  assMessage(ftbOn ? 'FTB ON' : 'FTB OFF');
  log(`[OBS] FTB -> ${ftbOn ? 'Schwarz' : 'zurück'} (${FTB_HOTKEY})`);
}

// ---------------- Keyer-Encoder OPAC / GAIN / CLIP -> OBS-Filter (v5d) ----------------
// Wirkt auf die Quelle des Keys (n-te von unten in PST). Filter haengen an der QUELLE (gilt in allen Szenen).
//   OPAC -> Filter "Kayak Opacity" (Farbkorrektur, opacity 0..1)
//   CLIP -> Filter "Kayak Luma" (Luma Key, luma_min = Schwelle), GAIN -> luma_min_smooth (mehr Gain = haerter)
// Schritte: $env:KAYAK_OPAC_STEP (0.02), $env:KAYAK_LUMA_STEP (0.005)
const OPAC_STEP = parseFloat(process.env.KAYAK_OPAC_STEP || '0.02');
const LUMA_STEP = parseFloat(process.env.KAYAK_LUMA_STEP || '0.005');
const F_OPAC = 'Kayak Opacity', F_LUMA = 'Kayak Luma';
const kf = new Map();   // sourceName -> { ready: Promise, opac, lumaMin, lumaSmooth, dirty:Set, timer }
const clamp01 = (v, hi = 1) => Math.max(0, Math.min(hi, v));
async function ensureFilter(src, name, kind, defaults) {
  const g = await requestRaw('GetSourceFilter', { sourceName: src, filterName: name });
  if (g.ok) return Object.assign({}, defaults, g.data.filterSettings || {});
  await request('CreateSourceFilter', { sourceName: src, filterName: name, filterKind: kind, filterSettings: defaults });
  log(`[KEYF] Filter "${name}" an "${src}" angelegt`);
  return Object.assign({}, defaults);
}
function kfFlush(src) {
  const f = kf.get(src); if (!f) return; f.timer = null;
  if (f.dirty.has('opac')) request('SetSourceFilterSettings', { sourceName: src, filterName: F_OPAC, filterSettings: { opacity: f.opac }, overlay: true });
  if (f.dirty.has('luma')) request('SetSourceFilterSettings', { sourceName: src, filterName: F_LUMA,
    filterSettings: { luma_min: f.lumaMin, luma_min_smooth: f.lumaSmooth }, overlay: true });
  f.dirty.clear();
}
async function keyFilter(i, kind, val, pstCode) {
  if (!ready) return;
  const scene = sceneOf(pstCode); if (!scene) return;
  if (joySel.idx !== i) joySel.idx = i;
  const t = await joyTarget(scene);
  if (!t) return;
  const src = t.name;
  let f = kf.get(src);
  if (!f) {
    f = { opac: 1, lumaMin: 0, lumaSmooth: 0, dirty: new Set(), timer: null, ready: null, luma: false, opacOk: false };
    kf.set(src, f);
  }
  if (kind === 'opac' && !f.opacOk) {
    f.opacOk = true;
    f.readyOpac = ensureFilter(src, F_OPAC, 'color_filter_v2', { opacity: 1.0 }).then(st2 => { f.opac = st2.opacity != null ? st2.opacity : 1; });
  }
  if (kind !== 'opac' && !f.luma) {
    f.luma = true;
    f.readyLuma = ensureFilter(src, F_LUMA, 'luma_key_filter_v2', { luma_max: 1.0, luma_max_smooth: 0.0, luma_min: 0.0, luma_min_smooth: 0.0 })
      .then(st2 => { f.lumaMin = st2.luma_min || 0; f.lumaSmooth = st2.luma_min_smooth || 0; });
  }
  await (kind === 'opac' ? f.readyOpac : f.readyLuma);
  if (kind === 'opac') { f.opac = clamp01(f.opac + val * OPAC_STEP); f.dirty.add('opac'); }
  else if (kind === 'clip') { f.lumaMin = clamp01(f.lumaMin + val * LUMA_STEP); f.dirty.add('luma'); }
  else if (kind === 'gain') { f.lumaSmooth = clamp01(f.lumaSmooth - val * LUMA_STEP, 0.5); f.dirty.add('luma'); }
  if (!f.timer) f.timer = setTimeout(() => kfFlush(src), 60);
  const now = Date.now();
  if (!f.lastLog || now - f.lastLog > 800) { f.lastLog = now;
    log(`[KEYF] Key${i + 1} "${src}": Opacity ${Math.round(f.opac * 100)} %, Clip ${f.lumaMin.toFixed(3)}, Gain(Glaettung) ${f.lumaSmooth.toFixed(3)}`); }
}

// ---------------- Ebene 7 (CUT/MIX) -> Schwarz ----------------
// Ersetzt die FTB-Taste: Panel-Ebene 7 CUT/MIX schneidet bzw. blendet das Programm auf die Szene "Black"
// (Name: $env:KAYAK_BLACK_SCENE) und beim zweiten Druck zurueck auf die vorherige Programm-Szene.
// Die Vorschau (PST) bleibt danach unveraendert. MIX nutzt die Blendzeit der Ebene 7 vom Panel.
const BLACK_SCENE = process.env.KAYAK_BLACK_SCENE || 'Black';
const blackState = { on: false, prev: null };
async function black(on, ms, pstCode) {
  if (!ready) return;
  if (on && !st.allScenes.includes(BLACK_SCENE)) { log(`[OBS] Szene "${BLACK_SCENE}" fehlt in OBS - bitte anlegen`); return; }
  let target;
  if (on) {
    const r = await request('GetCurrentProgramScene');
    blackState.prev = r ? (r.currentProgramSceneName || r.sceneName) : null;
    if (blackState.prev === BLACK_SCENE) return;
    target = BLACK_SCENE;
  } else {
    target = blackState.prev || sceneOf(pstCode);
    if (!target) return;
  }
  blackState.on = on;
  // Direkt aufs Programm (wie PGM-Bus): im Studio-Modus macht OBS daraus einen Uebergang mit dem aktuellen
  // Uebergang/Dauer, die Vorschau bleibt unangetastet. (v4k nutzte Vorschau+Trigger -> lief nicht.)
  const r = [];
  if (ms > 0 && st.fadeName) r.push(['SetCurrentSceneTransition', { transitionName: st.fadeName }],
    ['SetCurrentSceneTransitionDuration', { transitionDuration: clampMs(ms) }]);
  else if (st.cutName) r.push(['SetCurrentSceneTransition', { transitionName: st.cutName }]);
  r.push(['SetCurrentProgramScene', { sceneName: target }]);
  await batch(r);
  if (ms > 0) setTimeout(() => request('SetCurrentSceneTransitionDuration', { transitionDuration: st.durationMs }), clampMs(ms) + 300);
  assMessage(on ? 'BLACK ON' : 'BLACK OFF');
  log(`[OBS] Ebene 7 ${ms > 0 ? 'MIX' : 'CUT'} -> ${on ? '"' + BLACK_SCENE + '"' : 'zurueck auf "' + target + '"'}`);
}

// Keys 1..4 (i = 0..3)
function keySource(i, code) {
  st.keySrc[i] = code;
  const s = sceneOf(code), dsk = st.dsk[i];
  if (!s || !dsk) return;
  // neue Szene eintragen (ist der Key an: gleich umschalten), danach alle anderen Szenen aus dem DSK entfernen,
  // damit im DSK immer nur die aktuelle Key-Quelle steht
  (async () => {
    await vendor('dsk_add_scene', { dsk_name: dsk, scene: s });
    if (st.keyOn[i]) await vendor('dsk_select_scene', { dsk_name: dsk, scene: s });
    const d = await vendor('get_downstream_keyer', { dsk_name: dsk });
    const list = (d && d.responseData && d.responseData.scenes) || [];
    const old = list.map(x => x.name).filter(n => n && n !== s);
    for (const n of old) await vendor('dsk_remove_scene', { dsk_name: dsk, scene: n });
    log(`[OBS] Key${i + 1} -> DSK "${dsk}" Quelle ${nameFor(code)}${old.length ? ` (entfernt: ${old.join(', ')})` : ''}`);
  })();
}
async function keySwitch(i, on, ms) {
  st.keyOn[i] = on;
  const dsk = st.dsk[i]; if (!dsk || !ready) return;
  const tr = ms > 0 ? st.fadeName : st.cutName;
  // DSK nimmt beim Einschalten den "Show"-, beim Ausschalten den "Hide"-Uebergang, falls im Dock gesetzt,
  // sonst den normalen. Darum alle passenden setzen, damit immer Panel-Typ (CUT/MIX) und -Dauer gelten.
  if (tr) for (const tt of ['match', on ? 'show' : 'hide'])
    await vendor('dsk_set_transition', { dsk_name: dsk, transition: tr, transition_type: tt,
      transition_duration: ms > 0 ? clampMs(ms) : 0 });
  const s = on ? (sceneOf(st.keySrc[i]) || '') : '';
  if (on && !s) { log(`[OBS] Key${i + 1}: keine Quelle gewaehlt`); return; }
  if (on) await vendor('dsk_add_scene', { dsk_name: dsk, scene: s });
  await vendor('dsk_select_scene', { dsk_name: dsk, scene: s });
  log(`[OBS] Key${i + 1} DSK "${dsk}" ${on ? 'EIN ' + s : 'AUS'}${ms > 0 ? ` (${clampMs(ms)} ms)` : ''}`);
}

function init(logger, h) {
  if (logger) log = logger;
  Object.assign(hooks, h || {});
  if (!ENABLED) { log('[OBS] Anbindung abgeschaltet (KAYAK_OBS=0)'); return; }
  log(`[OBS] verbinde mit ${URL} ...`);
  connect();
}

module.exports = { keyFilter, selectItem, black, joyReset, ftb, setTransType, setWipePattern, joy, assMessage, emem, sceneNo, init, preview, program, cut, auto, setDuration, tbar, tbarEnd, tbarAbort,
  keySource, keySwitch, sceneOf, state: st, isReady: () => ready };
