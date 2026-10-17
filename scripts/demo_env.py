"""Prepare an isolated VS Code Demo profile; never touch the normal user profile."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / 'demo'
EXTENSION = 'hymanimy.isabelle-revamp'
SETTINGS = {
    'security.workspace.trust.enabled': False,
    'update.mode': 'none',
    'extensions.autoUpdate': False,
    'extensions.autoCheckUpdates': False,
    'extensions.ignoreRecommendations': True,
    'workbench.tips.enabled': False,
    'workbench.startupEditor': 'none',
    'workbench.welcomePage.walkthroughs.openOnInstall': False,
    'workbench.enableExperiments': False,
    'chat.disableAIFeatures': True,
    'telemetry.telemetryLevel': 'off',
    'editor.fontSize': 16,
    'isabelleRevamp.prettySymbols': True,
    'isabelleRevamp.demoLayoutOnStartup': True,
    'isabelleRevamp.showAsk': False,
    'workbench.activityBar.location': 'hidden',
}
# Kept out of the stage window; demo/.vscode/settings.json is seeded with these.
HIDDEN = {'**/.demo': True, '**/*_solution.thy': True, '**/*_reference.thy': True}


def resolve_destination(path):
    """The demo folder to prepare. demo/ is committed; nothing else inside the repo."""
    destination = path.expanduser().resolve()
    if destination != DEMO and (destination == ROOT or ROOT in destination.parents
                                and '.dev-host' not in destination.parts):
        raise SystemExit('Use demo/, a .dev-host/ scratch directory, or a folder outside the repository.')
    return destination


def read_json(file):
    return json.loads(file.read_text()) if file.exists() else {}


def write_json(file, value):
    text = json.dumps(value, indent=2) + '\n'
    # The committed demo folder is a working tree: leave an unchanged file alone
    # so preparing the environment never shows up as a modification.
    if file.exists() and file.read_text() == text:
        return
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_suffix(file.suffix + '.tmp')
    temporary.write_text(text)
    temporary.replace(file)


def executable(name, candidates):
    found = shutil.which(name)
    if found:
        return str(Path(found).resolve())
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate.resolve())
    raise SystemExit(f'{name} not found. Install it or put it on PATH, then rerun.')


def prepare_profile(data, settings):
    # Observed with stock VS Code 1.138. CLI installation does not create a
    # missing profile. Seed only this dedicated user-data directory, before
    # launching Code; then use the supported CLI for every extension operation.
    lock = data / 'SingletonLock'
    if lock.is_symlink():
        try:
            os.kill(int(os.readlink(lock).rsplit('-', 1)[1]), 0)
        except (ProcessLookupError, ValueError):
            pass
        else:
            raise SystemExit('Close the Demo VS Code window before updating its environment.')
    storage_file = data / 'User/globalStorage/storage.json'
    storage = read_json(storage_file)
    profiles = storage.setdefault('userDataProfiles', [])
    profile = next((item for item in profiles if item['name'] == 'Demo'), None)
    if profile is None:
        profile = {'location': 'demo', 'name': 'Demo'}
        if any(item['location'] == 'demo' for item in profiles):
            raise SystemExit('The dedicated Demo profile path is already used by another profile.')
        profiles.append(profile)
        write_json(storage_file, storage)
    location = profile['location']
    if not isinstance(location, str) or '/' in location or '\\' in location or location in {'.', '..'}:
        raise SystemExit('Unsupported VS Code profile location; no settings changed.')
    for file in [data / 'User/settings.json', data / 'User/profiles' / location / 'settings.json']:
        current = read_json(file)
        current.update(settings)
        write_json(file, current)
    return location


def copy_theories(destination, previous):
    # Only for a scratch destination. The committed demo/ folder already owns
    # its theories, and git is a better reset than a hash table.
    if destination == DEMO:
        print(f'Theories are version-controlled in {DEMO.relative_to(ROOT)}; reset them with "git checkout demo/".')
        return {}
    cards = ROOT / 'examples/card'
    sources = [file for file in sorted(cards.glob('*.thy')) if not file.stem.endswith(('_solution', '_reference'))]
    if not sources:
        sources = [ROOT / 'examples/Sqrt2.thy']
        print('Card fixtures are not present yet; using the existing Sqrt2 theorem for the environment check.')
    hashes = dict(previous)
    for source in sources:
        target = destination / source.name
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        if target.exists():
            existing = hashlib.sha256(target.read_bytes()).hexdigest()
            if existing != digest and existing != previous.get(source.name):
                print(f'Preserved edited theory: {target}')
                continue
        shutil.copyfile(source, target)
        hashes[source.name] = digest
    return hashes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=DEMO)
    parser.add_argument('--vsix', type=Path, help='Use an existing VSIX instead of building the current source')
    args = parser.parse_args()
    destination = resolve_destination(args.directory)
    destination.mkdir(parents=True, exist_ok=True)
    private = destination / '.demo'
    data, extensions = private / 'user-data', private / 'extensions'
    metadata_file = private / 'environment.json'
    previous = read_json(metadata_file)
    code = executable('code', [Path('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code')])
    isabelle = executable('isabelle', [
        *sorted(Path('/Applications').glob('Isabelle*.app/bin/isabelle'), reverse=True),
        *sorted((Path.home() / 'hack/isabelle-env').glob('Isabelle*.app/bin/isabelle'), reverse=True),
        *sorted(Path.home().glob('Isabelle*/bin/isabelle'), reverse=True),
    ])
    settings = {**SETTINGS, 'isabelleRevamp.executable': isabelle}
    palette = read_json(ROOT / '.vscode/settings.json').get('editor.tokenColorCustomizations')
    if palette:
        settings['editor.tokenColorCustomizations'] = palette
    profile = prepare_profile(data, settings)
    if args.vsix:
        vsix = args.vsix.expanduser().resolve()
    else:
        if not (ROOT / 'extension/node_modules').is_dir():
            subprocess.run(['npm', 'ci', '--prefix', str(ROOT / 'extension')], check=True)
        subprocess.run(['npm', 'run', 'package', '--prefix', str(ROOT / 'extension')], check=True, cwd=ROOT)
        version = read_json(ROOT / 'extension/package.json')['version']
        vsix = ROOT / f'dist/isabelle-revamp-{version}.vsix'
    with ZipFile(vsix) as archive:
        manifest = json.loads(archive.read('extension/package.json'))
    if manifest['publisher'] + '.' + manifest['name'] != EXTENSION:
        raise SystemExit('The VSIX is not Isabelle Revamp.')
    cli = [code, '--user-data-dir', str(data), '--extensions-dir', str(extensions), '--profile', 'Demo']
    subprocess.run([*cli, '--install-extension', str(vsix), '--force'], check=True)
    installed = subprocess.check_output([*cli, '--list-extensions'], text=True).splitlines()
    for name in installed:
        if name.strip() and name.strip() != EXTENSION:
            subprocess.run([*cli, '--uninstall-extension', name.strip()], check=True)
    installed = subprocess.check_output([*cli, '--list-extensions'], text=True).splitlines()
    if installed != [EXTENSION]:
        raise SystemExit(f'Unexpected Demo extensions: {installed!r}')
    candidates = sorted(extensions.glob(EXTENSION + '-*/mcp/launch.py'))
    launcher = next((file for file in candidates if read_json(file.parents[1] / 'package.json')['version'] == manifest['version']), None)
    if not launcher:
        raise SystemExit('Installed extension has no bundled MCP launcher.')
    # Project-scoped Claude registration, leaving the user's global config alone.
    mcp_file = destination / '.mcp.json'
    mcp = read_json(mcp_file)
    mcp.setdefault('mcpServers', {})['isabelle'] = {'type': 'stdio', 'command': 'python3', 'args': [str(launcher), '--port-file', str(private / 'port')]}
    write_json(mcp_file, mcp)
    hashes = copy_theories(destination, previous.get('theories', {}))
    workspace_file = destination / '.vscode/settings.json'
    workspace = read_json(workspace_file)
    workspace.setdefault('files.exclude', {}).update(HIDDEN)
    workspace.setdefault('search.exclude', {}).update(HIDDEN)
    write_json(workspace_file, workspace)
    # Prepare the optional MCP runtime now, not during the stage request.
    subprocess.run(['python3', str(launcher), '--help'], check=True, stdout=subprocess.DEVNULL)
    # Beat 1 opens on Sqrt2; a scratch directory may only hold the card fixtures.
    opening = destination / 'Sqrt2.thy'
    if not opening.is_file():
        opening = next(iter(sorted(destination.glob('*.thy'))), None)
    launch = ['env', 'ISABELLE_REVAMP_PORT_FILE=' + str(private / 'port'), *cli, '--new-window',
              '--sync', 'off', '--skip-welcome', '--skip-release-notes', str(destination),
              *([str(opening)] if opening else [])]
    write_json(metadata_file, {'profile': profile, 'settings': settings, 'launch': launch,
                              'extension': str(launcher.parents[1]), 'theories': hashes})
    print(f'Prepared Demo: {destination}')
    print('Open it with this exact command:')
    print(shlex.join(launch))


if __name__ == '__main__':
    main()
