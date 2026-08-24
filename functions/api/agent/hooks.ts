export interface ToolExecutionContext {
  toolName: string;
  toolArgs: string;
  toolId: string;
  timestamp: number;
}

export interface AgentHook {
  preToolUse?(context: ToolExecutionContext): Promise<void> | void;
  postToolUse?(context: ToolExecutionContext, result: any, error?: Error): Promise<void> | void;
}

/**
 * Basic Logger Hook to output execution times.
 */
export class LoggerHook implements AgentHook {
  preToolUse(_context: ToolExecutionContext) {
    // We can inject logic here without polluting the executor loop
  }

  postToolUse(context: ToolExecutionContext, result: any, error?: Error) {
    const duration = Date.now() - context.timestamp;
    const status = error ? "FAIL" : "OK";
    console.log(`[Agent Hook] → ${context.toolName}(${context.toolArgs}) → ${status} (${duration}ms)`);
    if (error) {
      console.warn(`[Agent Hook] Error detail: ${error.message}`);
    }
  }
}
