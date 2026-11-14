// Runs quietly for everyone in the room. Watches Owlbear's Dice for finished d20 rolls and,
// when the DM has switched the helper on, shows the Armor Class hit in a banner at the top of the screen.
import OBR from "./obr-sdk.js";
import { KEY, DICE, ID, readSettings, d20Result, rollKey, describe, activeWeapon, LOG_KEY, canUndo, canon, linkPlayers, SAVE_KEY, SAVE_TTL, describeSave, sameCharacter } from "./shared.js?v=21";

const BANNER = ID + "/banner", TURN = ID + "/turn";
let shownTurn = "";
// Owlbear shows a tool's options bar across the top centre for most tools; only these leave that space free.
const NO_BAR = ["rodeo.owlbear.tool/move", "rodeo.owlbear.tool/select", "rodeo.owlbear.tool/pointer"];
// A phone is judged by the device's own screen (its shorter side), which doesn't depend on how Owlbear reports sizes.
// Phone layout switched off: nobody plays on a phone, and touch-screen laptops could be mistaken for one.
const isPhone = () => false;
let lowered = false; // true while this person has a tool with an options bar picked
// The banner sits just under the pill during combat, and takes the pill's place at the top when there's no combat.
const pillTop = () => (lowered ? 64 : 14), bannerTop = (phone) => (phone ? 58 : pillTop() + (shownTurn ? 50 : 0));
const seen = new Set();
let settings = { on: false, thac0: {}, weapons: {}, active: {}, bless: {}, round: 0, turn: "", first: "", hist: [] }, lines = [], hideTimer = null, ready = false, role = "PLAYER", myId = "", onPhone = false;
const channel = new BroadcastChannel(ID + "/log");
// When this person clicks the banner away, forget those lines so the next roll doesn't bring them back.
new BroadcastChannel(ID + "/dismiss").onmessage = () => { lines = []; clearTimeout(hideTimer); };

function remember(entry) {
  let log = [];
  try { log = JSON.parse(localStorage.getItem(LOG_KEY(OBR.room.id)) || "[]"); } catch (e) {}
  if (log.some((e) => e.k === entry.k)) return;
  log.unshift(entry); log = log.slice(0, 15);
  try { localStorage.setItem(LOG_KEY(OBR.room.id), JSON.stringify(log)); } catch (e) {}
  channel.postMessage(log);
}

async function showBanner() {
  const now = Date.now();
  lines = lines.filter((e) => now - e.t < 7000).slice(-4);
  await OBR.popover.close(BANNER);
  if (!lines.length) return;
  let vw = 1200;
  try { vw = await OBR.viewport.getWidth(); } catch (e) {}
  const phone = isPhone(vw), width = Math.min(520, vw - 16), height = 18 + lines.length * 38, left = Math.round(vw / 2);
  // On a phone the top of the screen is crowded (and the dice tray covers it), so the banner sits near the bottom,
  // over the empty floor of the tray, growing upwards. Other screens are unaffected.
  let vh = 0;
  if (phone) { try { vh = await OBR.viewport.getHeight(); } catch (e) {} }
  const low = phone && vh > 300;
  await OBR.popover.open({
    id: BANNER, url: "/thac0-helper/banner.html?v=21#" + encodeURIComponent(JSON.stringify(lines)), width, height,
    anchorReference: "POSITION", anchorPosition: { left, top: low ? vh - 84 : bannerTop(phone) },
    anchorOrigin: { horizontal: "CENTER", vertical: low ? "BOTTOM" : "TOP" }, transformOrigin: { horizontal: "CENTER", vertical: low ? "BOTTOM" : "TOP" },
    disableClickAway: true, hidePaper: true, marginThreshold: 0,
  });
  clearTimeout(hideTimer); hideTimer = setTimeout(showBanner, 7000);
}

function consider(player) {
  const m = player.metadata || {}, roll = m[DICE + "roll"], values = m[DICE + "rollValues"];
  if (!roll) return;
  const r = d20Result(roll, values); if (!r) return;
  const key = rollKey(player.id, roll); if (seen.has(key)) return; seen.add(key);
  if (!ready) return;                                       // rolls made before we started are ignored
  const who = canon(settings, player);                     // the saved name, even if they've renamed themselves since
  // A saving throw the DM called from Party Sheets takes this roll, whether or not the AC calculator is on.
  const sv = saveFor(player, who);
  if (sv) {
    usedSaves.add(sv.at);
    const entry = describeSave(sv.name, r, sv); entry.k = key;
    remember(entry); lines.push(entry); showBanner();
    if (role === "GM") OBR.room.setMetadata({ [SAVE_KEY]: undefined }).catch(() => {});   // one roll answers one call
    return;
  }
  if (!settings.on) return;                                 // the AC calculator is off
  const t = settings.thac0[who];
  if (t === undefined || t === null || t === "" || isNaN(+t)) return;   // only characters the DM has given a THAC0
  const entry = describe(who, r, +t, activeWeapon(settings, who), !!settings.bless[who]); entry.k = key;
  remember(entry);
  if (onPhone && player.id !== myId) return;               // on a phone, only your own rolls pop up, to save space
  lines.push(entry); showBanner();
}

// Which roll answers a called save: simply the next d20 anyone rolls, the DM included. The DM picked the character
// by clicking their sheet, so whoever rolls (the player, or someone standing in for them) is rolling for that character.
let pendingSave = null; const usedSaves = new Set();
function saveFor(player, who) {
  const sv = pendingSave;
  if (!sv || !sv.need || usedSaves.has(sv.at) || Date.now() - sv.at > SAVE_TTL) return null;
  return sv;
}

// The small "Round 3 · Party acts" pill at the top of everyone's screen, shown while the DM has combat going.
async function showTurn() {
  let vw = 1200;
  try { vw = await OBR.viewport.getWidth(); } catch (e) {}
  // Not shown on phones at all: the screen is too small to spare the room.
  const phone = isPhone(vw), left = Math.round(vw / 2);
  const want = settings.round && !phone ? JSON.stringify({ round: settings.round, turn: settings.turn, first: settings.first, canUndo: canUndo(settings), lowered }) : "";
  if (want === shownTurn) return; shownTurn = want;
  await OBR.popover.close(TURN);
  if (!want) return;
  await OBR.popover.open({
    id: TURN, url: "/thac0-helper/turn.html?v=21#" + encodeURIComponent(want), width: 340, height: 38,
    anchorReference: "POSITION", anchorPosition: { left, top: pillTop() },
    anchorOrigin: { horizontal: "CENTER", vertical: "TOP" }, transformOrigin: { horizontal: "CENTER", vertical: "TOP" },
    disableClickAway: true, hidePaper: true, marginThreshold: 0,
  });
}

// The helper's button sits in Owlbear's toolbar for the GM only; players never see it.
// Clicking it opens the panel beside the button instead of switching tools; clicking elsewhere closes it.
const PANEL = ID + "/panel";
function addButton() {
  return OBR.tool.create({
    id: ID + "/button",
    icons: [{ icon: "/thac0-helper/icon.svg", label: "THAC0 Helper", filter: { roles: ["GM"] } }],
    onClick: async (context, elementId) => {
      await OBR.popover.open({ id: PANEL, url: "/thac0-helper/panel.html?v=21", width: 340, height: 480, anchorElementId: elementId,
        anchorOrigin: { horizontal: "LEFT", vertical: "TOP" }, transformOrigin: { horizontal: "RIGHT", vertical: "TOP" } });
      return false;
    },
  });
}
function badge() {}

// The GM's copy of the helper (only one writer) links players to their saved names by Owlbear player ID.
let partyNow = [];
async function link() {
  if (role !== "GM" || !partyNow.length) return;
  const a = linkPlayers(settings, partyNow), b = applySheets(settings, partyNow);
  if (a || b) { try { await OBR.room.setMetadata({ [KEY]: settings }); } catch (e) {} }
}

// ---------- THAC0s straight from the party tracker's sheets (GM's copy only) ----------
// Each player in the room is matched to a character: the "In Owlbear" name picked in Party Sheets first,
// otherwise the character's name or the sheet's Player box. Their THAC0 then comes from the sheet, so a level-up
// on the sheet is picked up automatically. Players who don't match keep working as before (a THAC0 typed in the panel).
let sheetChars = null;
const norm = (x) => String(x || "").trim().toLowerCase();
function applySheets(s, players) {
  if (!sheetChars) return false;
  const live = sheetChars.filter((c) => !c.binned && !c.hidden && c.name && String(c.thac0 || "").trim() !== "" && !isNaN(+c.thac0));
  let changed = false; const flags = {};
  const move = (from, to) => {                               // carry weapons and Bless typed under the old name over, once
    for (const k of ["weapons", "active", "bless"]) if (s[k][from] !== undefined) { if (s[k][to] === undefined) s[k][to] = s[k][from]; delete s[k][from]; }
    delete s.thac0[from]; for (const id in s.ids) if (s.ids[id] === from) delete s.ids[id];
    changed = true;
  };
  for (const p of players) {
    if (!p || !p.id || p.role === "GM") continue;
    const c = live.find((c) => c.obr && norm(c.obr) === norm(p.name))
      || live.find((c) => !c.obr && (sameCharacter(p.name, c.name) || (c.player && sameCharacter(p.name, c.player))));
    if (!c) continue;
    const n = c.name, old = s.ids[p.id] && s.ids[p.id] !== n ? s.ids[p.id] : (s.thac0[p.name] !== undefined && p.name !== n ? p.name : null);
    if (old && !s.sheet[old]) move(old, n);
    if (s.thac0[n] !== +c.thac0) { s.thac0[n] = +c.thac0; changed = true; }
    if (s.ids[p.id] !== n) { s.ids[p.id] = n; changed = true; }
    if (sheetWeapons(s, c, n)) changed = true;
    flags[n] = true;
  }
  for (const n in s.sheet) { const c = live.find((c) => c.name === n); if (c) { flags[n] = true; if (s.thac0[n] !== +c.thac0) { s.thac0[n] = +c.thac0; changed = true; } if (sheetWeapons(s, c, n)) changed = true; } }
  if (JSON.stringify(flags) !== JSON.stringify(s.sheet)) { s.sheet = flags; changed = true; }
  return changed;
}
// Weapons come from the sheet's Weapons box (up to 3: name, bonus to hit, Spec.), and the one in use from the
// choice made in Party Sheets. Weapons set up earlier in this panel are copied onto the sheet once, if its box is empty.
const sheetList = (c) => [1, 2, 3].map((i) => ({ n: String(c["w" + i + "n"] || "").trim(), b: parseInt(String(c["w" + i + "b"] || "0").replace(/[^\d-]/g, ""), 10) || 0, s: !!c["w" + i + "s"] })).filter((w) => w.n);
let sheetApi = null; const copied = new Set();
function sheetWeapons(s, c, n) {
  const list = sheetList(c);
  if (!list.length) {
    const old = (s.weapons[n] || []).slice(0, 3);
    if (old.length && sheetApi && !copied.has(c.id)) {          // one-time copy of this panel's weapons onto the sheet
      copied.add(c.id); const p = {}; old.forEach((w, i) => { p["w" + (i + 1) + "n"] = w.n; p["w" + (i + 1) + "b"] = String(w.b || 0); p["w" + (i + 1) + "s"] = !!w.s; });
      if (Number.isInteger(s.active[n]) && s.active[n] < 3) p.wact = s.active[n] + 1;
      sheetApi(c.id, p).catch(() => copied.delete(c.id));
    }
    return false;
  }
  let changed = false;
  if (JSON.stringify(s.weapons[n] || []) !== JSON.stringify(list)) { s.weapons[n] = list; changed = true; }
  const a = Number.isInteger(c.wact) && c.wact >= 1 && c.wact <= list.length ? c.wact - 1 : undefined;
  if (s.active[n] !== a) { if (a === undefined) delete s.active[n]; else s.active[n] = a; changed = true; }
  return changed;
}
let sheetsOn = false;
async function connectSheets() {
  if (sheetsOn || role !== "GM") return;
  let party = null; try { party = JSON.parse(localStorage.getItem("ps-party") || "null"); } catch (e) {}
  const cfg = window.TRACKER_CONFIG; if (!party || !cfg) return;    // Party Sheets hasn't been given the party link yet
  sheetsOn = true;
  try {
    const B = "https://www.gstatic.com/firebasejs/10.12.2/";
    const [{ initializeApp }, F] = await Promise.all([import(B + "firebase-app.js"), import(B + "firebase-firestore.js")]);
    const db = F.getFirestore(initializeApp(cfg.firebase, "thac0-helper"));
    sheetApi = (id, p) => F.updateDoc(F.doc(db, "parties", party, "characters", id), p);
    F.onSnapshot(F.collection(db, "parties", party, "characters"), (snap) => { sheetChars = snap.docs.map((d) => ({ id: d.id, ...d.data() })); link(); }, () => { sheetsOn = false; });
  } catch (e) { sheetsOn = false; console.warn("THAC0 Helper: couldn't read the party tracker", e); }
}
addEventListener("storage", (e) => { if (e.key === "ps-party") connectSheets(); });   // Party Sheets was just given the link

OBR.onReady(async () => {
  role = await OBR.player.getRole(); myId = await OBR.player.getId();
  try { onPhone = isPhone(await OBR.viewport.getWidth()); } catch (e) { onPhone = isPhone(1200); }
  try { addButton().catch(() => {}); } catch (e) {}
  { const meta = await OBR.room.getMetadata(); settings = readSettings(meta); pendingSave = meta[SAVE_KEY] || null; } badge();
  // Drop the pill below the options bar while a tool that has one is picked; put it back for the move tool.
  const toolChanged = (id) => { const low = !NO_BAR.includes(id); if (low !== lowered) { lowered = low; showTurn(); } };
  try { lowered = !NO_BAR.includes(await OBR.tool.getActiveTool()); OBR.tool.onToolChange(toolChanged); } catch (e) {}
  showTurn();
  OBR.room.onMetadataChange((meta) => { settings = readSettings(meta); pendingSave = meta[SAVE_KEY] || null; badge(); showTurn(); link(); });
  // note the rolls already on the table, so they are not announced as new
  const self = { id: await OBR.player.getId(), name: await OBR.player.getName(), metadata: await OBR.player.getMetadata() };
  partyNow = await OBR.party.getPlayers(); link(); connectSheets();
  consider(self); partyNow.forEach(consider);
  ready = true;
  OBR.player.onChange((p) => consider(p));
  OBR.party.onChange((ps) => { partyNow = ps; link(); ps.forEach(consider); });
  OBR.player.onChange(async (p) => { if (p.role && p.role !== role) { role = p.role; badge(); } });
});
