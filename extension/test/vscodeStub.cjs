// The small part of the vscode API that pure modules touch, for tests outside VS Code.
const Module = require('node:module');
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    [this.start, this.end] = a instanceof Position ? [a, b] : [new Position(a, b), new Position(c, d)];
  }
}
class EventEmitter {
  listeners = new Set();
  event = listener => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
  fire(value) { for (const listener of this.listeners) listener(value); }
  dispose() { this.listeners.clear(); }
}
class ThemeColor { constructor(id) { this.id = id; } }
const vscode = { Position, Range, EventEmitter, ThemeColor, OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  SymbolKind: { Module: 1, Namespace: 2, Class: 4, Method: 5, Enum: 9, Interface: 10, Function: 11, Constant: 13, String: 14, Object: 18, Struct: 22 } };
if (!Module._load.vscodeStub) {
  const load = Module._load;
  Module._load = function (name, ...rest) { return name === 'vscode' ? vscode : load.call(this, name, ...rest); };
  Module._load.vscodeStub = true;
}
module.exports = vscode;
