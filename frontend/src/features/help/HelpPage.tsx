import { ExternalLink } from "lucide-react";
import { helpLinks, modelBoundary } from "../../config/helpLinks";

const steps = [
  {
    title: "填入百炼凭据",
    body: "在设置页分别保存 API Key 与业务空间 ID。两者只写入 macOS 钥匙串，不进入浏览器存储、项目文件或日志。",
  },
  {
    title: "写好脚本再生成",
    body: `创作台支持 ${modelBoundary.maxCompiledChars} 字符以内的编译后提示词。编辑停顿后自动保存草稿，刷新或重启都能恢复。`,
  },
  {
    title: "确认参考音频",
    body: `最多使用 ${modelBoundary.maxReferenceCount} 条参考，每条不超过 ${modelBoundary.maxReferenceSeconds} 秒。每次生成前都会列出具体文件，确认后才上传。`,
  },
];

const questions = [
  {
    q: "本地运行是不是意味着完全离线？",
    a: "不是。应用与数据都在本机，但生成时文本和已确认的参考音频会发送至阿里云百炼，并按云端计费。",
  },
  {
    q: "提示词能用什么地域的模型？",
    a: `固定使用 ${modelBoundary.id}，需要${modelBoundary.region}的账号已开通该模型能力。`,
  },
  {
    q: "清除凭据会删掉已生成的音频吗？",
    a: "不会。凭据、音频作品和音色库是三条独立的生命周期，清除其中一种不会顺带删除另一种。",
  },
  {
    q: "生成失败会重复扣费吗？",
    a: "结果不确定时任务会被标记为需要人工确认，不会自动重放收费请求；重试由你明确点击触发。",
  },
];

export default function HelpPage() {
  return (
    <section className="help-page">
      <header>
        <div>
          <span>首次使用</span>
          <h1>帮助</h1>
        </div>
      </header>
      <ol className="help-steps">
        {steps.map((step, index) => (
          <li key={step.title}>
            <b>{index + 1}</b>
            <div>
              <strong>{step.title}</strong>
              <p>{step.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="settings-group">
        <h2>官方文档</h2>
        <ul className="help-links">
          <li>
            <a
              href={helpLinks.apiKey}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={13} /> 获取 API Key
            </a>
          </li>
          <li>
            <a
              href={helpLinks.workspaceId}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={13} /> 获取应用与业务空间 ID
            </a>
          </li>
          <li>
            <a
              href={helpLinks.audioApi}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={13} /> 音频生成接口说明
            </a>
          </li>
          <li>
            <a
              href={helpLinks.console}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={13} /> 百炼控制台
            </a>
          </li>
          <li>
            <a href={helpLinks.font} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={13} /> 思源宋体官方项目
            </a>
          </li>
        </ul>
      </div>

      <div className="settings-group">
        <h2>常见问题</h2>
        <dl className="help-faq">
          {questions.map((item) => (
            <div key={item.q}>
              <dt>{item.q}</dt>
              <dd>{item.a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
