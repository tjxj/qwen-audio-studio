export type AudioFormat = "wav" | "mp3" | "pcm";
export type CreationMode =
  | "podcast"
  | "advertisement"
  | "audiobook"
  | "drama"
  | "game"
  | "narration"
  | "auto";
export type JobStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface GenerationParams {
  format: AudioFormat;
  sampleRate: 8000 | 16000 | 24000 | 44100 | 48000;
  channels: 1 | 2;
  volume: number;
  rate: number;
  seed: number;
  enableCbr: boolean;
  bitRate: number;
  quality: number;
  enableAigcTag: boolean;
}

export const DEFAULT_PARAMS: GenerationParams = {
  format: "wav",
  sampleRate: 48000,
  channels: 2,
  volume: 50,
  rate: 1,
  seed: 42,
  enableCbr: false,
  bitRate: 128,
  quality: 5,
  enableAigcTag: false
};

export interface ReferenceAudio {
  id: string;
  name: string;
  durationSeconds: number;
  bytes: number;
  codec: string;
  consentToken?: string;
}

export interface ValidationReport {
  ffprobe: "pass" | "failed" | "not run";
  ffmpeg: "pass" | "failed" | "not run";
  requestId?: string;
  durationSeconds?: number;
  sampleRate?: number;
  channels?: number;
  bytes?: number;
  sha256?: string;
}

export interface Project {
  id: string;
  name: string;
  mode: CreationMode;
  prompt: string;
  params: GenerationParams;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  finalJobId?: string;
}

export interface Job {
  id: string;
  projectId: string;
  projectName: string;
  mode: CreationMode;
  prompt: string;
  params: GenerationParams;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  elapsedSeconds?: number;
  outputAssetId?: string;
  error?: string;
  report?: ValidationReport;
}

export interface CredentialStatus {
  apiKeyConfigured: boolean;
  workspaceConfigured: boolean;
}

export interface PreparedReference {
  id: string;
  name: string;
  duration_seconds: number;
  bytes: number;
  codec: string;
  consent_token: string;
  uploaded?: boolean;
}

export interface CreateJobRequest {
  project_id: string;
  project_name: string;
  mode: CreationMode;
  prompt: string;
  params: {
    format: AudioFormat;
    sample_rate: GenerationParams["sampleRate"];
    channels: GenerationParams["channels"];
    volume: number;
    rate: number;
    seed: number;
    enable_cbr: boolean;
    bit_rate: number;
    quality: number;
    enable_aigc_tag: boolean;
  };
  references: Array<{id: string; consent_token: string}>;
}

export interface CapabilityContract {
  model: "qwen-audio-3.1-tts-next";
  formats: AudioFormat[];
  sampleRates: number[];
  channels: number[];
  maxReferenceCount: number;
  maxReferenceSeconds: number;
  maxReferenceBytes: number;
  maxPromptChars: number;
  volume: {min: number; max: number; default: number};
  rate: {min: number; max: number; default: number};
}
