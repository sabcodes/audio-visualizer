"""Behavioral tests use disposable repositories below ignored test-results; no network."""
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import tempfile
import unittest
import zipfile
import zlib

ROOT = Path(__file__).resolve().parents[1]
SCANNER = ROOT / 'scripts/security_scan.py'
spec = importlib.util.spec_from_file_location('security_scan', SCANNER)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))


def picture(metadata=b'', kind=b'tEXt'):
    return (gate.PNG + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 6, 0, 0, 0))
        + (chunk(kind, metadata) if metadata else b'') + chunk(b'IDAT', zlib.compress(b'\0\xff\0\0\xff')) + chunk(b'IEND', b''))


class SecurityGateTests(unittest.TestCase):
    def setUp(self):
        folder = ROOT / 'test-results'
        folder.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(prefix='security-gate-', dir=folder)
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name)
        self.run_git('init', '-q')
        self.run_git('config', 'user.name', 'Gate Fixture')
        self.run_git('config', 'user.email', 'fixture@users.noreply.github.com')
        self.run_git('config', 'core.hooksPath', '.git/hooks')
        self.write('README.md', 'Public project.\n')
        self.run_git('add', 'README.md')
        self.run_git('commit', '-qm', 'Initial fixture')

    def run_git(self, *args):
        return subprocess.run(['git', *args], cwd=self.repo, capture_output=True, check=True).stdout

    def write(self, name, data):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data.encode() if isinstance(data, str) else data)
        return path

    def scan(self, mode='check-staged', *args, payload=None):
        result = subprocess.run(['python3', '-B', str(SCANNER), mode, *args], cwd=self.repo, input=payload, capture_output=True)
        return result.returncode, json.loads(result.stdout)

    def test_staged_content_cannot_be_hidden_by_an_unstaged_cleanup(self):
        private = '/' + 'Users/' + 'private-fixture/' + 'Downloads/model.glb'
        self.write('notes.md', private)
        self.run_git('add', 'notes.md')
        self.write('notes.md', 'Now clean only in the working tree.')
        status, report = self.scan()
        self.assertEqual(status, 1)
        self.assertEqual(report['findings'][0]['detector'], 'personal-home-path')
        self.assertNotIn(private, json.dumps(report))
        self.assertNotIn('private-fixture', json.dumps(report))
        self.run_git('add', 'notes.md')
        self.assertEqual(self.scan()[0], 0)

    def test_provider_credentials_and_utf16_paths_are_redacted(self):
        token = 'ghp_' + 'A1b2' * 10
        private = 'C:' + '\\Users\\' + 'private-fixture\\secret'
        self.write('config.txt', token)
        self.write('windows.txt', private.encode('utf-16-le'))
        self.run_git('add', 'config.txt', 'windows.txt')
        status, report = self.scan()
        self.assertEqual(status, 1)
        self.assertTrue({'provider-token', 'personal-home-path'} <= {f['detector'] for f in report['findings']})
        self.assertNotIn(token, json.dumps(report))

    def test_compressed_image_metadata_is_scanned_and_cleanup_preserves_pixels(self):
        private = ('/' + 'Users/' + 'private-fixture/project.blend').encode()
        data = picture(b'File\0\0' + zlib.compress(private), b'zTXt')
        self.write('render.png', data)
        self.run_git('add', 'render.png')
        status, report = self.scan()
        self.assertEqual(status, 1)
        self.assertEqual(report['findings'][0]['location'], 'PNG metadata')
        self.assertEqual(self.scan('sanitize', 'render.png')[0], 0)
        self.assertEqual((self.repo / 'render.png').read_bytes(), data)  # Dry run.
        self.assertEqual(self.scan('sanitize', '--write', 'render.png')[0], 0)
        self.assertEqual((self.repo / 'render.png').read_bytes(), picture())
        self.assertEqual(self.scan()[0], 1)  # Sanitizing does not silently restage.
        self.run_git('add', 'render.png')
        self.assertEqual(self.scan()[0], 0)

    def test_glb_embedded_image_and_jpeg_metadata_are_scanned(self):
        private = ('/' + 'Users/' + 'private-fixture/render.blend').encode()
        image = picture(b'File\0' + private)
        model = json.dumps({'asset': {'version': '2.0'}, 'buffers': [{'byteLength': len(image)}],
            'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': len(image)}], 'images': [{'bufferView': 0, 'mimeType': 'image/png'}]}).encode()
        model += b' ' * (-len(model) % 4)
        binary = image + b'\0' * (-len(image) % 4)
        glb = b'glTF' + struct.pack('<II', 2, 28 + len(model) + len(binary)) + struct.pack('<I', len(model)) + b'JSON' + model + struct.pack('<I', len(binary)) + b'BIN\0' + binary
        jpeg = b'\xff\xd8\xff\xe1' + struct.pack('>H', len(private) + 2) + private + b'\xff\xd9'
        self.write('model.glb', glb)
        self.write('photo.jpg', jpeg)
        self.run_git('add', 'model.glb', 'photo.jpg')
        status, report = self.scan()
        self.assertEqual(status, 1)
        self.assertEqual({f['location'] for f in report['findings']}, {'PNG metadata', 'JPEG metadata'})

    def test_environment_files_archives_and_diagnostics_are_blocked(self):
        for name, data in [('.env', 'MODE=public'), ('bundle.zip', b'PK\x03\x04'), ('results.json', json.dumps({'adapter': {'vendor': 'apple'}}))]:
            self.write(name, data)
            self.run_git('add', name)
        status, report = self.scan()
        self.assertEqual(status, 1)
        self.assertTrue({'private-or-archive-file', 'device-diagnostics'} <= {f['detector'] for f in report['findings']})

    def test_legitimate_zip_is_scanned_and_nested_image_leaks_are_blocked(self):
        def archive(content):
            output = io.BytesIO()
            with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
                z.writestr('source/preview.png', content)
            return output.getvalue()
        self.write('model-source.zip', archive(picture()))
        self.run_git('add', 'model-source.zip')
        self.assertEqual(self.scan()[0], 0)
        self.write('model-source.zip', archive(picture(b'File\0' + ('/' + 'Users/' + 'private-fixture/render.blend').encode())))
        self.run_git('add', 'model-source.zip')
        status, report = self.scan()
        self.assertEqual(status, 1)
        self.assertIn('model-source.zip!source/preview.png', report['findings'][0]['path'])

    def test_token_in_filename_is_also_redacted(self):
        token = 'ghp_' + 'A1b2' * 10
        self.write(token + '.txt', 'Public content')
        self.run_git('add', '--all')
        status, report = self.scan()
        self.assertEqual(status, 1)
        self.assertNotIn(token, json.dumps(report))

    def test_personal_commit_email_needs_an_exact_local_permission(self):
        import hashlib
        email = 'private-fixture' + '@' + 'example.org'
        self.run_git('config', 'user.email', email)
        status, report = self.scan()
        self.assertEqual(status, 1)
        self.assertEqual(report['findings'][0]['location'], 'commit identity')
        self.run_git('config', '--add', 'securitygate.allowedcommitemailhash', hashlib.sha256(email.encode()).hexdigest())
        self.assertEqual(self.scan()[0], 0)
        self.write('notes.md', email)
        self.run_git('add', 'notes.md')
        self.assertEqual(self.scan()[0], 1)  # Identity permission never exempts file contents.

    def test_malformed_metadata_and_git_failures_fail_closed(self):
        self.write('broken.png', gate.PNG + b'\0\0\x10\0tEXtshort')
        self.run_git('add', 'broken.png')
        self.assertEqual(self.scan()[0], 1)
        status, report = self.scan('check-commit', 'missing-revision')
        self.assertEqual(status, 2)
        self.assertEqual(report['status'], 'blocked')

    def test_remote_history_excludes_private_codex_checkpoint_trees(self):
        base = self.run_git('rev-parse', 'HEAD').decode().strip()
        self.run_git('update-ref', 'refs/remotes/origin/main', base)
        self.write('private.md', '/' + 'Users/' + 'private-fixture/notes')
        self.run_git('add', 'private.md')
        tree = self.run_git('write-tree').decode().strip()
        self.run_git('update-ref', 'refs/codex/turn-diffs/checkpoints/fixture', tree)
        self.assertEqual(self.scan('check-history')[0], 0)

    def test_pre_push_checks_intermediate_commits_even_when_tip_is_clean(self):
        base = self.run_git('rev-parse', 'HEAD').decode().strip()
        self.run_git('update-ref', 'refs/remotes/origin/main', base)
        self.write('notes.md', '/' + 'Users/' + 'private-fixture/notes')
        self.run_git('add', 'notes.md')
        self.run_git('commit', '-qm', 'Bad fixture')
        self.write('notes.md', 'Cleaned tip')
        self.run_git('add', 'notes.md')
        self.run_git('commit', '-qm', 'Clean fixture')
        tip = self.run_git('rev-parse', 'HEAD').decode().strip()
        payload = f'refs/heads/main {tip} refs/heads/main {base}\n'.encode()
        status, report = self.scan('pre-push', 'origin', payload=payload)
        self.assertEqual(status, 1)
        self.assertIn('personal-home-path', [f['detector'] for f in report['findings']])

    def test_install_preserves_hooks_and_blocks_an_actual_commit(self):
        hook = self.write('.git/hooks/pre-commit', '#!/bin/sh\nprintf chained > .git/chained\n')
        hook.chmod(0o755)
        result = subprocess.run(['python3', '-B', str(SCANNER), 'install'], cwd=self.repo, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertTrue((self.repo / '.git/hooks/pre-commit.security-gate-previous').exists())
        self.write('clean.md', 'No personal values.')
        self.run_git('add', 'clean.md')
        self.run_git('commit', '-qm', 'Allowed fixture')
        self.assertTrue((self.repo / '.git/chained').exists())
        (self.repo / '.git/chained').unlink()
        self.write('bad.md', '/' + 'Users/' + 'private-fixture/Downloads')
        self.run_git('add', 'bad.md')
        denied = subprocess.run(['git', 'commit', '-qm', 'Must be blocked'], cwd=self.repo, capture_output=True)
        self.assertNotEqual(denied.returncode, 0)
        self.assertFalse((self.repo / '.git/chained').exists())
        self.assertNotIn(b'private-fixture', denied.stdout + denied.stderr)

    def test_portable_scanner_and_its_tests_can_be_committed(self):
        self.write('scripts/security_scan.py', SCANNER.read_bytes())
        self.write('tests/security_gate_test.py', Path(__file__).read_bytes())
        self.run_git('add', '--all')
        self.assertEqual(self.scan()[0], 0)

    def test_pre_push_preserves_prior_hook_input_and_arguments(self):
        hook = self.write('.git/hooks/pre-push', '#!/bin/sh\ncat > .git/push-input\nprintf "%s\\n" "$@" > .git/push-args\n')
        hook.chmod(0o755)
        subprocess.run(['python3', '-B', str(SCANNER), 'install'], cwd=self.repo, capture_output=True, check=True)
        tip = self.run_git('rev-parse', 'HEAD').decode().strip()
        payload = f'refs/heads/main {tip} refs/heads/main {"0"*40}\n'.encode()
        result = subprocess.run([str(self.repo / '.git/hooks/pre-push'), 'origin', 'https://example.test/repo.git'], cwd=self.repo, input=payload, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout)
        self.assertEqual((self.repo / '.git/push-input').read_bytes(), payload)
        self.assertEqual((self.repo / '.git/push-args').read_text().splitlines(), ['origin', 'https://example.test/repo.git'])

    def test_deletions_and_unusual_filenames_do_not_break_index_scanning(self):
        self.run_git('rm', 'README.md')
        self.write('notes with spaces\nand newline.md', 'Public notes')
        self.run_git('add', '--all')
        self.assertEqual(self.scan()[0], 0)


if __name__ == '__main__':
    unittest.main()
