theory blank
  imports Complex_Main
begin

text \<open>The chain rule, from the limit definition of the derivative. Nothing below
  appeals to the library's own composition rules --- no \<open>DERIV_chain\<close>, no
  \<open>has_derivative_compose\<close>, no \<open>derivative_intros\<close>. What is borrowed is the limit form
  of the derivative, continuity of a composite of continuous maps, and algebra.\<close>

text \<open>Caratheodory's characterisation: f is differentiable at x with derivative l exactly
  when the increment f z - f x factors as q z * (z - x) for some q that is continuous at x
  and takes the value l there. The witness is the difference quotient itself, patched at
  z = x, where it would otherwise divide by zero.\<close>

lemma caratheodory_iff:
  fixes f :: "'a::real_normed_field \<Rightarrow> 'a"
  shows "(f has_field_derivative l) (at x) \<longleftrightarrow>
         (\<exists>q. (\<forall>z. f z - f x = q z * (z - x)) \<and> isCont q x \<and> q x = l)"
proof
  assume derivative: "(f has_field_derivative l) (at x)"
  define q where "q = (\<lambda>z. if z = x then l else (f z - f x) / (z - x))"
  have factors: "f z - f x = q z * (z - x)" for z
    by (cases "z = x") (simp_all add: q_def)
  have quotient_limit: "((\<lambda>z. (f z - f x) / (z - x)) \<longlongrightarrow> l) (at x)"
    using derivative by (simp add: has_field_derivative_iff)
  have agrees: "\<forall>\<^sub>F z in at x. (f z - f x) / (z - x) = q z"
    by (simp add: q_def eventually_at_filter)
  have witness_cont: "isCont q x"
    using quotient_limit agrees by (simp add: isCont_def q_def tendsto_cong)
  have bundled: "(\<forall>z. f z - f x = q z * (z - x)) \<and> isCont q x \<and> q x = l"
    using factors witness_cont by (simp add: q_def)
  show "\<exists>q. (\<forall>z. f z - f x = q z * (z - x)) \<and> isCont q x \<and> q x = l"
    using bundled by blast
next
  assume "\<exists>q. (\<forall>z. f z - f x = q z * (z - x)) \<and> isCont q x \<and> q x = l"
  then obtain q where factors: "\<And>z. f z - f x = q z * (z - x)"
    and witness_cont: "isCont q x" and witness_value: "q x = l"
    by blast
  have agrees: "\<forall>\<^sub>F z in at x. q z = (f z - f x) / (z - x)"
    using factors by (simp add: eventually_at_filter)
  have limit: "(q \<longlongrightarrow> l) (at x)"
    using witness_cont witness_value by (simp add: isCont_def)
  have quotient_limit: "((\<lambda>z. (f z - f x) / (z - x)) \<longlongrightarrow> l) (at x)"
    using limit agrees by (simp add: tendsto_cong)
  show "(f has_field_derivative l) (at x)"
    using quotient_limit by (simp add: has_field_derivative_iff)
qed

text \<open>With that, the chain rule needs no limits at all: multiply the two factorisations.
  The composite factor is continuous at x because g is continuous there --- being
  differentiable --- and takes the value f' * g'.\<close>

theorem chain_rule:
  fixes f g :: "'a::real_normed_field \<Rightarrow> 'a"
  assumes inner: "(g has_field_derivative g') (at x)"
      and outer: "(f has_field_derivative f') (at (g x))"
  shows "((\<lambda>x. f (g x)) has_field_derivative f' * g') (at x)"
proof -
  obtain qf where outer_factors: "\<And>z. f z - f (g x) = qf z * (z - g x)"
    and outer_cont: "isCont qf (g x)" and outer_at: "qf (g x) = f'"
    using outer caratheodory_iff by blast
  obtain qg where inner_factors: "\<And>z. g z - g x = qg z * (z - x)"
    and inner_cont: "isCont qg x" and inner_at: "qg x = g'"
    using inner caratheodory_iff by blast
  define q where "q = (\<lambda>z. qf (g z) * qg z)"
  have factors: "f (g z) - f (g x) = q z * (z - x)" for z
  proof -
    have outer_step: "f (g z) - f (g x) = qf (g z) * (g z - g x)"
      by (rule outer_factors)
    have inner_step: "g z - g x = qg z * (z - x)"
      by (rule inner_factors)
    show ?thesis
      using outer_step inner_step by (simp add: q_def mult.assoc)
  qed
  have path_cont: "isCont g x"
    using inner by (simp add: DERIV_continuous)
  have composed_cont: "isCont (\<lambda>z. qf (g z)) x"
    using path_cont outer_cont by (rule isCont_o2)
  have factor_cont: "isCont q x"
    using composed_cont inner_cont by (simp add: q_def)
  have factor_at: "q x = f' * g'"
    using outer_at inner_at by (simp add: q_def)
  show ?thesis
    using factors factor_cont factor_at caratheodory_iff by blast
qed

text \<open>A worked example: differentiate x squared, cubed, through the rule just proved.\<close>

lemma square_derivative:
  fixes x :: real
  shows "((\<lambda>x. x ^ 2) has_field_derivative 2 * x) (at x)"
  using DERIV_power[of "\<lambda>w. w" 1 x UNIV 2] by simp

lemma cube_derivative:
  fixes w :: real
  shows "((\<lambda>w. w ^ 3) has_field_derivative 3 * w ^ 2) (at w)"
  using DERIV_power[of "\<lambda>w. w" 1 w UNIV 3] by simp

corollary sixth_power_derivative:
  fixes x :: real
  shows "((\<lambda>x. x ^ 6) has_field_derivative 6 * x ^ 5) (at x)"
proof -
  have composed: "((\<lambda>x. (x ^ 2) ^ 3) has_field_derivative 3 * (x ^ 2) ^ 2 * (2 * x)) (at x)"
    by (rule chain_rule[OF square_derivative cube_derivative])
  show ?thesis
    using composed by (simp add: eval_nat_numeral power_mult algebra_simps)
qed

end
