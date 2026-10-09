/**
 * Northstar AI identity + scope guardrail layer.
 * Central instruction builder so every generated response receives the
 * same constraints. SQL generation / execution is untouched — this module
 * only governs conversational (non-database) answers and validates them.
 * No RAG functionality lives here.
 */

export const NORTHSTAR_NAME = 'Northstar AI';

export const NORTHSTAR_IDENTITY_ANSWER =
  "I'm Northstar AI, the AI assistant for your Northstar workspace. " +
  'I can help you find and understand information about projects, tasks, team members, activities, and other workspace data.';

export const NORTHSTAR_CAPABILITIES_ANSWER =
  "I'm Northstar AI, the AI assistant for your Northstar workspace. " +
  'I can help you with projects, tasks, team members, calendar/events, activities, documents, and other workspace information. ' +
  'Just ask, for example: "List the active projects."';

export const NORTHSTAR_SCOPE_PREFIX =
  'I am primarily designed for the Northstar workspace';

const IDENTITY_PATTERNS = [
  /\bwho\s+are\s+you\b/i,
  /\bwhat\s+are\s+you\b/i,
  /\bwhat(?:'s| is)\s+your\s+name\b/i,
  /\byour\s+name\b/i,
  /\bare\s+you\s+(?:chatgpt|gpt|openai|qwen|groq|ollama|an?\s+(?:ai|llm|language|chatbot|assistant|model))\b/i,
  /\bwhat\s+model\s+(?:are\s+you|do\s+you\s+use|is\s+this)\b/i,
  /\bwhich\s+model\s+(?:are\s+you|do\s+you\s+use)\b/i,
  /\bwho\s+(?:made|created|built|developed)\s+you\b/i,
  /\bwho\s+is\s+your\s+(?:creator|maker|developer)\b/i,
];

const CAPABILITIES_PATTERNS = [
  /\bwhat\s+can\s+you\s+do\b/i,
  /\bwhat\s+do\s+you\s+do\b/i,
  /\bhow\s+can\s+you\s+help\b/i,
  /\bwhat\s+are\s+your\s+(?:capabilit|featur|function)/i,
];

export function isIdentityQuestion(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return IDENTITY_PATTERNS.some((pattern) => pattern.test(text));
}

export function isCapabilitiesQuestion(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return CAPABILITIES_PATTERNS.some((pattern) => pattern.test(text));
}

export function answerIdentityQuestion(message: string): string {
  const text = message.trim().toLowerCase();
  if (/\bare\s+you\b/.test(text) && /(chatgpt|gpt|openai|qwen|groq|ollama)/.test(text)) {
    return `No — ${NORTHSTAR_IDENTITY_ANSWER}`;
  }
  if (/\b(model|made|created|built|developed|creator|maker|developer)\b/.test(text)) {
    return (
      `${NORTHSTAR_IDENTITY_ANSWER} ` +
      'I was built for the Northstar AI Workplace to help with your workspace data.'
    );
  }
  return NORTHSTAR_IDENTITY_ANSWER;
}

/** System prompt prepended to every non-database chat request. */
export function buildNorthstarSystemPrompt(): string {
  return [
    `You are ${NORTHSTAR_NAME}, the AI assistant in the Northstar AI Workplace.`,
    'Always identify yourself only as Northstar AI.',
    'Never identify as ChatGPT, GPT, OpenAI, Qwen, Groq, Ollama, or any model or provider.',
    'Never mention or hint at the underlying model, provider, API, or implementation details.',
    'Core responsibilities: projects, tasks, team members, calendar/events, activities, documents, workspace info.',
    'Never invent or assume Northstar workspace data (projects, tasks, people, dates, assignments, activities).',
    'If the user asks for workspace-specific facts and the information is not available through the database path, say the information is unavailable rather than guessing.',
    'For identity questions, respond with your Northstar AI identity and role.',
    'For unrelated requests, politely explain you are primarily designed for the Northstar workspace.',
    'Answer concisely and helpfully.',
  ].join('\n');
}

export function buildNorthstarChatPrompt(message: string): { system: string; user: string } {
  return { system: buildNorthstarSystemPrompt(), user: message.trim() };
}

export function northstarScopeDecline(topic?: string): string {
  const subject = topic ? ` ${topic}` : '';
  return (
    `${NORTHSTAR_SCOPE_PREFIX}, so I can't help with${subject} directly. ` +
    'I can help with projects, tasks, team members, calendar/events, activities, documents, and workspace info instead.'
  );
}

const FORBIDDEN_IDENTITY_CLAIMS = [
  /\bi\s+am\s+(?:chatgpt|gpt(?:-?\d[^.,;]*)?)\b/i,
  /\bi\s+am\s+an?\s+(?:openai|qwen|groq|ollama)[^.,;]{0,60}\bmodel\b/i,
  /\bi\s+am\s+(?:a(?:n)?\s+)?(?:openai|qwen|groq|ollama)\b/i,
  /\bi(?:'m| am)\s+powered\s+by\s+(?:openai|chatgpt|gpt|qwen|groq|ollama)\b/i,
  /\bi\s+use\s+(?:qwen|groq|ollama)\b/i,
  /\bmy\s+(?:underlying\s+)?model\s+is\b/i,
  /\bmy\s+provider\s+is\b/i,
];

export function containsForbiddenIdentityClaim(response: string): boolean {
  return FORBIDDEN_IDENTITY_CLAIMS.some((pattern) => pattern.test(response));
}

const WORKSPACE_FABRICATION = /\bProject\s+(Phoenix|Orion)\b/i;

export function containsWorkspaceFabrication(response: string): boolean {
  return WORKSPACE_FABRICATION.test(response);
}

export const WORKSPACE_UNAVAILABLE_ANSWER =
  'That workspace information is unavailable right now. ' +
  'I can only share workspace facts that come from your Northstar data, so I will not guess at projects, tasks, or assignments.';

/** Final validation for conversational answers only. DB answers bypass this. */
export function validateNorthstarResponse(response: string): string {
  if (!response || !response.trim()) return response;
  if (containsForbiddenIdentityClaim(response)) {
    return NORTHSTAR_IDENTITY_ANSWER;
  }
  if (containsWorkspaceFabrication(response)) {
    return WORKSPACE_UNAVAILABLE_ANSWER;
  }
  return response;
}

