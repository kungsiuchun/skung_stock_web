/**
 * Agent Framework — Core Types
 * Mirrors the Python blueprint's dataclasses (ToolParameter, ToolDefinition, ToolCall, LLMResponse, AgentResult).
 */

// ── Tool Schema Types ──────────────────────────────────────────────

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description: string;
  required?: boolean;   // default true
  enum?: string[];
  default?: any;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  handler: (args: Record<string, any>, env?: any) => Promise<Record<string, any>>;
  category?: string;    // "data" | "analysis" | "search" | "market"
}

// ── LLM Communication Types ────────────────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface LLMResponse {
  content: string | null;
  tool_calls: ToolCall[];
  model: string;
}

// ── Agent Result ───────────────────────────────────────────────────

export interface AgentResult {
  success: boolean;
  content: string;
  steps: AgentStep[];
  error?: string;
  new_memories?: string[];
}

export interface AgentStep {
  step: number;
  type: "tool_call" | "final_answer";
  tool_name?: string;
  tool_args?: Record<string, any>;
  tool_result?: string;
  content?: string;
}

// ── Message Types (OpenAI chat format) ─────────────────────────────

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;   // JSON string
  };
}

export interface OpenAIToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required: string[];
    };
  };
}
