theory Sqrt4_solution
  imports Complex_Main
begin

lemma sqrt4_irrational_refuted: "sqrt (4::real) \<in> \<rat>"
proof -
  have root: "sqrt (4::real) = 2"
    by simp
  have rational: "(2::real) \<in> \<rat>"
    by simp
  from root rational show ?thesis
    by simp
qed

end
