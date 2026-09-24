"""Explicitly isolated browser QA server. Never touches the system Keychain.

Run: PYTHONPATH=backend .venv/bin/python backend/qa_app.py --data-root <temporary-dir>
Audio is synthetic test tone, not model output or anyone's voice.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path

import uvicorn

from app.config import AppConfig
from app.main import create_app
from app.services.keychain import Credentials, FakeCredentialStore


def create_qa_app(root:Path,port=8766):
    root=root.resolve()
    if not any(parent==Path('/private/tmp') or parent==Path('/tmp') for parent in root.parents):
        raise ValueError('QA data root must be a dedicated /private/tmp subdirectory')
    config=AppConfig.from_environment({'QWEN_STUDIO_DATA_ROOT':str(root),'QWEN_STUDIO_PORT':str(port)})
    app=None
    def fake_worker(job):
        store=app.state.studio
        row=store.get_job(job.id)
        output=Path(row['output_path_snapshot']) if row['output_path_snapshot'] else root/'outputs'/job.id/(job.id+'.wav')
        output.parent.mkdir(parents=True,exist_ok=True)
        for stage in ['preparing','requesting','downloading','validating']:
            store.update_job(job.id,{'stage':stage});time.sleep(.08)
        duration=5+(job.params.seed%4)
        command=['ffmpeg','-nostdin','-v','error','-f','lavfi','-i',
            f'sine=frequency={180+job.params.seed%250}:duration={duration}',
            '-af','volume=0.15,afade=t=in:d=0.4,afade=t=out:st='+str(duration-.5)+':d=0.5',
            '-ar',str(job.params.sample_rate),'-ac',str(job.params.channels)]
        if job.params.format=='pcm':command.extend(['-f','s16le'])
        command.append(str(output))
        subprocess.run(command,check=True,timeout=15,capture_output=True)
        report={'model':'synthetic-qa-fixture','status':'success','synthetic':True,'duration_seconds':duration,
            'sample_rate':job.params.sample_rate,'channels':job.params.channels,'format':job.params.format,
            'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),
            'ffprobe':'pass','ffmpeg':'pass'}
        (output.parent/'prompt.txt').write_text(job.prompt,encoding='utf-8')
        (output.parent/'report.json').write_text(json.dumps(report,ensure_ascii=False),encoding='utf-8')
        (output.parent/'report.md').write_text('# 合成测试音频\n\n用于界面和功能验证，不是模型生成结果。',encoding='utf-8')
        asset=store.register_asset(output,'audio/mpeg' if job.params.format=='mp3' else 'audio/wav',owner_id=job.id)
        return {'report':report,'output_asset_id':asset['id'],'elapsed_seconds':.5}
    app=create_app(config=config,credential_store=FakeCredentialStore(Credentials('qa-placeholder-key','qa-placeholder-space')),
        csrf_token='isolated-qa-session',generation_worker=fake_worker)
    if not app.state.studio.list_projects():
        samples=[('雨夜，给自己十分钟','podcast','【角色：主持人，温和自然】\n【环境：窗外细雨，室内安静】\n【对白：主持人】先把手机放在一边。忙了一整天，现在这十分钟，只留给你自己。',42),
            ('木雀咖啡 · 清晨开场','advertisement','【音效：瓷杯轻碰，咖啡落入杯中】\n【对白：旁白】第一口热咖啡，为今天留一点从容。木雀咖啡，陪你慢慢醒来。',43),
            ('城市边缘的来信','audiobook','【旁白：沉静、克制】\n信封没有署名，只有一枚褪色的邮票。她把它放在窗边，等风停下来。',44),
            ('电台里的第二个声音','drama','【环境：深夜电台】\n【对白：主持人】这里是午夜信箱，你还在听吗？\n【对白：来电者】我有一个故事，想讲给明天的自己。',45),
            ('山谷探索 · 向导对白','game','【角色：向导，冷静可靠】\n【对白：向导】前方的石桥刚修好。沿着河道向北，我们会在日落前找到营地。',46),
            ('一杯茶的时间','narration','【旁白：清晰、自然】\n水温慢慢下降，茶叶舒展开来。有些变化，只需要一点耐心。',47)]
        for name,mode,prompt,seed in samples:
            project=app.state.studio.create_project({'name':name,'mode':mode,'prompt':prompt,'params':{'seed':seed,'format':'wav'}})
            job=app.state.studio.create_job({'project_id':project['id'],'project_name':name,'mode':mode,'prompt':prompt,
                'params':project['params'],'status':'queued'})
            app.state.job_manager.enqueue(job['id'])
            app.state.job_manager.wait(job['id'],15)
        projects=app.state.studio.list_projects()
        for status in ['failed','interrupted']:
            p=projects[0]
            app.state.studio.create_job({'project_id':p['id'],'project_name':'待继续的声音草稿','mode':p['mode'],
                'prompt':p['prompt'],'params':p['params'],'status':status,'error':'测试任务：可重新编辑后生成。'})
    return app


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--data-root',type=Path,required=True)
    parser.add_argument('--port',type=int,default=8766)
    options=parser.parse_args()
    uvicorn.run(create_qa_app(options.data_root,options.port),host='127.0.0.1',port=options.port,access_log=False)
