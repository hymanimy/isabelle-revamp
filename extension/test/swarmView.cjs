const assert = require('node:assert/strict');
const vm = require('node:vm');
const { swarmHtml, SwarmView } = require('../out/swarmView');

exports.checkSwarmView = async function () {
  const html = swarmHtml('testnonce');
  assert(html.includes('300ms') && html.includes("script-src 'nonce-testnonce'"));
  for (const variable of ['descriptionForeground', 'editorWarning-foreground', 'testing-iconPassed', 'errorForeground']) {
    assert(html.includes('var(--vscode-' + variable + ')'));
  }
  // Run the actual webview script against a tiny DOM to verify retained nodes,
  // message routing and text-only labels. No browser automation is involved.
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.textContent = ''; this.events = {}; }
    append(child) { this.insertBefore(child, null); }
    insertBefore(child, before) {
      child.remove();
      this.children.splice(before ? this.children.indexOf(before) : this.children.length, 0, child);
      child.parent = this;
    }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
    addEventListener(name, callback) { this.events[name] = callback; }
    querySelector(selector) { return this.children.find(c => c.className === selector.slice(1)); }
  }
  const elements = Object.fromEntries(['cards', 'empty', 'h1', '.status'].map(name => [name, new Element()]));
  const messages = []; let update;
  const context = vm.createContext({
    document: { getElementById: id => elements[id], querySelector: key => elements[key], createElement: () => new Element() },
    window: { addEventListener: (_, callback) => { update = callback; } },
    acquireVsCodeApi: () => ({ postMessage: value => messages.push(value) }), setInterval() {}, Date,
  });
  vm.runInContext(html.match(/<script nonce="testnonce">([\s\S]+)<\/script>/)[1], context);
  const state = { uri: 'file:///Swarm.thy', version: 1, theory: 'Swarm', proved: 0, fullyChecked: false,
    cards: [{ id: 'step', label: '<script>inert</script>', status: 'sorry' }] };
  update({ data: { type: 'state', state } });
  const button = elements.cards.children[0];
  assert.equal(button.querySelector('.label').textContent, state.cards[0].label);
  update({ data: { type: 'state', state: { ...state, proved: 1, fullyChecked: true,
    cards: [{ ...state.cards[0], status: 'proved', agent: 'Claude' }] } } });
  assert.equal(elements.cards.children[0], button, 'Status changes must retain the node for CSS transitions');
  assert.equal(button.dataset.status, 'proved');
  assert(button.querySelector('.detail').textContent.includes('Claude'));
  assert(elements['.status'].textContent.includes('kernel-checked ✓'));
  button.events.click();
  assert.equal(messages.at(-1).id, 'step');
  let receive, selected;
  const view = new SwarmView(async (...args) => { selected = args; });
  const fake = { webview: { onDidReceiveMessage(fn) { receive = fn; return { dispose() {} }; }, postMessage() {} }, onDidDispose() {} };
  view.resolveWebviewView(fake);
  receive(messages.at(-1));
  assert.deepEqual(selected, [state.uri, 1, 'step']);
  console.log('PASS: four themed card states, safe labels, retained animated nodes, header, and click messages');
};
