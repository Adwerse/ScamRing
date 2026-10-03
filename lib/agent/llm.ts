// Owner: A (AI moderator)
// The only file that knows about the LLM provider. TensorX is assumed to be OpenAI
// chat-completions compatible: POST ${TENSORX_BASE_URL}/chat/completions with a Bearer key.
// To switch provider, change this file only. The API key is never logged or returned.

export type ToolDef = {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ToolCall = { id: string; type: 'function'; function: { name: string; arguments: string } };

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export type Completion = { content: string | null; toolCalls: ToolCall[] };

export const LLM_TIMEOUT_MS = 15000;

type Config = { baseUrl: string; apiKey: string; model: string };

function config(): Config | null {
  const { TENSORX_BASE_URL: baseUrl, TENSORX_API_KEY: apiKey, TENSORX_MODEL: model } = process.env;
  return baseUrl && apiKey && model ? { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, model } : null;
}

export const llmConfigured = (): boolean => config() !== null;
export const modelName = (): string => process.env.TENSORX_MODEL || 'unconfigured';

function scrub(text: string, apiKey: string): string {
  return text.split(apiKey).join('***').slice(0, 200);
}

type RawMessage = { content?: string | null; tool_calls?: ToolCall[] };

export async function chat(messages: ChatMessage[], tools: ToolDef[], timeoutMs = LLM_TIMEOUT_MS): Promise<Completion> {
  const cfg = config();
  if (!cfg) throw new Error('TensorX is not configured (TENSORX_BASE_URL, TENSORX_API_KEY, TENSORX_MODEL)');
  let response: Response;
  try {
    response = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
        temperature: 0,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new Error(timedOut ? `LLM request timed out after ${Math.round(timeoutMs / 1000)}s` : `LLM request failed: ${scrub(String(err), cfg.apiKey)}`);
  }
  if (!response.ok) throw new Error(`LLM request failed: HTTP ${response.status} ${scrub(await response.text().catch(() => ''), cfg.apiKey)}`);
  const body = (await response.json().catch(() => null)) as { choices?: { message?: RawMessage }[] } | null;
  const message = body?.choices?.[0]?.message;
  if (!message) throw new Error('LLM response had no message');
  return { content: message.content ?? null, toolCalls: message.tool_calls ?? [] };
}
