import { createOpenAI } from '@ai-sdk/openai'
import { streamText, type CoreMessage } from 'ai'
import { settingsStore } from './store'

function getProvider() {
  const settings = settingsStore.get()
  return createOpenAI({
    apiKey: settings.aiApiKey || 'missing',
    ...(settings.aiBaseUrl ? { baseURL: settings.aiBaseUrl } : {}),
  })
}

export interface AiStreamCallbacks {
  onToken: (token: string) => void
  onFinish: (fullText: string) => void
  onError: (error: string) => void
}

const SYSTEM_PROMPT = `You are OmniCue, a concise desktop AI companion. You can see the user's screen when they share a screenshot. Be helpful, brief, and specific. Prefer bullet points and short paragraphs over walls of text. When analyzing screenshots, focus on what's most relevant to the user's question.`

export async function streamAiResponse(
  messages: CoreMessage[],
  callbacks: AiStreamCallbacks,
  abortSignal?: AbortSignal
): Promise<void> {
  const settings = settingsStore.get()
  const provider = getProvider()

  try {
    const result = streamText({
      model: provider(settings.aiModel || 'gpt-4o'),
      messages,
      abortSignal,
      system: SYSTEM_PROMPT,
    })

    let fullText = ''
    for await (const chunk of (await result).textStream) {
      fullText += chunk
      callbacks.onToken(chunk)
    }

    callbacks.onFinish(fullText)
  } catch (err: unknown) {
    if (abortSignal?.aborted) return
    const message = err instanceof Error ? err.message : String(err)
    callbacks.onError(message)
  }
}
