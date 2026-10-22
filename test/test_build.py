"""Keep local state and arbitrary files out of both release packages and source archives."""
from pathlib import Path
import hashlib
import importlib.util
import secrets
import shutil
import tempfile
import unittest
import zipfile

PROJECT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('builder', PROJECT/'build.py')
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

class PackageTests(unittest.TestCase):
    def test_allowlists_exclude_private_files_and_build_is_repeatable(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)/'project'
            for name in (*builder.SOURCE_FILES, *('plugin/'+n for n in builder.PLUGIN_FILES)):
                target = root/name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(PROJECT/name, target)
            sentinel = secrets.token_hex(32).encode()
            for name in ('config.json', '.env', 'state-private.json', 'plugin/config.json',
                         'plugin/window-state.json', 'plugin/smoke.html', 'test/private.json',
                         'src/secret.txt', 'node_modules/private.txt'):
                file = root/name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(sentinel)
            original = builder.ROOT
            try:
                builder.ROOT = root
                outputs = builder.build(Path(temp)/'dist')
                digests = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in outputs}
                for p in outputs:
                    with zipfile.ZipFile(p) as z:
                        self.assertIsNone(z.testzip())
                        for name in z.namelist():
                            self.assertNotIn(sentinel, z.read(name))
                main = outputs[0]
                with zipfile.ZipFile(main) as z:
                    self.assertEqual(set(z.namelist()), set(builder.PLUGIN_FILES))
                    self.assertTrue(z.getinfo('bin/keychain').external_attr >> 16 & 0o111)
                    self.assertIn("domain:''", z.read('storage.js').decode())
                rebuilt = builder.build(Path(temp)/'dist')
                self.assertEqual(digests, {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in rebuilt})
            finally:
                builder.ROOT = original

    def test_symlink_input_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root/'private.txt').write_text('private')
            (root/'link.js').symlink_to(root/'private.txt')
            with zipfile.ZipFile(root/'test.zip', 'w') as z:
                with self.assertRaises(ValueError):
                    builder.add(z, root/'link.js', 'link.js')
