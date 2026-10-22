"""Build installable Eagle packages using explicit production/source allowlists."""
from pathlib import Path
import argparse
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parent
PLUGIN_FILES = (
    'manifest.json', 'logo.png', 'THIRD_PARTY_NOTICES.md', 'bin/keychain',
    'index.html', 'inspector.html', 'settings.css', 'style.css',
    'core.js', 'credentials.js', 'encode.js', 'engine.js', 'inspector.js',
    'main.js', 'media.js', 'mirror.js', 'scope.js', 'storage.js', 'tinypng.js',
)
SOURCE_FILES = (
    '.gitignore', 'README.md', 'TEST-RESULTS.md', 'THIRD_PARTY_NOTICES.md',
    'UPLOAD-DESIGN.md', 'LOGO.md', 'build.py', 'package.json', 'package-lock.json',
    'src/keychain.c', 'test/browser-smoke.cjs', 'test/core.test.js',
    'test/credentials.test.js', 'test/media.test.js', 'test/mirror.test.js',
    'test/tinypng.test.js', 'test/test_build.py',
)

def add(z, file, name, replacement=None):
    if file.is_symlink() or not file.is_file():
        raise ValueError('Missing or unsafe build input: ' + name)
    info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
    info.create_system = 3
    info.external_attr = (0o100755 if name.endswith('bin/keychain') else 0o100644) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    z.writestr(info, replacement if replacement is not None else file.read_bytes())

def pack(dest, manifest=None):
    dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dest, 'w') as z:
        for name in PLUGIN_FILES:
            replacement = json.dumps(manifest, ensure_ascii=False, indent=2).encode() if name == 'manifest.json' and manifest else None
            add(z, ROOT/'plugin'/name, name, replacement)
    with zipfile.ZipFile(dest) as z:
        assert z.testzip() is None
        assert set(z.namelist()) == set(PLUGIN_FILES)
        assert z.getinfo('bin/keychain').external_attr >> 16 & 0o111
    return dest

def build(output):
    output.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT/'plugin/manifest.json').read_text())
    version = manifest['version']
    assert version == json.loads((ROOT/'package.json').read_text())['version']
    paths = [pack(output/f'Honeycyj-R2-Sync-{version}.eagleplugin')]
    background = {**manifest, 'id': 'HONEYR2BG00001', 'name': 'R2 发布 · 后台'}
    background.pop('preview')
    inspector = {**manifest, 'id': 'HONEYR2INSP001', 'name': 'R2 发布 · 详情'}
    inspector.pop('main')
    paths += [pack(output/'fallback'/f'Honeycyj-R2-Background-{version}.eagleplugin', background),
              pack(output/'fallback'/f'Honeycyj-R2-Inspector-{version}.eagleplugin', inspector)]
    source = output/f'Eagle-R2-Sync-{version}-source.zip'
    with zipfile.ZipFile(source, 'w') as z:
        for name in SOURCE_FILES:
            add(z, ROOT/name, 'eagle-r2-sync/'+name)
        for name in PLUGIN_FILES:
            add(z, ROOT/'plugin'/name, 'eagle-r2-sync/plugin/'+name)
    paths.append(source)
    (output/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.relative_to(output).as_posix()+'\n' for p in paths))
    return paths

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'dist')
    args = parser.parse_args()
    for result in build(args.output.resolve()):
        print(result)
