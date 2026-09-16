"""命令行：python -m compute.geometry mol.xyz [...]"""
import sys

from .report import summarize


def main(paths) -> int:
    if not paths:
        print(__doc__)
        return 1
    for path in paths:
        print(f"== {path}")
        print(summarize(open(path).read()))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
