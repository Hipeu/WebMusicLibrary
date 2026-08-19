"""艺人名称拆分与整理工具。

合作艺人（album_artist / artist）可能来自不同来源，分隔符不一致：
  - QQ：", " 或 "&"
  - iTunes："/"
  - 本地文件标签：任意
统一拆分为数组，或整理为 " A & B & C " 格式。
"""
import re

_SEP_RE = re.compile(r"[,，/&;；]")


def split_artists(value):
    """按 , ， / & ; ； 拆分并清理，返回去重后的艺人名列表。"""
    if not value:
        return []
    parts = [p.strip() for p in _SEP_RE.split(str(value)) if p and p.strip()]
    seen = set()
    out = []
    for p in parts:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out


def normalize_artists(value):
    """将多艺人字符串统一为 ' A & B & C ' 格式；单艺人原样返回。"""
    parts = split_artists(value)
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    return " & ".join(parts)