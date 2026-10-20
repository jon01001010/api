"""Validate and recover sdkmanager's nested NDK layout before using it."""
from pathlib import Path

CLANG = Path('toolchains/llvm/prebuilt/linux-x86_64/bin/clang')


def revision_at(root):
    metadata = root / 'source.properties'
    if not metadata.is_file():
        return None
    properties = dict(line.split('=', 1) for line in metadata.read_text().splitlines()
                      if '=' in line and not line.lstrip().startswith('#'))
    return {k.strip(): v.strip() for k, v in properties.items()}.get('Pkg.Revision')


def normalize_ndk(root, revision):
    """Return clang path; reject invalid/ambiguous layouts before moving files.

    Callers must serialize SDK installation and execute clang separately.
    This checks package metadata/layout, not cryptographic authenticity.
    """
    root = Path(root)
    if (root / 'source.properties').exists():
        if revision_at(root) != revision:
            raise RuntimeError('NDK root revision mismatch: ' + str(root))
        candidate = root
    else:
        candidates = [p.parent for p in root.glob('*/source.properties')
                      if not p.parent.is_symlink() and revision_at(p.parent) == revision]
        if len(candidates) != 1:
            raise RuntimeError('Expected exactly one matching nested NDK: ' + str(root))
        candidate = candidates[0]
    if not (candidate / CLANG).is_file():
        raise RuntimeError('NDK compiler missing: ' + str(candidate))
    if candidate != root:
        entries = list(candidate.iterdir())
        if any((root / entry.name).exists() or (root / entry.name).is_symlink()
               for entry in entries):
            raise RuntimeError('NDK recovery would overwrite existing entries: ' + str(root))
        for entry in entries:
            entry.rename(root / entry.name)
        candidate.rmdir()
    return root / CLANG
