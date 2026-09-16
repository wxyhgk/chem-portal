"""真实分子回归测试 — 用 gfn2 优化后的最后一帧，锁住螺原子判定与片段切分的结论。

    raw225  螺芴体系：2 个螺碳，各自切出近乎垂直的 C19H12 片段
    raw231  硼氮稠环：没有螺碳，底部苯环是靠单键挂上去的（曾被误判为螺）

判断必须用优化后结构：未优化的 2D→3D 坐标会出现 0.9 Å 的错位 H，
导致五配位碳和假螺原子（见 structure_warnings）。
"""
import unittest
from pathlib import Path

from compute.geometry import analyze, formula, fragments, sp3_atoms, spiro_list, structure_warnings
from compute.geometry.spiro import ring_sizes_at

FIXTURES = Path(__file__).parent / "fixtures"


def load(name: str) -> list:
    return analyze((FIXTURES / f"{name}.xyz").read_text())


class TestRaw225Spiro(unittest.TestCase):
    """两个螺碳的螺芴体系"""

    @classmethod
    def setUpClass(cls):
        cls.atoms = load("raw225")

    def test_composition(self):
        self.assertEqual(len(self.atoms), 148)
        self.assertEqual(formula(self.atoms), "C92 H42 F11 N2 B1")

    def test_two_spiro_carbons(self):
        spiro = spiro_list(self.atoms)
        self.assertEqual([a.index for a in spiro], [41, 54])
        for a in spiro:
            self.assertEqual(a.element, "C")
            self.assertEqual(a.cn, 4)
            self.assertEqual(a.hybrid, "sp3")
            # 芴的五元环 + 另一侧的六元环，只共用螺碳这一个原子
            self.assertEqual(ring_sizes_at(self.atoms, a.index), [5, 6])

    def test_spiro_atoms_are_the_only_sp3(self):
        self.assertEqual([a.index for a in sp3_atoms(self.atoms)], [41, 54])

    def test_spiro_fragments_are_near_perpendicular(self):
        spiro_frags = [f for f in fragments(self.atoms) if f.kind == "spiro"]
        self.assertEqual(len(spiro_frags), 2)
        self.assertEqual({f.anchor for f in spiro_frags}, {41, 54})
        for f in spiro_frags:
            self.assertEqual(f.formula, "C19 H12")
            self.assertEqual(f.heavy, 19)
            self.assertGreater(f.tilt_deg, 70.0)

    def test_pentafluorophenyl_and_phenyl_side_groups(self):
        single = [f for f in fragments(self.atoms) if f.kind != "spiro"]
        self.assertEqual(sorted(f.formula for f in single),
                         ["C6 F5", "C6 F5", "C6 H5", "C6 H5", "C6 H5", "C6 H5"])

    def test_optimised_structure_is_clean(self):
        self.assertEqual(structure_warnings(self.atoms), [])


class TestRaw231NoSpiro(unittest.TestCase):
    """垂直的底部单元来自单键旋转，不是螺原子"""

    @classmethod
    def setUpClass(cls):
        cls.atoms = load("raw231")

    def test_composition(self):
        self.assertEqual(len(self.atoms), 80)
        self.assertEqual(formula(self.atoms), "C48 H26 B3 N3")

    def test_no_spiro_and_no_sp3(self):
        self.assertEqual(spiro_list(self.atoms), [])
        self.assertEqual(sp3_atoms(self.atoms), [])

    def test_single_phenyl_on_a_rotatable_bond(self):
        frags = fragments(self.atoms)
        self.assertEqual(len(frags), 1)
        f = frags[0]
        self.assertEqual(f.kind, "bond")
        self.assertEqual(f.formula, "C6 H5")
        self.assertEqual(f.heavy, 6)
        # 切在 N45–C49 上，N 留在主体
        self.assertEqual({self.atoms[f.anchor - 1].element, self.atoms[f.partner - 1].element}, {"N", "C"})
        self.assertAlmostEqual(f.tilt_deg, 62.3, delta=0.5)

    def test_optimised_structure_is_clean(self):
        self.assertEqual(structure_warnings(self.atoms), [])


if __name__ == "__main__":
    unittest.main()
