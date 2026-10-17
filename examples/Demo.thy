theory Demo
  imports Complex_Main
begin

text \<open>The sum of two consecutive odd numbers is a multiple of four.\<close>

theorem consecutive_odds:
  fixes n :: nat
  shows "(2 * n + 1) + (2 * (n + 1) + 1) = 4 * (n + 1)"
proof -
  have expand: "(2 * n + 1) + (2 * (n + 1) + 1) = 4 * n + 4"
    sorry
  have factor: "4 * n + 4 = 4 * (n + 1)"
    sorry
  have result: "(2 * n + 1) + (2 * (n + 1) + 1) = 4 * (n + 1)"
    sorry
  thus ?thesis .
qed

text \<open>The square root of three is irrational.\<close>

theorem sqrt_3_irrational: "sqrt 3 \<notin> \<rat>"
proof
  assume "sqrt 3 \<in> \<rat>"
  then obtain m n :: nat where n_pos: "n \<noteq> 0"
    and eq: "\<bar>sqrt 3\<bar> = real m / real n"
    and cop: "coprime m n"
    by (rule Rats_abs_nat_div_natE)
  have three_dvd: "3 dvd a" if h: "3 dvd a^2" for a :: nat
  proof -
    have mod_sq: "a^2 mod 3 = (a mod 3)^2 mod 3"
      by (simp add: power_mod)
    have sq_zero: "a^2 mod 3 = 0"
      using h by (simp add: dvd_eq_mod_eq_0)
    have "a mod 3 < 3"
      by simp
    then have "a mod 3 = 0 \<or> a mod 3 = 1 \<or> a mod 3 = 2"
      by arith
    then have "a mod 3 = 0"
      using mod_sq sq_zero by auto
    then show "3 dvd a"
      by (simp add: dvd_eq_mod_eq_0)
  qed
  have sqrt_abs: "\<bar>sqrt 3\<bar> = sqrt 3"
    by (simp add: abs_of_nonneg)
  have "sqrt 3 = real m / real n"
    using eq sqrt_abs by simp
  then have real_eq: "real m = sqrt 3 * real n"
    using n_pos by (simp add: field_simps)
  have sq_eq: "real (m^2) = real (3 * n^2)"
  proof -
    have "real (m^2) = (sqrt 3 * real n)^2"
      using real_eq by simp
    also have "\<dots> = 3 * (real n)^2"
      by (simp add: power_mult_distrib)
    also have "\<dots> = real (3 * n^2)"
      by simp
    finally show ?thesis .
  qed
  have key: "m^2 = 3 * n^2"
    using sq_eq by (simp only: of_nat_eq_iff)
  have "3 dvd m^2"
    using key by simp
  then have dvd_m: "3 dvd m"
    by (rule three_dvd)
  then obtain k where k: "m = 3 * k"
    by (rule dvdE)
  have "3 * n^2 = m^2"
    using key by simp
  also have "\<dots> = 9 * k^2"
    using k by (simp add: power_mult_distrib)
  finally have "n^2 = 3 * k^2"
    by linarith
  then have "3 dvd n^2"
    by simp
  then have dvd_n: "3 dvd n"
    by (rule three_dvd)
  have "3 dvd gcd m n"
    using dvd_m dvd_n by (rule gcd_greatest)
  then have "(3::nat) dvd 1"
    using cop by (simp add: coprime_iff_gcd_eq_1)
  then have "(3::nat) \<le> 1"
    by (rule dvd_imp_le) simp
  then show False
    by simp
qed

end
