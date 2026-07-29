// IoT PLC Studio - Éditeur Ladder complet sur une seule feuille
// Copiez ce code dans un fichier App.jsx et exécutez avec React + Recharts

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

/* ============================================================
   IoT PLC Studio - Prototype logiciel : éditeur Ladder
   (IEC 61131-3 simplifié), simulation temps réel navigateur,
   génération code Arduino, HMI/SCADA, bibliothèque d'exemples.
   Tout s'exécute en mémoire, aucune connexion matérielle réelle.
   ============================================================ */

/* ---------- Utilitaires ---------- */
let __uid = 1;
const uid = () => `id${(__uid++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clone = (o) => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- Modèle de données Ladder ---------- */
const makeCell = (kind = "EMPTY", address = "") => ({
  id: uid(), kind, address, address2: "", op: ">", value: "0", branches: null,
});
const makeGroupCell = () => ({
  id: uid(), kind: "GROUP", address: "", address2: "", op: ">", value: "0",
  branches: [[makeCell()], [makeCell()]],
});
const makeRow = (cols) => ({ id: uid(), cells: Array.from({ length: cols }, () => makeCell()) });
const makeNetwork = (cols = 3, rows = 1, comment = "") => ({
  id: uid(), comment, cols,
  rows: Array.from({ length: rows }, () => makeRow(cols)),
  output: { kind: "NONE", address: "", preset: 1000, resetAddress: "" },
});
const DEFAULT_IO_MAP = [
  { addr: "I0.0", pin: "D2", kind: "DI" },
  { addr: "I0.1", pin: "D3", kind: "DI" },
  { addr: "I0.2", pin: "D4", kind: "DI" },
  { addr: "Q0.0", pin: "D8", kind: "DO" },
  { addr: "Q0.1", pin: "D9", kind: "DO" },
  { addr: "Q0.2", pin: "D10", kind: "DO" },
  { addr: "AI0", pin: "A0", kind: "AI" },
  { addr: "AI1", pin: "A1", kind: "AI" },
  { addr: "AQ0", pin: "D5", kind: "AQ" },
  { addr: "AQ1", pin: "D6", kind: "AQ" },
];
function createBlankProject() {
  return {
    name: "Nouveau projet", board: "uno",
    networks: [makeNetwork(3, 1, "Réseau 1")],
    ioMap: clone(DEFAULT_IO_MAP),
    hmi: { widgets: [] },
  };
}

const BOARDS = [
  { id: "uno", label: "Arduino Uno" },
  { id: "nano", label: "Arduino Nano" },
  { id: "mega", label: "Arduino Mega" },
  { id: "esp32", label: "ESP32 / ESP32-S3" },
  { id: "bluepill", label: "STM32 Blue Pill" },
  { id: "nucleo", label: "STM32 Nucleo" },
  { id: "rpi", label: "Raspberry Pi" },
];

/* ---------- Moteur d'évaluation ---------- */
function parseAddress(addr) {
  if (addr == null || addr === "") return { group: "LIT", value: 0 };
  if (/^-?\d+(\.\d+)?$/.test(addr)) return { group: "LIT", value: parseFloat(addr) };
  if (/^I\d/.test(addr)) return { group: "I", key: addr };
  if (/^Q\d/.test(addr)) return { group: "Q", key: addr };
  if (/^M\d/.test(addr)) return { group: "M", key: addr };
  if (/^AI\d/.test(addr)) return { group: "AI", key: addr };
  if (/^AQ\d/.test(addr)) return { group: "AQ", key: addr };
  if (/^T\d/.test(addr)) return { group: "T", key: parseInt(addr.slice(1), 10) || 0 };
  if (/^C\d/.test(addr)) return { group: "C", key: parseInt(addr.slice(1), 10) || 0 };
  return { group: "M", key: addr };
}
function getBool(values, addr) {
  const p = parseAddress(addr);
  if (p.group === "LIT") return !!p.value;
  if (p.group === "T") return !!(values.T[p.key] && values.T[p.key].Q);
  if (p.group === "C") return !!(values.C[p.key] && values.C[p.key].Q);
  return !!(values[p.group] && values[p.group][p.key]);
}
function getNum(values, addr) {
  const p = parseAddress(addr);
  if (p.group === "LIT") return p.value;
  if (p.group === "T") return (values.T[p.key] && values.T[p.key].ET) || 0;
  if (p.group === "C") return (values.C[p.key] && values.C[p.key].CV) || 0;
  if (p.group === "AI" || p.group === "AQ") return (values[p.group] && values[p.group][p.key]) || 0;
  return getBool(values, addr) ? 1 : 0;
}
function setBoolAddr(values, addr, val) {
  const p = parseAddress(addr);
  if (p.group === "I" || p.group === "Q" || p.group === "M") values[p.group][p.key] = !!val;
}
function setNumAddr(values, addr, val) {
  const p = parseAddress(addr);
  if (p.group === "AI" || p.group === "AQ") values[p.group][p.key] = val;
}
function evaluateCell(cell, values, prevValues) {
  if (cell.kind === "GROUP") {
    return (cell.branches || []).some((branch) =>
      branch.every((c) => evaluateCell(c, values, prevValues))
    );
  }
  switch (cell.kind) {
    case "NO": return getBool(values, cell.address);
    case "NC": return !getBool(values, cell.address);
    case "P": return getBool(values, cell.address) && !getBool(prevValues, cell.address);
    case "N": return !getBool(values, cell.address) && getBool(prevValues, cell.address);
    case "CMP": {
      const a = getNum(values, cell.address);
      const b = parseFloat(cell.value || "0");
      switch (cell.op) {
        case ">": return a > b; case "<": return a < b;
        case ">=": return a >= b; case "<=": return a <= b;
        case "==": return a === b; case "!=": return a !== b;
        default: return false;
      }
    }
    case "XOR": return getBool(values, cell.address) !== getBool(values, cell.address2);
    default: return true;
  }
}
function initValues() {
  return {
    I: {}, Q: {}, M: {}, AI: {}, AQ: {},
    T: Array.from({ length: 8 }, () => ({ Q: false, ET: 0, _pulsing: false })),
    C: Array.from({ length: 8 }, () => ({ Q: false, CV: 0 })),
  };
}
const SCAN_MS = 150;

function scanOnce(project, values, prevValues, prevNetPower, dt) {
  const newValues = clone(values);
  const visual = {};
  project.networks.forEach((net) => {
    const rowStagePowers = net.rows.map((row) => {
      let p = true; const stages = [true];
      row.cells.forEach((cell) => { p = p && evaluateCell(cell, values, prevValues); stages.push(p); });
      return stages;
    });
    const merged = rowStagePowers.some((s) => s[s.length - 1]);
    visual[net.id] = { rows: rowStagePowers, merged };
    const out = net.output;
    if (!out || out.kind === "NONE" || !out.address) return;
    const prevPower = !!prevNetPower[net.id];
    switch (out.kind) {
      case "COIL": setBoolAddr(newValues, out.address, merged); break;
      case "COIL_INV": setBoolAddr(newValues, out.address, !merged); break;
      case "SET": if (merged) setBoolAddr(newValues, out.address, true); break;
      case "RESET": if (merged) setBoolAddr(newValues, out.address, false); break;
      case "TON": {
        const i = parseAddress(out.address).key;
        const t = newValues.T[i] || { Q: false, ET: 0 };
        if (merged) { t.ET = Math.min((t.ET || 0) + dt, out.preset || 0); t.Q = t.ET >= (out.preset || 0); }
        else { t.ET = 0; t.Q = false; }
        newValues.T[i] = t; break;
      }
      case "TOF": {
        const i = parseAddress(out.address).key;
        const t = newValues.T[i] || { Q: false, ET: 0 };
        if (merged) { t.Q = true; t.ET = 0; }
        else { t.ET = Math.min((t.ET || 0) + dt, out.preset || 0); t.Q = t.ET < (out.preset || 0); }
        newValues.T[i] = t; break;
      }
      case "TP": {
        const i = parseAddress(out.address).key;
        const t = newValues.T[i] || { Q: false, ET: 0, _pulsing: false };
        if (merged && !prevPower) { t._pulsing = true; t.ET = 0; }
        if (t._pulsing) {
          t.ET = (t.ET || 0) + dt;
          if (t.ET >= (out.preset || 0)) { t.Q = false; t._pulsing = false; } else t.Q = true;
        }
        newValues.T[i] = t; break;
      }
      case "CTU": {
        const i = parseAddress(out.address).key;
        const c = newValues.C[i] || { Q: false, CV: 0 };
        if (out.resetAddress && getBool(values, out.resetAddress)) c.CV = 0;
        else if (merged && !prevPower) c.CV = (c.CV || 0) + 1;
        c.Q = c.CV >= (out.preset || 0);
        newValues.C[i] = c; break;
      }
      case "CTD": {
        const i = parseAddress(out.address).key;
        const c = newValues.C[i] || { Q: false, CV: out.preset || 0 };
        if (out.resetAddress && getBool(values, out.resetAddress)) c.CV = out.preset || 0;
        else if (merged && !prevPower) c.CV = Math.max(0, (c.CV != null ? c.CV : out.preset || 0) - 1);
        c.Q = c.CV <= 0;
        newValues.C[i] = c; break;
      }
      default: break;
    }
    prevNetPower[net.id] = merged;
  });
  return { newValues, visual };
}

/* ---------- Collecte des adresses (surveillance + génération de code) ---------- */
function collectFromCell(c, set) {
  if (c.kind === "GROUP") {
    (c.branches || []).forEach((branch) => branch.forEach((sc) => collectFromCell(sc, set)));
    return;
  }
  if (["NO", "NC", "P", "N"].includes(c.kind) && parseAddress(c.address).group !== "LIT" && !/^[TC]/.test(c.address || "")) set.add(c.address);
  if (c.kind === "XOR") { if (c.address) set.add(c.address); if (c.address2) set.add(c.address2); }
}
function collectUsedBoolAddresses(project) {
  const set = new Set();
  project.ioMap.forEach((io) => { if (io.kind === "DI" || io.kind === "DO") set.add(io.addr); });
  project.networks.forEach((net) => {
    net.rows.forEach((row) => row.cells.forEach((c) => collectFromCell(c, set)));
    const o = net.output;
    if (o && ["COIL", "COIL_INV", "SET", "RESET"].includes(o.kind) && o.address) set.add(o.address);
    if (o && o.resetAddress) set.add(o.resetAddress);
  });
  return [...set].filter((a) => /^[IQM]/.test(a)).sort();
}
function collectTimersCounters(project) {
  const timers = new Map(); const counters = new Map();
  project.networks.forEach((net) => {
    const o = net.output;
    if (["TON", "TOF", "TP"].includes(o.kind) && o.address) timers.set(o.address, { addr: o.address, kind: o.kind, preset: o.preset });
    if (["CTU", "CTD"].includes(o.kind) && o.address) counters.set(o.address, { addr: o.address, kind: o.kind, preset: o.preset, resetAddress: o.resetAddress });
  });
  return { timers: [...timers.values()].sort((a, b) => a.addr.localeCompare(b.addr)), counters: [...counters.values()].sort((a, b) => a.addr.localeCompare(b.addr)) };
}

/* ---------- Génération de code Arduino ---------- */
function cIdentBool(addr) {
  const p = parseAddress(addr);
  if (p.group === "T") return `T${p.key}_Q`;
  if (p.group === "C") return `C${p.key}_Q`;
  if (p.group === "LIT") return p.value ? "true" : "false";
  return String(addr).replace(".", "_");
}
function cIdentNum(addr) {
  const p = parseAddress(addr);
  if (p.group === "T") return `T${p.key}_ET`;
  if (p.group === "C") return `C${p.key}_CV`;
  if (p.group === "LIT") return String(p.value);
  return String(addr).replace(".", "_");
}
function cCond(cell) {
  if (cell.kind === "GROUP") {
    return "(" + (cell.branches || []).map((b) => "(" + b.map(cCond).join(" && ") + ")").join(" || ") + ")";
  }
  switch (cell.kind) {
    case "NO": return cIdentBool(cell.address);
    case "NC": return `!${cIdentBool(cell.address)}`;
    case "P": return `(${cIdentBool(cell.address)} && !prev_${cIdentBool(cell.address)})`;
    case "N": return `(!${cIdentBool(cell.address)} && prev_${cIdentBool(cell.address)})`;
    case "CMP": return `(${cIdentNum(cell.address)} ${cell.op} ${parseFloat(cell.value || "0")})`;
    case "XOR": return `(${cIdentBool(cell.address)} != ${cIdentBool(cell.address2)})`;
    default: return "true";
  }
}
function generateArduinoCode(project) {
  const L = [];
  const boardLabel = (BOARDS.find((b) => b.id === project.board) || {}).label || project.board;
  const boolAddrs = collectUsedBoolAddresses(project);
  const { timers, counters } = collectTimersCounters(project);
  const aiEntries = project.ioMap.filter((e) => e.kind === "AI");
  const aqEntries = project.ioMap.filter((e) => e.kind === "AQ");
  L.push(`// ${project.name} — IoT PLC Studio — Cible : ${boardLabel}`);
  L.push("");
  project.ioMap.forEach((io) => {
    const pinLit = /^A\d+$/.test(io.pin) ? io.pin : io.pin.replace(/^D/, "");
    L.push(`const int PIN_${io.addr.replace(".", "_")} = ${pinLit};`);
  });
  L.push(""); boolAddrs.forEach((a) => L.push(`bool ${cIdentBool(a)} = false;`));
  aiEntries.forEach((io) => L.push(`int ${io.addr} = 0;`));
  aqEntries.forEach((io) => L.push(`int ${io.addr} = 0;`));
  L.push(""); if (timers.length === 0) L.push("// aucun temporisateur");
  timers.forEach((t) => {
    L.push(`unsigned long ${t.addr}_ET = 0;`);
    L.push(`bool ${t.addr}_Q = false; ${t.kind === "TP" ? `bool ${t.addr}_pulsing = false;` : ""}`);
  });
  L.push(""); if (counters.length === 0) L.push("// aucun compteur");
  counters.forEach((c) => {
    L.push(`int ${c.addr}_CV = ${c.kind === "CTD" ? c.preset : 0};`);
    L.push(`bool ${c.addr}_Q = false;`);
  });
  L.push("");
  project.networks.forEach((net, idx) => {
    if (["TP", "CTU", "CTD"].includes(net.output.kind)) L.push(`bool prevNet${idx + 1} = false;`);
  });
  L.push("unsigned long lastScan = 0;");
  L.push("");
  L.push("void setup() {");
  L.push("  Serial.begin(115200);");
  project.ioMap.forEach((io) => {
    if (io.kind === "DI") L.push(`  pinMode(PIN_${io.addr.replace(".", "_")}, INPUT);`);
    if (io.kind === "DO" || io.kind === "AQ") L.push(`  pinMode(PIN_${io.addr.replace(".", "_")}, OUTPUT);`);
  });
  L.push("}");
  L.push("");
  L.push("void loop() {");
  L.push("  unsigned long now = millis(); unsigned long dt = now - lastScan; lastScan = now;");
  L.push("");
  boolAddrs.forEach((a) => L.push(`  bool prev_${cIdentBool(a)} = ${cIdentBool(a)};`));
  L.push("");
  project.ioMap.forEach((io) => {
    if (io.kind === "DI") L.push(`  ${io.addr.replace(".", "_")} = digitalRead(PIN_${io.addr.replace(".", "_")});`);
    if (io.kind === "AI") L.push(`  ${io.addr} = analogRead(PIN_${io.addr.replace(".", "_")});`);
  });
  L.push("");
  L.push("  // — Logique Ladder —");
  project.networks.forEach((net, idx) => {
    const n = idx + 1;
    const rowExprs = net.rows.map((row) => `(${row.cells.map(cCond).join(" && ")})`);
    L.push(`  bool net${n} = ${rowExprs.join(" || ")};`);
    const o = net.output;
    if (o.address) {
      switch (o.kind) {
        case "COIL": L.push(`  ${cIdentBool(o.address)} = net${n};`); break;
        case "COIL_INV": L.push(`  ${cIdentBool(o.address)} = !net${n};`); break;
        case "SET": L.push(`  if (net${n}) ${cIdentBool(o.address)} = true;`); break;
        case "RESET": L.push(`  if (net${n}) ${cIdentBool(o.address)} = false;`); break;
        case "TON":
          L.push(`  if (net${n}) { ${o.address}_ET = min(${o.address}_ET + dt, (unsigned long)${o.preset}); ${o.address}_Q = ${o.address}_ET >= ${o.preset}; } else { ${o.address}_ET = 0; ${o.address}_Q = false; }`);
          break;
        case "TOF":
          L.push(`  if (net${n}) { ${o.address}_Q = true; ${o.address}_ET = 0; } else { ${o.address}_ET = min(${o.address}_ET + dt, (unsigned long)${o.preset}); ${o.address}_Q = ${o.address}_ET < ${o.preset}; }`);
          break;
        case "TP":
          L.push(`  if (net${n} && !prevNet${n}) { ${o.address}_pulsing = true; ${o.address}_ET = 0; }`);
          L.push(`  if (${o.address}_pulsing) { ${o.address}_ET += dt; if (${o.address}_ET >= ${o.preset}) { ${o.address}_Q = false; ${o.address}_pulsing = false; } else ${o.address}_Q = true; }`);
          break;
        case "CTU":
          if (o.resetAddress) L.push(`  if (${cIdentBool(o.resetAddress)}) ${o.address}_CV = 0;`);
          L.push(`  ${o.resetAddress ? "else " : ""}if (net${n} && !prevNet${n}) ${o.address}_CV++;`);
          L.push(`  ${o.address}_Q = ${o.address}_CV >= ${o.preset};`);
          break;
        case "CTD":
          if (o.resetAddress) L.push(`  if (${cIdentBool(o.resetAddress)}) ${o.address}_CV = ${o.preset};`);
          L.push(`  ${o.resetAddress ? "else " : ""}if (net${n} && !prevNet${n}) ${o.address}_CV = max(0, ${o.address}_CV - 1);`);
          L.push(`  ${o.address}_Q = ${o.address}_CV <= 0;`);
          break;
        default: break;
      }
      if (["TP", "CTU", "CTD"].includes(o.kind)) L.push(`  prevNet${n} = net${n};`);
    }
  });
  L.push("");
  L.push("  // — Écriture des sorties —");
  project.ioMap.forEach((io) => {
    if (io.kind === "DO") L.push(`  digitalWrite(PIN_${io.addr.replace(".", "_")}, ${io.addr.replace(".", "_")});`);
    if (io.kind === "AQ") L.push(`  analogWrite(PIN_${io.addr.replace(".", "_")}, constrain(${io.addr}, 0, 255));`);
  });
  L.push("}");
  return L.join("\n");
}

/* ---------- Bibliothèque d'exemples ---------- */
function net(cols, rowsCells, output, comment) {
  return {
    id: uid(), cols, comment,
    rows: rowsCells.map((cells) => ({
      id: uid(),
      cells: Array.from({ length: cols }, (_, i) => cells[i] ? { id: uid(), address2: "", op: ">", value: "0", ...cells[i] } : makeCell()),
    })),
    output: { kind: "NONE", address: "", preset: 1000, resetAddress: "", ...output },
  };
}
const EXAMPLES = [
  {
    id: "motor", title: "Marche/Arrêt moteur", desc: "Auto-maintien classique.",
    ioMap: [{ addr: "I0.0", pin: "D2", kind: "DI" }, { addr: "I0.1", pin: "D3", kind: "DI" }, { addr: "Q0.0", pin: "D8", kind: "DO" }],
    networks: [
      net(2, [[{ kind: "NO", address: "I0.0" }, { kind: "NC", address: "I0.1" }], [{ kind: "NO", address: "M0" }, { kind: "NC", address: "I0.1" }]], { kind: "COIL", address: "M0" }, "Auto-maintien"),
      net(1, [[{ kind: "NO", address: "M0" }]], { kind: "COIL", address: "Q0.0" }, "Commande moteur"),
    ],
  },
  {
    id: "star-delta", title: "Démarrage étoile-triangle", desc: "Séquence temporisée.",
    ioMap: [{ addr: "I0.0", pin: "D2", kind: "DI" }, { addr: "I0.1", pin: "D3", kind: "DI" }, { addr: "Q0.0", pin: "D8", kind: "DO" }, { addr: "Q0.1", pin: "D9", kind: "DO" }, { addr: "Q0.2", pin: "D10", kind: "DO" }],
    networks: [
      net(2, [[{ kind: "NO", address: "I0.0" }, { kind: "NC", address: "I0.1" }], [{ kind: "NO", address: "M0" }, { kind: "NC", address: "I0.1" }]], { kind: "COIL", address: "M0" }, "Marche"),
      net(1, [[{ kind: "NO", address: "M0" }]], { kind: "TON", address: "T0", preset: 3000 }, "Tempo 3s"),
      net(1, [[{ kind: "NO", address: "M0" }]], { kind: "COIL", address: "Q0.0" }, "Ligne"),
      net(2, [[{ kind: "NO", address: "M0" }, { kind: "NC", address: "T0" }]], { kind: "COIL", address: "Q0.1" }, "Étoile"),
      net(2, [[{ kind: "NO", address: "M0" }, { kind: "NO", address: "T0" }]], { kind: "COIL", address: "Q0.2" }, "Triangle"),
    ],
  },
  {
    id: "traffic", title: "Feux tricolores", desc: "Séquence rouge/jaune/vert.",
    ioMap: [{ addr: "I0.0", pin: "D2", kind: "DI" }, { addr: "Q0.0", pin: "D8", kind: "DO" }, { addr: "Q0.1", pin: "D9", kind: "DO" }, { addr: "Q0.2", pin: "D10", kind: "DO" }],
    networks: [
      net(1, [[{ kind: "NO", address: "I0.0" }]], { kind: "SET", address: "M0" }, "Départ"),
      net(1, [[{ kind: "NO", address: "M0" }]], { kind: "TON", address: "T0", preset: 4000 }, "Rouge 4s"),
      net(2, [[{ kind: "NO", address: "M0" }, { kind: "NC", address: "T0" }]], { kind: "COIL", address: "Q0.0" }, "Rouge"),
      net(1, [[{ kind: "NO", address: "T0" }]], { kind: "TON", address: "T1", preset: 1500 }, "Jaune 1.5s"),
      net(2, [[{ kind: "NO", address: "T0" }, { kind: "NC", address: "T1" }]], { kind: "COIL", address: "Q0.1" }, "Jaune"),
      net(1, [[{ kind: "NO", address: "T1" }]], { kind: "TON", address: "T2", preset: 4000 }, "Vert 4s"),
      net(2, [[{ kind: "NO", address: "T1" }, { kind: "NC", address: "T2" }]], { kind: "COIL", address: "Q0.2" }, "Vert"),
      net(1, [[{ kind: "NO", address: "T2" }]], { kind: "RESET", address: "M0" }, "Fin cycle"),
    ],
  },
  {
    id: "pump", title: "Pompe avec flotteurs", desc: "Remplissage automatique.",
    ioMap: [{ addr: "I0.0", pin: "D2", kind: "DI" }, { addr: "I0.1", pin: "D3", kind: "DI" }, { addr: "Q0.0", pin: "D8", kind: "DO" }],
    networks: [
      net(2, [[{ kind: "NO", address: "I0.0" }, { kind: "NC", address: "I0.1" }], [{ kind: "NO", address: "M0" }, { kind: "NC", address: "I0.1" }]], { kind: "COIL", address: "M0" }, "Flotteurs"),
      net(1, [[{ kind: "NO", address: "M0" }]], { kind: "COIL", address: "Q0.0" }, "Pompe"),
    ],
  },
];
function buildExampleProject(ex) {
  return {
    name: ex.title, board: "uno",
    networks: clone(ex.networks), ioMap: clone(ex.ioMap),
    hmi: { widgets: [] },
  };
}

/* ============================================================
   Composants UI
   ============================================================ */

// --- Bouton style panneau de commande industriel ---
function Btn({ children, onClick, active, disabled, title, variant, className = "" }) {
  return (
    <button
      className={`plcs-btn ${active ? "active" : ""} ${variant || ""} ${className}`}
      onClick={onClick} disabled={disabled} title={title} type="button"
    >{children}</button>
  );
}
function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, color: "var(--bp-text-dim)" }}>
      {label}{children}
    </label>
  );
}
function Switch({ on, onClick }) {
  return <div className={`plcs-switch ${on ? "on" : ""}`} onClick={onClick} role="switch" aria-checked={on} />;
}

// --- Glyphes SVG Ladder ---
const SUBCELL_W = 64, GROUP_MARGIN = 22, CELL_W = 92, CELL_H = 64, RAIL_PAD = 26, OUT_W = 100, PAD_V = 26;
function maxBranchLen(cell) { return Math.max(1, ...(cell.branches || [[]]).map((b) => b.length)); }
function groupWidth(cell) { return maxBranchLen(cell) * SUBCELL_W + GROUP_MARGIN * 2; }
function cellWidth(cell) { if (cell && cell.kind === "GROUP") return Math.max(150, groupWidth(cell)); return CELL_W; }

function SimpleContactMarks({ cell, stroke, scale = 1 }) {
  const bx = 12 * scale, by = 13 * scale;
  return (
    <>
      <line x1={-bx} y1={-by} x2={-bx} y2={by} stroke={stroke} strokeWidth={3 * scale} />
      <line x1={bx} y1={-by} x2={bx} y2={by} stroke={stroke} strokeWidth={3 * scale} />
      {cell.kind === "NC" && <line x1={-bx - 3} y1={by + 1} x2={bx + 3} y2={-by - 1} stroke={stroke} strokeWidth={2 * scale} />}
      {cell.kind === "P" && <text y={5 * scale} textAnchor="middle" className="ladder-glyph-tag" style={{ fontSize: 12 * scale }}>P</text>}
      {cell.kind === "N" && <text y={5 * scale} textAnchor="middle" className="ladder-glyph-tag" style={{ fontSize: 12 * scale }}>N</text>}
    </>
  );
}

function GroupGlyph({ cell, width, values }) {
  const branches = cell.branches || [];
  const B = branches.length;
  const span = B > 1 ? Math.min(46, (B - 1) * 20) : 0;
  const leftX = -width / 2 + GROUP_MARGIN - 6;
  const rightX = width / 2 - GROUP_MARGIN + 6;
  const branchY = (i) => (B > 1 ? -span / 2 + (i * span) / (B - 1) : 0);
  return (
    <g>
      {B > 1 && <line x1={leftX} y1={branchY(0)} x2={leftX} y2={branchY(B - 1)} stroke="var(--bp-line-strong)" strokeWidth={2} />}
      {B > 1 && <line x1={rightX} y1={branchY(0)} x2={rightX} y2={branchY(B - 1)} stroke="var(--bp-line-strong)" strokeWidth={2} />}
      {branches.map((branch, bi) => {
        const y = branchY(bi);
        const on = values ? branch.every((c) => evaluateCell(c, values, values)) : false;
        const lineStroke = on ? "var(--bp-energized)" : "var(--bp-line)";
        const segW = (rightX - leftX) / Math.max(1, branch.length);
        return (
          <g key={bi} transform={`translate(0, ${y})`}>
            <line x1={leftX} y1={0} x2={rightX} y2={0} stroke={lineStroke} strokeWidth={on ? 2 : 1.3} />
            {branch.map((sc, si) => {
              if (sc.kind === "EMPTY") return null;
              const cx = leftX + segW * si + segW / 2;
              const stroke = on ? "var(--bp-energized)" : "var(--bp-line-strong)";
              return (
                <g key={sc.id} transform={`translate(${cx},0)`}>
                  {["NO", "NC", "P", "N"].includes(sc.kind) && <SimpleContactMarks cell={sc} stroke={stroke} scale={0.62} />}
                  <text y={B > 2 ? -10 : -12} textAnchor="middle" className="ladder-glyph-tiny" style={{ fontSize: 8.5 }}>{sc.address}</text>
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

function ContactGlyph({ cell, energized, width, values }) {
  if (!cell || cell.kind === "EMPTY") return null;
  if (cell.kind === "GROUP") return <GroupGlyph cell={cell} width={width || groupWidth(cell)} values={values} />;
  const stroke = energized ? "var(--bp-energized)" : "var(--bp-line-strong)";
  let label = cell.address;
  if (cell.kind === "CMP") label = `${cell.address} ${cell.op} ${cell.value}`;
  if (cell.kind === "XOR") label = `${cell.address} XOR ${cell.address2}`;
  const isContact = ["NO", "NC", "P", "N"].includes(cell.kind);
  return (
    <g>
      <text y={-22} textAnchor="middle" className="ladder-label">{label}</text>
      {isContact && <SimpleContactMarks cell={cell} stroke={stroke} />}
      {cell.kind === "CMP" && (
        <>
          <rect x={-32} y={-14} width={64} height={28} rx={4} fill="var(--bp-panel-raised)" stroke={stroke} strokeWidth={2} />
          <text y={5} textAnchor="middle" className="ladder-glyph-tag-sm">CMP {cell.op}</text>
        </>
      )}
      {cell.kind === "XOR" && (
        <>
          <rect x={-32} y={-14} width={64} height={28} rx={4} fill="var(--bp-panel-raised)" stroke={stroke} strokeWidth={2} />
          <text y={5} textAnchor="middle" className="ladder-glyph-tag-sm">XOR</text>
        </>
      )}
    </g>
  );
}

function OutputGlyph({ output, energized, simValues }) {
  if (!output || output.kind === "NONE") {
    return <text y={5} textAnchor="middle" className="ladder-label-dim">+ sortie</text>;
  }
  const stroke = energized ? "var(--bp-energized)" : "var(--bp-line-strong)";
  const isCoil = ["COIL", "COIL_INV", "SET", "RESET"].includes(output.kind);
  const isTimer = ["TON", "TOF", "TP"].includes(output.kind);
  const isCounter = ["CTU", "CTD"].includes(output.kind);
  let sub = "";
  if (isTimer && simValues) {
    const i = parseAddress(output.address).key;
    const t = simValues.T[i];
    sub = `${((t ? t.ET : 0) / 1000).toFixed(1)}/${(output.preset / 1000).toFixed(1)}s`;
  }
  if (isCounter && simValues) {
    const i = parseAddress(output.address).key;
    const c = simValues.C[i];
    sub = `${c ? c.CV : 0}/${output.preset}`;
  }
  return (
    <g>
      <text y={-28} textAnchor="middle" className="ladder-label">{output.address}</text>
      {isCoil && <ellipse cx={0} cy={0} rx={16} ry={16} fill={energized ? "var(--bp-energized-fill)" : "transparent"} stroke={stroke} strokeWidth={3} />}
      {output.kind === "COIL_INV" && <line x1={-13} y1={13} x2={13} y2={-13} stroke={stroke} strokeWidth={2} />}
      {output.kind === "SET" && <text y={5} textAnchor="middle" className="ladder-glyph-tag">S</text>}
      {output.kind === "RESET" && <text y={5} textAnchor="middle" className="ladder-glyph-tag">R</text>}
      {(isTimer || isCounter) && (
        <>
          <rect x={-33} y={-18} width={66} height={38} rx={3} fill="var(--bp-panel-raised)" stroke={stroke} strokeWidth={2.5} />
          <text y={-3} textAnchor="middle" className="ladder-glyph-tag-sm">{output.kind}</text>
          <text y={11} textAnchor="middle" className="ladder-glyph-tiny">{sub}</text>
        </>
      )}
    </g>
  );
}

// --- Vue réseau compacte (tous les réseaux sur une seule feuille) ---
function MiniNetworkView({ net, sim, onCellClick, onOutputClick }) {
  const rows = net.rows; const R = rows.length; const cols = net.cols;
  const colWidths = Array.from({ length: cols }, (_, ci) => Math.max(CELL_W, ...rows.map((r) => cellWidth(r.cells[ci]))));
  const colX = [RAIL_PAD]; colWidths.forEach((w) => colX.push(colX[colX.length - 1] + w));
  const mergeX = colX[cols]; const width = mergeX + OUT_W + RAIL_PAD;
  const height = PAD_V * 2 + R * CELL_H;
  const rightRailX = width - RAIL_PAD;
  const rowY = (i) => PAD_V + i * CELL_H + CELL_H / 2;
  const topY = rowY(0), botY = rowY(R - 1);
  const busTop = Math.max(6, topY - 18), busBot = botY + 18;
  const visual = sim && sim.running ? sim.visual[net.id] : null;
  const midY = (topY + botY) / 2;
  const outEnergized = !!(visual && visual.merged);
  const values = sim && sim.values;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: "block", margin: "0 auto" }}>
      <line x1={RAIL_PAD} y1={busTop} x2={RAIL_PAD} y2={busBot} stroke="var(--bp-rail)" strokeWidth={3} />
      <line x1={mergeX} y1={busTop} x2={mergeX} y2={busBot} stroke="var(--bp-line-strong)" strokeWidth={2} />
      <line x1={rightRailX} y1={busTop} x2={rightRailX} y2={busBot} stroke="var(--bp-rail)" strokeWidth={3} />
      {rows.map((row, ri) => {
        const y = rowY(ri);
        const stagePowers = (visual && visual.rows[ri]) || Array(cols + 1).fill(false);
        return (
          <g key={row.id}>
            {row.cells.map((cell, ci) => {
              const x0 = colX[ci]; const w = colWidths[ci]; const cx = x0 + w / 2;
              const segOn = !!stagePowers[ci];
              return (
                <g key={cell.id}>
                  <line x1={x0} y1={y} x2={x0 + w} y2={y} stroke={segOn ? "var(--bp-energized)" : "var(--bp-line)"} strokeWidth={segOn ? 2.5 : 1.5} />
                  <g transform={`translate(${cx},${y})`}>
                    <ContactGlyph cell={cell} energized={!!stagePowers[ci + 1]} width={w} values={values} />
                  </g>
                  <rect x={x0} y={y - CELL_H / 2 + 3} width={w} height={CELL_H - 6} fill="transparent" style={{ cursor: "pointer" }}
                    onClick={() => onCellClick(net.id, row.id, ci)} />
                </g>
              );
            })}
            <line x1={colX[cols]} y1={y} x2={mergeX} y2={y}
              stroke={stagePowers[cols] ? "var(--bp-energized)" : "var(--bp-line)"} strokeWidth={stagePowers[cols] ? 2.5 : 1.5} />
          </g>
        );
      })}
      <g>
        <line x1={mergeX} y1={midY} x2={mergeX + OUT_W / 2 - 20} y2={midY} stroke={outEnergized ? "var(--bp-energized)" : "var(--bp-line)"} strokeWidth={2} />
        <g transform={`translate(${mergeX + OUT_W / 2},${midY})`}>
          <OutputGlyph output={net.output} energized={outEnergized} simValues={sim && sim.values} />
        </g>
        <line x1={mergeX + OUT_W / 2 + 20} y1={midY} x2={rightRailX} y2={midY} stroke={outEnergized ? "var(--bp-energized)" : "var(--bp-line)"} strokeWidth={2} />
        <rect x={mergeX} y={midY - 27} width={OUT_W} height={54} fill="transparent" style={{ cursor: "pointer" }} onClick={() => onOutputClick(net.id)} />
      </g>
    </svg>
  );
}

// --- Inspecteur (édition d'un élément sélectionné) ---
const BODY_KINDS = [
  { kind: "EMPTY", label: "Vide" }, { kind: "NO", label: "Contact NO" }, { kind: "NC", label: "Contact NF" },
  { kind: "P", label: "Front montant" }, { kind: "N", label: "Front descendant" },
  { kind: "CMP", label: "Comparateur" }, { kind: "XOR", label: "OU exclusif" }, { kind: "GROUP", label: "Groupe parallèle" },
];
const OUTPUT_KINDS = [
  { kind: "NONE", label: "Aucune" }, { kind: "COIL", label: "Bobine" }, { kind: "COIL_INV", label: "Bobine inv." },
  { kind: "SET", label: "Set" }, { kind: "RESET", label: "Reset" },
  { kind: "TON", label: "TON" }, { kind: "TOF", label: "TOF" }, { kind: "TP", label: "TP" },
  { kind: "CTU", label: "CTU" }, { kind: "CTD", label: "CTD" },
];
const SUBCELL_KINDS = [
  { kind: "EMPTY", label: "Vide" }, { kind: "NO", label: "NO" }, { kind: "NC", label: "NF" },
  { kind: "P", label: "Front P" }, { kind: "N", label: "Front N" },
];

function GroupInspector({ cell, onChange }) {
  const branches = cell.branches || [];
  const setBranches = (next) => onChange(next);
  const addBranch = () => setBranches([...branches, [makeCell("NO", branches[0]?.[0]?.address || "I0.0")]]);
  const removeBranch = (bi) => { if (branches.length > 1) setBranches(branches.filter((_, i) => i !== bi)); };
  const addContact = (bi) => setBranches(branches.map((b, i) => i !== bi ? b : [...b, makeCell("NO", "I0.0")]));
  const removeContact = (bi, ci) => setBranches(branches.map((b, i) => i !== bi ? b : (b.length > 1 ? b.filter((_, j) => j !== ci) : b)));
  const patchContact = (bi, ci, patch) => setBranches(branches.map((b, i) => i !== bi ? b : b.map((c, j) => j !== ci ? c : { ...c, ...patch })));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: "1px solid var(--bp-line)", paddingTop: 10 }}>
      <div style={{ fontSize: 11, color: "var(--bp-text-dim)", lineHeight: 1.4 }}>Branches en OU, contacts en série dans chaque branche.</div>
      {branches.map((branch, bi) => (
        <div key={bi} style={{ background: "var(--bp-canvas)", border: "1px solid var(--bp-line)", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--bp-text-dim)" }}>Branche {bi + 1}</span>
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => addContact(bi)} title="Ajouter contact" style={{ background: "none", border: "none", color: "var(--bp-amber)", cursor: "pointer" }}>＋</button>
              <button onClick={() => removeBranch(bi)} disabled={branches.length <= 1} title="Supprimer" style={{ background: "none", border: "none", color: "var(--bp-alarm)", cursor: branches.length <= 1 ? "not-allowed" : "pointer", opacity: branches.length <= 1 ? 0.35 : 1 }}>✕</button>
            </div>
          </div>
          {branch.map((sc, ci) => (
            <div key={sc.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 16px", gap: 4, alignItems: "center" }}>
              <select className="plcs-select" style={{ fontSize: 11, padding: "3px 4px" }} value={sc.kind} onChange={(e) => patchContact(bi, ci, { kind: e.target.value })}>
                {SUBCELL_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
              <input className="plcs-input" style={{ fontSize: 11, padding: "3px 5px" }} value={sc.address} placeholder="I0.0" onChange={(e) => patchContact(bi, ci, { address: e.target.value })} />
              <button onClick={() => removeContact(bi, ci)} disabled={branch.length <= 1} style={{ background: "none", border: "none", color: "var(--bp-alarm)", cursor: branch.length <= 1 ? "not-allowed" : "pointer", opacity: branch.length <= 1 ? 0.35 : 1 }}>✕</button>
            </div>
          ))}
        </div>
      ))}
      <Btn onClick={addBranch}>＋ Ajouter une branche</Btn>
    </div>
  );
}

function Inspector({ selection, project, updateCell, updateOutput }) {
  if (!selection) return <div style={{ fontSize: 12.5, color: "var(--bp-text-dim)", lineHeight: 1.5 }}>Cliquez sur un élément pour le configurer.</div>;
  const net = project.networks.find((n) => n.id === selection.networkId);
  if (!net) return null;
  if (selection.type === "cell") {
    const row = net.rows.find((r) => r.id === selection.rowId);
    const cell = row.cells[selection.colIndex];
    const onTypeChange = (kind) => {
      if (kind === "GROUP") {
        const defaultAddr = cell.address || "I0.0";
        updateCell(net.id, row.id, selection.colIndex, { kind, branches: [[makeCell("NO", defaultAddr)], [makeCell("NO", defaultAddr)]] });
      } else updateCell(net.id, row.id, selection.colIndex, { kind, branches: null });
    };
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="plcs-panel-title">Élément</div>
        <Field label="Type">
          <select className="plcs-select" value={cell.kind} onChange={(e) => onTypeChange(e.target.value)}>
            {BODY_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
        </Field>
        {cell.kind !== "EMPTY" && cell.kind !== "GROUP" && (
          <Field label={cell.kind === "CMP" ? "Adresse" : "Adresse"}>
            <input className="plcs-input" value={cell.address} placeholder="I0.0, M3..." onChange={(e) => updateCell(net.id, row.id, selection.colIndex, { address: e.target.value })} />
          </Field>
        )}
        {cell.kind === "CMP" && (<>
          <Field label="Opérateur">
            <select className="plcs-select" value={cell.op} onChange={(e) => updateCell(net.id, row.id, selection.colIndex, { op: e.target.value })}>
              {[">", "<", ">=", "<=", "==", "!="].map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Valeur"><input className="plcs-input" value={cell.value} onChange={(e) => updateCell(net.id, row.id, selection.colIndex, { value: e.target.value })} /></Field>
        </>)}
        {cell.kind === "XOR" && <Field label="2e adresse"><input className="plcs-input" value={cell.address2} onChange={(e) => updateCell(net.id, row.id, selection.colIndex, { address2: e.target.value })} /></Field>}
        {cell.kind === "GROUP" && <GroupInspector cell={cell} onChange={(branches) => updateCell(net.id, row.id, selection.colIndex, { branches })} />}
      </div>
    );
  }
  const out = net.output;
  const isTimer = ["TON", "TOF", "TP"].includes(out.kind);
  const isCounter = ["CTU", "CTD"].includes(out.kind);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="plcs-panel-title">Sortie</div>
      <Field label="Type">
        <select className="plcs-select" value={out.kind} onChange={(e) => updateOutput(net.id, { kind: e.target.value })}>
          {OUTPUT_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
      </Field>
      {out.kind !== "NONE" && <Field label="Adresse"><input className="plcs-input" value={out.address} placeholder={isTimer ? "T0" : isCounter ? "C0" : "Q0.0"} onChange={(e) => updateOutput(net.id, { address: e.target.value })} /></Field>}
      {isTimer && <Field label="Consigne (ms)"><input className="plcs-input" type="number" min={0} value={out.preset} onChange={(e) => updateOutput(net.id, { preset: parseInt(e.target.value || "0", 10) })} /></Field>}
      {isCounter && (<>
        <Field label="Consigne"><input className="plcs-input" type="number" min={0} value={out.preset} onChange={(e) => updateOutput(net.id, { preset: parseInt(e.target.value || "0", 10) })} /></Field>
        <Field label="Reset"><input className="plcs-input" value={out.resetAddress} placeholder="I0.3" onChange={(e) => updateOutput(net.id, { resetAddress: e.target.value })} /></Field>
      </>)}
    </div>
  );
}

// --- Palette d'outils ---
const BODY_TOOLS = [
  { kind: "NO", label: "Contact NO" }, { kind: "NC", label: "Contact NF" }, { kind: "P", label: "Front P" },
  { kind: "N", label: "Front N" }, { kind: "CMP", label: "Comparateur" }, { kind: "XOR", label: "XOR" }, { kind: "GROUP", label: "Groupe //" },
];
const OUTPUT_TOOLS = [
  { kind: "COIL", label: "Bobine" }, { kind: "COIL_INV", label: "Bobine inv." }, { kind: "SET", label: "Set" }, { kind: "RESET", label: "Reset" },
  { kind: "TON", label: "TON" }, { kind: "TOF", label: "TOF" }, { kind: "TP", label: "TP" }, { kind: "CTU", label: "CTU" }, { kind: "CTD", label: "CTD" },
];

function Palette({ tool, setTool, ioMap, setIoMap }) {
  const addIoRow = () => setIoMap([...ioMap, { addr: "M" + ioMap.length, pin: "D" + (12 + ioMap.length), kind: "DI" }]);
  const updateIo = (i, patch) => setIoMap(ioMap.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeIo = (i) => setIoMap(ioMap.filter((_, idx) => idx !== i));
  return (
    <div className="plcs-scroll" style={{ overflowY: "auto", height: "100%", padding: 14, display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <div className="plcs-panel-title">Contacts</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {BODY_TOOLS.map((t) => <Btn key={t.kind} active={tool === t.kind} onClick={() => setTool(tool === t.kind ? null : t.kind)}>{t.label}</Btn>)}
        </div>
      </div>
      <div>
        <div className="plcs-panel-title">Sorties</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {OUTPUT_TOOLS.map((t) => <Btn key={t.kind} active={tool === "OUT_" + t.kind} onClick={() => setTool(tool === "OUT_" + t.kind ? null : "OUT_" + t.kind)}>{t.label}</Btn>)}
        </div>
      </div>
      <div>
        <Btn active={tool === "ERASE"} onClick={() => setTool(tool === "ERASE" ? null : "ERASE")} variant={tool === "ERASE" ? "danger" : ""}>⌫ Effacer</Btn>
      </div>
      <div>
        <div className="plcs-panel-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span>E/S</span>
          <button onClick={addIoRow} style={{ background: "none", border: "none", color: "var(--bp-amber)", cursor: "pointer" }}>＋</button>
        </div>
        {ioMap.map((row, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 4, background: "var(--bp-canvas)", border: "1px solid var(--bp-line)", borderRadius: 5, padding: 6, marginTop: 4 }}>
            <div style={{ display: "flex", gap: 4 }}>
              <input className="plcs-input" style={{ minWidth: 0, flex: 1, padding: "4px 5px", fontSize: 11 }} value={row.addr} placeholder="Adresse" onChange={(e) => updateIo(i, { addr: e.target.value })} />
              <input className="plcs-input" style={{ minWidth: 0, width: 52, padding: "4px 5px", fontSize: 11 }} value={row.pin} placeholder="Pin" onChange={(e) => updateIo(i, { pin: e.target.value })} />
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <select className="plcs-select" style={{ minWidth: 0, flex: 1, padding: "4px 3px", fontSize: 11 }} value={row.kind} onChange={(e) => updateIo(i, { kind: e.target.value })}>
                <option value="DI">DI</option><option value="DO">DO</option><option value="AI">AI</option><option value="AQ">AQ</option>
              </select>
              <button onClick={() => removeIo(i)} style={{ background: "none", border: "none", color: "var(--bp-alarm)", cursor: "pointer" }}>✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Panneau de surveillance ---
function LED({ on, color = "var(--bp-energized)" }) {
  return <span style={{ width: 10, height: 10, borderRadius: "50%", display: "inline-block", background: on ? color : "var(--bp-line)", boxShadow: on ? `0 0 6px ${color}` : "none", flexShrink: 0 }} />;
}

function WatchPanel({ project, sim, writeBool, writeNum, onRun, onStop, onReset }) {
  const diIo = project.ioMap.filter((i) => i.kind === "DI");
  const aiIo = project.ioMap.filter((i) => i.kind === "AI");
  const boolAddrs = collectUsedBoolAddresses(project);
  const qAddrs = boolAddrs.filter((a) => a.startsWith("Q"));
  const mAddrs = boolAddrs.filter((a) => a.startsWith("M"));
  const { timers, counters } = collectTimersCounters(project);
  const v = sim.values;
  return (
    <div className="plcs-scroll" style={{ overflowY: "auto", height: "100%", padding: 14, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {!sim.running ? <Btn variant="primary" onClick={onRun} className="plcs-mono">▶ Lancer</Btn> : <Btn variant="danger" onClick={onStop}>■ Arrêter</Btn>}
        <Btn onClick={onReset} title="Reset">↺</Btn>
      </div>
      <div style={{ fontSize: 11, color: "var(--bp-text-dim)" }}>Scan: {SCAN_MS}ms · {sim.running ? <span style={{ color: "var(--bp-energized)" }}>actif</span> : "arrêté"}</div>
      <div>
        <div className="plcs-panel-title">Entrées TOR</div>
        {diIo.map((io) => (
          <div key={io.addr} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span className="plcs-mono" style={{ fontSize: 12 }}>{io.addr} ({io.pin})</span>
            <Switch on={!!v.I[io.addr]} onClick={() => writeBool(io.addr, !v.I[io.addr])} />
          </div>
        ))}
      </div>
      {aiIo.length > 0 && (
        <div>
          <div className="plcs-panel-title">Entrées analog.</div>
          {aiIo.map((io) => (
            <div key={io.addr}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
                <span className="plcs-mono">{io.addr}</span><span className="plcs-mono" style={{ color: "var(--bp-blue)" }}>{v.AI[io.addr] || 0}</span>
              </div>
              <input type="range" min={0} max={1023} value={v.AI[io.addr] || 0} onChange={(e) => writeNum(io.addr, parseInt(e.target.value, 10))} style={{ width: "100%" }} />
            </div>
          ))}
        </div>
      )}
      <div>
        <div className="plcs-panel-title">Sorties</div>
        {qAddrs.map((a) => <div key={a} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}><span className="plcs-mono" style={{ fontSize: 12 }}>{a}</span><LED on={!!v.Q[a]} /></div>)}
      </div>
      <div>
        <div className="plcs-panel-title">Mémoires</div>
        {mAddrs.map((a) => <div key={a} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}><span className="plcs-mono" style={{ fontSize: 12 }}>{a}</span><Switch on={!!v.M[a]} onClick={() => writeBool(a, !v.M[a])} /></div>)}
      </div>
      {timers.length > 0 && (
        <div>
          <div className="plcs-panel-title">Temporisateurs</div>
          {timers.map((t) => {
            const st = v.T[parseAddress(t.addr).key] || { ET: 0, Q: false };
            const pct = clamp((st.ET / (t.preset || 1)) * 100, 0, 100);
            return (
              <div key={t.addr}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}><span className="plcs-mono">{t.addr} {t.kind}</span><LED on={st.Q} color="var(--bp-blue)" /></div>
                <div style={{ height: 5, background: "var(--bp-panel-raised)", borderRadius: 3, overflow: "hidden", marginTop: 3 }}><div style={{ height: "100%", width: pct + "%", background: "var(--bp-blue)" }} /></div>
              </div>
            );
          })}
        </div>
      )}
      {counters.length > 0 && (
        <div>
          <div className="plcs-panel-title">Compteurs</div>
          {counters.map((c) => {
            const st = v.C[parseAddress(c.addr).key] || { CV: 0, Q: false };
            return <div key={c.addr} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span className="plcs-mono" style={{ fontSize: 12 }}>{c.addr} {c.kind}</span><span className="plcs-mono" style={{ fontSize: 12, color: "var(--bp-blue)" }}>{st.CV}/{c.preset}</span></div>;
          })}
        </div>
      )}
    </div>
  );
}

// --- Hook de redimensionnement ---
function useResizeWidth(initial, min, max, invert) {
  const [width, setWidth] = useState(initial);
  const dragging = useRef(false);
  const startXRef = useRef(0);
  const startWRef = useRef(initial);
  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    startXRef.current = e.clientX;
    startWRef.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);
  useEffect(() => {
    const onMove = (e) => {
      if (!dragging.current) return;
      const delta = e.clientX - startXRef.current;
      setWidth(clamp(startWRef.current + (invert ? -delta : delta), min, max));
    };
    const onUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [min, max, invert]);
  const resetWidth = useCallback(() => setWidth(initial), [initial]);
  return [width, onMouseDown, resetWidth];
}

function ResizeHandle({ onMouseDown, onDoubleClick, title }) {
  return (
    <div className="plcs-resize-handle" onMouseDown={onMouseDown} onDoubleClick={onDoubleClick} title={title || "Redimensionner"}>
      <div className="plcs-resize-grip" />
    </div>
  );
}

// --- Vue Ladder tout-en-un ---
function LadderAllInOne({ project, setProject, tool, setTool, sim, selection, setSelection, writeBool, writeNum, onRun, onStop, onReset }) {
  const [leftW, leftDrag, resetLeft] = useResizeWidth(220, 150, 380, false);
  const [rightW, rightDrag, resetRight] = useResizeWidth(260, 200, 420, true);
  const updateNetworks = (fn) => setProject((p) => ({ ...p, networks: fn(clone(p.networks)) }));

  const placeOrSelectCell = (networkId, rowId, colIndex) => {
    const net = project.networks.find((n) => n.id === networkId);
    const row = net.rows.find((r) => r.id === rowId);
    const cell = row.cells[colIndex];
    if (tool === "ERASE") {
      updateNetworks((nets) => nets.map((n) => n.id !== networkId ? n : { ...n, rows: n.rows.map((r) => r.id !== rowId ? r : { ...r, cells: r.cells.map((c, i) => i !== colIndex ? c : makeCell()) }) }));
      return;
    }
    if (tool === "GROUP" && cell.kind === "EMPTY") {
      const defaultAddr = project.ioMap.find((i) => i.kind === "DI")?.addr || "I0.0";
      const group = makeGroupCell();
      group.branches = [[makeCell("NO", defaultAddr)], [makeCell("NO", defaultAddr)]];
      updateNetworks((nets) => nets.map((n) => n.id !== networkId ? n : { ...n, rows: n.rows.map((r) => r.id !== rowId ? r : { ...r, cells: r.cells.map((c, i) => i !== colIndex ? c : group) }) }));
      setSelection({ type: "cell", networkId, rowId, colIndex });
      return;
    }
    if (tool && BODY_TOOLS.some((t) => t.kind === tool) && cell.kind === "EMPTY") {
      const defaultAddr = project.ioMap.find((i) => i.kind === "DI")?.addr || "I0.0";
      updateNetworks((nets) => nets.map((n) => n.id !== networkId ? n : { ...n, rows: n.rows.map((r) => r.id !== rowId ? r : { ...r, cells: r.cells.map((c, i) => i !== colIndex ? c : makeCell(tool, defaultAddr)) }) }));
      setSelection({ type: "cell", networkId, rowId, colIndex });
      return;
    }
    setSelection({ type: "cell", networkId, rowId, colIndex });
  };

  const placeOrSelectOutput = (networkId) => {
    const net = project.networks.find((n) => n.id === networkId);
    if (tool === "ERASE") {
      updateNetworks((nets) => nets.map((n) => n.id !== networkId ? n : { ...n, output: { kind: "NONE", address: "", preset: 1000, resetAddress: "" } }));
      return;
    }
    if (tool && tool.startsWith("OUT_") && net.output.kind === "NONE") {
      const kind = tool.slice(4);
      const isTimer = ["TON", "TOF", "TP"].includes(kind);
      const isCounter = ["CTU", "CTD"].includes(kind);
      const defaultAddr = isTimer ? "T0" : isCounter ? "C0" : (project.ioMap.find((i) => i.kind === "DO")?.addr || "Q0.0");
      updateNetworks((nets) => nets.map((n) => n.id !== networkId ? n : { ...n, output: { kind, address: defaultAddr, preset: isTimer ? 1000 : 5, resetAddress: "" } }));
      setSelection({ type: "output", networkId });
      return;
    }
    setSelection({ type: "output", networkId });
  };

  const updateCell = (networkId, rowId, colIndex, patch) => {
    updateNetworks((nets) => nets.map((n) => n.id !== networkId ? n : { ...n, rows: n.rows.map((r) => r.id !== rowId ? r : { ...r, cells: r.cells.map((c, i) => i !== colIndex ? c : { ...c, ...patch }) }) }));
  };

  const updateOutput = (networkId, patch) => {
    updateNetworks((nets) => nets.map((n) => n.id !== networkId ? n : { ...n, output: { ...n.output, ...patch } }));
  };

  const addNetwork = () => updateNetworks((nets) => [...nets, makeNetwork(3, 1, `Réseau ${nets.length + 1}`)]);
  const deleteNetwork = (id) => updateNetworks((nets) => nets.filter((n) => n.id !== id));
  const addRow = (id) => updateNetworks((nets) => nets.map((n) => n.id !== id ? n : { ...n, rows: [...n.rows, makeRow(n.cols)] }));
  const removeRow = (id) => updateNetworks((nets) => nets.map((n) => n.id !== id || n.rows.length <= 1 ? n : { ...n, rows: n.rows.slice(0, -1) }));
  const addCol = (id) => updateNetworks((nets) => nets.map((n) => n.id !== id ? n : { ...n, cols: n.cols + 1, rows: n.rows.map((r) => ({ ...r, cells: [...r.cells, makeCell()] })) }));
  const removeCol = (id) => updateNetworks((nets) => nets.map((n) => n.id !== id || n.cols <= 1 ? n : { ...n, cols: n.cols - 1, rows: n.rows.map((r) => ({ ...r, cells: r.cells.slice(0, -1) })) }));
  const setComment = (id, text) => updateNetworks((nets) => nets.map((n) => n.id !== id ? n : { ...n, comment: text }));
  const setIoMap = (ioMap) => setProject((p) => ({ ...p, ioMap }));

  return (
    <div style={{ display: "flex", height: "100%", minWidth: 0, overflow: "hidden" }}>
      <div style={{ width: leftW, flexShrink: 0, background: "var(--bp-panel)" }}>
        <Palette tool={tool} setTool={setTool} ioMap={project.ioMap} setIoMap={setIoMap} />
      </div>
      <ResizeHandle onMouseDown={leftDrag} onDoubleClick={resetLeft} />
      <div className="plcs-scroll" style={{ flex: 1, minWidth: 0, overflow: "auto", padding: 12, background: "var(--bp-canvas)" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {project.networks.map((net) => (
            <div key={net.id} className="network-section" style={{ background: "rgba(14,32,54,0.5)", border: "1px solid var(--bp-line)", borderRadius: 3, padding: 4, marginBottom: 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 6px", background: "var(--bp-panel)", borderBottom: "1px solid var(--bp-line)", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "var(--bp-amber)", fontWeight: 600, flex: 1, minWidth: 80, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{net.comment}</span>
                <Btn onClick={() => addRow(net.id)} style={{ padding: "2px 6px", fontSize: 10 }}>+L</Btn>
                <Btn onClick={() => removeRow(net.id)} disabled={net.rows.length <= 1} style={{ padding: "2px 6px", fontSize: 10 }}>-L</Btn>
                <Btn onClick={() => addCol(net.id)} style={{ padding: "2px 6px", fontSize: 10 }}>+C</Btn>
                <Btn onClick={() => removeCol(net.id)} disabled={net.cols <= 1} style={{ padding: "2px 6px", fontSize: 10 }}>-C</Btn>
                <Btn variant="danger" onClick={() => deleteNetwork(net.id)} style={{ padding: "2px 6px", fontSize: 10 }}>✕</Btn>
              </div>
              <MiniNetworkView net={net} sim={sim} onCellClick={placeOrSelectCell} onOutputClick={placeOrSelectOutput} />
            </div>
          ))}
          <Btn onClick={addNetwork} style={{ alignSelf: "flex-start", marginTop: 8 }}>＋ Réseau</Btn>
        </div>
      </div>
      <ResizeHandle onMouseDown={rightDrag} onDoubleClick={resetRight} />
      <div style={{ width: rightW, flexShrink: 0, background: "var(--bp-panel)", display: "flex", flexDirection: "column", borderLeft: "2px solid #111" }}>
        <div style={{ padding: 14, borderBottom: "1px solid var(--bp-line)" }}>
          <Inspector selection={selection} project={project} updateCell={updateCell} updateOutput={updateOutput} />
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <WatchPanel project={project} sim={sim} writeBool={writeBool} writeNum={writeNum} onRun={onRun} onStop={onStop} onReset={onReset} />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   Composant principal App
   ============================================================ */
const TABS = [{ id: "ladder", label: "LADDER" }, { id: "code", label: "CODE" }];

export default function App() {
  const [project, setProject] = useState(createBlankProject);
  const [tab, setTab] = useState("ladder");
  const [tool, setTool] = useState(null);
  const [selection, setSelection] = useState(null);
  const [sim, setSim] = useState(() => ({ running: false, values: initValues(), visual: {} }));
  const [history, setHistory] = useState({});

  const projectRef = useRef(project);
  useEffect(() => { projectRef.current = project; }, [project]);

  const simDataRef = useRef({ values: initValues(), prevScanValues: initValues(), prevNetPower: {} });
  const intervalRef = useRef(null);
  const fileInputRef = useRef(null);

  const writeBool = useCallback((addr, val) => {
    if (!addr) return;
    setBoolAddr(simDataRef.current.values, addr, val);
    setSim((s) => ({ ...s, values: clone(simDataRef.current.values) }));
  }, []);

  const writeNum = useCallback((addr, val) => {
    if (!addr) return;
    setNumAddr(simDataRef.current.values, addr, val);
    setSim((s) => ({ ...s, values: clone(simDataRef.current.values) }));
  }, []);

  const runScan = useCallback(() => {
    const proj = projectRef.current;
    const s = simDataRef.current;
    const { newValues, visual } = scanOnce(proj, s.values, s.prevScanValues, s.prevNetPower, SCAN_MS);
    s.prevScanValues = s.values;
    s.values = newValues;
    setSim({ running: true, values: newValues, visual });
    const chartAddrs = proj.hmi.widgets.filter((w) => w.type === "CHART" && w.address).map((w) => w.address);
    if (chartAddrs.length) {
      setHistory((h) => {
        const next = { ...h };
        chartAddrs.forEach((addr) => {
          const arr = (next[addr] || []).slice(-39);
          next[addr] = [...arr, { t: (arr[arr.length - 1]?.t || 0) + 1, v: getNum(newValues, addr) }];
        });
        return next;
      });
    }
  }, []);

  const onRun = () => {
    if (intervalRef.current) return;
    setSim((s) => ({ ...s, running: true }));
    intervalRef.current = setInterval(runScan, SCAN_MS);
  };

  const onStop = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    setSim((s) => ({ ...s, running: false }));
  };

  const onReset = () => {
    onStop();
    simDataRef.current = { values: initValues(), prevScanValues: initValues(), prevNetPower: {} };
    setSim({ running: false, values: initValues(), visual: {} });
    setHistory({});
  };

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current); }, []);

  const loadProject = (p) => { onReset(); setProject(p); setSelection(null); setTool(null); };
  const loadExample = (ex) => { loadProject(buildExampleProject(ex)); };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${project.name.replace(/\s+/g, "_") || "projet"}.json`;
    a.click(); URL.revokeObjectURL(url);
  };

  const importJson = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.networks || !parsed.ioMap) throw new Error("format invalide");
        loadProject(parsed);
      } catch (err) { alert("Fichier invalide : " + err.message); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const code = useMemo(() => generateArduinoCode(project), [project]);
  const downloadCode = () => {
    const blob = new Blob([code], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${project.name.replace(/\s+/g, "_") || "programme"}.ino`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="plcs-root" style={{ width: "100%", height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Barre supérieure */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "10px 20px", background: "linear-gradient(180deg,#3a4149,#232830)", borderBottom: "2px solid #111417", flexWrap: "wrap" }}>
        <span style={{ fontFamily: "'Oswald', sans-serif", fontWeight: 600, fontSize: 17, textTransform: "uppercase", color: "var(--bp-text)" }}>IoT PLC Studio</span>
        <input className="plcs-input" style={{ background: "transparent", border: "1px solid transparent", fontFamily: "IBM Plex Sans", minWidth: 140 }}
          value={project.name} onChange={(e) => setProject((p) => ({ ...p, name: e.target.value }))} />
        <select className="plcs-select" value={project.board} onChange={(e) => setProject((p) => ({ ...p, board: e.target.value }))}>
          {BOARDS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <nav style={{ display: "flex", gap: 2 }}>
          {TABS.map((t) => (
            <div key={t.id} className={`plcs-tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>{t.label}</div>
          ))}
        </nav>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input ref={fileInputRef} type="file" accept="application/json" style={{ display: "none" }} onChange={importJson} />
          <Btn onClick={() => fileInputRef.current.click()}>↥ Importer</Btn>
          <Btn onClick={exportJson}>💾 Exporter</Btn>
          <div style={{ borderLeft: "1px solid var(--bp-line)", marginLeft: 4, paddingLeft: 8, display: "flex", gap: 4 }}>
            {EXAMPLES.map((ex) => <Btn key={ex.id} onClick={() => loadExample(ex)} style={{ fontSize: 10, padding: "4px 8px" }}>{ex.title}</Btn>)}
          </div>
        </div>
      </div>

      {/* Contenu principal */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === "ladder" ? (
          <LadderAllInOne project={project} setProject={setProject} tool={tool} setTool={setTool}
            sim={sim} selection={selection} setSelection={setSelection}
            writeBool={writeBool} writeNum={writeNum} onRun={onRun} onStop={onStop} onReset={onReset} />
        ) : (
          <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--bp-line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12.5, color: "var(--bp-text-dim)" }}>Code Arduino généré — À relire avant déploiement</span>
              <Btn variant="primary" onClick={downloadCode}>⬇ Télécharger .ino</Btn>
            </div>
            <pre className="plcs-scroll plcs-mono" style={{ flex: 1, margin: 0, padding: 18, overflow: "auto", fontSize: 12.5, lineHeight: 1.6, color: "var(--bp-text)", background: "var(--bp-canvas)" }}>
              {code}
            </pre>
          </div>
        )}
      </div>

      {/* Barre d'état */}
      <div style={{ display: "flex", justifyContent: "space-between", padding: "7px 16px", background: "linear-gradient(180deg,#232830,#181c21)", borderTop: "2px solid #111417", fontSize: 11, color: "var(--bp-text-dim)" }} className="plcs-mono">
        <span>{project.networks.length} réseau(x) · {project.ioMap.length} E/S</span>
        <span style={{ display: "flex", alignItems: "center", gap: 7, color: sim.running ? "var(--bp-energized)" : "var(--bp-text-dim)" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: sim.running ? "var(--bp-energized)" : "var(--bp-line-strong)", animation: sim.running ? "plcs-blink 1.4s infinite" : "none" }} />
          {sim.running ? "EN MARCHE" : "ARRÊTÉ"}
        </span>
      </div>
    </div>
  );
}