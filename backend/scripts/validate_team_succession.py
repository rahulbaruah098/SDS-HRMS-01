"""Run isolated tests only: no .env loading, Mongo server, email or network I/O."""
import argparse
import os
from pathlib import Path
import shutil
import socket
import sys
from unittest.mock import patch


def forbidden(*args, **kwargs):
    raise RuntimeError('External I/O is disabled by the isolated YourComate validation runner')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', choices=['syntax', 'targeted', 'regression'], required=True)
    args = parser.parse_args()
    backend = Path(__file__).resolve().parents[1]
    os.chdir(backend)
    sys.path.insert(0, str(backend))
    os.environ['PYTEST_DISABLE_PLUGIN_AUTOLOAD'] = '1'
    os.environ['YOURCOMATE_TEST_ISOLATION'] = '1'
    os.environ['MONGO_URI'] = 'mongodb://127.0.0.1:1/yourcomate_isolated_tests'
    os.environ.pop('FACE_TEST_MONGOD', None)
    if args.phase == 'syntax':
        paths = [p for folder in ('app', 'scripts', 'tests') for p in (backend / folder).rglob('*.py')]
        for path in paths:
            compile(path.read_bytes(), str(path), 'exec')
        print(f'Syntax checked {len(paths)} Python modules')
        return 0
    import dotenv
    import pymongo
    import pytest
    original_which = shutil.which
    def test_which(command, *a, **kw):
        return None if str(command).lower() in ('mongod', 'mongod.exe') else original_which(command, *a, **kw)
    paths = ['tests/test_team_succession.py', 'tests/test_project_planning.py'] if args.phase == 'targeted' else ['tests']
    with patch.object(dotenv, 'load_dotenv', return_value=False), \
         patch.object(pymongo, 'MongoClient', side_effect=forbidden), \
         patch.object(socket.socket, 'connect', side_effect=forbidden), \
         patch.object(socket.socket, 'connect_ex', side_effect=forbidden), \
         patch.object(shutil, 'which', side_effect=test_which):
        return pytest.main([*paths, '-q', '--disable-warnings'])


if __name__ == '__main__':
    raise SystemExit(main())
