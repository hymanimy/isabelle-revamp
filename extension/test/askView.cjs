const assert = require('node:assert/strict');
const vm = require('node:vm');
const { goalsHtml, GoalsView } = require('../out/goalsView');
const { askHtml, AskView } = require('../out/askView');
exports.checkAskView = async function () {
  const state = { phase: 'ready', text: 'goal', errors: [], theory: 'Demo' };
  const html = askHtml('asknonce');
  assert(html.includes("script-src 'nonce-asknonce'"));
  assert(html.includes('rows="1"'));
  assert(html.indexOf('id="prompt"') < html.indexOf('id="transcript"'));
  assert(!goalsHtml(state).includes('id="prompt"'));
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.events = {}; this.textContent = ''; this.value = ''; this.disabled = false; this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 100; }
    append(child) { child.parent = this; this.children.push(child); }
    remove() { const at = this.parent ? this.parent.children.indexOf(this) : -1; if (at >= 0) this.parent.children.splice(at, 1); }
    addEventListener(name, callback) { this.events[name] = callback; }
    focus() { this.focused = true; }
  }
  const elements = Object.fromEntries(['prompt', 'send', 'stop', 'clear', 'transcript', 'ask-status', 'goal', 'errors', 'h1', '.status'].map(name => [name, new Element()]));
  let receive, saved = { draft: 'unsent draft' };
  const messages = [];
  vm.runInNewContext(html.match(/<script nonce="asknonce">([\s\S]+)<\/script>/)[1], {
    document: { getElementById: id => elements[id], querySelector: key => elements[key], createElement: () => new Element(), body: { classList: { toggle() {} } } },
    window: { addEventListener: (_, callback) => { receive = callback; } },
    acquireVsCodeApi: () => ({ postMessage: value => messages.push(value), getState: () => saved, setState: value => { saved = value; } }),
  });
  assert.equal(elements.prompt.value, 'unsent draft');
  receive({ data: { type: 'askState', state: { active: false, entries: [] } } });
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
  // Clear is inert during a run, and an emptied state must empty the rendering.
  elements.clear.events.click();
  assert.notEqual(messages.at(-1).type, 'clear', 'Clear must not fire mid-run');
  receive({ data: { type: 'askState', state: { active: false, entries: [{ id: 1, kind: 'assistant', text: 'done' }] } } });
  assert(!elements.prompt.disabled && elements.stop.disabled && elements.prompt.focused);
  assert(!elements.clear.disabled);
  elements.clear.events.click();
  assert.equal(messages.at(-1).type, 'clear');
  receive({ data: { type: 'askState', state: { active: false, entries: [] } } });
  assert.equal(elements.transcript.children.length, 0, 'Clear must remove rendered lines, not only the state');
  let inbound, dispose; const posted = [];
  const view = new AskView(); let asked, stopped = false, cleared = false;
  view.onAsk = text => { asked = text; }; view.onStop = () => { stopped = true; };
  view.onClear = () => { cleared = true; };
  view.focus();
  const fake = { webview: { onDidReceiveMessage(fn) { inbound = fn; return { dispose() {} }; },
    postMessage(value) { posted.push(value); return Promise.resolve(true); } }, onDidDispose(fn) { dispose = fn; } };
  view.update({ active: false, entries: [{ id: 1, kind: 'user', text: 'earlier' }] });
  view.resolveWebviewView(fake); const initialHtml = fake.webview.html;
  inbound({ type: 'ready' });
  assert(posted.some(m => m.type === 'focus'));
  assert(posted.some(m => m.type === 'askState' && m.state.entries[0].text === 'earlier'));
  inbound({ type: 'ask', text: 'prove this' }); inbound({ type: 'stop' }); inbound({ type: 'clear' });
  assert.equal(asked, 'prove this'); assert(stopped); assert(cleared);
  view.update({ active: false, entries: [{ id: 1, kind: 'user', text: 'earlier' }] });
  assert.equal(fake.webview.html, initialHtml, 'Transcript updates must not reload the webview');
  dispose(); view.resolveWebviewView(fake); inbound({ type: 'ready' });
  assert(posted.findLast(message => message.type === 'askState').state.entries[0].text === 'earlier');
  const goals = new GoalsView();
  goals.resolveWebviewView(fake);
  const goalScript = goalsHtml(state, 'goalnonce').match(/<script nonce="goalnonce">([\s\S]+)<\/script>/)[1];
  vm.runInNewContext(goalScript, {
    document: { getElementById: id => elements[id], querySelector: key => elements[key], body: { classList: { toggle() {} } } },
    window: { addEventListener: (_, callback) => { receive = callback; } },
    acquireVsCodeApi: () => ({ postMessage: value => messages.push(value) }),
  });
  let opened, hovered;
  goals.onNavigate = async link => { opened = link; };
  goals.onHover = async link => { hovered = link; return 'editor hover'; };
  goals.update({ ...state, html:'<a href="file:/tmp/Target.thy#3">target</a>' });
  const current = goals.linkSnapshot();
  await goals.followLink(0,current.revision-1);assert.equal(opened,undefined);
  await goals.followLink(0,current.revision);assert.equal(opened.line,2);
  assert.equal(await goals.hoverLink(0,current.revision),'editor hover');
  goals.update({ ...state, phase:'checking',html:'<a href="file:/tmp/Target.thy#3">target</a>' });
  assert.equal(goals.linkSnapshot().links.length,0);
  // Actual inline script: only modified clicks navigate; hover asks the host.
  const anchor={ classList:['isabelle-entity','isabelle-link-0'],closest(){return this;},title:'' };
  elements.goal.contains=()=>true;elements.goal.querySelector=()=>anchor;
  receive({data:{type:'goal',revision:7,goal:{theory:'Demo',status:'ready',phase:'ready',text:'x',html:'<a>x</a>',errors:''}}});
  const click={target:anchor,ctrlKey:false,metaKey:false,preventDefault(){}};
  const count=messages.length;elements.goal.events.click(click);assert.equal(messages.length,count);
  elements.goal.events.click({...click,ctrlKey:true});assert.equal(messages.at(-1).action,'open');assert.equal(messages.at(-1).revision,7);
  elements.goal.events.mouseover({target:anchor});assert.equal(messages.at(-1).action,'hover');
  receive({data:{type:'goalHover',revision:6,index:0,text:'stale'}});assert.notEqual(anchor.title,'stale');
  receive({data:{type:'goalHover',revision:7,index:0,text:'editor hover'}});assert.equal(anchor.title,'editor hover');
  console.log('PASS: Ask webview Enter/newline/IME, disabled controls, Stop, focus command, retained draft/transcript, and escaped streamed text');
};
