# tools/print-factory/tests/test_shellprep.py
"""Pure transform maths for fusing a generative shell onto a fixture.

Every number in here that is described as "measured" came off the real
examples/shell.glb, not from a round number someone liked.
"""
import pytest

from printfactory.shellprep import (
    ShellError,
    apply_plan,
    bore_blockage,
    bore_cut_span,
    normalise_plan,
    retry_voxel_sizes,
    union_bbox_shortfall,
    fusion_volume_mismatch,
)

# The real wraith GLB, measured in Blender after import (which already applies
# glTF's Y-up -> Blender Z-up). Raw glTF POSITION accessor bounds were
# min [-0.27463, -0.50101, -0.28674] max [0.27410, 0.50060, 0.27885] i.e. the
# height sits on glTF +Y, exactly as the spec requires; Blender hands it back
# on +Z. See tests/test_shell_fusion_integration.py for the live assertion.
WRAITH_MIN = (-0.274630069732666, -0.2788456082344055, -0.5010120868682861)
WRAITH_MAX = (0.2741018533706665, 0.28674161434173584, 0.5006020665168762)


def _size(mn, mx):
    return tuple(mx[i] - mn[i] for i in range(3))


class TestNormalisePlan:
    def test_scales_so_z_height_equals_the_target(self):
        plan = normalise_plan(WRAITH_MIN, WRAITH_MAX, 200.0)
        assert plan["scale"] == pytest.approx(199.6777, abs=1e-3)

    def test_transformed_corners_land_at_the_target_height(self):
        plan = normalise_plan(WRAITH_MIN, WRAITH_MAX, 200.0)
        lo = apply_plan(WRAITH_MIN, plan)
        hi = apply_plan(WRAITH_MAX, plan)
        assert hi[2] - lo[2] == pytest.approx(200.0, abs=1e-6)

    def test_grounds_the_lowest_point_at_z_zero(self):
        """Not "near" zero: an STL that floats or sinks is a failed print."""
        plan = normalise_plan(WRAITH_MIN, WRAITH_MAX, 200.0)
        assert apply_plan(WRAITH_MIN, plan)[2] == pytest.approx(0.0, abs=1e-9)

    def test_centres_on_xy(self):
        plan = normalise_plan(WRAITH_MIN, WRAITH_MAX, 200.0)
        lo = apply_plan(WRAITH_MIN, plan)
        hi = apply_plan(WRAITH_MAX, plan)
        assert (lo[0] + hi[0]) / 2 == pytest.approx(0.0, abs=1e-9)
        assert (lo[1] + hi[1]) / 2 == pytest.approx(0.0, abs=1e-9)

    def test_the_measured_wraith_lands_at_its_measured_footprint(self):
        """Uniform scale, so the footprint is dictated, not chosen: a 200mm
        wraith is 109.57 x 112.94. This is the number the fixture has to live
        with when the two are unioned."""
        plan = normalise_plan(WRAITH_MIN, WRAITH_MAX, 200.0)
        lo = apply_plan(WRAITH_MIN, plan)
        hi = apply_plan(WRAITH_MAX, plan)
        assert hi[0] - lo[0] == pytest.approx(109.57, abs=0.01)
        assert hi[1] - lo[1] == pytest.approx(112.94, abs=0.01)

    def test_scale_is_uniform_across_all_three_axes(self):
        """A per-axis fit would make the jar bore elliptical and the jar would
        not drop in. One factor, always."""
        plan = normalise_plan(WRAITH_MIN, WRAITH_MAX, 200.0)
        assert isinstance(plan["scale"], float)

    def test_a_mesh_already_at_target_height_is_not_rescaled(self):
        plan = normalise_plan((0, 0, 0), (10, 10, 200), 200.0)
        assert plan["scale"] == pytest.approx(1.0)

    def test_a_flat_mesh_is_rejected(self):
        with pytest.raises(ShellError, match="zero height"):
            normalise_plan((0, 0, 5), (10, 10, 5), 200.0)

    def test_a_non_positive_target_height_is_rejected(self):
        with pytest.raises(ShellError, match="target_height_mm"):
            normalise_plan(WRAITH_MIN, WRAITH_MAX, 0.0)

    def test_a_target_height_beyond_the_build_volume_is_rejected(self):
        # No point remeshing 40k triangles for something the printer refuses.
        with pytest.raises(ShellError, match="build volume"):
            normalise_plan(WRAITH_MIN, WRAITH_MAX, 400.0)


class TestBoreCutSpan:
    def test_spans_the_platform_floor_to_above_the_model_top(self):
        """The bore has to be open TO THE SKY after the union, not just to the
        top of the cradle - otherwise the jar cannot be dropped in."""
        z0, z1 = bore_cut_span(cradle_height=200.0, platform_depth=25.0,
                               model_top_z=200.0)
        assert z0 == pytest.approx(175.0)
        assert z1 > 200.0

    def test_a_shell_taller_than_the_cradle_still_gets_a_through_cut(self):
        z0, z1 = bore_cut_span(cradle_height=200.0, platform_depth=25.0,
                               model_top_z=240.0)
        assert z0 == pytest.approx(175.0)
        assert z1 > 240.0, "shell above the cradle rim would cap the jar in"

    def test_the_cut_overshoots_rather_than_ending_coplanar(self):
        """Coplanar faces are exactly where the EXACT solver emits zero-area
        garbage, so the cutter always breaks the surface."""
        _, z1 = bore_cut_span(200.0, 25.0, 200.0, overshoot=1.0)
        assert z1 == pytest.approx(201.0)

    def test_a_platform_deeper_than_the_cradle_is_rejected(self):
        with pytest.raises(ShellError, match="platform_depth"):
            bore_cut_span(cradle_height=20.0, platform_depth=25.0,
                          model_top_z=200.0)


class TestRetryVoxelSizes:
    def test_the_first_attempt_uses_the_spec_value(self):
        assert retry_voxel_sizes(0.6)[0] == pytest.approx(0.6)

    def test_the_retry_halves_the_voxel(self):
        """Booleans on a remeshed generative mesh do fail. A finer remesh gives
        the EXACT solver cleaner topology to chew on - at 8x the triangles, so
        it is a retry, never the default."""
        assert retry_voxel_sizes(0.6) == [pytest.approx(0.6), pytest.approx(0.3)]

    def test_retries_are_bounded(self):
        assert len(retry_voxel_sizes(0.6, retries=1)) == 2
        assert len(retry_voxel_sizes(0.6, retries=0)) == 1

    def test_a_non_positive_voxel_is_rejected(self):
        with pytest.raises(ShellError, match="voxel_mm"):
            retry_voxel_sizes(0.0)


class TestBoreBlockage:
    """The step-8 gate, as pure arithmetic. This is the check that separates a
    candle holder from a solid decoration with the right bounding box."""

    CLEAR = {"samples": 33, "misses": 0,
             "first_hit_z_max": 175.0, "first_hit_z_min": 175.0}

    def test_a_clear_bore_is_not_blocked(self):
        assert bore_blockage(self.CLEAR, bore_floor_z=175.0, jar_dia=89.0) is None

    def test_the_measured_wraith_union_is_blocked(self):
        """Real numbers: before the re-cut, the fused wraith's own head stopped
        the jar at z=194.48 with the platform floor at 175."""
        probe = {"samples": 33, "misses": 0,
                 "first_hit_z_max": 194.47775268554688,
                 "first_hit_z_min": 172.59999084472656}
        reason = bore_blockage(probe, bore_floor_z=175.0, jar_dia=89.0)
        assert reason is not None
        assert "194.48" in reason and "19.48mm" in reason

    def test_rays_passing_straight_through_are_a_blockage_too(self):
        """No hit at all means no platform floor - the jar would drop through
        rather than sit. Not a pass just because nothing was in the way."""
        probe = {"samples": 33, "misses": 4, "first_hit_z_max": 175.0,
                 "first_hit_z_min": 175.0}
        reason = bore_blockage(probe, bore_floor_z=175.0, jar_dia=89.0)
        assert reason is not None and "4/33" in reason

    def test_a_sub_layer_obstruction_is_tolerated(self):
        # 0.3mm of remesh fuzz on the floor is not a blocked bore.
        probe = dict(self.CLEAR, first_hit_z_max=175.3)
        assert bore_blockage(probe, 175.0, 89.0) is None

    def test_an_obstruction_past_the_tolerance_is_not(self):
        probe = dict(self.CLEAR, first_hit_z_max=176.0)
        assert bore_blockage(probe, 175.0, 89.0) is not None

    def test_no_hits_at_all_is_a_blockage(self):
        probe = {"samples": 33, "misses": 33, "first_hit_z_max": None,
                 "first_hit_z_min": None}
        assert bore_blockage(probe, 175.0, 89.0) is not None


# The squat/wide shell, measured in Blender after import (examples/shell2.glb).
# 1.0011 x 0.6624 wide on a 0.5840 height: a width/height ratio of 1.714, which
# is the whole reason fit="bbox" exists. Scaling THIS to a legal height still
# produces an illegal width.
WIDE_MIN = (-0.5005, -0.3312, -0.2920)
WIDE_MAX = (0.5006, 0.3312, 0.2920)


class TestFitModes:
    def test_height_is_the_default_so_existing_jobs_do_not_move(self):
        plan = normalise_plan(WRAITH_MIN, WRAITH_MAX, 200.0)
        assert plan["bound_by"] == "height"
        assert plan["scale"] == pytest.approx(199.6777, abs=1e-3)

    def test_height_mode_ignores_width_entirely(self):
        """Documents the trap rather than hiding it: the wide shell at a
        perfectly legal 150mm height comes out 257mm across, which the A1
        cannot print. Height mode is allowed to do this; it is why the caller
        gets a choice."""
        plan = normalise_plan(WIDE_MIN, WIDE_MAX, 150.0, fit="height")
        width = (WIDE_MAX[0] - WIDE_MIN[0]) * plan["scale"]
        assert width > 256.0

    def test_bbox_mode_clamps_the_wide_shell_on_width(self):
        plan = normalise_plan(WIDE_MIN, WIDE_MAX, 150.0, fit="bbox")
        assert plan["bound_by"] == "x"
        width = (WIDE_MAX[0] - WIDE_MIN[0]) * plan["scale"]
        assert width <= 256.0
        height = (WIDE_MAX[2] - WIDE_MIN[2]) * plan["scale"]
        assert height < 150.0, "a width-bound fit must give up some height"

    def test_bbox_mode_leaves_the_tall_shell_bound_by_height(self):
        """The tall wraith is slim, so nothing about the build volume binds it
        and bbox mode must not shrink it."""
        plan = normalise_plan(WRAITH_MIN, WRAITH_MAX, 200.0, fit="bbox")
        assert plan["bound_by"] == "height"
        assert plan["scale"] == pytest.approx(199.6777, abs=1e-3)

    def test_bbox_mode_respects_the_margin(self):
        tight = normalise_plan(WIDE_MIN, WIDE_MAX, 150.0, fit="bbox", margin_mm=0.0)
        loose = normalise_plan(WIDE_MIN, WIDE_MAX, 150.0, fit="bbox", margin_mm=20.0)
        assert loose["scale"] < tight["scale"]

    def test_bbox_mode_still_grounds_and_centres(self):
        plan = normalise_plan(WIDE_MIN, WIDE_MAX, 150.0, fit="bbox")
        lo = apply_plan(WIDE_MIN, plan)
        hi = apply_plan(WIDE_MAX, plan)
        assert lo[2] == pytest.approx(0.0, abs=1e-9)
        assert (lo[0] + hi[0]) / 2 == pytest.approx(0.0, abs=1e-9)

    def test_bbox_mode_accepts_a_target_taller_than_the_printer(self):
        """In bbox mode an over-tall target is not an error, it is just the
        constraint that does not bind - the build volume clamps it."""
        plan = normalise_plan(WRAITH_MIN, WRAITH_MAX, 400.0, fit="bbox")
        height = (WRAITH_MAX[2] - WRAITH_MIN[2]) * plan["scale"]
        assert height <= 256.0
        assert plan["bound_by"] == "z"

    def test_the_fitted_bbox_is_reported(self):
        plan = normalise_plan(WIDE_MIN, WIDE_MAX, 150.0, fit="bbox")
        assert plan["fitted_bbox_mm"]["x"] == pytest.approx(254.0, abs=0.01)

    def test_an_unknown_fit_mode_is_rejected(self):
        with pytest.raises(ShellError, match="fit"):
            normalise_plan(WIDE_MIN, WIDE_MAX, 150.0, fit="sideways")

    def test_a_margin_that_eats_the_build_volume_is_rejected(self):
        with pytest.raises(ShellError, match="margin"):
            normalise_plan(WIDE_MIN, WIDE_MAX, 150.0, fit="bbox", margin_mm=999.0)


class TestUnionBboxShortfall:
    """A union's bounding box is the componentwise union of its inputs'. Always.

    Caught in production, not in theory: fusing shell2 at 120mm returned a
    part measuring exactly 104 x 104 x 120 - the bare cradle - after unioning
    a shell that had just been fitted to 205.73 x 136.12 x 120. A 205mm shell
    cannot hide inside a 104mm barrel, so the solver had silently dropped one
    input. Every other gate passed: manifold, non-degenerate, right height,
    plausible mass, jar fits, zero retries. Only the bbox knew.
    """

    BODY = {"x": 104.0, "y": 104.0, "z": 120.0}
    SHELL = {"x": 205.73, "y": 136.12, "z": 120.0}

    def test_a_correct_union_covers_both_inputs(self):
        good = {"x": 205.71, "y": 136.10, "z": 120.0}
        assert union_bbox_shortfall(good, self.BODY, self.SHELL) is None

    def test_the_measured_dropped_shell_is_caught(self):
        dropped = {"x": 104.0, "y": 104.0, "z": 120.0}
        reason = union_bbox_shortfall(dropped, self.BODY, self.SHELL)
        assert reason is not None
        assert "x" in reason and "205.73" in reason and "104.00" in reason

    def test_a_dropped_body_is_caught_too(self):
        dropped = dict(self.SHELL)
        dropped["z"] = 60.0
        assert union_bbox_shortfall(dropped, self.BODY, self.SHELL) is not None

    def test_solver_noise_is_tolerated(self):
        """Measured on the good 148mm run: the union came back 0.02-0.03mm
        under the componentwise max. That is the solver reweaving a surface,
        not a lost input."""
        noisy = {"x": 205.70, "y": 136.09, "z": 119.97}
        assert union_bbox_shortfall(noisy, self.BODY, self.SHELL) is None

    def test_a_shell_genuinely_inside_the_body_is_not_a_shortfall(self):
        """The tall wraith really is narrower than its cradle. That is a
        product problem, reported elsewhere - it is not a solver failure."""
        small = {"x": 60.0, "y": 60.0, "z": 120.0}
        assert union_bbox_shortfall(self.BODY, self.BODY, small) is None

    def test_the_measured_thin_sliver_loss_is_tolerated(self):
        """The real 200mm shell.glb union: inputs span 112.75 on y, the union
        came back 112.04 - one connected component throughout, a collapsed
        robe-edge sliver, 0.62% of the axis. Not a dropped input."""
        body = {"x": 104.0, "y": 104.0, "z": 200.0}
        shell = {"x": 109.35, "y": 112.75, "z": 199.97}
        union = {"x": 109.35, "y": 112.04, "z": 200.01}
        assert union_bbox_shortfall(union, body, shell) is None

    def test_the_gap_between_noise_and_a_dropped_input_is_wide(self):
        """0.62% real noise vs 49.4% real failure. If those ever converge this
        guard needs a better instrument than a bounding box."""
        shell = {"x": 205.73, "y": 136.12, "z": 120.0}
        body = {"x": 104.0, "y": 104.0, "z": 120.0}
        assert union_bbox_shortfall(
            {"x": 195.5, "y": 136.1, "z": 120.0}, body, shell) is None
        assert union_bbox_shortfall(
            {"x": 150.0, "y": 136.1, "z": 120.0}, body, shell) is not None


class TestFusionVolumeIdentity:
    """Every cut the fixture makes lies strictly inside its own body (the
    widest is the 99.2mm cavity inside a 104mm barrel), and the shell material
    outside the body is never touched by them. So an exact identity holds:

        final_volume == bare_fixture_volume + proud_shell_volume

    Checked against the three real runs: +0.09% at 148mm, -0.04% at 95mm, and
    +226.19% at 120mm, where the cavity cut silently did nothing and left
    ~581,000mm3 of barrel behind. The part was manifold, non-degenerate, the
    right size, and its bore probed open - it just weighed 1038.8g instead of
    319g, which is heavier than the same product 28mm TALLER.
    """

    def test_a_correct_fusion_satisfies_the_identity(self):
        assert fusion_volume_mismatch(414051.8, 179664.0, 234000.0) is None
        assert fusion_volume_mismatch(158505.9, 139064.0, 19498.1) is None

    def test_the_measured_failed_cavity_cut_is_caught(self):
        reason = fusion_volume_mismatch(837724.9, 158215.0, 98606.3)
        assert reason is not None
        assert "837725" in reason.replace(",", "") or "837724" in reason.replace(",", "")

    def test_solver_noise_of_a_fraction_of_a_percent_passes(self):
        assert fusion_volume_mismatch(100_500.0, 60_000.0, 40_000.0) is None

    def test_a_part_that_lost_material_is_caught_too(self):
        """Under-volume matters as much as over: it means a cut ran twice or
        took more than its own cylinder."""
        assert fusion_volume_mismatch(50_000.0, 60_000.0, 40_000.0) is not None

    def test_tiny_parts_get_an_absolute_floor(self):
        # 2% of nothing is nothing; a small absolute slack stops false alarms.
        assert fusion_volume_mismatch(1200.0, 1000.0, 0.0) is None
