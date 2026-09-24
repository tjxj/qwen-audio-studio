import io
import tempfile
import unittest
import wave
import subprocess
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import AppConfig
from app.main import create_app
from app.services.keychain import Credentials, FakeCredentialStore


def wav_bytes(seconds=1):
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b'\0\0' * int(16000 * seconds))
    return stream.getvalue()


class V2WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.calls = []
        def worker(job):
            self.calls.append(job.id)
            return {'report': {'duration_seconds': 1}, 'elapsed_seconds': .1}
        self.app = create_app(
            config=AppConfig.from_environment({'QWEN_STUDIO_DATA_ROOT': self.tmp.name}),
            credential_store=FakeCredentialStore(Credentials('test-key', 'test-space')),
            csrf_token='csrf', generation_worker=worker,
        )
        self.client = TestClient(self.app)
        self.headers = {'X-Qwen-Studio-CSRF': 'csrf'}
        self.project = self.client.post('/api/projects', headers=self.headers, json={
            'name': '测试作品', 'mode': 'narration', 'prompt': '你好，世界。'
        }).json()

    def tearDown(self):
        self.app.state.job_manager.shutdown()
        self.tmp.cleanup()

    def post(self, url, data=None):
        return self.client.post(url, headers=self.headers, json=data or {})

    def test_directory_cancel_and_registered_chinese_path(self):
        self.app.state.directories.picker = lambda: None
        self.assertEqual(self.post('/api/directories/choose').json(), {'cancelled': True})
        selected = Path(self.tmp.name) / '声音 输出'
        selected.mkdir()
        self.app.state.directories.picker = lambda: selected
        result = self.post('/api/directories/choose').json()['directory']
        self.assertTrue(result['writable'])
        target = self.app.state.directories.resolve_output(result['id'], self.project['id'], 'job_safe', '../标题 / 广告', 'mp3')
        self.assertIn(selected.resolve(), target.parents)
        self.assertTrue(target.name.endswith('.mp3'))
        self.assertNotIn('..', target.relative_to(selected.resolve()).parts)
        self.assertEqual(self.post('/api/directories/unknown/validate').status_code, 404)

    def test_library_edit_trash_restore_keeps_audio_and_clears_final(self):
        store = self.app.state.studio
        job = store.create_job({'project_id': self.project['id'], 'project_name': '测试作品',
            'mode': 'narration', 'prompt': '你好', 'params': self.project['params'], 'status': 'success'})
        path = Path(self.tmp.name) / 'outputs' / 'audio.wav'
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(wav_bytes())
        asset = store.register_asset(path, 'audio/wav', owner_id=job['id'])
        store.update_job(job['id'], {'output_asset_id': asset['id']})
        store.set_final_job(self.project['id'], job['id'])
        edited = self.client.patch('/api/jobs/' + job['id'], headers=self.headers,
            json={'display_name': '雨夜', 'favorite': True})
        self.assertEqual(edited.status_code, 200)
        listing = self.client.get('/api/library?q=雨夜&favorite=true').json()
        self.assertEqual(listing['total'], 1)
        self.assertTrue(listing['items'][0]['can_play'])
        self.assertEqual(self.post('/api/jobs/' + job['id'] + '/trash', {'scope':'record_and_files'}).status_code, 200)
        self.assertFalse(path.exists())
        self.assertIsNone(store.get_project(self.project['id'])['final_job_id'])
        self.assertEqual(self.client.get('/api/library?view=trash').json()['total'], 1)
        self.assertEqual(self.post('/api/jobs/' + job['id'] + '/restore').status_code, 200)
        self.assertTrue(path.exists())
        self.assertIsNone(store.get_project(self.project['id'])['final_job_id'])
        self.assertNotIn(self.tmp.name, self.client.get('/api/jobs/' + job['id'] + '/export-report').text)

    def test_trash_owned_outputs_includes_reports_and_restores_without_overwrite(self):
        store=self.app.state.studio
        job=store.create_job({'project_id':self.project['id'],'project_name':'测试','mode':'narration',
            'prompt':'你好','params':self.project['params'],'status':'success'})
        path=self.app.state.directories.resolve_output('dir_default',self.project['id'],job['id'],'测试','wav')
        path.parent.mkdir(parents=True);path.write_bytes(wav_bytes())
        sidecar=path.parent/'prompt.txt';sidecar.write_text('原稿')
        asset=store.register_asset(path,'audio/wav',owner_id=job['id'])
        store.update_job(job['id'],{'output_asset_id':asset['id'],'output_path_snapshot':str(path),'output_directory_id':'dir_default'})
        result=self.post('/api/jobs/'+job['id']+'/trash',{'scope':'record_and_files'})
        self.assertEqual(result.status_code,200,result.text)
        self.assertFalse(sidecar.exists())
        path.write_bytes(b'existing unrelated file')
        self.assertEqual(self.post('/api/jobs/'+job['id']+'/restore').status_code,200)
        self.assertEqual(path.read_bytes(),b'existing unrelated file')
        restored=store.resolve_asset(asset['id'])['path']
        self.assertEqual(restored.read_bytes(),wav_bytes())
        self.assertEqual(sidecar.read_text(),'原稿')

    def payload(self):
        return {'project_id': self.project['id'], 'expected_project_revision': 1,
            'mode': 'narration', 'prompt':'你好，世界。', 'params':self.project['params'],
            'candidate_seeds':[42,43], 'reference_bindings':[]}

    def test_generation_is_idempotent_and_changed_payload_conflicts(self):
        payload = self.payload()
        check = self.post('/api/generation-preflight', payload)
        self.assertEqual(check.status_code, 200, check.text)
        payload.update(client_request_id='request_test', confirmed_request_hash=check.json()['request_hash'])
        first = self.post('/api/generation-requests', payload)
        self.assertEqual(first.status_code, 201, first.text)
        second = self.post('/api/generation-requests', payload)
        self.assertEqual(second.status_code, 200, second.text)
        self.assertEqual(first.json()['job_ids'], second.json()['job_ids'])
        for job_id in first.json()['job_ids']:
            self.app.state.job_manager.wait(job_id, 5)
        self.assertEqual(len(self.calls), 2)
        payload['prompt'] = '改动'
        self.assertEqual(self.post('/api/generation-requests', payload).status_code, 409)
        self.assertEqual(self.post('/api/jobs/' + first.json()['job_ids'][0] + '/cancel').status_code, 409)
        retry=self.post('/api/jobs/'+first.json()['job_ids'][0]+'/retry',
            {'client_request_id':'explicit_retry','acknowledge_new_charge':True})
        self.assertEqual(retry.status_code,201,retry.text)
        retried=retry.json()['job_ids'][0]
        self.app.state.job_manager.wait(retried,5)
        self.assertEqual(self.app.state.studio.get_job(retried)['parent_job_id'],first.json()['job_ids'][0])

    def test_queued_cancel_never_invokes_worker_and_running_cancel_conflicts(self):
        started=Event();finish=Event()
        self.app.state.job_manager.set_limit(1)
        def worker(job):
            self.calls.append(job.id);started.set();finish.wait(3)
            return {'report':{}}
        self.app.state.job_manager.worker=worker
        payload=self.payload();payload['candidate_seeds']=[1,2,3]
        check=self.post('/api/generation-preflight',payload).json()
        payload.update(client_request_id='cancel_batch',confirmed_request_hash=check['request_hash'])
        created=self.post('/api/generation-requests',payload).json()
        self.assertTrue(started.wait(1))
        try:
            running=self.calls[0]
            queued=next(job_id for job_id in created['job_ids'] if job_id!=running)
            self.assertEqual(self.post('/api/jobs/'+running+'/cancel').status_code,409)
            self.assertEqual(self.post('/api/jobs/'+queued+'/cancel').status_code,200)
        finally:
            finish.set()
        for job_id in created['job_ids']:self.app.state.job_manager.wait(job_id,5)
        self.assertNotIn(queued,self.calls)

    def test_preflight_rejects_compiled_overflow_and_missing_voice(self):
        payload = self.payload()
        payload['prompt'] = '文' * 3000
        self.assertEqual(self.post('/api/generation-preflight', payload).status_code, 422)
        payload['prompt'] = '@voice1 你好'
        self.assertEqual(self.post('/api/generation-preflight', payload).status_code, 422)
        self.assertEqual(len(self.calls), 0)

    def test_preflight_rejects_invalid_mp3_bitrate(self):
        payload=self.payload()
        payload['params']={**self.project['params'],'format':'mp3','sample_rate':8000,'enable_cbr':True,'bit_rate':320}
        self.assertEqual(self.post('/api/generation-preflight',payload).status_code,422)
        payload['params']={**payload['params'],'bit_rate':64}
        self.assertEqual(self.post('/api/generation-preflight',payload).status_code,200)

    def test_raw_voice_slots_cannot_silently_reorder_on_draft_save(self):
        store=self.app.state.studio
        project=store.create_project({'name':'双人','mode':'podcast','prompt':'@voice1 说你好。@voice2 回答你好。',
            'reference_bindings':[{'reference_id':'voice_a','alias':'甲'},{'reference_id':'voice_b','alias':'乙'}]})
        reversed_refs=list(reversed(project['reference_bindings']))
        response=self.client.patch('/api/projects/'+project['id'],headers=self.headers,
            json={'expected_revision':1,'reference_bindings':reversed_refs})
        self.assertEqual(response.status_code,422,response.text)
        self.assertEqual(store.get_project(project['id'])['reference_bindings'][0]['reference_id'],'voice_a')

    def test_list_jobs_keeps_v2_display_fields(self):
        store=self.app.state.studio
        job=store.create_job({'project_id':self.project['id'],'project_name':'测试','mode':'narration',
            'prompt':'你好','params':self.project['params'],'status':'failed','note':'版本备注'})
        store.update_job(job['id'],{'favorite':True,'display_name':'新版标题'})
        response=self.client.get('/api/jobs').json()
        self.assertEqual(response[0]['note'],'版本备注')
        self.assertEqual(response[0]['display_name'],'新版标题')
        self.assertFalse(response[0]['file_available'])
        self.assertTrue(response[0]['favorite'])

    def test_library_page_size_accepts_query_integers_only_at_supported_sizes(self):
        self.assertEqual(self.client.get('/api/library?page_size=50').status_code,200)
        self.assertEqual(self.client.get('/api/library?page_size=21').status_code,422)
        self.assertEqual(self.client.get('/api/library?page_size=50000').status_code,422)

    def test_preflight_confirmation_expires_when_default_directory_changes(self):
        payload=self.payload()
        check=self.post('/api/generation-preflight',payload).json()
        selected=Path(self.tmp.name)/'new output';selected.mkdir()
        self.app.state.directories.picker=lambda:selected
        directory=self.post('/api/directories/choose').json()['directory']
        settings=self.app.state.studio.settings()
        self.app.state.studio.save_settings(settings['revision'],{'default_directory_id':directory['id']})
        payload.update(client_request_id='changed_directory',confirmed_request_hash=check['request_hash'])
        self.assertEqual(self.post('/api/generation-requests',payload).status_code,409)
        self.assertEqual(len(self.calls),0)

    def test_failure_outcome_unknown_is_persisted_without_paid_replay(self):
        from app.errors import DomainError
        def worker(job):
            self.calls.append(job.id)
            raise DomainError('PROVIDER_OUTCOME_UNKNOWN','云端结果不确定，可能已计费。',status=502)
        self.app.state.job_manager.worker=worker
        payload=self.payload();payload['candidate_seeds']=[42]
        check=self.post('/api/generation-preflight',payload).json()
        payload.update(client_request_id='uncertain',confirmed_request_hash=check['request_hash'])
        first=self.post('/api/generation-requests',payload).json()
        job_id=first['job_ids'][0];self.app.state.job_manager.wait(job_id,5)
        self.assertEqual(self.post('/api/generation-requests',payload).status_code,200)
        result=self.client.get('/api/jobs/'+job_id).json()
        self.assertEqual(result['status'],'failed')
        self.assertEqual(result['error_detail']['code'],'PROVIDER_OUTCOME_UNKNOWN')
        self.assertEqual(len(self.calls),1)

    def test_symlink_swap_cannot_expose_unregistered_file(self):
        path=Path(self.tmp.name)/'owned.wav';path.write_bytes(wav_bytes())
        asset=self.app.state.studio.register_asset(path,'audio/wav')
        outside=Path(self.tmp.name)/'private.txt';outside.write_text('private')
        path.unlink();path.symlink_to(outside)
        response=self.client.get('/api/media/'+asset['id'])
        self.assertEqual(response.status_code,410)
        self.assertNotIn('private',response.text)

    def test_journal_recovers_interrupted_restore_before_showing_success(self):
        from app.services.migrations import now_iso
        store=self.app.state.studio
        source=Path(self.tmp.name).resolve()/'restored.wav'
        trash=Path(self.tmp.name).resolve()/'trash'/'audio.wav';trash.parent.mkdir()
        source.write_bytes(wav_bytes())
        stamp=now_iso()
        moves=[{'asset_id':None,'source':str(source),'target':str(trash),'restore_target':str(source)}]
        with store._connect() as db:
            db.execute('INSERT INTO file_operations VALUES (?,?,?,?,?,?,?,?)',
                ('op_recovery','record_and_files','job_example','restoring',json.dumps(moves),None,stamp,stamp))
        self.app.state.library.recover_operations()
        self.assertTrue(trash.is_file())
        self.assertFalse(source.exists())
        with store._connect() as db:
            self.assertEqual(db.execute('SELECT state FROM file_operations WHERE id=?',('op_recovery',)).fetchone()[0],'done')

    def test_missing_or_symlinked_final_audio_is_rejected(self):
        store=self.app.state.studio
        job=store.create_job({'project_id':self.project['id'],'project_name':'测试','mode':'narration',
            'prompt':'你好','params':self.project['params'],'status':'success'})
        path=Path(self.tmp.name)/'final.wav';path.write_bytes(wav_bytes())
        asset=store.register_asset(path,'audio/wav',owner_id=job['id'])
        store.update_job(job['id'],{'output_asset_id':asset['id']})
        replacement=Path(self.tmp.name)/'replacement.wav';replacement.write_bytes(wav_bytes())
        path.unlink();path.symlink_to(replacement)
        result=self.post('/api/projects/'+self.project['id']+'/final-version',{'job_id':job['id']})
        self.assertEqual(result.status_code,422,result.text)

    def test_reference_trim_persist_and_single_request_consent(self):
        imported = self.client.post('/api/reference-imports', headers=self.headers,
            files={'file':('sample.wav', wav_bytes(2), 'audio/wav')})
        self.assertEqual(imported.status_code, 201, imported.text)
        import_id = imported.json()['import_id']
        invalid = self.post('/api/reference-imports/' + import_id + '/prepare', {'start_seconds':0,'end_seconds':31,'name':'声音'})
        self.assertEqual(invalid.status_code, 422)
        ref = self.post('/api/reference-imports/' + import_id + '/prepare',
            {'start_seconds':.25,'end_seconds':1.25,'name':'声音','persistent':True}).json()
        self.assertAlmostEqual(ref['duration_seconds'], 1, places=1)
        self.assertEqual(ref['channels'], 1)
        self.assertEqual(len(self.client.get('/api/references?persistent=true').json()), 1)
        payload = self.payload()
        payload['reference_bindings'] = [{'reference_id':ref['id'], 'alias':'旁白'}]
        check = self.post('/api/generation-preflight', payload).json()
        consent = self.post('/api/reference-consents', {'project_id':self.project['id'],
            'reference_ids':[ref['id']], 'confirmed':True}).json()
        payload.update(client_request_id='ref_request', confirmed_request_hash=check['request_hash'], consent_id=consent['consent_id'])
        first = self.post('/api/generation-requests', payload)
        self.assertEqual(first.status_code, 201, first.text)
        for job_id in first.json()['job_ids']:
            self.app.state.job_manager.wait(job_id, 5)
        payload['client_request_id'] = 'another_request'
        self.assertEqual(self.post('/api/generation-requests', payload).status_code, 409)
        self.assertEqual(len(self.client.get('/api/references?persistent=true').json()), 1)

    def test_draft_saves_params_bindings_and_template_columns(self):
        params={**self.project['params'],'rate':1.25}
        result=self.client.patch('/api/projects/'+self.project['id'],headers=self.headers,json={
            'expected_revision':1,'params':params,'reference_bindings':[],
            'template_application':{'template_id':'example','template_version':1,'values':{}}})
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()['params']['rate'],1.25)
        self.assertEqual(result.json()['template_application']['template_id'],'example')

    def test_reference_m4a_import_converts_and_persistent_voice_survives_cleanup(self):
        source=Path(self.tmp.name)/'source.wav';source.write_bytes(wav_bytes(2))
        m4a=source.with_suffix('.m4a')
        subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(source),str(m4a)],check=True)
        imported=self.client.post('/api/reference-imports',headers=self.headers,
            files={'file':('声音.m4a',m4a.read_bytes(),'audio/mp4')})
        self.assertEqual(imported.status_code,201)
        ref=self.post('/api/reference-imports/'+imported.json()['import_id']+'/prepare',
            {'start_seconds':0,'end_seconds':1,'name':'声音','persistent':False}).json()
        saved=self.client.patch('/api/references/'+ref['id'],headers=self.headers,json={'persistent':True})
        self.assertEqual(saved.status_code,200)
        self.assertIn('voices',self.app.state.references.path(ref['id']).parts)
        self.assertNotIn('cache',self.app.state.references.path(ref['id']).relative_to(Path(self.tmp.name).resolve()).parts)
        self.post('/api/storage/cleanup-cache')
        self.assertTrue(self.app.state.references.path(ref['id']).is_file())
        self.assertEqual(source.read_bytes(),wav_bytes(2))

    def test_concurrent_request_replays_create_only_one_batch(self):
        payload=self.payload()
        payload['confirmed_request_hash']=self.post('/api/generation-preflight',payload).json()['request_hash']
        payload['client_request_id']='concurrent'
        with ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(lambda _:self.post('/api/generation-requests',payload),range(4)))
        self.assertEqual(sorted(item.status_code for item in results),[200,200,200,201])
        all_ids=[item.json()['job_ids'] for item in results]
        self.assertTrue(all(ids==all_ids[0] for ids in all_ids))
        for job_id in all_ids[0]: self.app.state.job_manager.wait(job_id,5)
        self.assertEqual(len(self.calls),2)

    def test_shared_reference_cannot_be_cleaned_until_every_lease_released(self):
        imported=self.client.post('/api/reference-imports',headers=self.headers,
            files={'file':('voice.wav',wav_bytes(),'audio/wav')}).json()
        ref=self.post('/api/reference-imports/'+imported['import_id']+'/prepare',
            {'start_seconds':0,'end_seconds':1,'name':'临时声音'}).json()
        store=self.app.state.studio
        jobs=[store.create_job({'project_id':self.project['id'],'project_name':'测试','mode':'narration',
            'prompt':'你好','params':self.project['params'],'status':'queued'}) for _ in range(2)]
        for job in jobs:
            self.app.state.references.acquire([ref['id']],job['id'])
        self.app.state.references.release(jobs[0]['id'])
        self.post('/api/storage/cleanup-cache')
        self.assertTrue(self.app.state.references.path(ref['id']).is_file())
        self.assertEqual(self.client.delete('/api/references/'+ref['id'],headers=self.headers).status_code,409)
        self.app.state.references.release(jobs[1]['id'])
        self.post('/api/storage/cleanup-cache')
        self.assertEqual(len(self.app.state.references.list(False)),0)


    def test_changed_trash_destination_keeps_record_and_original_audio(self):
        store = self.app.state.studio
        job = store.create_job({'project_id':self.project['id'], 'project_name':'测试',
            'mode':'narration','prompt':'你好','params':self.project['params'],'status':'success'})
        root = Path(self.tmp.name).resolve()
        output = root / 'outputs' / 'audio.wav'
        output.parent.mkdir(exist_ok=True)
        output.write_bytes(wav_bytes())
        asset = store.register_asset(output, 'audio/wav', owner_id=job['id'])
        store.update_job(job['id'], {'output_asset_id':asset['id']})
        changed = root / 'unrelated-folder'
        changed.mkdir()
        (output.parent / '.qwen-studio-trash').symlink_to(changed, target_is_directory=True)
        response = self.post('/api/jobs/'+job['id']+'/trash', {'scope':'record_and_files'})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(output.read_bytes(), wav_bytes())
        self.assertIsNone(store.get_job(job['id'])['deleted_at'])
        self.assertEqual(list(changed.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
