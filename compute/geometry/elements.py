"""元素数据表（只有数据，没有逻辑）"""

# 共价半径（Å，Cordero 2008）
COVALENT_RADII = {
    "H": 0.31, "B": 0.84, "C": 0.76, "N": 0.71, "O": 0.66, "F": 0.57,
    "Si": 1.11, "P": 1.07, "S": 1.05, "Cl": 1.02, "Br": 1.20, "I": 1.39,
}
DEFAULT_RADIUS = 0.80

# 正常配位数上限，超出说明坐标有问题（ETKDG 初始结构常见：氢挤到邻近碳上）
MAX_VALENCE = {"H": 1, "F": 1, "Cl": 1, "Br": 1, "I": 1, "O": 2, "N": 4, "B": 4, "C": 4, "S": 6, "P": 5}


def radius(element: str) -> float:
    return COVALENT_RADII.get(element, DEFAULT_RADIUS)


def normalize_symbol(s: str) -> str:
    """CL → Cl，c → C"""
    return s[:1].upper() + s[1:].lower()
