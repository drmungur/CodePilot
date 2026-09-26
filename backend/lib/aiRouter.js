const PROVIDERS = [
  {
    name: "groq",
    model: () => process.env.GROQ_MODEL || "openai/gpt-oss-20b",
    enabled: () => Boolean(process.env.GROQ_API_KEY?.trim()),
    call: callGroq,
  },
  {
    name: "openrouter",
    model: () => process.env.OPENROUTER_MODEL || "openrouter/free",
    enabled: () => Boolean(process.env.OPENROUTER_API_KEY?.trim()),
    call: callOpenRouter,
  },
  {
    name: "gemini",
    model: () => process.env.GEMINI_MODEL || "gemini-3.8-flash",
    enabled: () => Boolean(process.env.GEMINI_API_KEY?.trim()),
    call: callGemini,
  },
];

function providerError(provider, message, status = null, retryable = false) {
  const error = new Error(message);
  error.provider = provider;
  error.status = status;
  error.retryable = retryable;
  return error;
}

async function callGroq(prompt) {
  const apiKey = process.env.GROQ_API_KEY?.trim();

  if (!apiKey) {
    throw providerError("groq", "GROQ_API_KEY is not configured");
  }

  let res;

  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 8192,
      }),
    });
  } catch {
    throw providerError(
      "groq",
      "Groq service is unreachable",
      null,
      true
    );
  }

  if (res.status === 429) {
    throw providerError(
      "groq",
      "Groq rate limit reached",
      429,
      true
    );
  }

  if (res.status >= 500) {
    throw providerError(
      "groq",
      `Groq server error (${res.status})`,
      res.status,
      true
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw providerError(
      "groq",
      `Groq authentication failed (${res.status})`,
      res.status,
      false
    );
  }

  if (!res.ok) {
    throw providerError(
      "groq",
      `Groq API request failed (${res.status})`,
      res.status,
      false
    );
  }

  const data = await res.json();

  const message = data?.choices?.[0]?.message;

  const text =
    typeof message?.content === "string"
      ? message.content
      : typeof message?.reasoning_content === "string"
        ? message.reasoning_content
        : typeof data?.choices?.[0]?.text === "string"
          ? data.choices[0].text
          : "";

  if (!text.trim()) {
    throw providerError(
      "groq",
      "Groq returned no usable generated text",
      null,
      true
    );
  }

  return text.trim();
}

async function callOpenRouter(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (!apiKey) {
    throw providerError(
      "openrouter",
      "OPENROUTER_API_KEY is not configured"
    );
  }

  let res;

  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://code-pilot-tawny.vercel.app",
        "X-Title": "Code/Pilot",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "openrouter/free",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });
  } catch {
    throw providerError(
      "openrouter",
      "OpenRouter service is unreachable",
      null,
      true
    );
  }

  if (res.status === 429) {
    throw providerError(
      "openrouter",
      "OpenRouter rate limit reached",
      429,
      true
    );
  }

  if (res.status >= 500) {
    throw providerError(
      "openrouter",
      `OpenRouter server error (${res.status})`,
      res.status,
      true
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw providerError(
      "openrouter",
      `OpenRouter authentication failed (${res.status})`,
      res.status,
      false
    );
  }

  if (!res.ok) {
    throw providerError(
      "openrouter",
      `OpenRouter API request failed (${res.status})`,
      res.status,
      false
    );
  }

  const data = await res.json();

  const text = data?.choices?.[0]?.message?.content || "";

  if (!text.trim()) {
    throw providerError(
      "openrouter",
      "OpenRouter returned no usable generated text",
      null,
      true
    );
  }

  return text.trim();
}

async function callGemini(prompt) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw providerError(
      "gemini",
      "GEMINI_API_KEY is not configured"
    );
  }

  const model =
    process.env.GEMINI_MODEL || "gemini-3.8-flash";

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let res;

  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 8192,
        },
      }),
    });
  } catch {
    throw providerError(
      "gemini",
      "Gemini service is unreachable",
      null,
      true
    );
  }

  if (res.status === 429) {
    throw providerError(
      "gemini",
      "Gemini rate limit reached",
      429,
      true
    );
  }

  if (res.status >= 500) {
    throw providerError(
      "gemini",
      `Gemini server error (${res.status})`,
      res.status,
      true
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw providerError(
      "gemini",
      `Gemini authentication failed (${res.status})`,
      res.status,
      false
    );
  }

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");

    throw providerError(
      "gemini",
      `Gemini API request failed (${res.status})${errorText ? `: ${errorText.slice(0, 200)}` : ""}`,
      res.status,
      false
    );
  }

  const data = await res.json();

  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part?.text || "")
      .join("") || "";

  if (!text.trim()) {
    throw providerError(
      "gemini",
      "Gemini returned no usable generated text",
      null,
      true
    );
  }

  return text.trim();
}

export async function callAI(prompt) {
  const enabledProviders = PROVIDERS.filter((provider) =>
    provider.enabled()
  );

  if (enabledProviders.length === 0) {
    throw new Error(
      "No AI providers are configured. Add a Groq, OpenRouter, or Gemini API key."
    );
  }

  const failures = [];

  for (const provider of enabledProviders) {
    try {
      console.log(
        `[ai-router] Trying ${provider.name} (${provider.model()})`
      );

      const text = await provider.call(prompt);

      console.log(
        `[ai-router] SUCCESS: ${provider.name} (${provider.model()})`
      );

      return {
        text,
        provider: provider.name,
        model: provider.model(),
      };
    } catch (error) {
      failures.push({
        provider: provider.name,
        message: error.message,
        status: error.status,
      });

      console.warn(
        `[ai-router] ${provider.name} failed: ${error.message}`
      );

      if (!error.retryable) {
        console.warn(
          `[ai-router] ${provider.name} failure is not retryable; moving to next provider`
        );
      } else {
        console.warn(
          `[ai-router] ${provider.name} temporary failure; moving to next provider`
        );
      }
    }
  }

  const summary = failures
    .map(
      (failure) =>
        `${failure.provider}: ${failure.message}`
    )
    .join(" | ");

  throw new Error(
    `All configured AI providers failed. ${summary}`
  );
}