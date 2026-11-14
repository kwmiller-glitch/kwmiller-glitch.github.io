import OBR from "./obr-sdk.js?v=1";

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
    id: PANEL, url: `/party-sheets/panel.html?v=5&mh=${height}`, width, height,
    anchorReference: "POSITION", anchorPosition: { left: vw - 76, top: 66 },
    anchorOrigin: { horizontal: "RIGHT", vertical: "TOP" }, transformOrigin: { horizontal: "RIGHT", vertical: "TOP" },
  });
  open = true;
}

OBR.onReady(async () => {
  if ((await OBR.player.getRole()) !== "GM") return;
  OBR.tool.create({
    id: ID + "/button",
    icons: [{ icon: "/party-sheets/icon.svg", label: "Party Sheets", filter: { roles: ["GM"] } }],
    onClick: () => { toggle(); return false; },
  });
});
