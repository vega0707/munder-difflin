/**
 * Free Flow STT backends. Groq Whisper is the original (fast, often blocked
 * from mainland China). SiliconFlow SenseVoice is the China-reachable free
 * alternative — same OpenAI-compatible transcription POST, different host/model.
 */

export type SttProviderId = 'groq' | 'siliconflow';

export interface SttProvider {
  id: SttProviderId;
  endpoint: string;
  defaultModel: string;
  models: readonly { id: string; labelKey: 'fast' | 'accurate' | 'sensevoice' }[];
  signupUrl: string;
}

export const STT_PROVIDERS: Record<SttProviderId, SttProvider> = {
  groq: {
    id: 'groq',
    endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
    defaultModel: 'whisper-large-v3-turbo',
    models: [
      { id: 'whisper-large-v3-turbo', labelKey: 'fast' },
      { id: 'whisper-large-v3', labelKey: 'accurate' }
    ],
    signupUrl: 'https://console.groq.com/keys'
  },
  siliconflow: {
    id: 'siliconflow',
    endpoint: 'https://api.siliconflow.cn/v1/audio/transcriptions',
    defaultModel: 'FunAudioLLM/SenseVoiceSmall',
    models: [
      { id: 'FunAudioLLM/SenseVoiceSmall', labelKey: 'sensevoice' }
    ],
    signupUrl: 'https://cloud.siliconflow.cn/account/ak'
  }
};

export function isSttProviderId(id: unknown): id is SttProviderId {
  return id === 'groq' || id === 'siliconflow';
}

/** Unknown / missing ids keep the original Groq path so existing configs stay put. */
export function resolveSttProvider(id: unknown): SttProvider {
  return isSttProviderId(id) ? STT_PROVIDERS[id] : STT_PROVIDERS.groq;
}
