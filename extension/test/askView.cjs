const assert = require('node:assert/strict');
const vm = require('node:vm');
const { goalsHtml, GoalsView } = require('../out/goalsView');
exports.checkAskView = async function () {
  const state = { phase: 'ready', text: 'goal', errors: [], theory: 'Demo' };
  const html = goalsHtml(state, 'asknonce');
  assert(html.includes("script-src 'nonce-asknonce'"));
  assert(html.indexOf('id="prompt"') < html.indexOf('<header>'));
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.events = {}; this.textContent = ''; this.value = ''; this.disabled = false; this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 100; }
    append(child) { this.children.push(child); }
    addEventListener(name, callback) { this.events[name] = callback; }
    focus() { this.focused = true; }
  }
  const elements = Object.fromEntries(['prompt', 'send', 'stop', 'transcript', 'ask-status', 'goal', 'errors', 'h1', '.status'].map(name => [name, new Element()]));
  let receive, saved = { draft: 'unsent draft' };
  const messages = [];
  vm.runInNewContext(html.match(/<script nonce="asknonce">([\s\S]+)<\/script>/)[1], {
    document: { getElementById: id => elements[id], querySelector: key => elements[key], createElement: () => new Element(), body: { classList: { toggle() {} } } },
    window: { addEventListener: (_, callback) => { receive = callback; } },
    acquireVsCodeApi: () => ({ postMessage: value => messages.push(value), getState: () => saved, setState: value => { saved = value; } }),
  });
  assert.equal(elements.prompt.value, 'unsent draft');
  receive({ data: { type: 'goal', goal: { theory: 'Demo', status: 'checking…', phase: 'checking', text: '', errors: '' } } });
  assert.equal(elements.prompt.value, 'unsent draft');
  assert.equal(elements.goal.textContent, '');
  const enter = shiftKey => ({ key: 'Enter', shiftKey, preventDefault() { this.prevented = true; } });
  elements.prompt.events.keydown(enter(true));
  assert.equal(messages.length, 1, 'Shift+Enter must not send');
  elements.prompt.events.keydown({ ...enter(false), isComposing: true });
  assert.equal(messages.length, 1, 'IME composition must not send');
  elements.prompt.value = 'prove this';
  elements.prompt.events.keydown(enter(false));
  assert.equal(messages.at(-1).text, 'prove this');
  assert(elements.prompt.disabled && elements.send.disabled && !elements.stop.disabled);
  assert.equal(saved.draft, '');
  elements.prompt.value = 'accidental duplicate'; elements.send.events.click();
  assert.equal(messages.filter(m => m.type === 'ask').length, 1);
  receive({ data: { type: 'askState', state: { active: true, entries: [{ id: 1, kind: 'assistant', text: '<script>safe</script>' }] } } });
  const node = elements.transcript.children[0];
  assert.equal(node.textContent, '<script>safe</script>');
  receive({ data: { type: 'askState', state: { active: true, entries: [{ id: 1, kind: 'assistant', text: 'streaming' }] } } });
  assert.equal(elements.transcript.children[0], node);
  elements.stop.events.click(); assert.equal(messages.at(-1).type, 'stop');
  receive({ data: { type: 'askState', state: { active: false, entries: [{ id: 1, kind: 'assistant', text: 'done' }] } } });
  assert(!elements.prompt.disabled && elements.stop.disabled && elements.prompt.focused);
  let inbound, dispose; const posted = [];
  const view = new GoalsView(); let asked, stopped = false;
  view.onAsk = text => { asked = text; }; view.onStop = () => { stopped = true; };
  view.focusAsk();
  const fake = { webview: { onDidReceiveMessage(fn) { inbound = fn; return { dispose() {} }; },
    postMessage(value) { posted.push(value); return Promise.resolve(true); } }, onDidDispose(fn) { dispose = fn; } };
  view.update(state); view.updateAsk({ active: false, entries: [{ id: 1, kind: 'user', text: 'earlier' }] });
  view.resolveWebviewView(fake); const initialHtml = fake.webview.html;
  inbound({ type: 'ready' });
  assert(posted.some(m => m.type === 'focus'));
  assert(posted.some(m => m.type === 'askState' && m.state.entries[0].text === 'earlier'));
  inbound({ type: 'ask', text: 'prove this' }); inbound({ type: 'stop' });
  assert.equal(asked, 'prove this'); assert(stopped);
  view.update({ ...state, text: 'updated' });
  assert.equal(fake.webview.html, initialHtml, 'Goal updates must not reload the webview');
  dispose(); view.resolveWebviewView(fake); inbound({ type: 'ready' });
  assert(posted.findLast(message => message.type === 'askState').state.entries[0].text === 'earlier');
  console.log('PASS: Ask webview Enter/newline/IME, disabled controls, Stop, focus command, retained draft/transcript, and escaped streamed text');
};
