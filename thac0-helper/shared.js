// Shared bits for the THAC0 Helper extension.
export const ID = "thac0-helper";               // our own keys in Owlbear's storage
export const KEY = ID + "/settings";             // room setting: { on, thac0: {name: 18}, weapons: {name: [{n:"Long sword +1", b:1, s:true}]}, active: {name: index}, bless: {name: round cast, or true}, round: 0, turn: "" | "party" | "monsters" }
export const DICE = "rodeo.owlbear.dice/";       // where Owlbear's own Dice extension shares each player's roll

export function readSettings(meta) {
  const s = (meta && meta[KEY]) || {};
  const obj = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
  return { on: !!s.on, thac0: obj(s.thac0), weapons: obj(s.weapons), active: obj(s.active), bless: obj(s.bless),
           round: Number.isInteger(s.round) && s.round > 0 ? s.round : 0, turn: s.turn === "party" || s.turn === "monsters" ? s.turn : "",
           prev: s.prev && typeof s.prev === "object" ? s.prev : null };
}

// The d20 result of a finished, visible roll made only of d20s (one d20, or two at advantage/disadvantage).
// Anything else (other dice mixed in, hidden rolls, rolls still tumbling) gives null.
export function d20Result(roll, values) {
  if (!roll || !values || roll.hidden) return null;
  const dies = []; let bonus = typeof roll.bonus === "number" ? roll.bonus : 0; let comb = roll.combination;
  const walk = (d) => {
    for (const x of d.dice || []) {
      if (x && typeof x.id === "string") dies.push(x);
      else if (x && Array.isArray(x.dice)) { if (typeof x.bonus === "number") bonus += x.bonus; if (x.combination && !comb) comb = x.combination; walk(x); }
    }
  };
  walk(roll);
  if (!dies.length || dies.some((d) => d.type !== "D20")) return null;
  const faces = dies.map((d) => values[d.id]);
  if (faces.some((v) => typeof v !== "number")) return null;
  let used;
  if (faces.length === 1) used = faces[0];
  else if (comb === "HIGHEST") used = Math.max(...faces);
  else if (comb === "LOWEST") used = Math.min(...faces);
  else return null; // several d20s added together is not an attack roll
  return { faces, used, bonus, total: used + bonus, comb: faces.length > 1 ? comb : null };
}

// One key per physical roll, so the same roll is never announced twice.
export function rollKey(playerId, roll) {
  const ids = []; const walk = (d) => (d.dice || []).forEach((x) => (x && typeof x.id === "string" ? ids.push(x.id) : x && walk(x)));
  walk(roll); return playerId + ":" + ids.join(",");
}

// AD&D 2nd Edition: the Armor Class hit is THAC0 minus the attack roll (die plus bonuses).
// The weapon the DM has picked for this player, if any.
export function activeWeapon(settings, name) {
  const list = settings.weapons[name] || [], i = settings.active[name];
  return Number.isInteger(i) && list[i] ? list[i] : null;
}
// Bless (PHB): +1 to attack rolls while it lasts. The DM switches it on and off for each player.
export function describe(name, r, thac0, weapon, blessed) {
  // Weapon specialization (PHB): +1 to hit with that one weapon, ticked by the DM when adding it.
  const wb = weapon ? +weapon.b || 0 : 0, spec = weapon && weapon.s ? 1 : 0, bless = blessed ? 1 : 0, total = r.total + wb + spec + bless;
  return { name, bless, spec, die: r.used, faces: r.faces, comb: r.comb, bonus: r.bonus, weapon: weapon ? weapon.n : "", wb, total, thac0, ac: thac0 - total,
           nat: r.used === 20 ? 20 : r.used === 1 ? 1 : 0, t: Date.now() };
}

const minus = (n) => (n < 0 ? "−" + Math.abs(n) : String(n));
export function acText(e) {
  if (e.nat === 1) return "misses";
  if (e.ac > 10) return "misses";
  return "hits AC " + minus(e.ac);
}
export function rollText(e) {
  const b = e.bonus ? (e.bonus > 0 ? " + " + e.bonus : " − " + Math.abs(e.bonus)) : "";
  const adv = e.comb === "HIGHEST" ? " (best of " + e.faces.join(", ") + ")" : e.comb === "LOWEST" ? " (worst of " + e.faces.join(", ") + ")" : "";
  const w = e.weapon ? (e.wb ? (e.wb > 0 ? " + " + e.wb : " − " + Math.abs(e.wb)) : "") + " (" + e.weapon + ")" : "";
  return e.die + adv + b + w + (e.spec ? " + 1 (specialized)" : "") + (e.bless ? " + 1 (blessed)" : "");
}
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const LOG_KEY = (roomId) => ID + "/log/" + roomId;

// Bless lasts 6 rounds (PHB). Cast during a round, it runs out when the 7th round starts.
export const BLESS_ROUNDS = 6;
export const blessLeft = (settings, name) => { const c = settings.bless[name]; return Number.isInteger(c) && settings.round ? c + BLESS_ROUNDS - settings.round : null; };
export const turnText = (s) => "Round " + s.round + " · " + (s.turn === "party" ? "Party acts" : s.turn === "monsters" ? "Monsters act" : "Roll initiative");

// Round changes, used by both the DM's panel and the DM's clicks on the pill.
// "Next round" keeps a copy of how things were, so one slip can be taken back exactly (Bless included).
export function nextRound(s) {
  s.prev = { round: s.round, turn: s.turn, bless: Object.assign({}, s.bless) };
  s.round += 1; s.turn = "";
  for (const n in s.bless) { const c = s.bless[n]; if (Number.isInteger(c) && s.round >= c + BLESS_ROUNDS) delete s.bless[n]; }
}
export function prevRound(s) {
  if (s.round <= 1) return;
  if (s.prev && s.prev.round === s.round - 1) { s.round = s.prev.round; s.turn = s.prev.turn || ""; s.bless = Object.assign({}, s.prev.bless || {}); }
  else { s.round -= 1; s.turn = ""; }
  s.prev = null;
}
export const flipTurn = (s) => { s.turn = s.turn === "party" ? "monsters" : "party"; };
