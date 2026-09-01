# tools/print-factory/tests/test_shellprep.py
"""Pure transform maths for fusing a generative shell onto a fixture.

Every number in here that is described as "measured" came off the real
examples/shell.glb, not from a round number someone liked.
"""
import pytest

from printfactory.shellprep import (
    ShellError,
    apply_plan,
    bore_cut_span,
    normalise_plan,
    retry_voxel_sizes,
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
