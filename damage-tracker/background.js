import OBR, { buildLabel } from "./obr-sdk.js?v=6";
import { ID, DMG, PC, LABEL } from "./shared.js?v=6";

// ▼ ▲ and Clear on the token menu, for the GM only, on tokens (the CHARACTER layer) not marked as PCs.
const notPC = { key: ["metadata", PC], value: true, operator: "!=" };
const onToken = { key: "layer", value: "CHARACTER" };
const damaged = { key: ["metadata", DMG], value: undefined, operator: "!=" };

function change(items, fn) {
  return OBR.scene.items.updateItems(items, (drafts) => {
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
    onToolClick: async (context, event) => {
      const t = await tokenOf(event.target);
      if (t) await change([t], (n) => (event.shiftKey ? n - 1 : n + 1));
      return false;                       // don't select or move the token
    },
  });
  OBR.tool.createAction({
    id: ID + "/clearall",
    icons: [{ icon: "/damage-tracker/clear.svg", label: "Clear all damage", filter: { activeTools: [TOOL] } }],
    onClick: async () => {
      const hurt = await OBR.scene.items.getItems((i) => i.layer === "CHARACTER" && +i.metadata[DMG] > 0);
      if (hurt.length) await change(hurt, () => 0);
    },
  });
}

// The "−7" labels under damaged tokens are local items: they exist on the GM's screen only.
let busy = false, again = false;
async function sync() {
  if (busy) { again = true; return; } busy = true;
  try {
    const tokens = (await OBR.scene.items.getItems((i) => i.layer === "CHARACTER" && +i.metadata[DMG] > 0));
    const labels = await OBR.scene.local.getItems((i) => i.metadata[LABEL] !== undefined);
    const want = new Map(tokens.map((t) => [t.id, "−" + (+t.metadata[DMG])]));
    const have = new Map(labels.map((l) => [l.metadata[LABEL], l]));
    const gone = labels.filter((l) => !want.has(l.metadata[LABEL])).map((l) => l.id);
    if (gone.length) await OBR.scene.local.deleteItems(gone);
    const stale = labels.filter((l) => want.has(l.metadata[LABEL]) && l.text.plainText !== want.get(l.metadata[LABEL]));
    if (stale.length) await OBR.scene.local.updateItems(stale, (ds) => { for (const d of ds) d.text.plainText = want.get(d.metadata[LABEL]); });
    const add = [];
    for (const t of tokens) {
      if (have.has(t.id)) continue;
      const b = await OBR.scene.items.getItemBounds([t.id]);
      // A small badge just above the token's top-right corner, so it covers neither the token nor its name label.
      add.push(buildLabel().plainText(want.get(t.id)).position({ x: b.max.x - b.width * 0.08, y: b.min.y + b.height * 0.06 }).pointerDirection("DOWN")
        .attachedTo(t.id).layer("ATTACHMENT").locked(true).disableHit(true).visible(true)
        .backgroundColor("#b71c1c").backgroundOpacity(0.92).cornerRadius(6).pointerHeight(0).padding(3)
        .fillColor("#ffffff").fontWeight(700).fontSize(Math.max(12, Math.round(b.height * 0.13)))
        .metadata({ [LABEL]: t.id }).build());
    }
    if (add.length) await OBR.scene.local.addItems(add);
  } catch (e) { console.warn("Damage Tracker:", e); }
  busy = false;
  if (again) { again = false; sync(); }
}

OBR.onReady(async () => {
  addMenu();
  if ((await OBR.player.getRole()) !== "GM") return;      // players: nothing else to do
  addTool();
  let unsub = null;
  const start = () => { if (unsub) unsub(); unsub = OBR.scene.items.onChange(() => sync()); sync(); };
  if (await OBR.scene.isReady()) start();
  OBR.scene.onReadyChange((ready) => { if (ready) start(); else if (unsub) { unsub(); unsub = null; } });
});
