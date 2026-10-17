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
    assert demo.read_json(data / 'User/globalStorage/storage.json') == storage
    first = demo.copy_theories(root, {})
    proof = root / 'Sqrt2.thy'
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
print('PASS: isolated profile creation, settings updates, repeat setup, edited-proof preservation and active-window refusal')
