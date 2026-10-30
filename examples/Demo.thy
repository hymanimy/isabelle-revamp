theory Demo
  imports Main
begin

section \<open>Lists\<close>

lemma rev_append_example: "rev (xs @ ys) = rev ys @ rev xs"
  by simp

lemma length_rev_example: "length (rev xs) = length xs"
  by simp

section \<open>Arithmetic\<close>

fun sum_odd :: "nat \<Rightarrow> nat" where
  "sum_odd 0 = 0"
| "sum_odd (Suc n) = sum_odd n + (2 * n + 1)"

lemma sum_odd_square: "sum_odd n = n * n"
  by (induction n) auto

text \<open>Unfinished: try Isabelle: Sledgehammer, or using sum_odd_square try0, here.\<close>

lemma sum_odd_double: "sum_odd n + sum_odd n = 2 * n * n"
  sorry

end
