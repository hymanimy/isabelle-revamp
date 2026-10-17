theory Sqrt2
  imports Complex_Main "HOL-Computational_Algebra.Primes"
begin

text \<open>Euclid: for every bound n, a prime factor of n! + 1 lies above n.\<close>

lemma fact_succ_ne_one: "fact n + 1 \<noteq> (1 :: nat)"
  by simp

lemma fact_succ_has_prime_factor: "\<exists>p. prime p \<and> p dvd fact n + (1 :: nat)"
  using fact_succ_ne_one prime_factor_nat by blast

lemma small_prime_dvd_fact: "prime p \<Longrightarrow> p \<le> n \<Longrightarrow> p dvd fact (n :: nat)"
  using prime_gt_0_nat[of p] dvd_fact[of p n] try0
  sorry

lemma prime_factor_above_bound: "prime p \<Longrightarrow> p dvd fact n + 1 \<Longrightarrow> n < (p :: nat)"
  using small_prime_dvd_fact[of p n] dvd_add_right_iff[of p "fact n" 1] not_le by fastforce

lemma prime_above_bound: "\<exists>p. prime p \<and> n < (p :: nat)"
  using fact_succ_has_prime_factor prime_factor_above_bound by blast

theorem infinitely_many_primes: "infinite {p :: nat. prime p}"
  using prime_above_bound finite_nat_set_iff_bounded try0
  sorry

end
