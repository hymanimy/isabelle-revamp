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
const vscode = { Position, Range, EventEmitter, DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 } };
if (!Module._load.vscodeStub) {
  const load = Module._load;
  Module._load = function (name, ...rest) { return name === 'vscode' ? vscode : load.call(this, name, ...rest); };
  Module._load.vscodeStub = true;
}
module.exports = vscode;
