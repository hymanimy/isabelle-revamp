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
    const keywords = 'theory imports begin end lemma theorem proof qed by have show from then hence thus obtain assume fix using unfolding also finally sorry oops text where and case next with definition datatype locale context apply done let note ultimately moreover'.split(' ');
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
    // Roles within commands: names, labels, methods, facts, admissions and prose.
    const scopesOf = (line, text) => {
      const result = tokenize(line);
      const token = result.tokens.find(token => line.slice(token.startIndex, token.endIndex) === text);
      assert(token, `No token ${text} in ${line}`);
      return token.scopes;
    };
    const role = (line, text, scope) => assert(scopesOf(line, text).includes(scope), `${text} in ${line}: ${scope}`);
    for (const word of ['sorry', 'oops']) role(word, word, 'invalid.illegal.admission.isabelle');
    for (const word of ['theorem', 'lemma', 'definition', 'theory', 'begin', 'end']) role(word, word, 'storage.type.isabelle');
    for (const word of ['have', 'show', 'obtain']) assert(!scopesOf(word, word).includes('storage.type.isabelle'), word);
    role('theorem sqrt2_irrational: "x"', 'sqrt2_irrational', 'entity.name.function.theorem.isabelle');
    role('lemma foo [simp]: "x"', 'foo', 'entity.name.function.theorem.isabelle');
    assert(!has(tokenize('lemma assumes "x"'), 'entity.name.function.theorem.isabelle'));
    role('  assume rational: "x"', 'rational', 'entity.name.label.fact.isabelle');
    role('    where denominator: "x"', 'denominator', 'entity.name.label.fact.isabelle');
    assert(!has(tokenize('  then obtain m n :: nat'), 'entity.name.label.fact.isabelle'));
    role('    by simp', 'simp', 'support.function.method.isabelle');
    role('by (simp add: power_mult_distrib)', 'simp', 'support.function.method.isabelle');
    role('by (simp add: power_mult_distrib)', 'add', 'keyword.other.modifier.isabelle');
    role('by (simp add: power_mult_distrib)', 'power_mult_distrib', 'variable.other.fact.isabelle');
    assert(!has(tokenize('by (simp add: power_mult_distrib)'), 'entity.name.label.fact.isabelle'));
    role('by (auto elim: evenE)', 'elim', 'keyword.other.modifier.isabelle');
    role('  using prime_above_bound try0', 'try0', 'storage.type.isabelle');
    role('  using denominator fraction by simp', 'fraction', 'variable.other.fact.isabelle');
    role('  using denominator fraction by simp', 'by', 'keyword.control.isabelle');
    role('  using denominator fraction by simp', 'simp', 'support.function.method.isabelle');
    role('text ‹A proof by contradiction›', 'A proof by contradiction', 'comment.block.documentation.isabelle');
    assert(!has(tokenize('text ‹A proof by contradiction›'), 'support.function.method.isabelle'));
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
      // hc_light already draws keyword.control in its invalid red; workspace colours separate them there.
      if (name !== 'hc_light') assert.notEqual(style('sorry'), style('have'), name + ': admissions need a distinct style');
    }
    console.log(`PASS: VS Code TextMate grammar, ${keywords.length} keywords, ${commands} demo command lines, symbols, contexts, and four built-in themes`);
  } finally { registry.dispose(); }
};
