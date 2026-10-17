theory Swarm
  imports Complex_Main
begin

text \<open>The first n odd numbers add up to a square.\<close>

theorem sum_first_odds: "(\<Sum>i<n. 2 * i + 1) = (n::nat)^2"
proof -
  have base: "(\<Sum>i<0. 2 * i + 1) = (0::nat)^2"
    by simp

  have next_sum: "\<And>k::nat. (\<Sum>i<Suc k. 2 * i + 1) = (\<Sum>i<k. 2 * i + 1) + (2 * k + 1)"
    by simp

  have next_square: "\<And>k::nat. k^2 + (2 * k + 1) = (Suc k)^2"
    by (simp add: power2_eq_square)

  have induction_step: "\<And>k::nat. (\<Sum>i<k. 2 * i + 1) = k^2 \<Longrightarrow> (\<Sum>i<Suc k. 2 * i + 1) = (Suc k)^2"
  proof -
    fix k :: nat
    assume ih: "(\<Sum>i<k. 2 * i + 1) = k^2"
    have "(\<Sum>i<Suc k. 2 * i + 1) = k^2 + (2 * k + 1)"
      by (simp only: next_sum ih)
    also have "\<dots> = (Suc k)^2"
      by (rule next_square)
    finally show "(\<Sum>i<Suc k. 2 * i + 1) = (Suc k)^2" .
  qed

  have all_n: "(\<Sum>i<k. 2 * i + 1) = k^2" for k :: nat
  proof (induct k)
    case 0
    show ?case by (rule base)
  next
    case (Suc k)
    show ?case by (rule induction_step[OF Suc])
  qed

  have result: "(\<Sum>i<n. 2 * i + 1) = n^2"
    by (rule all_n)
  thus ?thesis .
qed

end
