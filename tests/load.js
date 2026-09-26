// Loads the browser scripts (state.js, engine.js) into Node for testing.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function load() {
  const store = {};
  const ctx = {
    console, Math, Date, JSON, isNaN, Number, Object, Array, String,
    localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = String(v); } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  ["js/state.js", "js/engine.js"].forEach((f) => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", f), "utf8"), ctx, { filename: f });
  });
  return ctx.FIRE;
}

// Returns a migrated, normalized copy of `obj` (or of the defaults), exactly
// as the app would hold it after an import.
function stateFrom(FIRE, obj) {
  const src = obj || FIRE.state.defaultState();
  FIRE.state.importJSON(JSON.stringify(src));
  return JSON.parse(JSON.stringify(FIRE.state.get()));
}

function sampleState(FIRE) {
  const raw = fs.readFileSync(path.join(__dirname, "..", "data", "sample-state.json"), "utf8");
  return stateFrom(FIRE, JSON.parse(raw));
}

module.exports = { load, stateFrom, sampleState };
