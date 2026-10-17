const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { proofSteps } = require('../out/isarSteps');

exports.checkSteps = function () {
  for (const file of ['Swarm.thy', 'Swarm_solution.thy']) {
    const source = fs.readFileSync(path.join(__dirname, '../../examples', file), 'utf8');
    const cards = proofSteps(source, 0);
    assert.deepEqual(cards.map(card => card.label), ['base', 'next_sum', 'next_square', 'induction_step', 'all_n', 'result']);
    assert(cards.every(card => card.closed && source.slice(card.start, card.commandEnd) === 'have'));
    assert(cards.every((card, i) => !i || card.start > cards[i - 1].end));
  }
  const source = String.raw`theory Test imports Main begin
text \<open>have fake: "False" sorry \<open>show\<close>\<close>
(* theorem Fake proof (* have fake *) qed *)
lemma first: "True"
proof -
  have named: "True"
  proof -
    have hidden: "True" by simp
    show ?thesis by simp
  qed
  (* have fake: "False" sorry *)
  obtain x where "x = (0::nat)" by simp
  have "True" by simp
  also
  finally show ?thesis by simp
qed
lemma second: "True"
proof -
  have other: "True" sorry
  thus ?thesis .
qed
end`;
  const cards = proofSteps(source, source.indexOf('have named'));
  assert.deepEqual(cards.map(card => card.command), ['have', 'obtain', 'have', 'also', 'finally', 'show']);
  assert.equal(cards[0].label, 'named');
  assert.equal(cards[2].label, 'True');
  assert(cards.every(card => !card.label.includes('hidden') && !card.label.includes('fake')));
  assert.deepEqual(proofSteps(source, source.indexOf('have other')).map(card => card.label), ['other']);
  const incomplete = 'lemma x: "True"\nproof -\n have open_goal: "True"\n';
  assert.equal(proofSteps(incomplete, 0)[0].closed, false);
  console.log('PASS: six named cards, nested proof exclusion, current theorem, opaque prose, and incomplete steps');
};
