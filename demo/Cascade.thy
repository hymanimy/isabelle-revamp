theory Cascade
  imports Main
begin

text \<open>A rational square root of a natural number is an integer.
  Main has no real-number type: a/b is represented by natural witnesses,
  b > 0 and a squared = n times b squared. We reduce the fraction, cancel
  the common square, and prove that the reduced denominator is one.\<close>

theorem rational_square_root:
  fixes n a b :: nat
  assumes denominator: "0 < b"
    and square: "a^2 = n * b^2"
  shows "\<exists>k::nat. n = k^2"
proof -
  let ?g = "gcd a b"
  let ?p = "a div ?g"
  let ?q = "b div ?g"

  have reduction: "0 < ?g \<and> a = ?g * ?p \<and> b = ?g * ?q \<and> coprime ?p ?q"
  proof -
    have denominator_nonzero: "b \<noteq> 0"
      using denominator sorry
    have common_positive: "0 < ?g"
    proof -
      have not_both_zero: "a \<noteq> 0 \<or> b \<noteq> 0"
        using denominator_nonzero sorry
      show ?thesis
        using not_both_zero sorry
    qed
    have numerator_rebuild: "a = ?g * ?p"
    proof -
      have numerator_divides: "?g dvd a"
        sorry
      have numerator_cancel: "?g * (a div ?g) = a"
        using numerator_divides sorry
      show ?thesis
        using numerator_cancel sorry
    qed
    have denominator_rebuild: "b = ?g * ?q"
    proof -
      have denominator_divides: "?g dvd b"
        sorry
      have denominator_cancel: "?g * (b div ?g) = b"
        using denominator_divides sorry
      show ?thesis
        using denominator_cancel sorry
    qed
    have reduced_coprime: "coprime ?p ?q"
    proof -
      have nonzero_pair: "a \<noteq> 0 \<or> b \<noteq> 0"
        using denominator_nonzero sorry
      have cancellation: "coprime (a div gcd a b) (b div gcd a b)"
        using nonzero_pair sorry
      show ?thesis
        using cancellation sorry
    qed
    show ?thesis
      using common_positive numerator_rebuild denominator_rebuild reduced_coprime sorry
  qed

  have reduced_square: "?p^2 = n * ?q^2"
  proof -
    have common_nonzero: "?g \<noteq> 0"
      using reduction sorry
    have common_square_nonzero: "?g^2 \<noteq> 0"
      using common_nonzero sorry
    have numerator_expansion: "a^2 = ?g^2 * ?p^2"
    proof -
      have numerator_factor: "a = ?g * ?p"
        using reduction sorry
      have numerator_power: "(?g * ?p)^2 = ?g^2 * ?p^2"
        sorry
      show ?thesis
        using numerator_factor numerator_power sorry
    qed
    have denominator_expansion: "b^2 = ?g^2 * ?q^2"
    proof -
      have denominator_factor: "b = ?g * ?q"
        using reduction sorry
      have denominator_power: "(?g * ?q)^2 = ?g^2 * ?q^2"
        sorry
      show ?thesis
        using denominator_factor denominator_power sorry
    qed
    have scaled_equality: "?g^2 * ?p^2 = n * (?g^2 * ?q^2)"
      using square numerator_expansion denominator_expansion sorry
    have reorder: "n * (?g^2 * ?q^2) = ?g^2 * (n * ?q^2)"
      sorry
    have cancellable: "?g^2 * ?p^2 = ?g^2 * (n * ?q^2)"
      using scaled_equality reorder sorry
    show ?thesis
      using common_square_nonzero cancellable sorry
  qed

  have denominator_one: "?q = 1"
  proof -
    have coprime_squares: "coprime (?p^2) (?q^2)"
    proof -
      have reduced_pair: "coprime ?p ?q"
        using reduction sorry
      have square_left: "coprime (?p^2) ?q"
        using reduced_pair sorry
      show ?thesis
        using square_left sorry
    qed
    have denominator_dvd: "?q^2 dvd ?p^2"
    proof -
      have divides_product: "?q^2 dvd n * ?q^2"
        sorry
      show ?thesis
        using divides_product reduced_square sorry
    qed
    have square_is_one: "?q^2 = 1"
    proof -
      have divides_itself: "?q^2 dvd ?q^2"
        sorry
      have common_is_unit: "is_unit (?q^2)"
        using coprime_squares denominator_dvd divides_itself sorry
      show ?thesis
        using common_is_unit sorry
    qed
    show ?thesis
      using square_is_one sorry
  qed

  have integer_square: "n = ?p^2"
  proof -
    have denominator_square: "?q^2 = 1"
      using denominator_one sorry
    have simplify_fraction: "n * ?q^2 = n"
      using denominator_square sorry
    show ?thesis
      using reduced_square simplify_fraction sorry
  qed
  show ?thesis
    using integer_square sorry
qed

end
