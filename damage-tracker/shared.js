// Damage Tracker: shared names.
export const ID = "damage-tracker";
export const DMG = ID + "/dmg";     // damage taken, stored on the token (a number; absent when none)
export const PC = ID + "/pc";
export const MAX = ID + "/max";    // a monster's hit points, set by rolling its hit dice in the dice tray       // true on tokens the GM marked as PCs: no arrows on those
export const LABEL = ID + "/label"; // on the GM-only labels: which token the label belongs to
export const V = "1";
export const FX = ID + "/fx";      // effects on a token: [{ n: "Held", left: rounds remaining, or null = until removed }]
export const FXL = ID + "/fxlabel";
