import Groq from 'groq-sdk';

const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

let groqClient: Groq | undefined;

function getGroqClient(): Groq {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured. Add it to the backend environment.');
  }

  if (!groqClient) {
    groqClient = new Groq({ apiKey });
  }

  return groqClient;
}

function getStatus(error: unknown): number | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof error.status === 'number'
  ) {
    return error.status;
  }

  return undefined;
}

function getMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown Groq API error.';
  const apiKey = process.env.GROQ_API_KEY;
  return apiKey ? message.split(apiKey).join('[REDACTED]') : message;
}

function describeGroqError(error: unknown): string {
  const status = getStatus(error);
  const message = getMessage(error);

  if (status === 401 || status === 403) {
    return 'Groq rejected the API key. Check GROQ_API_KEY.';
  }
  if (
    status === 404 ||
    (status === 400 && /\bmodel\b.*(?:not found|does not exist|not available)/i.test(message))
  ) {
    return `Groq could not find the configured model. Check GROQ_MODEL (currently ${process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL}).`;
  }
  if (status === 429) {
    return 'Groq rate limit reached. Wait before retrying or check the account limits.';
  }
  if (status !== undefined) {
    return `Groq request failed with HTTP ${status}: ${message}`;
  }

  return `Groq request failed: ${message}`;
}

export interface GroqChatOptions {
  system?: string;
}

async function requestCompletion(prompt: string, options?: GroqChatOptions): Promise<string | null> {
  const completion = await getGroqClient().chat.completions.create({
    model: process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL,
    messages: [
      ...(options?.system ? [{ role: 'system' as const, content: options.system }] : []),
      { role: 'user', content: prompt },
    ],
  });

  return completion.choices[0]?.message.content ?? null;
}

export async function chatWithGroq(prompt: string, options?: GroqChatOptions): Promise<string> {
  let content: string | null;
  try {
    content = await requestCompletion(prompt, options);
  } catch (error) {
    throw new Error(describeGroqError(error));
  }

  if (!content?.trim()) {
    throw new Error('Groq returned an empty model response.');
  }

  return content;
}
