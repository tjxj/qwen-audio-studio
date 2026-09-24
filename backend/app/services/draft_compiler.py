import re

from app.errors import DomainError


class DraftCompiler:
    def __init__(self,adapter):
        self.adapter=adapter

    def compile(self,mode,prompt,bindings):
        if not prompt.strip():
            raise DomainError('EMPTY_PROMPT','请先填写脚本。',status=422,field='prompt')
        if re.search(r'\{\{\w+\}\}',prompt):
            raise DomainError('UNFILLED_TEMPLATE','请先填写模板变量。',status=422,field='prompt')
        if len(bindings)>3 or len({b['reference_id'] for b in bindings})!=len(bindings):
            raise DomainError('INVALID_VOICE_BINDING','最多选择三个不同的参考音色。',status=422)
        for raw in re.findall(r'@voice(\d+)',prompt):
            if not 1<=int(raw)<=len(bindings):
                raise DomainError('INVALID_VOICE_BINDING',f'脚本的 @voice{raw} 缺少对应音色，请修改脚本或补充音色。',status=422,field='reference_bindings')
        aliases=[b.get('alias','').strip() for b in bindings]
        if len([a for a in aliases if a])!=len(set(a for a in aliases if a)):
            raise DomainError('INVALID_VOICE_BINDING','角色别名不能重复。',status=422)
        text=prompt
        for index,alias in enumerate(aliases,1):
            if alias:
                text=text.replace('【对白：'+alias+'】','【对白：@voice'+str(index)+'】')
                text=text.replace('【对白:'+alias+'】','【对白：@voice'+str(index)+'】')
        try:
            compiled=self.adapter.compile_prompt(mode,text,len(bindings))
        except self.adapter.module.ConfigError as exc:
            raise DomainError('PROMPT_TOO_LONG','编译后的提示词超过 3000 字符，请缩短内容。',status=422,field='prompt') from exc
        if len(compiled)>3000:
            raise DomainError('PROMPT_TOO_LONG','编译后的提示词超过 3000 字符，请缩短内容。',status=422,field='prompt',
                details={'compiled_chars':len(compiled),'limit':3000})
        return {'compiled_prompt':compiled,'compiled_chars':len(compiled),'max_chars':3000}
