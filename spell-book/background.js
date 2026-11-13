import OBR from "./obr-sdk.js?v=2";

// A book button in the toolbar, for the GM only. Clicking it opens the spell dictionary in a tall panel
// on the right-hand side of the screen; clicking it again, ✕ or Esc in the panel, or a click anywhere outside it closes it.
const ID = "spell-book", PANEL = ID + "/panel";
// The panel says "closed" as it goes away (✕, Esc or a click outside). Clicking the book itself counts as a click
// outside, so if the panel closed a moment ago that click was meant to close it: don't open it again.
let closedAt = 0, open = false;
new BroadcastChannel(ID).onmessage = (m) => { if (m.data === "closed") { closedAt = Date.now(); open = false; } };

async function toggle() {
  if (Date.now() - closedAt < 600) return;
  if (open) { open = false; await OBR.popover.close(PANEL); return; }   // in case Owlbear doesn't count the toolbar as "outside"
  let vw = 1400, vh = 900;
  try { vw = await OBR.viewport.getWidth(); vh = await OBR.viewport.getHeight(); } catch (e) {}
  const width = Math.round(Math.min(900, Math.max(560, vw * 0.5))), height = Math.max(420, vh - 110);
  await OBR.popover.open({
    id: PANEL, url: "/spell-book/spells.html?obr=1&v=3", width, height,
    anchorReference: "POSITION", anchorPosition: { left: vw - 76, top: 66 },
    anchorOrigin: { horizontal: "RIGHT", vertical: "TOP" }, transformOrigin: { horizontal: "RIGHT", vertical: "TOP" },
  });
  open = true;
}

OBR.onReady(async () => {
  if ((await OBR.player.getRole()) !== "GM") return;
  OBR.tool.create({
    id: ID + "/button",
    icons: [{ icon: "/spell-book/icon.svg", label: "Spell Book", filter: { roles: ["GM"] } }],
    onClick: () => { toggle(); return false; },
  });
});
