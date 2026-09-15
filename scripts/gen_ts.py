"""由 shared/schemas/job.py（Pydantic 模型，唯一来源）生成 shared/schemas/job.ts，TS 契约不再手写。

在项目根目录运行：
    python -m scripts.gen_ts             生成 / 覆盖 job.ts
    python -m scripts.gen_ts --check     job.ts 与模型不一致时退出码 1（改了 job.py 却忘记生成时报警）
    python -m scripts.gen_ts --out PATH  写到其他位置
"""
import argparse
import inspect
import json
import sys
import types
import typing
from pathlib import Path

from annotated_types import Ge, Le, MaxLen, MinLen
from pydantic import BaseModel
from pydantic_core import PydanticUndefined

import shared.schemas.job as schema

TS_PATH = Path(__file__).resolve().parents[1] / "shared" / "schemas" / "job.ts"

HEADER = """// ⚠️ 自动生成，请勿手改。来源：chem-portal/shared/schemas/job.py（Pydantic 模型）
// 修改字段：改 job.py → 在 chem-portal 目录运行 `python -m scripts.gen_ts`
//          → 前端仓库运行 `bash scripts/sync-shared.sh --to-web`
"""


def literal_aliases() -> dict:
    """模块级 Literal 别名（JobStatus 等），按定义顺序：名称 → 取值"""
    return {name: typing.get_args(obj) for name, obj in vars(schema).items() if typing.get_origin(obj) is typing.Literal}


def schema_models() -> list:
    """本模块定义的 Pydantic 模型，按定义顺序"""
    return [obj for obj in vars(schema).values() if inspect.isclass(obj) and issubclass(obj, BaseModel) and obj.__module__ == schema.__name__]


class Emitter:
    def __init__(self):
        self.aliases = literal_aliases()
        self.alias_by_values = {frozenset(v): k for k, v in self.aliases.items()}

    def ts_type(self, ann) -> str:
        origin, args = typing.get_origin(ann), typing.get_args(ann)
        if origin in (typing.Union, types.UnionType):
            non_null = [a for a in args if a is not type(None)]
            body = " | ".join(self.ts_type(a) for a in non_null)
            return f"{body} | null" if len(non_null) < len(args) else body
        if origin is typing.Literal:
            return self.alias_by_values.get(frozenset(args)) or " | ".join(json.dumps(a, ensure_ascii=False) for a in args)
        if origin is list:
            inner = self.ts_type(args[0])
            return f"({inner})[]" if "|" in inner else f"{inner}[]"
        if origin is dict:
            return f"Record<string, {self.ts_type(args[1])}>"
        if ann is str:
            return "string"
        if ann in (int, float):
            return "number"
        if ann is bool:
            return "boolean"
        if inspect.isclass(ann) and issubclass(ann, BaseModel):
            return ann.__name__
        raise TypeError(f"gen_ts 不支持的类型: {ann!r}（请在 gen_ts.py 中补充映射）")

    @staticmethod
    def field_comment(f) -> str:
        parts = [f.description] if f.description else []
        lo = hi = min_len = max_len = None
        for m in f.metadata:
            if isinstance(m, Ge):
                lo = m.ge
            elif isinstance(m, Le):
                hi = m.le
            elif isinstance(m, MinLen):
                min_len = m.min_length
            elif isinstance(m, MaxLen):
                max_len = m.max_length
        if lo is not None or hi is not None:
            parts.append(f"范围 {'' if lo is None else lo}–{'' if hi is None else hi}")
        if min_len is not None or max_len is not None:
            parts.append(f"长度 {min_len or 0}–{'' if max_len is None else max_len}")
        if not f.is_required() and f.default not in (PydanticUndefined, None):
            parts.append(f"默认 {f.default}")
        return "；".join(parts)

    def interface(self, cls) -> str:
        lines = []
        doc = (cls.__doc__ or "").strip()
        if doc:
            lines.append(f"/** {doc.splitlines()[0]} */")
        lines.append(f"export interface {cls.__name__} {{")
        for name, f in cls.model_fields.items():
            comment = self.field_comment(f)
            lines.append(f"  {name}{'' if f.is_required() else '?'}: {self.ts_type(f.annotation)};" + (f"  // {comment}" if comment else ""))
        lines.append("}")
        return "\n".join(lines)


def generate() -> str:
    e = Emitter()
    out = [HEADER]
    out += [f"export type {name} = {' | '.join(json.dumps(v, ensure_ascii=False) for v in values)};" for name, values in e.aliases.items()]
    for cls in schema_models():
        out += ["", e.interface(cls)]
    return "\n".join(out) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description="由 Pydantic 模型生成 TypeScript 契约")
    ap.add_argument("--check", action="store_true", help="只检查，不一致时退出码 1")
    ap.add_argument("--out", type=Path, default=TS_PATH)
    args = ap.parse_args()
    text = generate()
    if args.check:
        if not args.out.exists() or args.out.read_text() != text:
            print(f"{args.out} 与 shared/schemas/job.py 不一致：运行 python -m scripts.gen_ts 重新生成", file=sys.stderr)
            return 1
        print("job.ts 与 job.py 一致")
        return 0
    args.out.write_text(text)
    print(f"已生成 {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
