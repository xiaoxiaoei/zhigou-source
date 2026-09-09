export class ModelConfigurationError extends Error {
  constructor(message = "AI 模型尚未配置") {
    super(message);
    this.name = "ModelConfigurationError";
    this.code = "MODEL_NOT_CONFIGURED";
    this.status = 503;
  }
}

export class ModelRequestError extends Error {
  constructor(message, { code = "MODEL_REQUEST_FAILED", status = 502, cause, requestId, providerCode, attempt, maxAttempts } = {}) {
    super(message, { cause });
    this.name = "ModelRequestError";
    this.code = code;
    this.status = status;
    this.requestId = requestId || null;
    this.providerCode = providerCode || null;
    this.attempt = attempt || null;
    this.maxAttempts = maxAttempts || null;
  }
}

function stripJsonFence(value = "") {
  return String(value).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(attempt, baseDelayMs) {
  const exponential = baseDelayMs * (2 ** Math.max(0, attempt - 1));
  const jitter = Math.floor(Math.random() * Math.max(250, baseDelayMs * 0.35));
  return Math.min(15000, exponential + jitter);
}

function safeProviderDetails(payload, response) {
  return {
    requestId: payload?.request_id || payload?.requestId || response?.headers?.get?.("x-request-id") || response?.headers?.get?.("x-dashscope-request-id") || null,
    providerCode: payload?.code || payload?.error?.code || null,
    providerMessage: payload?.message || payload?.error?.message || null,
  };
}

function shouldRetry(error) {
  return ["MODEL_TIMEOUT", "MODEL_CONNECTION_FAILED", "MODEL_INVALID_RESPONSE", "MODEL_EMPTY_RESPONSE", "MODEL_INVALID_JSON"].includes(error?.code)
    || error?.status === 429
    || Number(error?.status) >= 500;
}

export function createLlmClient({
  baseUrl,
  apiKey,
  model,
  timeoutMs = Number(process.env.LLM_TIMEOUT_MS || 240000),
  disableThinking = process.env.LLM_DISABLE_THINKING === "true",
  protocol = process.env.LLM_PROTOCOL || "openai",
  fetchImpl = fetch,
  maxAttempts = Number(process.env.LLM_MAX_ATTEMPTS || 3),
  retryBaseDelayMs = Number(process.env.LLM_RETRY_BASE_DELAY_MS || 1800),
} = {}) {
  const normalizedBaseUrl = String(baseUrl || "").replace(/\/$/, "");
  const useOllamaNativeApi = protocol === "ollama";
  const useDashScope = /dashscope(?:-intl)?\.aliyuncs\.com/.test(normalizedBaseUrl);

  function forModel(selectedModel) {
    const configured = Boolean(normalizedBaseUrl && apiKey && selectedModel);
    return {
      configured,
      model: selectedModel || null,
      protocol,
      runtime: useOllamaNativeApi ? "本机 Ollama" : useDashScope ? "百炼云端" : "兼容云端服务",
      async completeJson({ stage, system, prompt, temperature = 0.1 }) {
        if (!configured) throw new ModelConfigurationError();
        const attempts = Math.max(1, Math.min(5, Number(maxAttempts) || 3));
        let lastError;

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          let response;
          try {
            const retryInstruction = attempt > 1 && lastError?.code === "MODEL_INVALID_JSON"
              ? "\n\n上一次响应不是有效 JSON。本次不得使用 Markdown 代码围栏、注释或 JSON 之外的任何文字，并确保所有引号和换行正确转义。"
              : "";
            response = await fetchImpl(
              useOllamaNativeApi ? `${normalizedBaseUrl}/api/chat` : `${normalizedBaseUrl}/chat/completions`,
              {
                method: "POST",
                signal: controller.signal,
                headers: {
                  "content-type": "application/json",
                  ...(useOllamaNativeApi ? {} : { authorization: `Bearer ${apiKey}` }),
                },
                body: JSON.stringify(useOllamaNativeApi ? {
                  model: selectedModel,
                  stream: false,
                  format: "json",
                  ...(disableThinking ? { think: false } : {}),
                  options: { temperature },
                  messages: [
                    { role: "system", content: system || "只输出严格、可解析的 JSON。" },
                    { role: "user", content: prompt + retryInstruction },
                  ],
                } : {
                  model: selectedModel,
                  temperature,
                  response_format: { type: "json_object" },
                  ...(useDashScope && disableThinking ? { enable_thinking: false } : {}),
                  messages: [
                    { role: "system", content: system || "只输出严格、可解析的 JSON。" },
                    { role: "user", content: prompt + retryInstruction },
                  ],
                }),
              },
            );
          } catch (error) {
            lastError = error?.name === "AbortError"
              ? new ModelRequestError(`AI 阶段“${stage}”超时`, { code: "MODEL_TIMEOUT", status: 504, cause: error, attempt, maxAttempts: attempts })
              : new ModelRequestError(`AI 阶段“${stage}”无法连接模型服务`, { code: "MODEL_CONNECTION_FAILED", cause: error, attempt, maxAttempts: attempts });
          } finally {
            clearTimeout(timer);
          }

          if (!lastError || lastError.attempt !== attempt) {
            let payload;
            try {
              payload = await response.json();
            } catch (error) {
              lastError = new ModelRequestError(`AI 阶段“${stage}”返回了无效响应`, { code: "MODEL_INVALID_RESPONSE", status: response.status || 502, cause: error, attempt, maxAttempts: attempts });
            }

            if (payload) {
              const details = safeProviderDetails(payload, response);
              if (!response.ok) {
                const status = response.status || 502;
                lastError = new ModelRequestError(`AI 阶段“${stage}”调用失败（${response.status}${details.providerCode ? ` · ${details.providerCode}` : ""}）`, {
                  code: "MODEL_HTTP_ERROR", status, requestId: details.requestId, providerCode: details.providerCode, attempt, maxAttempts: attempts,
                });
              } else {
                const content = useOllamaNativeApi ? payload?.message?.content : payload?.choices?.[0]?.message?.content;
                if (!content) {
                  lastError = new ModelRequestError(`AI 阶段“${stage}”没有返回内容`, { code: "MODEL_EMPTY_RESPONSE", requestId: details.requestId, attempt, maxAttempts: attempts });
                } else {
                  try {
                    return JSON.parse(stripJsonFence(content));
                  } catch (error) {
                    lastError = new ModelRequestError(`AI 阶段“${stage}”没有返回有效 JSON`, { code: "MODEL_INVALID_JSON", cause: error, requestId: details.requestId, attempt, maxAttempts: attempts });
                  }
                }
              }
            }
          }

          if (!shouldRetry(lastError) || attempt >= attempts) {
            if (attempt >= attempts && attempts > 1) lastError.message += `；已自动尝试 ${attempts} 次`;
            throw lastError;
          }
          await wait(retryDelay(attempt, retryBaseDelayMs));
        }
        throw lastError;
      },
      forModel(nextModel) {
        return forModel(nextModel || selectedModel);
      },
    };
  }

  return forModel(model);
}

export function createLlmClientFromEnv() {
  return createLlmClient({
    baseUrl: process.env.LLM_BASE_URL,
    apiKey: process.env.LLM_API_KEY,
    model: process.env.LLM_MODEL,
    disableThinking: process.env.LLM_DISABLE_THINKING === "true",
    protocol: process.env.LLM_PROTOCOL || "openai",
  });
}
