#!/usr/bin/env python3
"""Install pinned Linux x64 Android tools without administrator privileges."""
import argparse
from android_build_tools import normalize_ndk
import hashlib
import os
from pathlib import Path
import subprocess
import tarfile
from urllib.parse import urlparse
import zipfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--tools-dir', type=Path, required=True)
parser.add_argument('--accept-sdk-licenses', action='store_true')
parser.add_argument('--compile-native', action='store_true')
parser.add_argument('--java-truststore', type=Path)
parser.add_argument('--gradle-cache', type=Path, help='Separate Gradle cache location outside a synced workspace')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[1]
root = args.tools_dir.resolve()
if root == repo or repo in root.parents:
    parser.error('Keep build tools outside the source tree')
if not args.accept_sdk_licenses:
    parser.error('Review Android SDK terms, then supply --accept-sdk-licenses')
root.mkdir(parents=True, exist_ok=True)
if args.compile_native:
    patcher = repo / 'node_modules/patch-package/index.js'
    if not patcher.is_file():
        parser.error('Install JavaScript dependencies before native compilation')
    # Restored node_modules may predate the source checkpoint's security patches.
    subprocess.run(['node', str(patcher), '--error-on-fail'], cwd=repo, check=True)

def download(name, url, algorithm, expected):
    path = root / name
    def verified():
        if not path.is_file():
            return False
        digest = hashlib.new(algorithm)
        with path.open('rb') as source:
            for block in iter(lambda: source.read(1024 * 1024), b''):
                digest.update(block)
        return digest.hexdigest() == expected
    if not verified():
        temporary = path.with_suffix(path.suffix + '.part')
        subprocess.run(['curl', '-fLsS', '--retry', '2', '--max-time', '240', url, '-o', str(temporary)], check=True)
        temporary.replace(path)
    if not verified():
        raise RuntimeError('Checksum mismatch: ' + name)
    print('Verified ' + name, flush=True)
    return path

jdk = download('jdk17.tar.gz', 'https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.20.1%2B1/OpenJDK17U-jdk_x64_linux_hotspot_17.0.20.1_1.tar.gz', 'sha256', '3808d1d15e3ec6bd5b84057fb5d84c33d8a1536a258146bcea2e603fc726e08e')
if not (root / 'jdk').exists():
    stage = root / 'jdk-stage'
    stage.mkdir(exist_ok=True)
    with tarfile.open(jdk) as archive:
        archive.extractall(stage, filter='data')
    entries = list(stage.iterdir())
    if len(entries) != 1:
        raise RuntimeError('Unexpected JDK archive layout')
    entries[0].rename(root / 'jdk')
subprocess.run([str(root / 'jdk/bin/javac'), '-version'], check=True)

sdk = root / 'sdk'
sdk_zip = download('sdktools.zip', 'https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip', 'sha1', '5fdcc763663eefb86a5b8879697aa6088b041e70')
if not (sdk / 'cmdline-tools/19.0').exists():
    with zipfile.ZipFile(sdk_zip) as archive:
        archive.extractall(sdk / 'cmdline-tools')
    (sdk / 'cmdline-tools/cmdline-tools').rename(sdk / 'cmdline-tools/19.0')
    for path in (sdk / 'cmdline-tools/19.0/bin').iterdir():
        path.chmod(0o755)
gradle_zip = download('gradle.zip', 'https://downloads.gradle.org/distributions/gradle-9.0.0-bin.zip', 'sha256', '8fad3d78296ca518113f3d29016617c7f9367dc005f932bd9d93bf45ba46072b')
if not (root / 'gradle-9.0.0').exists():
    with zipfile.ZipFile(gradle_zip) as archive:
        archive.extractall(root)
(root / 'gradle-9.0.0/bin/gradle').chmod(0o755)
env = os.environ.copy()
env.update(JAVA_HOME=str(root / 'jdk'), ANDROID_HOME=str(sdk), GRADLE_USER_HOME=str((args.gradle_cache or root / 'gradle-cache').resolve()))
env['PATH'] = str(root / 'jdk/bin') + os.pathsep + env['PATH']
proxy = urlparse(env.get('HTTPS_PROXY', ''))
java_options = []
if proxy.hostname and proxy.port:
    java_options = [f'-D{scheme}.proxy{key}={value}' for scheme in ('http', 'https') for key, value in [('Host', proxy.hostname), ('Port', proxy.port)]]
if args.java_truststore:
    trust = args.java_truststore.resolve()
    if not trust.is_file():
        parser.error('Java trust store does not exist')
    java_options.append('-Djavax.net.ssl.trustStore=' + str(trust))
env['JAVA_OPTS'] = ' '.join(java_options)
packages = ['platforms;android-36', 'build-tools;36.0.0', 'ndk;27.3.13750724', 'ndk;27.0.12077973', 'cmake;3.22.1']
if not all((sdk / package.replace(';', '/') / 'package.xml').is_file() for package in packages):
    print('Installing SDK packages; see sdk-install.log', flush=True)
    with (root / 'sdk-install.log').open('w') as log:
        subprocess.run([str(sdk / 'cmdline-tools/19.0/bin/sdkmanager'), '--sdk_root=' + str(sdk), *packages], input='y\n' * 100, text=True, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
for revision in ('27.3.13750724', '27.0.12077973'):
    compiler = normalize_ndk(sdk / 'ndk' / revision, revision)
    subprocess.run([str(compiler), '--version'], check=True, stdout=subprocess.DEVNULL)
print('Android tools ready', flush=True)
if args.compile_native:
    print('Checking Java/Kotlin only; this does not verify APK or NPU', flush=True)
    with (root / 'native-compile.log').open('w') as log:
        result = subprocess.run([str(root / 'gradle-9.0.0/bin/gradle'), '--no-daemon', '--max-workers=2', '--stacktrace', *java_options, '-PreactNativeArchitectures=arm64-v8a', ':app:compileProdDebugKotlin', ':app:compileProdDebugJavaWithJavac'], cwd=repo / 'android', env=env, stdout=log, stderr=subprocess.STDOUT)
    print('Native compilation exit: ' + str(result.returncode), flush=True)
    raise SystemExit(result.returncode)
