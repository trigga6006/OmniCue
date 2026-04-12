/**
 * Non-streaming single-shot AI helper for intent resolution.
 * Reuses OmniCue's existing provider settings and direct API credentials.
 * Returns raw text response; caller is responsible for parsing.
 */

import Anthropic from '@anthropic-ai/sdk'
import { randomUUID } from 'crypto'
import { settingsStore } from '../store'
import { cleanupSession, streamAiResponse, type ChatMessage } from '../ai'

const TIMEOUT_MS = 5000

type Settings = ReturnType<typeof settingsStore.get>

interface CompatProviderConfig {
  providerId: Settings['aiProvider']
  name: string
  defaultBaseUrl: string
  defaultModel: string
  apiKeyField: keyof Settings
  modelField: keyof Settings
  authHeader?: string
  authPrefix?: string
}

const COMPAT_PROVIDERS: CompatProviderConfig[] = [
  {
    providerId: 'gemini',
    name: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.1-pro',
    apiKeyField: 'geminiApiKey',
    modelField: 'geminiModel',
  },
  {
    providerId: 'deepseek',
    name: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    apiKeyField: 'deepseekApiKey',
    modelField: 'deepseekModel',
  },
  {
    providerId: 'groq',
    name: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
    apiKeyField: 'groqApiKey',
    modelField: 'groqModel',
  },
  {
    providerId: 'mistral',
    name: 'Mistral',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    apiKeyField: 'mistralApiKey',
    modelField: 'mistralModel',
  },
  {
    providerId: 'xai',
    name: 'xAI Grok',
    defaultBaseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4',
    apiKeyField: 'xaiApiKey',
    modelField: 'xaiModel',
  },
  {
    providerId: 'glm',
    name: 'GLM (Zhipu AI)',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5.1',
    apiKeyField: 'glmApiKey',
    modelField: 'glmModel',
  },
  {
    providerId: 'kimi',
    name: 'Kimi (Moonshot)',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    defaultModel: 'kimi-k2.5',
    apiKeyField: 'kimiApiKey',
    modelField: 'kimiModel',
  },
]

async function callAnthropic(prompt: string, settings: Settings): Promise<string | null> {
  const apiKey = settings.claudeApiKey?.trim()
  if (!apiKey) return null

  try {
    const client = new Anthropic({ apiKey })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const response = await client.messages.create(
      {
        model: settings.claudeModel?.trim() || 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{ role: 'user', content: prompt }],
      },
      { signal: controller.signal }
    )

    clearTimeout(timer)
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')

    return text || null
  } catch (err) {
    console.warn('[OmniCue] Intent AI: Claude API call failed:', err instanceof Error ? err.message : err)
    return null
  }
}

async function callOpenAiCompat(args: {
  prompt: string
  baseURL: string
  apiKey: string
  model: string
  providerLabel: string
  authHeader?: string
  authPrefix?: string
}): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const headerName = args.authHeader || 'Authorization'
    const prefix = args.authPrefix || 'Bearer'

    const res = await fetch(`${args.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [headerName]: `${prefix} ${args.apiKey}`,
      },
      body: JSON.stringify({
        model: args.model,
        messages: [{ role: 'user', content: args.prompt }],
        stream: false,
        temperature: 0,
      }),
      signal: controller.signal,
    })

    clearTimeout(timer)

    if (!res.ok) {
      const body = await res.text()
      let errorMsg = `${args.providerLabel} API error ${res.status}`
      try {
        errorMsg = JSON.parse(body).error?.message || errorMsg
      } catch {
        // use default
      }
      console.warn('[OmniCue] Intent AI:', errorMsg)
      return null
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>
    }

    const content = data.choices?.[0]?.message?.content
    if (typeof content === 'string') return content || null
    if (Array.isArray(content)) {
      return content.map((part) => part.text || '').join('') || null
    }
    return null
  } catch (err) {
    console.warn('[OmniCue] Intent AI call failed:', err instanceof Error ? err.message : err)
    return null
  }
}

async function callViaStreamingProvider(
  prompt: string,
  provider: Settings['aiProvider']
): Promise<string | null> {
  const sessionId = `intent-${randomUUID()}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    return await new Promise<string | null>((resolve) => {
      let settled = false
      const finish = (value: string | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        cleanupSession(sessionId)
        resolve(value)
      }

      const messages: ChatMessage[] = [{ role: 'user', content: prompt }]

      streamAiResponse(
        sessionId,
        messages,
        {
          onToken: () => {
            // no-op; onFinish provides the full text
          },
          onFinish: (fullText) => finish(fullText || null),
          onError: () => finish(null),
        },
        controller.signal,
        undefined,
        provider,
        undefined,
        'read-only',
        'normal'
      ).catch(() => finish(null))
    })
  } finally {
    clearTimeout(timer)
  }
}

function getCompatProvider(providerId: Settings['aiProvider']): CompatProviderConfig | undefined {
  return COMPAT_PROVIDERS.find((provider) => provider.providerId === providerId)
}

function orderedProviderAttempts(
  settings: Settings,
  prompt: string
): Array<() => Promise<string | null>> {
  const attempts: Array<() => Promise<string | null>> = []
  const seen = new Set<string>()

  const addAttempt = (key: string, fn: () => Promise<string | null>) => {
    if (seen.has(key)) return
    seen.add(key)
    attempts.push(fn)
  }

  const addDirectProvider = (providerId: Settings['aiProvider']) => {
    if (providerId === 'claude') {
      addAttempt('claude', () => callAnthropic(prompt, settings))
      return
    }

    if (providerId === 'openai') {
      const apiKey = settings.aiApiKey?.trim()
      if (!apiKey) return
      addAttempt('openai', () =>
        callOpenAiCompat({
          prompt,
          baseURL: settings.aiBaseUrl?.trim() || 'https://api.openai.com/v1',
          apiKey,
          model: settings.aiModel?.trim() || 'gpt-5.4-mini',
          providerLabel: 'OpenAI',
        })
      )
      return
    }

    const compat = getCompatProvider(providerId)
    if (!compat) return
    const apiKey = String(settings[compat.apiKeyField] || '').trim()
    if (!apiKey) return
    addAttempt(compat.providerId, () =>
      callOpenAiCompat({
        prompt,
        baseURL: compat.defaultBaseUrl,
        apiKey,
        model: String(settings[compat.modelField] || '').trim() || compat.defaultModel,
        providerLabel: compat.name,
        authHeader: compat.authHeader,
        authPrefix: compat.authPrefix,
      })
    )
  }

  addDirectProvider(settings.aiProvider)
  addDirectProvider('claude')
  addDirectProvider('openai')
  for (const compat of COMPAT_PROVIDERS) {
    addDirectProvider(compat.providerId)
  }

  return attempts
}

/**
 * Send a single-shot prompt and get a text response.
 * Prefers the currently configured API-backed provider, then falls back to any
 * other configured direct API providers.
 */
export async function singleShotCompletion(prompt: string): Promise<string | null> {
  const settings = settingsStore.get()
  const attempts = orderedProviderAttempts(settings, prompt)

  for (const attempt of attempts) {
    const result = await attempt()
    if (result) return result
  }

  if (settings.aiProvider === 'codex' || settings.aiProvider === 'claude' || settings.aiProvider === 'opencode' || settings.aiProvider === 'kimicode') {
    return callViaStreamingProvider(prompt, settings.aiProvider)
  }

  return null
}
