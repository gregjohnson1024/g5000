"""Pure-Python unit tests for the level/rank logic. Run with:

    python3 -m unittest discover -s tools/gebco-contour-maker/tests

No GDAL, no pip installs — exercises only config expansion, rank assignment,
depth<->elevation conversion, grid grouping and the contour tagger.
"""
import io
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import gebco_levels as gl  # noqa: E402
import tag_contours  # noqa: E402

SHIPPED = gl.load_config(ROOT / "config" / "levels.json")


class ExpandLevels(unittest.TestCase):
    def test_step_is_exclusive_of_from_inclusive_of_to(self):
        got = gl.expand_levels([{"fromM": 0, "toM": 100, "stepM": 20}])
        self.assertEqual(got, [20, 40, 60, 80, 100])

    def test_union_dedupes_overlapping_rules(self):
        got = gl.expand_levels(
            [{"fromM": 0, "toM": 1000, "stepM": 20}, {"fromM": 1000, "toM": 1400, "stepM": 200}]
        )
        self.assertEqual(got.count(1000), 1)  # 1000 produced by both rules, kept once
        self.assertIn(1200, got)
        self.assertIn(1400, got)
        self.assertEqual(got[0], 20)  # 0 itself is never a contour

    def test_rejects_nonpositive_step(self):
        with self.assertRaises(ValueError):
            gl.expand_levels([{"fromM": 0, "toM": 100, "stepM": 0}])


class Classify(unittest.TestCase):
    RANKS = SHIPPED["ranks"]

    def assert_rank(self, depth, name, minzoom):
        self.assertEqual(gl.classify(depth, self.RANKS), (name, minzoom))

    def test_basin_tier_visible_at_world_view(self):
        # Every 1000 m -> minzoom 0 so basin isobaths never disappear when
        # zoomed right out.
        self.assert_rank(1000, "basin", 0)
        self.assert_rank(2000, "basin", 0)
        self.assert_rank(5000, "basin", 0)

    def test_major_tier(self):
        self.assert_rank(100, "major", 3)  # shelf line, explicitly promoted
        self.assert_rank(200, "major", 3)  # shelf edge, explicitly promoted

    def test_deep_200_tier(self):
        # multiples of 200 that aren't major
        self.assert_rank(400, "deep", 5)
        self.assert_rank(600, "deep", 5)
        self.assert_rank(800, "deep", 5)
        self.assert_rank(1200, "deep", 5)
        self.assert_rank(1800, "deep", 5)

    def test_shelf_100_tier(self):
        # multiples of 100 that aren't multiples of 200 and aren't promoted
        self.assert_rank(300, "shelf", 6)
        self.assert_rank(500, "shelf", 6)
        self.assert_rank(900, "shelf", 6)

    def test_fine_20_tier_is_everything_else(self):
        self.assert_rank(20, "fine", 8)
        self.assert_rank(40, "fine", 8)
        self.assert_rank(980, "fine", 8)

    def test_precedence_first_match_wins(self):
        # 2000 is a multiple of 1000 AND of 200 AND of 100 -> basin wins (first).
        self.assert_rank(2000, "basin", 0)

    def test_missing_default_rule_raises(self):
        ranks = [{"name": "major", "minzoom": 3, "match": {"multipleOf": 1000}}]
        with self.assertRaises(ValueError):
            gl.classify(37, ranks)


class Assign(unittest.TestCase):
    def setUp(self):
        self.rows = gl.assign(SHIPPED)
        self.by_depth = {r["depth"]: r for r in self.rows}

    def test_elevation_is_negated_depth(self):
        for r in self.rows:
            self.assertEqual(r["elevation"], -r["depth"])

    def test_sorted_shallow_to_deep(self):
        depths = [r["depth"] for r in self.rows]
        self.assertEqual(depths, sorted(depths))

    def test_grid_grouping_follows_minzoom_threshold(self):
        # coarseForMinzoomLE = 6 in shipped config
        self.assertEqual(self.by_depth[400]["grid"], "coarse")  # minzoom 5
        self.assertEqual(self.by_depth[300]["grid"], "coarse")  # minzoom 6
        self.assertEqual(self.by_depth[20]["grid"], "fine")  # minzoom 8

    def test_signed_elevations_per_grid_are_negative_and_disjoint(self):
        coarse = set(gl.signed_elevations(SHIPPED, "coarse"))
        fine = set(gl.signed_elevations(SHIPPED, "fine"))
        self.assertTrue(all(e < 0 for e in coarse | fine))
        self.assertEqual(coarse & fine, set())  # each depth contoured exactly once
        self.assertEqual(coarse | fine, set(gl.signed_elevations(SHIPPED)))

    def test_elevation_map_keys_are_string_signed_ints(self):
        m = gl.elevation_map(SHIPPED)
        self.assertEqual(m["-200"], {"depth": 200, "rank": "major", "minzoom": 3})
        self.assertEqual(m["-20"]["depth"], 20)

    def test_fl_cli_output_is_strictly_increasing(self):
        # gdal_contour -fl rejects non-increasing level lists.
        for grid in (None, "coarse", "fine"):
            cmd = ["fl"] + (["--grid", grid] if grid else [])
            buf = io.StringIO()
            old = sys.stdout
            sys.stdout = buf
            try:
                gl._main(cmd)
            finally:
                sys.stdout = old
            vals = [int(x) for x in buf.getvalue().split()]
            self.assertEqual(vals, sorted(vals))
            self.assertEqual(len(vals), len(set(vals)))  # strictly increasing


class Tagger(unittest.TestCase):
    def _run(self, features, map_path, attr="elev"):
        stdin = io.StringIO("\n".join(json.dumps(f) for f in features) + "\n")
        stdout = io.StringIO()
        old_in, old_out = sys.stdin, sys.stdout
        sys.stdin, sys.stdout = stdin, stdout
        try:
            tag_contours.main(["--map", str(map_path), "--attr", attr])
        finally:
            sys.stdin, sys.stdout = old_in, old_out
        return [json.loads(ln) for ln in stdout.getvalue().splitlines() if ln.strip()]

    def setUp(self):
        self.map_path = ROOT / "data" / "_test_elevmap.json"
        with open(self.map_path, "w", encoding="utf-8") as fh:
            json.dump(gl.elevation_map(SHIPPED), fh)

    def tearDown(self):
        self.map_path.unlink(missing_ok=True)

    def test_tags_depth_rank_and_minzoom(self):
        feat = {
            "type": "Feature",
            "properties": {"elev": -200.0},
            "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
        }
        out = self._run([feat], self.map_path)
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["properties"], {"depth": 200, "rank": "major"})
        self.assertEqual(out[0]["tippecanoe"], {"minzoom": 3})

    def test_drops_unknown_elevation(self):
        feat = {
            "type": "Feature",
            "properties": {"elev": -7},  # not in the level set
            "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
        }
        out = self._run([feat], self.map_path)
        self.assertEqual(out, [])


if __name__ == "__main__":
    unittest.main()
