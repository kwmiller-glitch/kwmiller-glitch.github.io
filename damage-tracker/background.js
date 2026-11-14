import OBR, { buildText } from "./obr-sdk.js?v=12";
import { ID, DMG, PC, LABEL } from "./shared.js?v=12";

// ▼ ▲ and Clear on the token menu, for the GM only, on tokens (the CHARACTER layer) not marked as PCs.
const notPC = { key: ["metadata", PC], value: true, operator: "!=" };
const onToken = { key: "layer", value: "CHARACTER" };
const damaged = { key: ["metadata", DMG], value: undefined, operator: "!=" };

function change(items, fn) {
  // PCs' tokens take the damage off their hit points on the sheet instead (see "PCs" below); monsters get the counter.
  const pcs = items.filter((t) => charFor(t)), rest = items.filter((t) => !charFor(t));
  const d = fn(0);                                          // +1 damage, −1 take back, 0 clear (clearing does nothing to PCs)
  if (d) pcs.forEach((t) => bumpHP(charFor(t), d, t.id));
  if (!rest.length) return Promise.resolve();
  return OBR.scene.items.updateItems(rest, (drafts) => {
    for (const d of drafts) { const n = fn(+d.metadata[DMG] || 0); if (n > 0) d.metadata[DMG] = n; else delete d.metadata[DMG]; }
  });
}

function addMenu() {
  OBR.contextMenu.create({
    id: ID + "/down",
    icons: [{ icon: "/damage-tracker/down.svg", label: "1 damage", filter: { roles: ["GM"], every: [onToken, notPC] } }],
    onClick: (ctx) => change(ctx.items, (n) => n + 1),
    shortcut: "j",               // select a monster, press j: 1 damage (if Owlbear honours it)
  });
  OBR.contextMenu.create({
    id: ID + "/up",
    icons: [{ icon: "/damage-tracker/up.svg", label: "Take back 1 damage", filter: { roles: ["GM"], every: [onToken, notPC, damaged] } }],
    onClick: (ctx) => change(ctx.items, (n) => n - 1),
    shortcut: "k",               // k takes 1 back
  });
  OBR.contextMenu.create({
    id: ID + "/clear",
    icons: [{ icon: "/damage-tracker/clear.svg", label: "Clear damage", filter: { roles: ["GM"], every: [onToken, damaged] } }],
    onClick: (ctx) => change(ctx.items, () => 0),
  });
}

// The damage tool (GM only). Pick it, then click a token: 1 damage per click; Shift + click takes one back.
// "Clear all damage" sits in the tool's own bar at the top while it's picked. Pick the hand tool to go back.
const TOOL = ID + "/tool", MODE = ID + "/hit";
async function tokenOf(item) {
  if (!item) return null;
  if (item.layer === "CHARACTER") return item;
  if (item.attachedTo) { const [p] = await OBR.scene.items.getItems([item.attachedTo]); return p && p.layer === "CHARACTER" ? p : null; }
  return null;
}
function addTool() {
  OBR.tool.create({ id: TOOL, icons: [{ icon: "/damage-tracker/icon.svg", label: "Damage (click a monster)", filter: { roles: ["GM"] } }], defaultMode: MODE });
  OBR.tool.createMode({
    id: MODE,
    icons: [{ icon: "/damage-tracker/down.svg", label: "Click: 1 damage · Shift + click: take one back", filter: { activeTools: [TOOL] } }],
    cursors: [{ cursor: "pointer", filter: { target: [onToken] } }, { cursor: "default" }],
    preventDrag: { target: [onToken] },
    // Counted on each press (not each click), so rapid clicking is never mistaken for a double-click and lost.
    onToolDown: async (context, event) => {
      const t = await tokenOf(event.target);
      if (!t) return;
      const c = charFor(t);
      if (c) bumpHP(c, event.shiftKey ? -1 : 1, t.id);      // a PC: straight off their hit points on the sheet
      else bump(t.id, event.shiftKey ? -1 : 1);
    },
    // A click on empty map (not a token) means you're done hitting things: switch back to the move tool.
    // The damage numbers stay on the tokens.
    onToolClick: async (context, event) => {
      if (!(await tokenOf(event.target))) await OBR.tool.activateTool("rodeo.owlbear.tool/move");
      return false;                       // don't select or move the token
    },
    onToolDoubleClick: () => false,
  });
  OBR.tool.createAction({
    id: ID + "/clearall",
    icons: [{ icon: "/damage-tracker/clear.svg", label: "Clear all damage", filter: { activeTools: [TOOL] } }],
    onClick: async () => {
      pend.clear(); clearTimeout(flushT);
      const hurt = await OBR.scene.items.getItems((i) => i.layer === "CHARACTER" && +i.metadata[DMG] > 0);
      if (hurt.length) await change(hurt, () => 0);
    },
  });
}

// Rapid clicks: the number on screen changes at once, and the total is saved to the token a moment after
// the clicking stops (one save instead of one per click, which is what made it feel slow).
let pend = new Map(), inflight = new Map(), flushT = null;
const delta = (id) => (pend.get(id) || 0) + (inflight.get(id) || 0);
function bump(id, d) {
  pend.set(id, (pend.get(id) || 0) + d);
  sync();
  clearTimeout(flushT); flushT = setTimeout(flush, 350);
}
async function flush() {
  if (!pend.size) return;
  inflight = pend; pend = new Map();
  try {
    const items = await OBR.scene.items.getItems([...inflight.keys()]);
    await OBR.scene.items.updateItems(items, (ds) => {
      for (const d of ds) { const n = (+d.metadata[DMG] || 0) + (inflight.get(d.id) || 0); if (n > 0) d.metadata[DMG] = n; else delete d.metadata[DMG]; }
    });
  } catch (e) { console.warn("Damage Tracker:", e); }
  inflight = new Map(); sync();
}

// The "−7" labels under damaged tokens are local items: they exist on the GM's screen only.
let busy = false, again = false;
async function sync() {
  if (busy) { again = true; return; } busy = true;
  try {
    const dmgOf = (i) => Math.max(0, (+i.metadata[DMG] || 0) + delta(i.id));
    const tokens = (await OBR.scene.items.getItems((i) => i.layer === "CHARACTER" && dmgOf(i) > 0));
    const labels = await OBR.scene.local.getItems((i) => i.metadata[LABEL] !== undefined);
    const want = new Map(tokens.map((t) => [t.id, "−" + dmgOf(t)]));
    const have = new Map(labels.map((l) => [l.metadata[LABEL], l]));
    const gone = labels.filter((l) => !want.has(l.metadata[LABEL])).map((l) => l.id);
    if (gone.length) await OBR.scene.local.deleteItems(gone);
    const stale = labels.filter((l) => want.has(l.metadata[LABEL]) && l.text.plainText !== want.get(l.metadata[LABEL]));
    if (stale.length) await OBR.scene.local.updateItems(stale, (ds) => { for (const d of ds) d.text.plainText = want.get(d.metadata[LABEL]); });
    const add = [];
    for (const t of tokens) {
      if (have.has(t.id)) continue;
      const b = await OBR.scene.items.getItemBounds([t.id]);
      // Plain red text with a dark outline, just under the token's bottom edge, right of centre (clear of the name label).
      // It's drawn as part of the map, so it keeps the same size relative to the token at every zoom.
      const fs = Math.max(8, Math.round(b.height * 0.2));
      add.push(buildText().textType("PLAIN").plainText(want.get(t.id)).width(Math.round(b.width * 0.5)).height(Math.round(fs * 1.4))
        .position({ x: b.center.x + b.width * 0.12, y: b.max.y - fs * 0.35 }).textAlign("LEFT").textAlignVertical("TOP")
        .fontSize(fs).fontWeight(800).fillColor("#ff4a4a").strokeColor("#1a0000").strokeWidth(Math.max(2, Math.round(fs * 0.16)))
        .attachedTo(t.id).layer("ATTACHMENT").locked(true).disableHit(true).visible(true)
        .metadata({ [LABEL]: t.id }).build());
    }
    if (add.length) await OBR.scene.local.addItems(add);
  } catch (e) { console.warn("Damage Tracker:", e); }
  busy = false;
  if (again) { again = false; sync(); }
}

// ---------- PCs: damage comes off the hit points on their party tracker sheet ----------
// A token is a PC when its name matches a character in the party tracker (same name, or a shared word of 3+ letters),
// as in Party Sheets. Clicks are added up and saved to the sheet a moment after you stop, so rapid clicks all count;
// the HP number above the token (Party Sheets) and the tracker update from that. Shift + click heals 1.
let sheetChars = [];
const norm = (x) => String(x || "").trim().toLowerCase();
const sameName = (a, b) => { a = norm(a); b = norm(b); if (!a || !b) return false; if (a === b) return true; const wb = b.split(/\s+/); return a.split(/\s+/).some((w) => w.length > 2 && wb.includes(w)); };
const numOf = (v) => { const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10); return isNaN(n) ? null : n; };
function charFor(t) {
  const name = (t.text && t.text.plainText) || t.name || "", live = sheetChars.filter((c) => !c.binned && !c.hidden && c.name && numOf(c.hpmax) !== null);
  return live.find((c) => norm(c.name) === norm(name)) || live.find((c) => sameName(name, c.name)) || null;
}
let hpPend = new Map(), hpT = null, sheetUpdate = null;
function bumpHP(c, d, tokenId) {
  hpPend.set(c.id, (hpPend.get(c.id) || 0) + d); clearTimeout(hpT); hpT = setTimeout(flushHP, 350);
  if (tokenId) showHP(c, tokenId);
}
// Change the HP number above the token (drawn by Party Sheets on this screen) at once, before the sheet is saved,
// so clicking feels instant; Party Sheets redraws it from the sheet a moment later with the same number.
async function showHP(c, tokenId) {
  const max = numOf(c.hpmax), hp = (numOf(c.hp) ?? max ?? 0) - (hpPend.get(c.id) || 0);
  const color = hp <= 0 ? "#ff5a5a" : max && hp * 2 <= max ? "#ffc94d" : "#8ff09a";
  try {
    const ls = await OBR.scene.local.getItems((i) => i.metadata["party-sheets/hp"] === tokenId);
    if (ls.length) await OBR.scene.local.updateItems(ls, (ds) => { for (const x of ds) { x.text.plainText = hp + "/" + max; x.text.style.fillColor = color; } });
  } catch (e) {}
}
async function flushHP() {
  const p = hpPend; hpPend = new Map(); if (!sheetUpdate) return;
  for (const [id, dmg] of p) {
    const c = sheetChars.find((x) => x.id === id); if (!c || !dmg) continue;
    const now = numOf(c.hp) ?? numOf(c.hpmax) ?? 0;
    try { await sheetUpdate(id, { hp: String(now - dmg) }); } catch (e) { console.warn("Damage Tracker: couldn't save hit points", e); }
  }
}
let fbOn = false;
async function connectSheets() {
  if (fbOn) return;
  let party = null; try { party = JSON.parse(localStorage.getItem("ps-party") || "null"); } catch (e) {}
  const cfg = window.TRACKER_CONFIG; if (!party || !cfg) return;    // Party Sheets hasn't been given the party link here yet
  fbOn = true;
  try {
    const B = "https://www.gstatic.com/firebasejs/10.12.2/";
    const [{ initializeApp }, F] = await Promise.all([import(B + "firebase-app.js"), import(B + "firebase-firestore.js")]);
    const db = F.getFirestore(initializeApp(cfg.firebase, "damage-tracker"));
    sheetUpdate = (id, p) => F.updateDoc(F.doc(db, "parties", party, "characters", id), p);
    F.onSnapshot(F.collection(db, "parties", party, "characters"), (snap) => { sheetChars = snap.docs.map((d) => ({ id: d.id, ...d.data() })); }, () => { fbOn = false; });
  } catch (e) { fbOn = false; }
}
addEventListener("storage", (e) => { if (e.key === "ps-party") connectSheets(); });

OBR.onReady(async () => {
  addMenu();
  if ((await OBR.player.getRole()) !== "GM") return;      // players: nothing else to do
  addTool(); connectSheets();
  let unsub = null;
  const start = () => { if (unsub) unsub(); unsub = OBR.scene.items.onChange(() => sync()); sync(); };
  if (await OBR.scene.isReady()) start();
  OBR.scene.onReadyChange((ready) => { if (ready) start(); else if (unsub) { unsub(); unsub = null; } });
});
