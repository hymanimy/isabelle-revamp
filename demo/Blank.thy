theory blank
  imports Complex_Main
begin

text \<open>Cauchy's integral theorem, in the form that needs no integration theory.
  Complex_Main carries derivatives but no integral, so the contour integral is
  characterised by the fundamental theorem of calculus instead of being built.
  The general holomorphic-on-a-domain version lives in HOL-Analysis.\<close>

text \<open>The analytic heart: a primitive of f, composed with the path, differentiates to
  the integrand f (g t) * g' t. This is the chain rule across the two kinds of
  derivative Complex_Main offers --- field derivative for F, vector derivative for g.\<close>

lemma primitive_along_path:
  fixes F :: "complex \<Rightarrow> complex" and g :: "real \<Rightarrow> complex"
  assumes primitive: "(F has_field_derivative f (g t)) (at (g t))"
      and path: "(g has_vector_derivative g') (at t)"
  shows "((\<lambda>t. F (g t)) has_vector_derivative f (g t) * g') (at t)"
proof -
  have path_derivative: "(g has_derivative (\<lambda>h. h *\<^sub>R g')) (at t)"
    using path by (simp add: has_vector_derivative_def)
  have primitive_derivative: "(F has_derivative (*) (f (g t))) (at (g t))"
    using primitive by (simp add: has_field_derivative_def)
  have composed: "((\<lambda>t. F (g t)) has_derivative (\<lambda>h. f (g t) * (h *\<^sub>R g'))) (at t)"
    using has_derivative_compose[OF path_derivative primitive_derivative] by simp
  show ?thesis
    using composed by (simp add: has_vector_derivative_def scaleR_conv_of_real algebra_simps)
qed

text \<open>A complex-valued function of a real parameter whose derivative vanishes on the unit
  interval is constant there: apply the mean value theorem to its real and imaginary parts.\<close>

lemma vanishing_derivative_constant:
  fixes H :: "real \<Rightarrow> complex"
  assumes deriv: "\<And>t. t \<in> {0..1} \<Longrightarrow> (H has_vector_derivative 0) (at t)"
  shows "H 1 = H 0"
proof -
  have real_part: "\<And>t. t \<in> {0..1} \<Longrightarrow> DERIV (\<lambda>t. Re (H t)) t :> 0"
    using bounded_linear.has_vector_derivative[OF bounded_linear_Re deriv]
    by (simp add: has_real_derivative_iff_has_vector_derivative)
  have imag_part: "\<And>t. t \<in> {0..1} \<Longrightarrow> DERIV (\<lambda>t. Im (H t)) t :> 0"
    using bounded_linear.has_vector_derivative[OF bounded_linear_Im deriv]
    by (simp add: has_real_derivative_iff_has_vector_derivative)
  have real_cont: "continuous_on {0..1} (\<lambda>t. Re (H t))"
    using real_part by (metis DERIV_continuous continuous_at_imp_continuous_on)
  have imag_cont: "continuous_on {0..1} (\<lambda>t. Im (H t))"
    using imag_part by (metis DERIV_continuous continuous_at_imp_continuous_on)
  have real_equal: "Re (H 1) = Re (H 0)"
    by (rule DERIV_isconst_end[OF zero_less_one real_cont]) (use real_part in auto)
  have imag_equal: "Im (H 1) = Im (H 0)"
    by (rule DERIV_isconst_end[OF zero_less_one imag_cont]) (use imag_part in auto)
  show ?thesis
    using real_equal imag_equal by (rule complex_eqI)
qed

text \<open>Cauchy's integral theorem. The contour integral is not constructed here --- it enters
  through the property that characterises it, the fundamental theorem of calculus: I is any
  function whose derivative along the path is the integrand. The conclusion is that its net
  change around a closed path is zero, whichever such I and whichever primitive F.\<close>

theorem cauchy_integral_theorem_primitive_form:
  fixes f F :: "complex \<Rightarrow> complex" and g :: "real \<Rightarrow> complex" and I :: "real \<Rightarrow> complex"
  assumes primitive: "\<And>t. t \<in> {0..1} \<Longrightarrow> (F has_field_derivative f (g t)) (at (g t))"
      and path: "\<And>t. t \<in> {0..1} \<Longrightarrow> (g has_vector_derivative g' t) (at t)"
      and integral: "\<And>t. t \<in> {0..1} \<Longrightarrow> (I has_vector_derivative f (g t) * g' t) (at t)"
      and closed: "g 1 = g 0"
  shows "I 1 - I 0 = 0"
proof -
  have along_path: "\<And>t. t \<in> {0..1} \<Longrightarrow> ((\<lambda>t. F (g t)) has_vector_derivative f (g t) * g' t) (at t)"
    using primitive path by (rule primitive_along_path)
  have difference: "((\<lambda>t. I t - F (g t)) has_vector_derivative 0) (at t)" if t: "t \<in> {0..1}" for t
  proof -
    have combined: "((\<lambda>t. I t - F (g t)) has_vector_derivative f (g t) * g' t - f (g t) * g' t) (at t)"
      using integral[OF t] along_path[OF t] by (rule has_vector_derivative_diff)
    show ?thesis
      using combined by simp
  qed
  have no_net_change: "I 1 - F (g 1) = I 0 - F (g 0)"
    using difference by (rule vanishing_derivative_constant)
  have endpoints: "F (g 1) = F (g 0)"
    using closed by simp
  show ?thesis
    using no_net_change endpoints by simp
qed

text \<open>A concrete instance, which also shows the hypotheses are satisfiable rather than
  vacuous: the integral of z squared around the unit circle vanishes.\<close>

lemma square_has_primitive:
  fixes z :: complex
  shows "((\<lambda>w. w ^ 3 / 3) has_field_derivative z ^ 2) (at z)"
proof -
  have cube: "((\<lambda>w :: complex. w ^ 3) has_field_derivative 3 * z ^ 2) (at z)"
    using DERIV_power[of "\<lambda>w. w" 1 z UNIV 3] by simp
  show ?thesis
    using DERIV_cdivide[OF cube, of 3] by simp
qed

lemma circle_has_vector_derivative:
  fixes t :: real
  shows "((\<lambda>t. exp (2 * of_real pi * \<i> * of_real t)) has_vector_derivative
          2 * of_real pi * \<i> * exp (2 * of_real pi * \<i> * of_real t)) (at t)"
proof -
  have inner: "DERIV ((*) (2 * of_real pi * \<i>)) (of_real t) :> 2 * of_real pi * \<i>"
    by (rule DERIV_cmult_Id)
  have field_step: "((\<lambda>z. exp (2 * of_real pi * \<i> * z)) has_field_derivative
                      2 * of_real pi * \<i> * exp (2 * of_real pi * \<i> * of_real t)) (at (of_real t))"
    using DERIV_fun_exp[OF inner] by (simp add: mult.commute)
  show ?thesis
    using has_vector_derivative_real_field[OF field_step] by simp
qed

corollary cauchy_square_unit_circle:
  fixes I :: "real \<Rightarrow> complex"
  defines "g \<equiv> (\<lambda>t :: real. exp (2 * of_real pi * \<i> * of_real t))"
  assumes integral: "\<And>t. t \<in> {0..1} \<Longrightarrow>
      (I has_vector_derivative (g t) ^ 2 * (2 * of_real pi * \<i> * g t)) (at t)"
  shows "I 1 - I 0 = 0"
proof -
  have primitive: "\<And>t. t \<in> {0..1} \<Longrightarrow> ((\<lambda>w. w ^ 3 / 3) has_field_derivative (g t) ^ 2) (at (g t))"
    by (rule square_has_primitive)
  have path: "\<And>t. t \<in> {0..1} \<Longrightarrow> (g has_vector_derivative 2 * of_real pi * \<i> * g t) (at t)"
    unfolding g_def by (rule circle_has_vector_derivative)
  have closed: "g 1 = g 0"
    by (simp add: g_def)
  show ?thesis
    by (rule cauchy_integral_theorem_primitive_form
          [where f = "\<lambda>z. z ^ 2" and F = "\<lambda>w. w ^ 3 / 3" and g = g
             and g' = "\<lambda>t. 2 * of_real pi * \<i> * g t",
           OF primitive path integral closed])
qed

text \<open>The primitive hypothesis is not decoration: drop it and the conclusion fails.
  Around the same unit circle the integrand 1 / z accumulates 2 * pi * \<i>, because
  1 / z has no primitive on the punctured plane.\<close>

lemma primitive_hypothesis_is_needed:
  defines "g \<equiv> (\<lambda>t :: real. exp (2 * of_real pi * \<i> * of_real t))"
  defines "I \<equiv> (\<lambda>t :: real. 2 * of_real pi * \<i> * of_real t)"
  shows "(\<And>t. t \<in> {0..1} \<Longrightarrow> (g has_vector_derivative 2 * of_real pi * \<i> * g t) (at t))"
    and "(\<And>t. t \<in> {0..1} \<Longrightarrow> (I has_vector_derivative (1 / g t) * (2 * of_real pi * \<i> * g t)) (at t))"
    and "g 1 = g 0"
    and "I 1 - I 0 \<noteq> 0"
proof -
  show path: "(g has_vector_derivative 2 * of_real pi * \<i> * g t) (at t)" if "t \<in> {0..1}" for t
    unfolding g_def by (rule circle_has_vector_derivative)
  show "(I has_vector_derivative (1 / g t) * (2 * of_real pi * \<i> * g t)) (at t)" if "t \<in> {0..1}" for t
  proof -
    have nonzero: "g t \<noteq> 0"
      by (simp add: g_def)
    have integrand: "(1 / g t) * (2 * of_real pi * \<i> * g t) = 2 * of_real pi * \<i>"
      using nonzero by simp
    have parameter: "((\<lambda>t :: real. of_real t :: complex) has_vector_derivative 1) (at t)"
      using has_vector_derivative_of_real[OF DERIV_ident] by simp
    have velocity: "(I has_vector_derivative 2 * of_real pi * \<i>) (at t)"
      unfolding I_def
      using has_vector_derivative_mult[OF has_vector_derivative_const parameter] by simp
    show ?thesis
      using velocity integrand by simp
  qed
  show "g 1 = g 0"
    by (simp add: g_def)
  show "I 1 - I 0 \<noteq> 0"
    by (simp add: I_def)
qed

end
