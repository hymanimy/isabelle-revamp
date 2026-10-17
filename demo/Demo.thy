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

end
