import OBR, { buildText } from "./obr-sdk.js?v=2";

// A toolbar button for the GM only. It opens the party's short character sheets in a panel on the right;
// the button again, ✕, Esc or a click anywhere outside closes it. (Same pattern as the Spell Book.)
const ID = "party-sheets", PANEL = ID + "/panel";
let closedAt = 0, open = false;
new BroadcastChannel(ID).onmessage = (m) => { if (m.data === "closed") { closedAt = Date.now(); open = false; } };

async function toggle() {
  if (Date.now() - closedAt < 600) return;
  if (open) { open = false; await OBR.popover.close(PANEL); return; }
  let vw = 1400, vh = 900;
  try { vw = await OBR.viewport.getWidth(); vh = await OBR.viewport.getHeight(); } catch (e) {}
  const width = 420, height = Math.max(420, vh - 110);
  await OBR.popover.open({
    id: PANEL, url: `/party-sheets/panel.html?v=10&mh=${height}`, width, height,
    anchorReference: "POSITION", anchorPosition: { left: vw - 76, top: 66 },
    anchorOrigin: { horizontal: "RIGHT", vertical: "TOP" }, transformOrigin: { horizontal: "RIGHT", vertical: "TOP" },
  });
  open = true;
}

// ---------- hit points under the PCs' tokens, on the GM's screen only ----------
// A token is matched to a character by the token's name (same name, or a shared word of 3+ letters), since players
// always use the same tokens. The "14/24" is drawn on the map just under the token, left of centre (the Damage
// Tracker's number sits right of centre), green above half, amber at half or below, red at 0 or less.
const HPL = ID + "/hp";
let sheetChars = [], busy = false, again = false;
const norm = (x) => String(x || "").trim().toLowerCase();
const sameName = (a, b) => { a = norm(a); b = norm(b); if (!a || !b) return false; if (a === b) return true; const wb = b.split(/\s+/); return a.split(/\s+/).some((w) => w.length > 2 && wb.includes(w)); };
const numOf = (v) => { const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10); return isNaN(n) ? null : n; };
const tokenName = (t) => (t.text && t.text.plainText) || t.name || "";
async function syncHP() {
  if (busy) { again = true; return; } busy = true;
  try {
    const chars = sheetChars.filter((c) => !c.binned && !c.hidden && c.name && numOf(c.hpmax) !== null);
    const tokens = await OBR.scene.items.getItems((i) => i.layer === "CHARACTER");
    const want = new Map();
    for (const t of tokens) {
      const c = chars.find((c) => norm(c.name) === norm(tokenName(t))) || chars.find((c) => sameName(tokenName(t), c.name));
      if (!c) continue;
      const max = numOf(c.hpmax), hp = numOf(c.hp) ?? max;
      want.set(t.id, { text: hp + "/" + max, color: hp <= 0 ? "#ff5a5a" : hp * 2 <= max ? "#ffc94d" : "#8ff09a" });
    }
    const labels = await OBR.scene.local.getItems((i) => i.metadata[HPL] !== undefined);
    const have = new Map(labels.map((l) => [l.metadata[HPL], l]));
    const gone = labels.filter((l) => !want.has(l.metadata[HPL])).map((l) => l.id);
    if (gone.length) await OBR.scene.local.deleteItems(gone);
    const stale = labels.filter((l) => { const w = want.get(l.metadata[HPL]); return w && (l.text.plainText !== w.text || l.text.style.fillColor !== w.color); });
    if (stale.length) await OBR.scene.local.updateItems(stale, (ds) => { for (const d of ds) { const w = want.get(d.metadata[HPL]); d.text.plainText = w.text; d.text.style.fillColor = w.color; } });
    const add = [];
    for (const [id, w] of want) {
      if (have.has(id)) continue;
      const b = await OBR.scene.items.getItemBounds([id]); const fs = Math.max(8, Math.round(b.height * 0.18));
      add.push(buildText().textType("PLAIN").plainText(w.text).width(Math.round(fs * 5)).height(Math.round(fs * 1.5))
        .position({ x: b.center.x - b.width * 0.12 - fs * 5, y: b.max.y - fs * 0.35 }).textAlign("RIGHT").textAlignVertical("TOP")
        .fontSize(fs).fontWeight(800).fillColor(w.color).strokeColor("#0b0d12").strokeWidth(Math.max(2, Math.round(fs * 0.16)))
        .attachedTo(id).layer("ATTACHMENT").locked(true).disableHit(true).visible(true).metadata({ [HPL]: id }).build());
    }
    if (add.length) await OBR.scene.local.addItems(add);
  } catch (e) { console.warn("Party Sheets:", e); }
  busy = false; if (again) { again = false; syncHP(); }
}
let fbOn = false;
async function connectSheets() {
  if (fbOn) return;
  let party = null; try { party = JSON.parse(localStorage.getItem("ps-party") || "null"); } catch (e) {}
  const cfg = window.TRACKER_CONFIG; if (!party || !cfg) return;
  fbOn = true;
  try {
    const B = "https://www.gstatic.com/firebasejs/10.12.2/";
    const [{ initializeApp }, F] = await Promise.all([import(B + "firebase-app.js"), import(B + "firebase-firestore.js")]);
    const db = F.getFirestore(initializeApp(cfg.firebase, "party-sheets-bg"));
    F.onSnapshot(F.collection(db, "parties", party, "characters"), (snap) => { sheetChars = snap.docs.map((d) => ({ id: d.id, ...d.data() })); syncHP(); }, () => { fbOn = false; });
  } catch (e) { fbOn = false; }
}
addEventListener("storage", (e) => { if (e.key === "ps-party") connectSheets(); });

OBR.onReady(async () => {
  if ((await OBR.player.getRole()) !== "GM") return;
  connectSheets();
  let unsub = null;
  const start = () => { if (unsub) unsub(); unsub = OBR.scene.items.onChange(() => syncHP()); syncHP(); };
  if (await OBR.scene.isReady()) start();
  OBR.scene.onReadyChange((r) => { if (r) start(); else if (unsub) { unsub(); unsub = null; } });
  OBR.tool.create({
    id: ID + "/button",
    icons: [{ icon: "/party-sheets/icon.svg", label: "Party Sheets", filter: { roles: ["GM"] } }],
    onClick: () => { toggle(); return false; },
  });
});
