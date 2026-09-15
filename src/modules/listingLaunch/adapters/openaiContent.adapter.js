const config = require('../../../config');
const AppError = require('../../../shared/errors/appError');
const { buildRequest } = require('../prompts/amazonContent.v1');
const { validateContent } = require('../services/listingContentValidation');

const providerError = (suffix, message, status = 502) => new AppError(message, status, true, `CONTENT_PROVIDER_${suffix}`);
const tokenCount = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;

async function generateContent({ snapshot, model = config.listingContent.model, signal }) {
  const { enabled, apiKey, timeoutMs } = config.listingContent;
  if (!enabled || !apiKey || !model || !config.listingContent.model) {
    throw new AppError('Content generation is not configured', 503, true, 'CONTENT_GENERATION_UNAVAILABLE');
  }
  if (signal?.aborted) throw providerError('ABORTED', 'Content generation was cancelled');
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  let providerRequestId = null;
  let usage = null;
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildRequest(snapshot, model)),
    });
    const requestId = response.headers.get('x-request-id');
    providerRequestId = typeof requestId === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(requestId) ? requestId : null;
    if (!response.ok) {
      const suffix = response.status === 401 ? 'UNAUTHORIZED' : response.status === 429 ? 'RATE_LIMITED' : response.status >= 500 ? 'UNAVAILABLE' : 'ERROR';
      throw providerError(suffix, 'Content provider request failed');
    }
    let body;
    try { body = await response.json(); } catch {
      throw providerError('INVALID_RESPONSE', 'Content provider returned invalid JSON');
    }
    if (body?.usage && typeof body.usage === 'object' && !Array.isArray(body.usage)) {
      usage = { inputTokens: tokenCount(body.usage.input_tokens), outputTokens: tokenCount(body.usage.output_tokens), totalTokens: tokenCount(body.usage.total_tokens) };
    }
    if (body?.status === 'incomplete') throw providerError('INCOMPLETE', 'Content provider response was incomplete');
    if (body?.status !== 'completed' || !Array.isArray(body.output)) throw providerError('INVALID_RESPONSE', 'Content provider response was not completed');
    if (body.output.some((item) => !['message', 'reasoning'].includes(item?.type))) {
      throw providerError('INVALID_RESPONSE', 'Content provider returned an unexpected output format');
    }
    const messages = body.output.filter((item) => item?.type === 'message');
    if (messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part?.type === 'refusal'))) {
      throw providerError('REFUSED', 'Content provider declined this generation');
    }
    if (messages.length !== 1 || messages[0].status !== 'completed' || messages[0].role !== 'assistant'
      || !Array.isArray(messages[0].content) || messages[0].content.length !== 1
      || messages[0].content[0]?.type !== 'output_text' || typeof messages[0].content[0].text !== 'string') {
      throw providerError('INVALID_RESPONSE', 'Content provider returned an unexpected output format');
    }
    let parsed;
    try { parsed = JSON.parse(messages[0].content[0].text); } catch {
      throw providerError('INVALID_RESPONSE', 'Content provider returned invalid content JSON');
    }
    return { content: validateContent(parsed, snapshot), usage, providerRequestId };
  } catch (error) {
    const safeError = controller.signal.aborted
      ? providerError(timedOut ? 'TIMEOUT' : 'ABORTED', timedOut ? 'Content provider request timed out' : 'Content generation was cancelled')
      : error instanceof AppError ? error : providerError('ERROR', 'Content provider request failed');
    safeError.usage = usage;
    safeError.providerRequestId = providerRequestId;
    throw safeError;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    controller.abort();
  }
}

module.exports = { generateContent };
