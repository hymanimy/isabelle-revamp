theory Sqrt2
  imports Complex_Main
begin

text \<open>A reduced fraction cannot have both numerator and denominator even.\<close>

theorem sqrt2_irrational: "sqrt (2 :: real) \<notin> \<rat>"
proof
  assume rational: "sqrt (2 :: real) \<in> \<rat>"
  then obtain m n :: nat
    where denominator: "n \<noteq> 0"
      and fraction: "\<bar>sqrt (2 :: real)\<bar> = m / n"
      and reduced: "coprime m n"
    by (rule Rats_abs_nat_div_natE)

  text \<open>Clear the denominator and square the equation.\<close>
  have root_squared: "(sqrt (2 :: real)) ^ 2 = 2"
    by simp
  have scaled: "(m :: real) = sqrt 2 * n"
    using denominator fraction by simp
  have squared_real: "(m :: real) ^ 2 = 2 * (n :: real) ^ 2"
    using scaled root_squared by (simp add: power_mult_distrib)
  have squared: "m ^ 2 = 2 * n ^ 2"
    using squared_real by (simp flip: of_nat_mult of_nat_power)

  text \<open>An even square has an even root, so write the numerator as twice k.\<close>
  have numerator_even: "even m"
  proof -
    have "even (m ^ 2)" using squared by simp
    then show ?thesis by simp
  qed
  then obtain k :: nat where numerator: "m = 2 * k"
    by (auto elim: evenE)

  text \<open>Substitution forces the denominator to be even as well.\<close>
  have denominator_squared: "n ^ 2 = 2 * k ^ 2"
    using squared numerator by (simp add: power2_eq_square)
  have denominator_even: "even n"
  proof -
    have "even (n ^ 2)" using denominator_squared by simp
    then show ?thesis by simp
  qed

  text \<open>But a common factor of two contradicts the fraction being reduced.\<close>
  have common_factor: "2 dvd gcd m n"
    using numerator_even denominator_even by simp
  have impossible: "(2 :: nat) dvd 1"
    using common_factor reduced by simp
  then show False
    by simp
qed

end
