// Runs quietly for everyone in the room. Watches Owlbear's Dice for finished d20 rolls and,
// when the DM has switched the helper on, shows the Armor Class hit in a banner at the top of the screen.
import OBR from "./obr-sdk.js";
import { KEY, DICE, ID, readSettings, d20Result, rollKey, describe, activeWeapon, LOG_KEY } from "./shared.js";

const BANNER = ID + "/banner";
const seen = new Set();
let settings = { on: false, thac0: {}, weapons: {}, active: {} }, lines = [], hideTimer = null, ready = false, role = "PLAYER";
const channel = new BroadcastChannel(ID + "/log");

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
  const width = 520, height = 18 + lines.length * 38;
  let left = 600;
  try { left = Math.round((await OBR.viewport.getWidth()) / 2); } catch (e) {}
  await OBR.popover.open({
    id: BANNER, url: "/thac0-helper/banner.html#" + encodeURIComponent(JSON.stringify(lines)), width, height,
    anchorReference: "POSITION", anchorPosition: { left, top: 64 },
    anchorOrigin: { horizontal: "CENTER", vertical: "TOP" }, transformOrigin: { horizontal: "CENTER", vertical: "TOP" },
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
  const t = settings.thac0[player.name];
  if (t === undefined || t === null || t === "" || isNaN(+t)) return;   // only characters the DM has given a THAC0
  const entry = describe(player.name, r, +t, activeWeapon(settings, player.name)); entry.k = key;
  lines.push(entry); remember(entry); showBanner();
}

function badge() {
  if (role !== "GM") return;
  OBR.action.setBadgeText(settings.on ? "ON" : undefined);
  if (settings.on) OBR.action.setBadgeBackgroundColor("#2e7d32");
}

OBR.onReady(async () => {
  role = await OBR.player.getRole();
  settings = readSettings(await OBR.room.getMetadata()); badge();
  OBR.room.onMetadataChange((meta) => { settings = readSettings(meta); badge(); });
  // note the rolls already on the table, so they are not announced as new
  const self = { id: await OBR.player.getId(), name: await OBR.player.getName(), metadata: await OBR.player.getMetadata() };
  consider(self); (await OBR.party.getPlayers()).forEach(consider);
  ready = true;
  OBR.player.onChange((p) => consider(p));
  OBR.party.onChange((ps) => ps.forEach(consider));
  OBR.player.onChange(async (p) => { if (p.role && p.role !== role) { role = p.role; badge(); } });
});
