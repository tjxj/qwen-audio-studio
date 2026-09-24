"""Process-level ownership regression: a second service cannot recover live jobs."""
import io
import json
import multiprocessing
import subprocess
import sys
import tempfile
import unittest
import wave
from dataclasses import replace
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import AppConfig
from app.main import create_app
from app.services.keychain import Credentials, FakeCredentialStore
from app.services.studio_store import StudioStore


def hold_active_generation(root, ready_pipe, entered, release, calls):
    """A separate real service process with a fake chargeable worker boundary."""
    def worker(job):
        with calls.get_lock():
            calls.value += 1
        entered.set()
        if not release.wait(20):
            raise RuntimeError('test worker was not released')
        return {'report': {'synthetic': True}}

    app = create_app(
        config=AppConfig.from_environment({'QWEN_STUDIO_DATA_ROOT': root, 'QWEN_STUDIO_PORT': '8765'}),
        credential_store=FakeCredentialStore(Credentials('test-key', 'test-space')),
        generation_worker=worker,
    )
    with TestClient(app):
        store = app.state.studio
        project = store.create_project({'name': '收费边界测试', 'mode': 'narration', 'prompt': '你好'})
        audio = io.BytesIO()
        with wave.open(audio, 'wb') as sound:
            sound.setnchannels(1)
            sound.setsampwidth(2)
            sound.setframerate(16000)
            sound.writeframes(b'\x00\x00' * 16000)
        audio.seek(0)
        imported = app.state.references.import_audio('voice.wav', audio)
        voice = app.state.references.prepare(imported['import_id'], 0, 1, '临时音色')
        job = store.create_job({'project_id': project['id'], 'project_name': project['name'],
            'mode': 'narration', 'prompt': '你好', 'params': project['params'], 'status': 'queued'})
        app.state.references.acquire([voice['id']], job['id'])
        app.state.job_manager.enqueue(job['id'])
        if not entered.wait(5):
            raise RuntimeError('worker did not start')
        ready_pipe.send({'job_id': job['id'], 'reference_id': voice['id']})
        app.state.job_manager.wait(job['id'], 25)
    ready_pipe.close()


SECOND_PROCESS = '''
import sys
from fastapi.testclient import TestClient
from app.config import AppConfig
from app.main import create_app
from app.services.keychain import FakeCredentialStore
try:
    app=create_app(config=AppConfig.from_environment({'QWEN_STUDIO_DATA_ROOT':sys.argv[1],'QWEN_STUDIO_PORT':'8767'}),credential_store=FakeCredentialStore())
except RuntimeError as exc:
    print('REJECTED:'+getattr(exc,'code','UNKNOWN'))
else:
    with TestClient(app):
        print('ACQUIRED')
'''


class SingleInstanceTests(unittest.TestCase):
    def test_second_process_cannot_interrupt_paid_worker_or_release_its_lease(self):
        context = multiprocessing.get_context('spawn')
        with tempfile.TemporaryDirectory() as directory:
            parent, child = context.Pipe(duplex=False)
            entered, release = context.Event(), context.Event()
            calls = context.Value('i', 0)
            owner = context.Process(target=hold_active_generation,
                args=(directory, child, entered, release, calls))
            owner.start()
            child.close()
            try:
                self.assertTrue(parent.poll(12), 'owner service failed to start')
                info = parent.recv()
                store = StudioStore(Path(directory))
                self.assertEqual(store.get_job(info['job_id'])['status'], 'running')
                attempted = subprocess.run([sys.executable, '-c', SECOND_PROCESS, directory],
                    capture_output=True, text=True, timeout=10)
                self.assertEqual(attempted.returncode, 0, attempted.stderr)
                self.assertEqual(attempted.stdout.strip(), 'REJECTED:INSTANCE_ALREADY_RUNNING')
                self.assertEqual(store.get_job(info['job_id'])['status'], 'running')
                with store._connect() as db:
                    lease = db.execute('SELECT released_at FROM reference_leases WHERE job_id=?', (info['job_id'],)).fetchone()
                self.assertIsNone(lease['released_at'])
                self.assertEqual(calls.value, 1)
            finally:
                release.set()
                owner.join(10)
                if owner.is_alive():
                    owner.terminate()
                    owner.join(5)
                parent.close()
            self.assertEqual(owner.exitcode, 0)
            restarted = subprocess.run([sys.executable, '-c', SECOND_PROCESS, directory],
                capture_output=True, text=True, timeout=10)
            self.assertEqual(restarted.returncode, 0, restarted.stderr)
            self.assertEqual(restarted.stdout.strip(), 'ACQUIRED')

    def test_same_process_rejected_and_normal_shutdown_releases_ownership(self):
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.from_environment({'QWEN_STUDIO_DATA_ROOT': directory})
            first = create_app(config=config, credential_store=FakeCredentialStore())
            with TestClient(first):
                with self.assertRaisesRegex(RuntimeError, '正在使用'):
                    create_app(config=config, credential_store=FakeCredentialStore())
            second = create_app(config=config, credential_store=FakeCredentialStore())
            with TestClient(second) as client:
                self.assertEqual(client.get('/api/health').status_code, 200)

    def test_failed_initialization_does_not_leave_lock_held(self):
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.from_environment({'QWEN_STUDIO_DATA_ROOT': directory})
            invalid = replace(config, skill_script=Path(directory)/'missing.py')
            with self.assertRaises(RuntimeError):
                create_app(config=invalid, credential_store=FakeCredentialStore())
            app = create_app(config=config, credential_store=FakeCredentialStore())
            with TestClient(app) as client:
                self.assertEqual(client.get('/api/health').status_code, 200)


if __name__ == '__main__':
    unittest.main()
