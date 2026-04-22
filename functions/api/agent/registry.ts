/**
 * Agent Framework — Tool Registry
 * Mirrors the Python blueprint's ToolRegistry class.
 *
 * Responsibilities:
 *   1. register()       — Add a ToolDefinition
 *   2. toOpenAITools()  — Generate OpenAI function-calling JSON schema
 *   3. execute()        — Look up tool by name and run its handler
 */

import type { ToolDefinition, ToolParameter, OpenAIToolDef } from "./types";

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();
  private env: any = {};

  setEnv(env: any) {
    this.env = env;
  }

  /** Register a tool definition. */
  register(toolDef: ToolDefinition): void {
    this.tools.set(toolDef.name, toolDef);
  }

  /** Register multiple tool definitions at once. */
  registerAll(toolDefs: ToolDefinition[]): void {
    for (const td of toolDefs) {
      this.register(td);
    }
  }

  /** Generate the OpenAI tools array for the chat completions API. */
  toOpenAITools(): OpenAIToolDef[] {
    return Array.from(this.tools.values()).map((td) =>
      this.toolDefToOpenAI(td)
    );
  }

  /** Execute a tool by name with the given arguments. */
  async execute(name: string, args: Record<string, any>): Promise<Record<string, any>> {
    let toolDef = this.tools.get(name);

    // Gemini sometimes sends namespaced names like "namespace:tool_name"
    if (!toolDef && name.includes(":")) {
      const shortName = name.split(":").pop()!;
      toolDef = this.tools.get(shortName);
    }

    if (!toolDef) {
      throw new Error(`Tool '${name}' not found in registry`);
    }

    // Fill in defaults for missing optional parameters
    const filledArgs = { ...args };
    for (const param of toolDef.parameters) {
      if (!(param.name in filledArgs) && param.default !== undefined) {
        filledArgs[param.name] = param.default;
      }
    }

    return toolDef.handler(filledArgs, this.env);
  }

  /** Get list of registered tool names (for debugging). */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  // ── Private ──────────────────────────────────────────────────────

  private toolDefToOpenAI(td: ToolDefinition): OpenAIToolDef {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const param of td.parameters) {
      properties[param.name] = this.paramToJsonSchema(param);
      if (param.required !== false) {
        required.push(param.name);
      }
    }

    return {
      type: "function",
      function: {
        name: td.name,
        description: td.description,
        parameters: {
          type: "object",
          properties,
          required,
        },
      },
    };
  }

  private paramToJsonSchema(param: ToolParameter): Record<string, any> {
    const schema: Record<string, any> = {
      type: param.type,
      description: param.description,
    };
    if (param.enum) {
      schema.enum = param.enum;
    }
    if (param.default !== undefined) {
      schema.default = param.default;
    }
    return schema;
  }
}
