import { Box, Gauge, SlidersHorizontal } from "lucide-react";
import type { GenerationParams } from "../../types";

export function GenerationInspector({
  value,
  onChange,
}: {
  value: GenerationParams;
  onChange: (params: GenerationParams) => void;
}) {
  const update = <K extends keyof GenerationParams>(
    key: K,
    next: GenerationParams[K],
  ) => onChange({ ...value, [key]: next });

  return (
    <section className="generation-inspector">
      <div className="section-heading">
        <div>
          <span>输出设置</span>
          <strong>生成参数</strong>
        </div>
        <SlidersHorizontal size={17} />
      </div>
      <div className="inspector-fields">
        <label>
          <span>输出格式</span>
          <select
            aria-label="输出格式"
            value={value.format}
            onChange={(event) =>
              update("format", event.target.value as GenerationParams["format"])
            }
          >
            <option value="wav">WAV</option>
            <option value="mp3">MP3</option>
            <option value="pcm">PCM</option>
          </select>
        </label>
        <label>
          <span>采样率</span>
          <select
            aria-label="采样率"
            value={value.sampleRate}
            onChange={(event) =>
              update(
                "sampleRate",
                Number(event.target.value) as GenerationParams["sampleRate"],
              )
            }
          >
            {[8000, 16000, 24000, 44100, 48000].map((rate) => (
              <option value={rate} key={rate}>
                {rate === 48000 ? "48kHz" : rate / 1000 + "kHz"}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>声道</span>
          <select
            aria-label="声道"
            value={value.channels}
            onChange={(event) =>
              update("channels", Number(event.target.value) as 1 | 2)
            }
          >
            <option value={1}>单声道 Mono</option>
            <option value={2}>立体声 Stereo</option>
          </select>
        </label>
        <label className="range-field">
          <span>
            音量 <b>{value.volume}</b>
          </span>
          <input
            aria-label="音量"
            type="range"
            min={0}
            max={100}
            value={value.volume}
            onChange={(event) => update("volume", Number(event.target.value))}
          />
        </label>
        <label className="range-field">
          <span>
            语速 <b>{value.rate.toFixed(1)}X</b>
          </span>
          <input
            aria-label="语速"
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={value.rate}
            onChange={(event) => update("rate", Number(event.target.value))}
          />
        </label>
        <label>
          <span>随机种子 Seed</span>
          <div className="number-input">
            <input
              aria-label="随机种子"
              type="number"
              value={value.seed}
              onChange={(event) => update("seed", Number(event.target.value))}
            />
            <Box size={15} />
          </div>
        </label>
        <label className="toggle-row">
          <span>AIGC 标识</span>
          <input
            aria-label="AIGC 标识"
            type="checkbox"
            checked={value.enableAigcTag}
            onChange={(event) => update("enableAigcTag", event.target.checked)}
          />
        </label>
        {value.format === "mp3" ? (
          <div className="mp3-quality">
            <div className="subsection-label">
              <Gauge size={15} /> MP3 音质
            </div>
            <label className="toggle-row">
              <span>恒定码率 CBR</span>
              <input
                aria-label="恒定码率"
                type="checkbox"
                checked={value.enableCbr}
                onChange={(event) => update("enableCbr", event.target.checked)}
              />
            </label>
            {value.enableCbr ? (
              <label>
                <span>比特率</span>
                <select
                  aria-label="MP3 比特率"
                  value={value.bitRate}
                  onChange={(event) =>
                    update("bitRate", Number(event.target.value))
                  }
                >
                  {[64, 96, 128, 192, 256, 320].map((rate) => (
                    <option value={rate} key={rate}>
                      {rate} kbps
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label>
                <span>质量（0 最高）</span>
                <input
                  aria-label="MP3 质量"
                  type="number"
                  min={0}
                  max={9}
                  value={value.quality}
                  onChange={(event) =>
                    update("quality", Number(event.target.value))
                  }
                />
              </label>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}
