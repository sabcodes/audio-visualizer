#!/usr/bin/env python3
# repo-security-gate scanner v2
"""Offline, redacted publication checks. Hooks inspect Git objects, never unstaged substitutes."""
import argparse
import base64
import binascii
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import struct
import subprocess
import sys
import zipfile
import zlib

MAX_FILE = 64 * 1024 * 1024
MAX_METADATA = 4 * 1024 * 1024
MAX_EXPANDED = 128 * 1024 * 1024
PNG = b'\x89PNG\r\n\x1a\n'
PNG_PRIVATE = {b'tEXt', b'zTXt', b'iTXt', b'eXIf'}
MARKER = 'repo-security-gate managed v2'
HOME_PATH = re.compile(rb'(?i)(?:/(?:Users|home)/[a-z0-9][a-z0-9._-]*(?=[/\\\s"\x27`<>\x00]|$)|[a-z]:[\\/]Users[\\/][a-z0-9][a-z0-9._-]*)')
RULES = {
    'private-key': re.compile(rb'-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY(?: BLOCK)?-----'),
    'provider-token': re.compile(rb'\b(?:gh[pousr]_[A-Za-z0-9]{30,255}|github_pat_[A-Za-z0-9_]{30,255}|(?:AKIA|ASIA)[A-Z0-9]{16}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{35}|xox[baprs]-[A-Za-z0-9-]{20,}|(?:sk|rk)_live_[A-Za-z0-9]{16,})\b'),
    'credential-assignment': re.compile(rb'(?i)\b(?:password|passwd|client[_-]?secret|private[_-]?key|api[_-]?key|access[_-]?token|auth[_-]?token)\b["\x27]?\s*[:=]\s*["\x27]([^"\x27\r\n]{8,200})["\x27]'),
    'credential-url': re.compile(rb'[a-zA-Z][a-zA-Z0-9+.-]*://[^\s/:<>"\x00]{1,100}:[^\s/@<>"\x00]{1,200}@'),
    'jwt': re.compile(rb'\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b'),
    'personal-home-path': HOME_PATH,
    'mac-private-temp': re.compile(rb'/(?:private/)?var/folders/[a-zA-Z0-9_/.-]{8,}'),
    'device-hostname': re.compile(rb'(?i)\b[a-z0-9][a-z0-9-]{2,60}(?:-MacBook(?:-Pro|-Air)?|-iMac|\.local)\b'),
    'hardware-model': re.compile(rb'(?i)\b(?:Apple[ \t]+M[1-9][0-9]?(?:[ \t]+(?:Pro|Max|Ultra))?|MacBook(?:Pro|Air)?[0-9]{1,2},[0-9]{1,2}|NVIDIA[ \t]+(?:GeForce[ \t]+)?(?:RTX|GTX)[ \t]+[0-9]{3,4}|AMD[ \t]+Radeon[ \t]+RX[ \t]+[0-9]{3,4})\b'),
    'private-network-address': re.compile(rb'\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b'),
    'device-mac-address': re.compile(rb'(?i)\b(?:[a-f0-9]{2}:){5}[a-f0-9]{2}\b'),
    'contact-email': re.compile(rb'(?i)(?<![a-z0-9._%+-])[a-z0-9][a-z0-9._%+-]{0,80}@[a-z0-9.-]+\.[a-z]{2,20}\b'),
}


def git(*args, data=None, allow_failure=False):
    result = subprocess.run(['git', *args], input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode and not allow_failure:
        raise ValueError('Git operation failed; scan is incomplete')
    return result


def root():
    return Path(os.fsdecode(git('rev-parse', '--show-toplevel').stdout).strip())


def safe_path(path):
    # A path itself can contain private information or terminal control characters.
    data = HOME_PATH.sub(b'[HOME]', os.fsencode(path))
    data = RULES['contact-email'].sub(b'[EMAIL]', data)
    for detector, regex in RULES.items():
        if detector not in ('personal-home-path', 'contact-email'):
            data = regex.sub(b'[REDACTED]', data)
    return ''.join(c if c.isprintable() else '?' for c in os.fsdecode(data))


class Scanner:
    def __init__(self):
        self.findings = []
        self.files = 0
        self.bytes = 0
        self.expanded = 0
        self.identities = set()

    def identity(self, data, label):
        permitted = git('config', '--local', '--get-all', 'securitygate.allowedcommitemailhash', allow_failure=True).stdout.splitlines()
        for match in RULES['contact-email'].finditer(data):
            email = match.group()
            fingerprint = hashlib.sha256(email.lower()).hexdigest().encode()
            if fingerprint in permitted or fingerprint in self.identities:
                continue
            self.identities.add(fingerprint)
            self.text(email, label, 'commit identity')

    def finding(self, path, detector, evidence=b'', line=None, location='content'):
        self.findings.append({'path': safe_path(path), 'line': line, 'location': location, 'detector': detector,
            'severity': 'high' if detector in ('private-key', 'provider-token', 'credential-assignment', 'credential-url', 'jwt') else 'medium',
            'confidence': 'high', 'fingerprint': hashlib.sha256(evidence or os.fsencode(path)).hexdigest()[:12]})

    def text(self, data, path, location='content', binary=False):
        variants = [data]
        # EXIF and documents may contain UTF-16 paths; do not rely on raw ASCII strings alone.
        if b'\x00' in data:
            for encoding in ('utf-16-le', 'utf-16-be'):
                variants.append(data.decode(encoding, errors='ignore').encode('utf-8'))
        seen = set()
        for variant in variants:
            for detector, regex in RULES.items():
                # Compressed pixels can accidentally resemble an email or device identifier.
                if binary and detector in ('contact-email', 'device-mac-address', 'device-hostname', 'hardware-model', 'private-network-address'):
                    continue
                for match in regex.finditer(variant):
                    value = match.group()
                    if detector == 'credential-assignment':
                        candidate = match.group(1)
                        # Environment references and obvious templates are instructions, not literal credentials.
                        if re.match(rb'^(?:\$\{|\$[A-Z_]|<[^>]+>$|\[REDACTED\]$)', candidate):
                            continue
                    if detector == 'contact-email':
                        lower = value.lower()
                        # Public attribution addresses; this does not exempt personal commit emails.
                        if lower.endswith(b'@users.noreply.github.com') or lower in (b'noreply@github.com', b'noreply@anthropic.com'):
                            continue
                    key = (detector, hashlib.sha256(value).digest())
                    if key in seen:
                        continue
                    seen.add(key)
                    line = variant[:match.start()].count(b'\n') + 1 if location == 'content' and not binary else None
                    self.finding(path, detector, value, line, location)

    def metadata(self, data, path, depth=0):
        if depth > 3:
            raise ValueError('nested container limit')
        if data.startswith(PNG):
            for kind, chunk, encoded in png_chunks(data):
                if kind == b'zTXt':
                    key, rest = chunk.split(b'\0', 1)
                    if rest[0] != 0:
                        raise ValueError('unknown PNG compression')
                    chunk = key + b' ' + inflate(rest[1:])
                elif kind == b'iTXt':
                    key, rest = chunk.split(b'\0', 1)
                    flag, method = rest[:2]
                    language, translated, content = rest[2:].split(b'\0', 2)
                    if flag not in (0, 1) or method != 0:
                        raise ValueError('unknown PNG compression')
                    chunk = key + b' ' + (inflate(content) if flag else content)
                if kind in PNG_PRIVATE:
                    self.text(chunk, path, 'PNG metadata')
            return
        if data.startswith(b'\xff\xd8'):
            offset = 2
            while offset + 4 <= len(data):
                if data[offset] != 255:
                    raise ValueError('invalid JPEG segment')
                marker = data[offset+1]
                offset += 2
                if marker in (0xda, 0xd9):
                    break
                if marker in range(0xd0, 0xd9) or marker == 0x01:
                    continue
                size = int.from_bytes(data[offset:offset+2], 'big')
                if size < 2 or offset + size > len(data):
                    raise ValueError('truncated JPEG')
                if marker in (0xe1, 0xed, 0xfe):
                    self.text(data[offset+2:offset+size], path, 'JPEG metadata')
                offset += size
            return
        if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            offset = 12
            while offset + 8 <= len(data):
                kind, size = data[offset:offset+4], int.from_bytes(data[offset+4:offset+8], 'little')
                if offset + size + 8 > len(data):
                    raise ValueError('truncated WebP')
                if kind in (b'EXIF', b'XMP '):
                    self.text(data[offset+8:offset+8+size], path, 'WebP metadata')
                offset += size + 8 + size % 2
            return
        if data.startswith(b'glTF'):
            if len(data) < 20 or int.from_bytes(data[8:12], 'little') != len(data):
                raise ValueError('invalid GLB')
            size = int.from_bytes(data[12:16], 'little')
            content = data[20:20+size]
            model = json.loads(content)
            self.text(content, path, 'GLB JSON')
            binary = data[28+size:]
            for image in model.get('images', []):
                if 'bufferView' in image:
                    view = model['bufferViews'][image['bufferView']]
                    at, count = view.get('byteOffset', 0), view['byteLength']
                    if at + count > len(binary):
                        raise ValueError('invalid embedded image bounds')
                    self.metadata(binary[at:at+count], path, depth + 1)
                elif image.get('uri', '').startswith('data:'):
                    header, encoded = image['uri'].split(',', 1)
                    if not header.endswith(';base64'):
                        raise ValueError('unsupported embedded image encoding')
                    self.metadata(base64.b64decode(encoded, validate=True), path, depth + 1)
            return
        if data.startswith((b'PK\x03\x04', b'PK\x05\x06')):
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                self.text(archive.comment, path, 'ZIP comment')
                members = archive.infolist()
                if len(members) > 1000:
                    raise ValueError('archive entry limit')
                for member in members:
                    if member.is_dir():
                        continue
                    self.expanded += member.file_size
                    if member.flag_bits & 1 or member.file_size > MAX_FILE or self.expanded > MAX_EXPANDED:
                        raise ValueError('encrypted archive or expansion limit')
                    label = path + '!' + member.filename
                    self.text(member.comment, label, 'ZIP comment')
                    self.blob(label, archive.read(member), depth + 1)
            return
        if data.startswith((b'7z\xbc\xaf\x27\x1c', b'Rar!', b'\x1f\x8b')):
            self.finding(path, 'archive-requires-review', location='container')
            return
        binary = b'\0' in data[:4096]
        self.text(data, path, binary=binary)
        if not binary and path.endswith('.json'):
            try:
                self.hardware(json.loads(data), path)
            except json.JSONDecodeError:
                pass

    def hardware(self, value, path):
        if isinstance(value, dict):
            for key, item in value.items():
                if isinstance(item, str) and item and item not in ('redacted', '[REDACTED]'):
                    if key.lower() in ('useragent', 'serialnumber', 'hardwareuuid', 'computername') or (
                        key.lower() in ('vendor', 'device', 'architecture', 'description') and re.search(r'Apple|Intel|NVIDIA|AMD|MacIntel|Mac OS|Metal', item, re.I)):
                        self.finding(path, 'device-diagnostics', item.encode(), location='JSON diagnostic field')
                self.hardware(item, path)
        elif isinstance(value, list):
            for item in value:
                self.hardware(item, path)

    def blob(self, path, data, depth=0):
        self.files += 1
        self.bytes += len(data)
        segments = re.split(r'[!\\/]', path)
        base = segments[-1].lower()
        if ((base == '.env' or base.startswith('.env.')) and base not in ('.env.example', '.env.sample', '.env.template')) or (
            base in ('.ds_store', '.netrc', '.npmrc', 'id_rsa', 'id_ed25519', 'credentials.json', 'user-settings.json') or
            base.endswith(('.pem', '.p12', '.pfx', '.key', '.sqlite', '.sqlite3', '.db', '.log', '.7z', '.tar', '.gz', '.rar')) or
            '.playwright-mcp' in segments or '__MACOSX' in segments or any(p in segments for p in ('.git', '.ssh', '.aws'))):
            self.finding(path, 'private-or-archive-file', location='filename')
        self.text(os.fsencode(path), path, 'filename')
        if len(data) > MAX_FILE:
            self.finding(path, 'scan-size-limit', location='scan error')
            return
        try:
            self.metadata(data, path, depth)
        except (ValueError, TypeError, IndexError, KeyError, struct.error, zlib.error, binascii.Error, zipfile.BadZipFile, NotImplementedError, RuntimeError):
            self.finding(path, 'unreadable-metadata', location='scan error')

    def report(self, mode):
        print(json.dumps({'mode': mode, 'files': self.files, 'bytes': self.bytes, 'findings': self.findings}, indent=2))
        return 1 if self.findings else 0


def inflate(data):
    decoder = zlib.decompressobj()
    value = decoder.decompress(data, MAX_METADATA + 1)
    if len(value) > MAX_METADATA or not decoder.eof:
        raise ValueError('metadata decompression limit')
    return value


def png_chunks(data):
    offset = 8
    while offset + 12 <= len(data):
        size = int.from_bytes(data[offset:offset+4], 'big')
        end = offset + size + 12
        if end > len(data):
            raise ValueError('truncated PNG')
        kind, value = data[offset+4:offset+8], data[offset+8:end-4]
        if offset == 8 and (kind != b'IHDR' or size != 13):
            raise ValueError('missing PNG header')
        if zlib.crc32(kind + value) != int.from_bytes(data[end-4:end], 'big'):
            raise ValueError('invalid PNG checksum')
        yield kind, value, data[offset:end]
        offset = end
        if kind == b'IEND':
            if size != 0 or offset != len(data):
                raise ValueError('trailing PNG data')
            return
    raise ValueError('missing PNG end')


def staged(scanner):
    for role in ('GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT'):
        scanner.identity(git('var', role).stdout, role)
    names = git('diff', '--cached', '--name-only', '--diff-filter=ACMRTUXB', '-z').stdout.split(b'\0')
    index = {}
    for record in git('ls-files', '--stage', '-z').stdout.split(b'\0'):
        if record:
            metadata, path = record.split(b'\t', 1)
            mode, oid, stage = metadata.split()
            if stage != b'0':
                raise ValueError('unmerged index entries; resolve conflicts before scanning')
            index[path] = (mode, oid)
    for name in names:
        if not name:
            continue
        mode, oid = index[name]
        if mode == b'160000':
            scanner.finding(os.fsdecode(name), 'submodule-requires-review')
        else:
            read_blob(scanner, oid.decode(), os.fsdecode(name))


def read_blob(scanner, oid, path):
    size = int(git('cat-file', '-s', oid).stdout)
    if size > MAX_FILE:
        scanner.finding(path, 'scan-size-limit', location='scan error')
    else:
        scanner.blob(path, git('cat-file', 'blob', oid).stdout)


def scan_objects(scanner, revisions):
    # Explicit remote branch/tag refs only. --all would also include local Codex checkpoint trees.
    rows = git('rev-list', '--objects', *revisions).stdout.splitlines()
    commits = git('log', '--format=%H%x00%ae%x00%ce%x00%B%x00', *revisions).stdout.split(b'\0')
    for i in range(0, len(commits) - 3, 4):
        oid, author, committer, message = commits[i:i+4]
        label = 'commit ' + oid.strip().decode()[:12]
        scanner.identity(author, label)
        scanner.identity(committer, label)
        scanner.text(message, label, 'commit message')
    request = b'\n'.join(row.split(b' ', 1)[0] for row in rows) + b'\n'
    metadata = git('cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)', data=request).stdout.splitlines()
    for row, entry in zip(rows, metadata):
        oid, kind, size = entry.split()
        if kind != b'blob':
            continue
        bits = row.split(b' ', 1)
        path = os.fsdecode(bits[1]) if len(bits) > 1 else '(historical blob)'
        if int(size) > MAX_FILE:
            scanner.finding(path, 'scan-size-limit', location='scan error')
        else:
            read_blob(scanner, oid.decode(), path)


def history_refs():
    refs = git('for-each-ref', '--format=%(refname)', 'refs/remotes', 'refs/tags').stdout.decode().splitlines()
    return refs or ['HEAD']


def outgoing(scanner, remote, payload):
    for row in payload.splitlines():
        fields = row.split()
        if len(fields) != 4:
            raise ValueError('invalid pre-push input')
        local_ref, local_oid, remote_ref, remote_oid = [os.fsdecode(value) for value in fields]
        if not all(re.fullmatch(r'(?:[0-9a-f]{40}|[0-9a-f]{64})', oid) for oid in (local_oid, remote_oid)):
            raise ValueError('invalid push object ID')
        if set(local_oid) == {'0'}:
            continue  # Branch deletion publishes no content.
        if set(remote_oid) != {'0'}:
            revisions = [local_oid, '--not', remote_oid]
        else:
            refs = git('for-each-ref', '--format=%(refname)', 'refs/remotes/' + remote + '/').stdout.decode().splitlines()
            revisions = [local_oid] + (['--not', *refs] if refs else [])
        scan_objects(scanner, revisions)


def install(repo):
    source = Path(__file__).resolve()
    destination = repo / 'scripts/security_scan.py'
    if source != destination:
        if destination.exists() and b'repo-security-gate scanner v2' not in destination.read_bytes():
            raise ValueError('refusing to overwrite an unrelated scanner')
        destination.parent.mkdir(exist_ok=True)
        destination.write_bytes(source.read_bytes())
    common = Path(os.fsdecode(git('rev-parse', '--git-common-dir').stdout).strip()).resolve()
    effective = git('config', '--get', 'core.hooksPath', allow_failure=True).stdout.decode().strip()
    hook_dir = (Path(effective) if Path(effective).is_absolute() else repo / effective) if effective else common / 'hooks'
    hook_dir = hook_dir.resolve()
    # Do not modify a global/shared hooks directory outside this repository.
    if not (hook_dir.is_relative_to(repo) or hook_dir.is_relative_to(common)):
        raise ValueError('hooks are outside this repository; choose a repository-local hooksPath before installation')
    hook_dir.mkdir(parents=True, exist_ok=True)
    for name in ('pre-commit', 'pre-push'):
        hook, previous = hook_dir / name, hook_dir / (name + '.security-gate-previous')
        if hook.exists() and MARKER not in hook.read_text(errors='replace'):
            if previous.exists():
                raise ValueError('existing hook backup would be overwritten')
            hook.rename(previous)
        wrapper = f'''#!/bin/sh
# {MARKER}
set -eu
repo=$(git rev-parse --show-toplevel)
hook_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec python3 "$repo/scripts/security_scan.py" hook {name} "$hook_dir/{previous.name}" "$@"
'''
        hook.write_text(wrapper)
        hook.chmod(0o755)
    print('Installed repository-local pre-commit and pre-push gates; previous hooks are chained when present.')


def sanitize(path, write):
    if path.is_symlink():
        raise ValueError('refusing to sanitize a symlink')
    data = path.read_bytes()
    if data.startswith(PNG):
        pieces = [PNG]
        for kind, value, encoded in png_chunks(data):
            if kind not in PNG_PRIVATE:
                pieces.append(encoded)
        clean = b''.join(pieces)
    elif path.suffix.lower() in ('.md', '.txt', '.rst'):
        data.decode('utf-8')  # Do not corrupt binary/legacy-encoded files.
        clean = HOME_PATH.sub(b'$HOME', data)
    else:
        raise ValueError('automatic cleanup supports PNG metadata and documentation home paths only; source code and credentials require manual review')
    if clean != data and write:
        permissions = stat.S_IMODE(path.stat().st_mode)
        # Replace atomically; never stage the result or change history.
        temporary = path.with_name(path.name + '.security-cleanup.tmp')
        with temporary.open('xb') as output:
            output.write(clean)
        temporary.chmod(permissions)
        os.replace(temporary, path)
    print(json.dumps({'path': safe_path(str(path)), 'changed': clean != data, 'written': clean != data and write}))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['check-staged', 'scan-repo', 'check-history', 'check-commit', 'check-range', 'pre-push', 'hook', 'install', 'sanitize'])
    parser.add_argument('--write', action='store_true', help='explicitly write PNG/document cleanup')
    parser.add_argument('arguments', nargs='*')
    args = parser.parse_intermixed_args(argv)
    try:
        repo = root()
        os.chdir(repo)
        if args.mode == 'install':
            install(repo)
            return 0
        if args.mode == 'sanitize':
            if not args.arguments:
                raise ValueError('supply the exact files to sanitize')
            for value in args.arguments:
                path = Path(value).resolve()
                if not path.is_relative_to(repo):
                    raise ValueError('cleanup is limited to this repository')
                sanitize(path, args.write)
            return 0
        scanner = Scanner()
        mode, payload, previous = args.mode, b'', None
        if mode == 'hook':
            if len(args.arguments) < 2 or args.arguments[0] not in ('pre-commit', 'pre-push'):
                raise ValueError('invalid hook invocation')
            hook, previous, *forward = args.arguments
            mode = 'check-staged' if hook == 'pre-commit' else 'pre-push'
            args.arguments = forward
        if mode == 'check-staged':
            staged(scanner)
        elif mode == 'scan-repo':
            for raw in git('ls-files', '-z').stdout.split(b'\0'):
                if not raw:
                    continue
                path = Path(os.fsdecode(raw))
                if path.is_symlink():
                    scanner.blob(str(path), os.fsencode(os.readlink(path)))
                elif path.is_file():
                    if path.stat().st_size > MAX_FILE:
                        scanner.finding(str(path), 'scan-size-limit', location='scan error')
                    else:
                        scanner.blob(str(path), path.read_bytes())
        elif mode == 'check-history':
            scan_objects(scanner, history_refs())
        elif mode == 'check-commit' and len(args.arguments) == 1:
            commit = git('rev-parse', '--verify', args.arguments[0] + '^{commit}').stdout.decode().strip()
            parents = git('rev-list', '--parents', '-n', '1', commit).stdout.decode().split()[1:]
            scan_objects(scanner, [commit] + (['--not', *parents] if parents else []))
        elif mode == 'check-range' and len(args.arguments) == 1 and '..' in args.arguments[0]:
            first, last = args.arguments[0].split('..', 1)
            tips = [git('rev-parse', '--verify', ref + '^{commit}').stdout.decode().strip() for ref in (first, last)]
            scan_objects(scanner, [tips[1], '--not', tips[0]])
        elif mode == 'pre-push' and args.arguments:
            payload = sys.stdin.buffer.read()
            outgoing(scanner, args.arguments[0], payload)
        else:
            raise ValueError('invalid command arguments')
        status = scanner.report(mode)
        if status == 0 and previous and os.access(previous, os.X_OK):
            return subprocess.run([previous, *args.arguments], input=payload if mode == 'pre-push' else None).returncode
        return status
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        # Error values can contain a private path, URL or payload; do not echo exceptions.
        print(json.dumps({'status': 'blocked', 'reason': 'scan or installation failed; review command arguments, Git state, file formats and size limits', 'error_type': type(error).__name__}))
        return 2


if __name__ == '__main__':
    sys.exit(main())
