/**
 * Agent Framework — OpenRouter LLM Adapter
 * Simplified version of the Python blueprint's LLMToolAdapter.
 * Only supports OpenRouter (no LiteLLM multi-provider).
 *
 * Responsibilities:
 *   1. callWithTools()  — Send messages + tool definitions to OpenRouter
 *   2. Parse response   — Extract tool_calls or content from the response
 */

import type { ChatMessage, LLMResponse, ToolCall, OpenAIToolDef } from "./types";

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
}

export class OpenRouterAdapter {
  private apiKey: string;
  private model: string;

  constructor(config: OpenRouterConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  /**
   * Call OpenRouter chat/completions with tool definitions.
   * Returns a standardised LLMResponse.
   */
  async callWithTools(
    messages: ChatMessage[],
    tools: OpenAIToolDef[]
  ): Promise<LLMResponse> {
    const body: Record<string, any> = {
      model: this.model,
      messages: messages.map((m) => this.serializeMessage(m)),
    };

    // Only include tools if we have some registered
    if (tools.length > 0) {
      body.tools = tools;
    }

    console.log(`[Agent] Calling OpenRouter model=${this.model}, messages=${messages.length}, tools=${tools.length}`);

    const data = await this.fetchWithRetry("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    return this.parseResponse(data);
  }

  // ── Private ──────────────────────────────────────────────────────

  /**
   * Fetch with exponential backoff for 429/5xx errors
   */
  private async fetchWithRetry(url: string, options: RequestInit, maxRetries = 5): Promise<any> {
    const baseDelay = 2000;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetch(url, options);
        if (!res.ok) {
          const errorText = await res.text();
          if (res.status === 429 || res.status >= 500) {
            if (attempt === maxRetries) {
              console.error("[Agent] OpenRouter API Error:", errorText);
              throw new Error(`OpenRouter API error (${res.status}): ${errorText}`);
            }
            // Fall through to retry
          } else {
            throw new Error(`OpenRouter API error (${res.status}): ${errorText}`);
          }
        } else {
          // Success case: attempt parsing JSON
          const text = await res.text();
          if (!text || text.trim().length === 0) {
            throw new Error("Empty response from API");
          }
          try {
            return JSON.parse(text);
          } catch (e) {
            throw new Error(`JSON Parse Error: ${text.slice(0, 100)}...`);
          }
        }
      } catch (err: any) {
        if (attempt === maxRetries) {
          throw err;
        }
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`[Agent] Request/Parse Error: ${err.message}. Retrying in ${delay}ms... (Attempt ${attempt + 1}/${maxRetries})`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw new Error("Max retries exceeded.");
  }

  /**
   * Serialize a ChatMessage for the OpenRouter API.
   * Handles the special 'tool' role and assistant tool_calls.
   */
  private serializeMessage(msg: ChatMessage): Record<string, any> {
    const serialized: Record<string, any> = {
      role: msg.role,
    };

    if (msg.content !== null && msg.content !== undefined) {
      serialized.content = msg.content;
    }

    // Assistant message with tool_calls
    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      serialized.tool_calls = msg.tool_calls;
      // Some APIs expect content to be null when tool_calls are present
      if (!serialized.content) {
        serialized.content = null;
      }
    }

    // Tool result message
    if (msg.role === "tool") {
      serialized.tool_call_id = msg.tool_call_id;
      if (msg.name) {
        serialized.name = msg.name;
      }
    }

    return serialized;
  }

  /**
   * Parse the OpenRouter (OpenAI-compatible) response into our LLMResponse.
   */
  private parseResponse(data: any): LLMResponse {
    const choice = data.choices?.[0];
    if (!choice) {
      return {
        content: "No response from model.",
        tool_calls: [],
        model: this.model,
      };
    }

    const message = choice.message;
    const toolCalls: ToolCall[] = [];

    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const tc of message.tool_calls) {
        let args: Record<string, any> = {};
        try {
          args =
            typeof tc.function.arguments === "string"
              ? JSON.parse(tc.function.arguments)
              : tc.function.arguments;
        } catch {
          console.warn(`[Agent] Failed to parse tool_call arguments for ${tc.function.name}`);
        }

        toolCalls.push({
          id: tc.id || `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: tc.function.name,
          arguments: args,
        });
      }
    }

    return {
      content: message.content || null,
      tool_calls: toolCalls,
      model: this.model,
    };
  }
}
