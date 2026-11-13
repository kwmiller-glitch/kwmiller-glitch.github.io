import OBR, { buildLabel } from "./obr-sdk.js?v=3";
import { ID, DMG, PC, LABEL } from "./shared.js?v=3";

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
    shortcut: "-",               // select a monster, press the minus key: 1 damage
  });
  OBR.contextMenu.create({
    id: ID + "/up",
    icons: [{ icon: "/damage-tracker/up.svg", label: "Take back 1 damage", filter: { roles: ["GM"], every: [onToken, notPC, damaged] } }],
    onClick: (ctx) => change(ctx.items, (n) => n - 1),
    shortcut: "=",               // the plus/equals key takes 1 back
  });
  OBR.contextMenu.create({
    id: ID + "/clear",
    icons: [{ icon: "/damage-tracker/clear.svg", label: "Clear damage", filter: { roles: ["GM"], every: [onToken, damaged] } }],
    onClick: (ctx) => change(ctx.items, () => 0),
  });
}

// The toolbar button (GM only) opens the small panel: mark PCs, clear all damage.
function addButton() {
  OBR.tool.create({
    id: ID + "/button",
    icons: [{ icon: "/damage-tracker/icon.svg", label: "Damage Tracker", filter: { roles: ["GM"] } }],
    onClick: async (context, elementId) => {
      await OBR.popover.open({ id: ID + "/panel", url: "/damage-tracker/panel.html?v=3", width: 260, height: 130, anchorElementId: elementId,
        anchorOrigin: { horizontal: "LEFT", vertical: "TOP" }, transformOrigin: { horizontal: "RIGHT", vertical: "TOP" } });
      return false;
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
      add.push(buildLabel().plainText(want.get(t.id)).position({ x: b.center.x, y: b.max.y - b.height * 0.12 })
        .attachedTo(t.id).layer("ATTACHMENT").locked(true).disableHit(true).visible(true)
        .backgroundColor("#b71c1c").backgroundOpacity(0.92).cornerRadius(10).pointerHeight(0).padding(6)
        .fillColor("#ffffff").fontWeight(700).fontSize(Math.max(18, Math.round(b.height * 0.2)))
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
  addButton();
  let unsub = null;
  const start = () => { if (unsub) unsub(); unsub = OBR.scene.items.onChange(() => sync()); sync(); };
  if (await OBR.scene.isReady()) start();
  OBR.scene.onReadyChange((ready) => { if (ready) start(); else if (unsub) { unsub(); unsub = null; } });
});
