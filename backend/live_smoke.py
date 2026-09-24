"""Opt-in: ONE real, chargeable text-only Next call. Never prints credentials.

Run explicitly with --confirm-one-call; uses a separate temporary data directory.
"""
import argparse
import json
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import create_app
from app.config import AppConfig

parser=argparse.ArgumentParser()
parser.add_argument('--confirm-one-call',action='store_true',required=True)
parser.parse_args()
root=Path(tempfile.mkdtemp(prefix='qwen-studio-live-',dir='/private/tmp'))
config=AppConfig.from_environment({'QWEN_STUDIO_DATA_ROOT':str(root)})
app=create_app(config=config)
with TestClient(app) as client:
    session=client.get('/api/session').json()
    if not all(session['credentials'].values()):
        raise SystemExit('Live smoke not run: configure credentials in the local app first.')
    headers={'X-Qwen-Studio-CSRF':session['csrf_token']}
    project=client.post('/api/projects',headers=headers,json={'name':'V2 短句连通性实测','mode':'narration','prompt':'【角色：旁白（温和、清晰）】\n【对白：旁白】你好，让灵感被听见。','params':{'format':'mp3','sample_rate':48000,'channels':2,'seed':42}}).json()
    payload={'project_id':project['id'],'expected_project_revision':project['revision'],'mode':project['mode'],'prompt':project['prompt'],'params':project['params'],'reference_bindings':[],'candidate_seeds':[42]}
    preflight=client.post('/api/generation-preflight',headers=headers,json=payload)
    if preflight.status_code!=200:
        raise SystemExit('Live smoke preflight failed; provider not called.')
    payload.update(client_request_id='live-smoke-one-call',confirmed_request_hash=preflight.json()['request_hash'])
    submitted=client.post('/api/generation-requests',headers=headers,json=payload)
    if submitted.status_code!=201:
        raise SystemExit('Live smoke submission failed; inspect isolated task state before retrying.')
    job_id=submitted.json()['job_ids'][0]
    app.state.job_manager.wait(job_id,600)
    job=client.get('/api/jobs/'+job_id).json()
    report=job.get('report') or {}
    result={'status':job['status'],'call_count':1,'synthetic':False,'model':'qwen-audio-3.1-tts-next','format':job['params']['format'],'duration_seconds':report.get('duration_seconds'),'sample_rate':report.get('sample_rate'),'channels':report.get('channels'),'ffprobe':report.get('ffprobe'),'ffmpeg':report.get('ffmpeg'),'error':job.get('error')}
    print(json.dumps(result,ensure_ascii=False))
    if job['status']=='success':
        print('Local audio: '+str(app.state.studio.resolve_asset(job['output_asset_id'])['path']))
    else:
        raise SystemExit(1)
