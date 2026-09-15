"""RDKit 化学工具：SDF → 3D XYZ、XYZ → 2D 结构图"""
import re
from typing import Optional

PLACEHOLDER_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#f4f4f5"/>'
    '<text x="120" y="95" text-anchor="middle" font-size="42" fill="#a1a1aa">?</text></svg>'
)


def sdf_to_xyz(sdf: str) -> dict:
    """SDF → 3D XYZ（ETKDGv3 距离几何 + UFF 快清）；返回 xyz / charge(形式电荷) / name(标题行)。
    只取第一个分子；解析或嵌入失败抛 ValueError，缺 RDKit 抛 ImportError。
    """
    from rdkit import Chem
    from rdkit.Chem import AllChem

    mol = Chem.MolFromMolBlock(sdf.split("$$$$")[0])
    if mol is None:
        raise ValueError("RDKit 无法解析 SDF")
    charge = Chem.GetFormalCharge(mol)
    name = mol.GetProp("_Name").strip() if mol.HasProp("_Name") else ""
    mol = Chem.AddHs(mol)
    ps = AllChem.ETKDGv3()
    ps.randomSeed = 42
    ps.numThreads = 4
    if AllChem.EmbedMolecule(mol, ps) != 0:
        raise ValueError("ETKDG 嵌入失败（检查成键/价态）")
    try:
        AllChem.UFFOptimizeMolecule(mol, maxIters=100)
    except Exception:
        pass
    xyz = Chem.MolToXYZBlock(mol)
    if not xyz or not xyz.splitlines()[0].strip().isdigit():
        raise ValueError("XYZ 生成为空")
    return {"xyz": xyz, "charge": charge, "name": name}


def last_frame_xyz(text: str) -> Optional[str]:
    """多帧 XYZ 取最后一帧；解析失败返回 None"""
    if not text or not text.strip():
        return None
    lines = text.strip().splitlines()
    starts = [i for i, l in enumerate(lines) if re.match(r"^\s*\d+\s*$", l)]
    if not starts:
        return text if len(lines) > 2 else None
    i = starts[-1]
    frame = lines[i : i + 2 + int(lines[i].strip())]
    return "\n".join(frame) if len(frame) >= 3 else None


def xyz_to_svg(xyz: str, charge: int, w: int = 240, h: int = 180) -> Optional[str]:
    """XYZ → 2D SVG（RDKit 键感知 + 平面坐标）；失败返回 None"""
    try:
        from rdkit import Chem
        from rdkit.Chem import AllChem, Draw, rdDetermineBonds

        mol = Chem.MolFromXYZBlock(xyz.strip())
        if mol is None:
            return None
        rdDetermineBonds.DetermineBonds(mol, charge=charge or 0)
        AllChem.Compute2DCoords(mol)
        d = Draw.MolDraw2DSVG(w, h)
        d.DrawMolecule(mol)
        d.FinishDrawing()
        return d.GetDrawingText()
    except Exception:
        return None


def job_card_svg(row: dict) -> Optional[str]:
    """任务卡片图：终态帧 > 进度帧 > 输入，取第一个能画出来的"""
    try:
        charge = int(row.get("charge") or 0)
    except (TypeError, ValueError):
        charge = 0
    for txt in (row.get("result_xyz"), row.get("progress_xyz"), row.get("input_xyz")):
        frame = last_frame_xyz(txt or "")
        if frame:
            svg = xyz_to_svg(frame, charge)
            if svg:
                return svg
    return None
