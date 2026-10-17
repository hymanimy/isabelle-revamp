// Use the installed editor's TextMate and Oniguruma, not a second tokenizer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

exports.checkHighlighting = async function (app) {
  const textmate = require(path.join(app, 'node_modules.asar/vscode-textmate'));
  const onig = require(path.join(app, 'node_modules.asar/vscode-oniguruma'));
  const wasm = fs.readFileSync(path.join(app, 'node_modules.asar.unpacked/vscode-oniguruma/release/onig.wasm'));
  await onig.loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength));
  const extension = path.resolve(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'package.json'), 'utf8'));
  const contribution = manifest.contributes.grammars.find(item => item.language === 'isabelle');
  assert(manifest.contributes.languages.find(item => item.id === 'isabelle').extensions.includes('.thy'));
  const registry = new textmate.Registry({
    onigLib: Promise.resolve({ createOnigScanner: onig.createOnigScanner, createOnigString: onig.createOnigString }),
    loadGrammar: async () => JSON.parse(fs.readFileSync(path.join(extension, contribution.path), 'utf8')),
  });
  try {
    const grammar = await registry.loadGrammar(contribution.scopeName);
    const tokenize = (line, state = textmate.INITIAL) => grammar.tokenizeLine(line, state);
    const has = (result, scope) => result.tokens.some(token => token.scopes.includes(scope));
    const keywords = 'theory imports begin end lemma theorem proof qed by have show from then hence thus obtain assume fix using unfolding also finally sorry oops text where and'.split(' ');
    for (const word of keywords) assert(has(tokenize(word), 'keyword.control.isabelle'), word);
    for (const name of ["theory'", 'proof_lemma', 'Some.proof', "'theory", 'αproof', 'proofβ']) {
      assert(!has(tokenize(name), 'keyword.control.isabelle'), 'Identifier mistaken for keyword: ' + name);
    }
    for (const symbol of ['\\<notin>', '\\<rat>', '\\<forall>', '\\<Rightarrow>', '\\<^sub>']) {
      for (const line of [symbol, '"' + symbol + '"']) {
        assert(has(tokenize(line), 'constant.character.escape.isabelle'), line);
      }
    }
    for (const symbol of ['∉', '∀', '⇒', '√']) assert(has(tokenize(symbol), 'keyword.operator.isabelle'), symbol);
    assert(has(tokenize('ℚ'), 'constant.language.isabelle'));
    for (const line of ['"show theorem"', String.raw`"escaped \" proof"`,
      '(* proof (* nested *) show *)', '‹show ‹theorem› qed›',
      String.raw`\<open>show \<open>theorem\<close> qed\<close>`]) {
      assert(!has(tokenize(line), 'keyword.control.isabelle'), line);
    }
    // Multi-line contexts must resume the outer grammar at their closing token.
    for (const [opening, closing] of [['(* nested (*', '*) *)'], ['‹‹', '››'],
      [String.raw`\<open>\<open>`, String.raw`\<close>\<close>`], ['"', '"']]) {
      let state = tokenize(opening).ruleStack;
      assert(!has(tokenize('show', state), 'keyword.control.isabelle'));
      state = tokenize(closing, state).ruleStack;
      assert(has(tokenize('show', state), 'keyword.control.isabelle'));
    }
    let state = textmate.INITIAL;
    let commands = 0;
    const source = fs.readFileSync(path.join(extension, '../examples/Sqrt2.thy'), 'utf8');
    for (const line of source.split('\n')) {
      const result = tokenize(line, state);
      state = result.ruleStack;
      const firstWord = /^\s*([a-z]+)/.exec(line)?.[1];
      if (keywords.includes(firstWord)) {
        assert(has(result, 'keyword.control.isabelle'), line);
        commands++;
      }
      if (line.trimStart().startsWith('text ')) assert(has(result, 'string.quoted.other.isabelle'), line);
    }
    assert(commands > 30);
    assert.equal(state.depth, textmate.INITIAL.depth, 'Highlighting leaked past the final end');

    // Resolve actual built-in theme inheritance and compare token presentation.
    function theme(file) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      return { settings: [...(data.include ? theme(path.resolve(path.dirname(file), data.include)).settings : []),
        ...(data.tokenColors ?? [])] };
    }
    for (const name of ['dark_plus', 'light_plus', 'hc_black', 'hc_light']) {
      registry.setTheme(theme(path.join(app, 'extensions/theme-defaults/themes/' + name + '.json')));
      // TextMate's encoded token foreground occupies bits 15–23. Compare the
      // colour, not token-type bits (which alone distinguish strings).
      const style = word => (grammar.tokenizeLine2(word, textmate.INITIAL).tokens[1] & 16744448) >>> 15;
      assert.notEqual(style('theorem'), style('sqrt2_irrational'), name + ': keywords need a distinct style');
      assert.notEqual(style('"a string"'), style('sqrt2_irrational'), name + ': strings need a distinct style');
    }
    console.log(`PASS: VS Code TextMate grammar, ${keywords.length} keywords, ${commands} demo command lines, symbols, contexts, and four built-in themes`);
  } finally { registry.dispose(); }
};
