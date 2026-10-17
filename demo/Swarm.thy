theory Swarm
  imports Complex_Main
begin

text \<open>The first n odd numbers add up to a square.\<close>

theorem sum_first_odds: "(\<Sum>i<n. 2 * i + 1) = (n::nat)^2"
proof -
  have base: "(\<Sum>i<0. 2 * i + 1) = (0::nat)^2"
    sorry

  have next_sum: "\<And>k::nat. (\<Sum>i<Suc k. 2 * i + 1) = (\<Sum>i<k. 2 * i + 1) + (2 * k + 1)"
    sorry

  have next_square: "\<And>k::nat. k^2 + (2 * k + 1) = (Suc k)^2"
    sorry

  have induction_step: "\<And>k::nat. (\<Sum>i<k. 2 * i + 1) = k^2 \<Longrightarrow> (\<Sum>i<Suc k. 2 * i + 1) = (Suc k)^2"
    sorry

  have all_n: "\<And>k::nat. (\<Sum>i<k. 2 * i + 1) = k^2"
    sorry

  have result: "(\<Sum>i<n. 2 * i + 1) = n^2"
    sorry
  thus ?thesis .
qed

end
