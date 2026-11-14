// Runs quietly for everyone in the room. Watches Owlbear's Dice for finished d20 rolls and,
// when the DM has switched the helper on, shows the Armor Class hit in a banner at the top of the screen.
import OBR from "./obr-sdk.js";
import { KEY, DICE, ID, readSettings, d20Result, rollKey, describe, activeWeapon, LOG_KEY, canUndo, canon, linkPlayers } from "./shared.js?v=16";

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
    id: BANNER, url: "/thac0-helper/banner.html?v=16#" + encodeURIComponent(JSON.stringify(lines)), width, height,
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
  if (!ready || !settings.on) return;                       // rolls made before we started, or with the helper off, are ignored
  const who = canon(settings, player);                     // the saved name, even if they've renamed themselves since
  const t = settings.thac0[who];
  if (t === undefined || t === null || t === "" || isNaN(+t)) return;   // only characters the DM has given a THAC0
  const entry = describe(who, r, +t, activeWeapon(settings, who), !!settings.bless[who]); entry.k = key;
  remember(entry);
  if (onPhone && player.id !== myId) return;               // on a phone, only your own rolls pop up, to save space
  lines.push(entry); showBanner();
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
    id: TURN, url: "/thac0-helper/turn.html?v=16#" + encodeURIComponent(want), width: 340, height: 38,
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
      await OBR.popover.open({ id: PANEL, url: "/thac0-helper/panel.html?v=16", width: 340, height: 480, anchorElementId: elementId,
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
  if (linkPlayers(settings, partyNow)) { try { await OBR.room.setMetadata({ [KEY]: settings }); } catch (e) {} }
}

OBR.onReady(async () => {
  role = await OBR.player.getRole(); myId = await OBR.player.getId();
  try { onPhone = isPhone(await OBR.viewport.getWidth()); } catch (e) { onPhone = isPhone(1200); }
  try { addButton().catch(() => {}); } catch (e) {}
  settings = readSettings(await OBR.room.getMetadata()); badge();
  // Drop the pill below the options bar while a tool that has one is picked; put it back for the move tool.
  const toolChanged = (id) => { const low = !NO_BAR.includes(id); if (low !== lowered) { lowered = low; showTurn(); } };
  try { lowered = !NO_BAR.includes(await OBR.tool.getActiveTool()); OBR.tool.onToolChange(toolChanged); } catch (e) {}
  showTurn();
  OBR.room.onMetadataChange((meta) => { settings = readSettings(meta); badge(); showTurn(); link(); });
  // note the rolls already on the table, so they are not announced as new
  const self = { id: await OBR.player.getId(), name: await OBR.player.getName(), metadata: await OBR.player.getMetadata() };
  partyNow = await OBR.party.getPlayers(); link();
  consider(self); partyNow.forEach(consider);
  ready = true;
  OBR.player.onChange((p) => consider(p));
  OBR.party.onChange((ps) => { partyNow = ps; link(); ps.forEach(consider); });
  OBR.player.onChange(async (p) => { if (p.role && p.role !== role) { role = p.role; badge(); } });
});
