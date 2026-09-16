"""compute.geometry 的冒烟测试 — 只用手写坐标和标准库，CI 不需要装 rdkit/xtb。

    python -m unittest discover -s tests
"""
import unittest

from compute.geometry import analyze, fragments, formula, spiro_list, sp3_atoms, structure_warnings

# 甲烷：正四面体，C 在原点，4 个 H 沿立方体对角线（C–H 1.09 Å）
METHANE = """5

C   0.0000  0.0000  0.0000
H   0.6294  0.6294  0.6294
H  -0.6294 -0.6294  0.6294
H  -0.6294  0.6294 -0.6294
H   0.6294 -0.6294 -0.6294
"""

# 乙烯：平面，C=C 1.33 Å
ETHENE = """6

C   0.0000  0.6650  0.0000
C   0.0000 -0.6650  0.0000
H   0.9230  1.2340  0.0000
H  -0.9230  1.2340  0.0000
H   0.9230 -1.2340  0.0000
H  -0.9230 -1.2340  0.0000
"""

# 螺戊烷骨架：中心 C 属于两个互相垂直的三元环，两环只共用这一个原子
SPIRO_SKELETON = """5

C   0.0000  0.0000  0.0000
C   1.3000  0.7500  0.0000
C   1.3000 -0.7500  0.0000
C  -1.3000  0.0000  0.7500
C  -1.3000  0.0000 -0.7500
"""


class TestHybridization(unittest.TestCase):
    def test_methane_is_sp3(self):
        atoms = analyze(METHANE)
        self.assertEqual(formula(atoms), "H4 C1")  # 按数量降序，不是 Hill 记法
        self.assertEqual(atoms[0].cn, 4)
        self.assertEqual(atoms[0].hybrid, "sp3")
        self.assertEqual([a.index for a in sp3_atoms(atoms)], [1])

    def test_ethene_is_sp2(self):
        atoms = analyze(ETHENE)
        self.assertEqual([a.hybrid for a in atoms[:2]], ["sp2", "sp2"])
        self.assertEqual(sp3_atoms(atoms), [])


class TestSpiro(unittest.TestCase):
    def test_spiro_centre_found(self):
        atoms = analyze(SPIRO_SKELETON)
        self.assertEqual([a.index for a in spiro_list(atoms)], [1])

    def test_methane_has_no_spiro(self):
        self.assertEqual(spiro_list(analyze(METHANE)), [])

    def test_no_fragment_without_rings(self):
        # 片段要求含环且够大，甲烷不该切出任何片段
        self.assertEqual(fragments(analyze(METHANE)), [])


class TestValidate(unittest.TestCase):
    def test_clean_structure_has_no_warning(self):
        self.assertEqual(structure_warnings(analyze(METHANE)), [])

    def test_too_short_bond_is_flagged(self):
        bad = METHANE.replace("H   0.6294  0.6294  0.6294", "H   0.3000  0.3000  0.3000")
        self.assertTrue(structure_warnings(analyze(bad)))


if __name__ == "__main__":
    unittest.main()
