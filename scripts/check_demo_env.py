"""Setup checks without touching the user's normal profile or launching a UI."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('demo_env', ROOT / 'scripts/demo_env.py')
demo = importlib.util.module_from_spec(spec)
spec.loader.exec_module(demo)
(ROOT / '.dev-host').mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(dir=ROOT / '.dev-host', prefix='demo-setup-check-') as temporary:
    root = Path(temporary)
    data = root / '.demo/user-data'
    assert demo.prepare_profile(data, demo.SETTINGS) == 'demo'
    storage = demo.read_json(data / 'User/globalStorage/storage.json')
    assert storage['userDataProfiles'] == [{'location': 'demo', 'name': 'Demo'}]
    custom = data / 'User/profiles/demo/settings.json'
    settings = demo.read_json(custom)
    settings['editor.lineNumbers'] = 'relative'
    demo.write_json(custom, settings)
    demo.prepare_profile(data, demo.SETTINGS)
    assert demo.read_json(custom)['editor.lineNumbers'] == 'relative'
    assert demo.read_json(custom)['isabelleRevamp.showAsk'] is False
    assert demo.read_json(custom)['workbench.activityBar.location'] == 'hidden'
    assert demo.read_json(data / 'User/globalStorage/storage.json') == storage
    # A scratch destination still gets the card fixtures, with an edited proof
    # preserved. examples/card/ has supplied Sqrt4 since M14.
    cards = sorted(file.name for file in (ROOT / 'examples/card').glob('*.thy')
                   if not file.stem.endswith(('_solution', '_reference')))
    first = demo.copy_theories(root, {})
    assert sorted(first) == cards, (sorted(first), cards)
    proof = root / cards[0]
    assert proof.is_file()
    demo.copy_theories(root, first)
    proof.write_text('User proof in progress — preserve me.\n')
    demo.copy_theories(root, first)
    assert proof.read_text() == 'User proof in progress — preserve me.\n'
    (data / 'SingletonLock').symlink_to('test-host-' + str(os.getpid()))
    try:
        demo.prepare_profile(data, demo.SETTINGS)
        raise AssertionError('Updating a live Demo profile must be refused')
    except SystemExit as error:
        assert 'Close the Demo' in str(error)

# The committed demo folder: self-contained, version-controlled, never rewritten.
assert demo.DEMO == ROOT / 'demo'
assert demo.resolve_destination(Path('demo')) == demo.DEMO
for refused in ['.', 'examples', 'extension', 'mcp']:
    try:
        demo.resolve_destination(ROOT / refused)
        raise AssertionError(f'{refused} must not be used as the demo folder')
    except SystemExit as error:
        assert 'Use demo/' in str(error)
for name in ['Sqrt2.thy', 'Swarm.thy', 'Cascade.thy', 'Demo.thy', 'Sqrt4.thy', 'README.md']:
    assert (demo.DEMO / name).is_file(), name
assert not list(demo.DEMO.glob('*_solution.thy')) and not (demo.DEMO / 'extension').exists()
assert demo.copy_theories(demo.DEMO, {}) == {}, 'Committed theories must never be copied over'

settings_file = demo.DEMO / '.vscode/settings.json'
committed = settings_file.read_text()
workspace = demo.read_json(settings_file)
workspace.setdefault('files.exclude', {}).update(demo.HIDDEN)
workspace.setdefault('search.exclude', {}).update(demo.HIDDEN)
demo.write_json(settings_file, workspace)
assert settings_file.read_text() == committed, 'Preparing demo/ must not rewrite its committed settings'
assert workspace['isabelleRevamp.prettySymbols'] is True
assert workspace['isabelleRevamp.demoLayoutOnStartup'] is True
# Trust, updates and this machine's Isabelle path belong to the Demo profile.
for key in ['security.workspace.trust.enabled', 'update.mode', 'isabelleRevamp.executable']:
    assert key not in workspace, f'{key} is user-level and must stay out of demo/.vscode/settings.json'
    assert key in demo.SETTINGS or key == 'isabelleRevamp.executable'
readme = (demo.DEMO / 'README.md').read_text()
for expected in ['security.workspace.trust.enabled', 'DND on', 'Backup video', 'scripts/demo-env.sh']:
    assert expected in readme, expected
print('PASS: isolated profile creation, settings updates, repeat setup, edited-proof preservation,'
      ' active-window refusal, and a self-contained committed demo/ that setup leaves unmodified')
