import type { SpxGexMcpClient } from "./spx-gex-heatmap";

interface JsonRpcResponse {
  id?: number | string;
  result?: {
    content?: { text?: string }[];
    isError?: boolean;
  };
  error?: {
    message?: string;
  };
}

class SseLineReader {
  private buffer = "";
  private readonly decoder = new TextDecoder();
  private pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async readEvent(timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    const lines: string[] = [];

    while (Date.now() < deadline) {
      const line = await this.readLine(Math.max(1, deadline - Date.now()));
      if (line === null) break;
      if (line === "") {
        if (lines.length > 0) return lines;
      } else {
        lines.push(line);
      }
    }

    return lines;
  }

  private async readLine(timeoutMs: number): Promise<string | null> {
    while (!this.buffer.includes("\n")) {
      const result = await Promise.race([
        this.getPendingRead(),
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), timeoutMs),
        ),
      ]);

      if (result === "timeout") return null;

      this.pendingRead = null;

      if (result.done) {
        if (this.buffer.length === 0) return null;
        const tail = this.buffer;
        this.buffer = "";
        return tail.replace(/\r$/, "");
      }

      this.buffer += this.decoder.decode(result.value, { stream: true });
    }

    const newlineIndex = this.buffer.indexOf("\n");
    const line = this.buffer.slice(0, newlineIndex).replace(/\r$/, "");
    this.buffer = this.buffer.slice(newlineIndex + 1);
    return line;
  }

  private getPendingRead() {
    this.pendingRead ||= this.reader.read();
    return this.pendingRead;
  }
}

const jsonContent = (body: unknown) =>
  JSON.stringify(body);

export class StocksMcpSseClient implements SpxGexMcpClient {
  private messageUrl: string | null = null;
  private sseReader: SseLineReader | null = null;
  private nextId = 1;

  constructor(
    private readonly bearerToken: string,
    private readonly serverBase = "https://stock-mcp-sse.azurewebsites.net",
  ) {}

  async getQuotes() {
    return this.callTool("get_quotes", { tickers: "SPX" });
  }

  async getOptions() {
    return this.callTool("get_options", { ticker: "SPX", strikesAroundAtm: 25 });
  }

  async getOptions0Dte() {
    return this.callTool("get_options_0dte", { ticker: "SPX" });
  }

  async getOptionsGex(expiry: string) {
    return this.callTool("get_options_gex", { ticker: "SPX", expiry, topRows: 20 });
  }

  private async connect() {
    if (this.messageUrl && this.sseReader) return;

    const response = await fetch(`${this.serverBase}/sse`, {
      headers: {
        Accept: "text/event-stream",
        Authorization: `Bearer ${this.bearerToken}`,
      },
    });

    if (!response.ok || !response.body) {
      throw new Error(`Stocks MCP SSE connect failed: ${response.status}`);
    }

    this.sseReader = new SseLineReader(response.body.getReader());
    const endpointEvent = await this.sseReader.readEvent(10_000);
    const endpoint = endpointEvent.find((line) => line.startsWith("data:"))?.replace(/^data:\s*/, "");
    if (!endpoint) throw new Error("Stocks MCP SSE endpoint was not received.");

    this.messageUrl = endpoint.startsWith("http") ? endpoint : `${this.serverBase}${endpoint}`;
    const initId = this.nextId++;
    await this.post(initId, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "sius-spx-gex-heatmap-worker", version: "1.0.0" },
    });
    await this.readJsonRpcById(initId, 10_000);
    await this.post(this.nextId++, "notifications/initialized", {});
  }

  private async post(id: number, method: string, params: unknown) {
    if (!this.messageUrl) throw new Error("Stocks MCP message URL is not ready.");

    const response = await fetch(this.messageUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        "Content-Type": "application/json",
      },
      body: jsonContent({ jsonrpc: "2.0", id, method, params }),
    });

    if (response.status !== 202 && !response.ok) {
      throw new Error(`Stocks MCP ${method} post failed: HTTP ${response.status}`);
    }
  }

  private async readJsonRpcById(id: number, timeoutMs: number): Promise<JsonRpcResponse> {
    if (!this.sseReader) throw new Error("Stocks MCP SSE reader is not ready.");

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const event = await this.sseReader.readEvent(Math.max(1, deadline - Date.now()));
      const dataLine = event.find((line) => line.startsWith("data:"));
      if (!dataLine) continue;

      const payload = JSON.parse(dataLine.replace(/^data:\s*/, "")) as JsonRpcResponse;
      if (String(payload.id) === String(id)) return payload;
    }

    throw new Error(`Timed out waiting for Stocks MCP JSON-RPC id ${id}.`);
  }

  private async callTool(name: string, args: Record<string, unknown>) {
    await this.connect();
    const id = this.nextId++;
    await this.post(id, "tools/call", { name, arguments: args });
    const payload = await this.readJsonRpcById(id, 120_000);

    if (payload.error?.message) {
      throw new Error(`Stocks MCP tool ${name} failed: ${payload.error.message}`);
    }

    if (payload.result?.isError) {
      throw new Error(`Stocks MCP tool ${name} returned an error.`);
    }

    return (payload.result?.content || []).map((item) => item.text || "").join("\n");
  }
}
