import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from android_build_tools import CLANG, normalize_ndk


class BuildToolsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def fixture(self, name='', revision='27.3.13750724', compiler=True):
        root = self.root / name
        root.mkdir(parents=True, exist_ok=True)
        (root / 'source.properties').write_text('Pkg.Revision = ' + revision + '\n')
        if compiler:
            (root / CLANG).parent.mkdir(parents=True)
            (root / CLANG).write_text('fixture only; not executable')
        return root

    def test_direct(self):
        self.fixture()
        self.assertEqual(normalize_ndk(self.root, '27.3.13750724'), self.root / CLANG)

    def test_nested_matching_only(self):
        nested = self.fixture('android-ndk-r27d')
        unrelated = self.fixture('android-ndk-r27', '27.0.12077973')
        normalize_ndk(self.root, '27.3.13750724')
        self.assertFalse(nested.exists())
        self.assertTrue(unrelated.exists())
        self.assertTrue((self.root / CLANG).is_file())

    def test_wrong_direct_revision(self):
        self.fixture(revision='wrong')
        with self.assertRaises(RuntimeError): normalize_ndk(self.root, '27.3.13750724')

    def test_wrong_nested_revision(self):
        nested = self.fixture('nested', 'wrong')
        with self.assertRaises(RuntimeError): normalize_ndk(self.root, '27.3.13750724')
        self.assertTrue(nested.exists())

    def test_ambiguous(self):
        self.fixture('a'); self.fixture('b')
        with self.assertRaises(RuntimeError): normalize_ndk(self.root, '27.3.13750724')
        self.assertFalse((self.root / 'source.properties').exists())

    def test_conflict_before_mutation(self):
        nested = self.fixture('nested')
        (nested / 'other').write_text('keep')
        (self.root / 'toolchains').mkdir()
        with self.assertRaises(RuntimeError): normalize_ndk(self.root, '27.3.13750724')
        self.assertTrue((nested / 'other').is_file())
        self.assertTrue((nested / 'source.properties').is_file())

    def test_dangling_conflict(self):
        self.fixture('nested')
        (self.root / 'toolchains').symlink_to(self.root / 'missing')
        with self.assertRaises(RuntimeError): normalize_ndk(self.root, '27.3.13750724')
        self.assertFalse((self.root / 'source.properties').exists())

    def test_missing_compiler(self):
        nested = self.fixture('nested', compiler=False)
        with self.assertRaises(RuntimeError): normalize_ndk(self.root, '27.3.13750724')
        self.assertTrue((nested / 'source.properties').is_file())

    def test_npu_build_missing_sdk(self):
        env = {k: v for k, v in os.environ.items() if k not in ('HEXAGON_SDK_ROOT', 'HEXAGON_TOOLS_ROOT')}
        result = subprocess.run(['bash', str(Path(__file__).with_name('build-api-helper-npu.sh'))], env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('HEXAGON_SDK_ROOT', result.stderr)

    def test_npu_build_invalid_paths(self):
        env = dict(os.environ, HEXAGON_SDK_ROOT=str(self.root / 'absent'), HEXAGON_TOOLS_ROOT=str(self.root))
        result = subprocess.run(['bash', str(Path(__file__).with_name('build-api-helper-npu.sh'))], env=env, capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('refusing a CPU-only APK', result.stderr)


if __name__ == '__main__':
    unittest.main()
