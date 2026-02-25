import type {
  ServerNotification,
} from "../schemas/ServerNotification";
import type { InitializeCapabilities } from "@schemas/InitializeCapabilities";
import type { ClientInfo } from "@schemas/ClientInfo";
export interface CodexClientOptions {
  codexHome?: string;
  codexPath?: string;
  listen?: string;
  env?: Record<string, string>;
  clientInfo?: Partial<ClientInfo>;
  capabilities?: InitializeCapabilities;
  autoStart?: boolean;
  debug?: boolean;
}

export type ConnectionState = "idle" | "starting" | "ready" | "disconnected" | "error";

export interface ToolCall {
  id: string;
  type: "mcp" | "command" | "dynamic";
  name: string;
  arguments?: any;
  result?: any;
  status: "started" | "completed" | "error";
  duration?: string;
}

export interface TurnResult {
  turnId: string;
  status: string;
  text: string;
  final: boolean;
  toolCall?: ToolCall;
}

export interface CodexError extends Error {
  code?: string;
  method?: string;
}

type EventMap = {
  stateChange: [ConnectionState];
  turnStarted: [any];
  turnCompleted: [any];
  message: [any];
  error: [CodexError];
  toolCallStarted: [ToolCall];
  toolCallCompleted: [ToolCall];
  messageDelta: [string];
  commandOutput: [string];
  approvalRequest: [any];
};

type EventKey = keyof EventMap;
type EventReceiver<T> = (params: T) => void;

class EventEmitter<Events extends Record<string, any[]>> {
  private listeners = new Map<EventKey, Set<EventReceiver<any>>>();

  on<K extends EventKey>(event: K, fn: EventReceiver<Events[K]>): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(fn);
  }

  off<K extends EventKey>(event: K, fn: EventReceiver<Events[K]>): void {
    this.listeners.get(event)?.delete(fn);
  }

  emit<K extends EventKey>(event: K, ...args: any[]): void {
    this.listeners.get(event)?.forEach((fn: any) => fn(...args));
  }
}

export class CodexStream implements AsyncIterable<TurnResult> {
  private client: CodexClient;
  private text = "";
  private turnId: string | null = null;
  private status = "";
  private resolved = false;
  private waiters: Array<(value: TurnResult) => void> = [];
  private tools: Map<string, ToolCall> = new Map();
  private toolWaiters: Array<(value: ToolCall) => void> = [];

  constructor(client: CodexClient) {
    this.client = client;
  }

  get toolCalls(): ToolCall[] {
    return Array.from(this.tools.values());
  }

  getTool(id: string): ToolCall | undefined {
    return this.tools.get(id);
  }

  onToolCall(callback: (tool: ToolCall) => void): void {
    this.toolWaiters.push(callback);
    // Emit existing tools
    for (const tool of this.tools.values()) {
      callback(tool);
    }
  }

  setTurn(turnId: string): void {
    this.turnId = turnId;
  }

  async next(): Promise<IteratorResult<TurnResult>> {
    if (this.resolved && this.text === "") {
      return { done: true, value: undefined as any };
    }
    return new Promise((resolve) => {
      this.waiters.push((result) => {
        resolve({ done: !result.final, value: result });
      });
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<TurnResult> {
    return this;
  }

  get fullText(): string {
    return this.text;
  }

  get isComplete(): boolean {
    return this.resolved;
  }

  async waitForComplete(): Promise<TurnResult> {
    if (this.resolved) {
      return { turnId: this.turnId!, status: this.status, text: this.text, final: true };
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  _push(result: TurnResult): void {
    if (result.final) {
      this.resolved = true;
      this.status = result.status;
    } else {
      this.text += result.text;
    }
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      waiter(result);
    }
  }

  _pushTool(tool: ToolCall): void {
    this.tools.set(tool.id, tool);
    for (const waiter of this.toolWaiters) {
      waiter(tool);
    }
  }
}

export class CodexThread {
  private client: CodexClient;
  private _id: string;

  constructor(client: CodexClient, id: string) {
    this.client = client;
    this._id = id;
  }

  get id(): string {
    return this._id;
  }

  async send(input: string): Promise<CodexStream> {
    return this.client.streamTurn({
      threadId: this._id,
      input: [{ type: "text", text: input }],
    });
  }

  async steer(input: string, expectedTurnId: string): Promise<void> {
    await this.client.steerTurn({
      threadId: this._id,
      input: [{ type: "text", text: input }],
      expectedTurnId,
    });
  }

  async interrupt(turnId: string): Promise<void> {
    await this.client.interruptTurn(this._id, turnId);
  }

  async fork(): Promise<CodexThread> {
    const newId = await this.client.forkThread(this._id);
    return new CodexThread(this.client, newId);
  }

  async archive(): Promise<void> {
    await this.client.archiveThread(this._id);
  }

  async read(includeTurns?: boolean): Promise<any> {
    return this.client.readThread(this._id, includeTurns);
  }
}

export class CodexClient extends EventEmitter<EventMap> {
  private proc: any = null;
  private requestId = 0;
  private pendingRequests = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: any) => void }
  >();
  private threadId: string | null = null;
  private _state: ConnectionState = "idle";
  private options: CodexClientOptions & { codexHome: string; codexPath: string; listen: string; env: Record<string, string> };
  private currentStream: CodexStream | null = null;
  private _currentThread: CodexThread | null = null;

  private get state(): ConnectionState {
    return this._state;
  }

  private set state(value: ConnectionState) {
    this._state = value;
    this.emit("stateChange", value);
  }

  static async create(options: CodexClientOptions = {}): Promise<CodexClient> {
    const client = new CodexClient({ ...options, autoStart: false });
    client.start();
    await client.initialize({
      clientInfo: options.clientInfo,
      capabilities: options.capabilities,
    });
    return client;
  }

  constructor(options: CodexClientOptions = {}) {
    super();
    this.options = {
      codexHome: options.codexHome ?? `${process.env.HOME ?? "."}/.codex`,
      codexPath: options.codexPath ?? "codex",
      listen: options.listen ?? "stdio://",
      env: options.env ?? {},
      autoStart: options.autoStart ?? true,
      debug: options.debug ?? false,
    };

    if (this.options.autoStart) {
      this.start();
      this.initialize({
        clientInfo: options.clientInfo,
        capabilities: options.capabilities,
      });
    }
  }

  get isReady(): boolean {
    return this.state === "ready";
  }

  get currentThread(): CodexThread | null {
    return this._currentThread;
  }

  private get env(): Record<string, string> {
    return {
      ...process.env,
      CODEX_HOME: this.options.codexHome,
      ...this.options.env,
    };
  }

  start(): void {
    this.state = "starting";
    const args =
      this.options.listen?.startsWith("ws")
        ? ["app-server", "--listen", this.options.listen]
        : ["app-server"];

    this.proc = Bun.spawn([this.options.codexPath ?? "codex", ...args], {
      stdio: ["pipe", "pipe", "inherit"],
      env: this.env,
    });

    const reader = new TextReader(this.proc.stdout);
    reader.onLine = (line: string) => this.handleMessage(line);
    this.state = "ready";
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
    this.state = "disconnected";
  }

  private log(...args: any[]): void {
    if (this.options.debug) {
      console.log("[CodexClient]", ...args);
    }
  }

  private send(method: string, params?: object): number {
    const id = ++this.requestId;
    const msg = JSON.stringify({ method, id, params });
    this.log("→", method, params);
    this.proc?.stdin?.write(`${msg}\n`);
    return id;
  }

  private handleMessage(line: string): void {
    this.log("←", line);
    try {
      const msg = JSON.parse(line) as any;

      if (msg.id != null) {
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          this.pendingRequests.delete(msg.id);
          if (msg.error) {
            const error: CodexError = new Error(msg.error.message);
            error.code = msg.error.code?.toString();
            pending.reject(error);
          } else {
            pending.resolve(msg.result);
          }
        }
      } else {
        this.handleNotification(msg);
      }
    } catch (e) {
      console.error("Failed to parse message:", e);
    }
  }

  private handleNotification(notif: ServerNotification): void {
    const method = notif.method as string;
    const params = notif.params as any;

    this.emit("message", { method, params });

    switch (method) {
      case "turn/started":
        this.currentStream?.setTurn(params.turn?.id);
        this.emit("turnStarted", params);
        break;
      case "turn/completed":
        this.currentStream?._push({ turnId: "", status: params.turn?.status ?? "completed", text: "", final: true });
        this.emit("turnCompleted", params);
        break;
      case "item/agentMessage/delta":
        this.currentStream?._push({ turnId: "", status: "inProgress", text: params.delta ?? "", final: false });
        this.emit("messageDelta", params.delta ?? "");
        break;
      case "item/commandExecution/outputDelta":
        this.emit("commandOutput", params.text ?? "");
        break;
      case "item/mcpToolCall/started":
        const mcpToolStart: ToolCall = {
          id: params.call_id,
          type: "mcp",
          name: params.invocation?.tool,
          arguments: params.invocation?.arguments,
          status: "started",
        };
        this.currentStream?._pushTool(mcpToolStart);
        this.emit("toolCallStarted", mcpToolStart);
        break;
      case "item/mcpToolCall/completed":
        const mcpToolResult = params.result;
        let mcpToolEnd: ToolCall;
        if ("Ok" in mcpToolResult) {
          mcpToolEnd = {
            id: params.call_id,
            type: "mcp",
            name: params.invocation?.tool,
            arguments: params.invocation?.arguments,
            result: mcpToolResult.Ok,
            status: "completed",
            duration: params.duration,
          };
        } else {
          mcpToolEnd = {
            id: params.call_id,
            type: "mcp",
            name: params.invocation?.tool,
            arguments: params.invocation?.arguments,
            result: mcpToolResult.Err,
            status: "error",
            duration: params.duration,
          };
        }
        this.currentStream?._pushTool(mcpToolEnd);
        this.emit("toolCallCompleted", mcpToolEnd);
        break;
      case "item/dynamicToolCall/started":
        const dynamicToolStart: ToolCall = {
          id: params.callId,
          type: "dynamic",
          name: params.tool,
          arguments: params.arguments,
          status: "started",
        };
        this.currentStream?._pushTool(dynamicToolStart);
        this.emit("toolCallStarted", dynamicToolStart);
        break;
      case "item/dynamicToolCall/completed":
        const dynamicToolEnd: ToolCall = {
          id: params.callId,
          type: "dynamic",
          name: params.tool,
          arguments: params.arguments,
          result: params.result,
          status: "completed",
        };
        this.currentStream?._pushTool(dynamicToolEnd);
        this.emit("toolCallCompleted", dynamicToolEnd);
        break;
      case "item/commandExecution/requestApproval":
      case "item/fileChange/requestApproval":
        this.emit("approvalRequest", params);
        break;
      case "error":
        const error: CodexError = new Error(params.error?.message ?? "Unknown error");
        error.code = params.error?.code;
        this.emit("error", error);
        break;
    }
  }

  private request<T = any>(method: string, params?: object): Promise<T> {
    const id = this.send(method, params);
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
    });
  }

  async initialize(params?: {
    clientInfo?: Partial<ClientInfo>;
    capabilities?: InitializeCapabilities;
  }): Promise<void> {
    const clientInfo: ClientInfo = {
      name: params?.clientInfo?.name ?? "codex-client",
      title: params?.clientInfo?.title ?? "Codex Client",
      version: params?.clientInfo?.version ?? "1.0.0",
    };
    await this.request("initialize", { clientInfo, capabilities: params?.capabilities });
    await this.request("initialized", {});
  }

  async createThread(params?: {
    model?: string;
    cwd?: string;
    personality?: string;
  }): Promise<CodexThread> {
    const threadId = await this.request<{ thread: { id: string } }>("thread/start", params ?? {});
    this.threadId = threadId.thread.id;
    this._currentThread = new CodexThread(this, this.threadId);
    return this._currentThread;
  }

  async resumeThread(threadId: string, params?: object): Promise<CodexThread> {
    const result = await this.request<{ thread: { id: string } }>("thread/resume", { threadId, ...params });
    this.threadId = result.thread.id;
    this._currentThread = new CodexThread(this, this.threadId);
    return this._currentThread;
  }

  async listThreads(params?: {
    cursor?: string;
    limit?: number;
    archived?: boolean;
    cwd?: string;
  }): Promise<any> {
    return this.request("thread/list", params ?? {});
  }

  async listLoadedThreads(): Promise<CodexThread[]> {
    const result = await this.request<{ data: string[] }>("thread/loaded/list");
    return result.data.map((id) => new CodexThread(this, id));
  }

  streamTurn(params: {
    threadId: string;
    input: Array<{ type: string; text?: string; image?: string }>;
    model?: string;
    effort?: string;
    personality?: string;
    cwd?: string;
  }): CodexStream {
    this.currentStream = new CodexStream(this);
    this.request("turn/start", params);
    return this.currentStream;
  }

  async steerTurn(params: {
    threadId: string;
    input: Array<{ type: string; text: string }>;
    expectedTurnId: string;
  }): Promise<any> {
    return this.request("turn/steer", params);
  }

  async interruptTurn(threadId: string, turnId: string): Promise<void> {
    await this.request("turn/interrupt", { threadId, turnId });
  }

  async listModels(params?: { limit?: number; includeHidden?: boolean }): Promise<any> {
    return this.request("model/list", params ?? {});
  }

  async forkThread(threadId: string): Promise<string> {
    const result = await this.request<{ thread: { id: string } }>("thread/fork", { threadId });
    return result.thread.id;
  }

  async archiveThread(threadId: string): Promise<void> {
    await this.request("thread/archive", { threadId });
  }

  async unarchiveThread(threadId: string): Promise<void> {
    await this.request("thread/unarchive", { threadId });
  }

  async readThread(threadId: string, includeTurns?: boolean): Promise<any> {
    return this.request("thread/read", { threadId, includeTurns });
  }

  async rollbackThread(threadId: string, turns: number): Promise<any> {
    return this.request("thread/rollback", { threadId, turns });
  }

  async execCommand(params: {
    command: string[];
    cwd?: string;
    sandboxPolicy?: object;
    timeoutMs?: number;
  }): Promise<any> {
    return this.request("command/exec", params);
  }

  async startReview(params: {
    threadId: string;
    delivery?: string;
    target: object;
  }): Promise<any> {
    return this.request("review/start", params);
  }

  async listSkills(params?: { cwds?: string[]; forceReload?: boolean }): Promise<any> {
    return this.request("skills/list", params ?? {});
  }

  async setSkillEnabled(path: string, enabled: boolean): Promise<void> {
    await this.request("skills/config/write", { path, enabled });
  }

  async listApps(params?: { cursor?: string; limit?: number; threadId?: string }): Promise<any> {
    return this.request("app/list", params ?? {});
  }

  async getAccount(refreshToken?: boolean): Promise<any> {
    return this.request("account/read", { refreshToken: refreshToken ?? false });
  }

  async loginWithApiKey(apiKey: string): Promise<void> {
    await this.request("account/login/start", { type: "apiKey", apiKey });
  }

  async loginWithChatGpt(): Promise<{ loginId: string; authUrl: string }> {
    return this.request("account/login/start", { type: "chatgpt" });
  }

  async loginWithChatGptTokens(idToken: string, accessToken: string): Promise<void> {
    await this.request("account/login/start", { type: "chatgptAuthTokens", idToken, accessToken });
  }

  async logout(): Promise<void> {
    await this.request("account/logout", {});
  }

  async getRateLimits(): Promise<any> {
    return this.request("account/rateLimits/read", {});
  }

  async sendApprovalResponse(params: {
    threadId: string;
    turnId: string;
    itemId: string;
    decision: object;
  }): Promise<void> {
    await this.request("item/commandExecution/approval", params);
  }

  async readConfig(): Promise<any> {
    return this.request("config/read", {});
  }

  async writeConfigValue(keyPath: string, value: any): Promise<void> {
    await this.request("config/value/write", { keyPath, value, mergeStrategy: "replace" });
  }

  async batchWriteConfig(edits: Array<{ keyPath: string; value: any }>): Promise<void> {
    await this.request("config/batchWrite", { edits });
  }
}

class TextReader {
  private buffer = "";
  onLine: (line: string) => void;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.onLine = () => {};
    stream.pipeTo(
      new WritableStream({
        write: (chunk) => {
          const text = new TextDecoder().decode(chunk);
          this.buffer += text;
          const lines = this.buffer.split("\n");
          this.buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim()) this.onLine(line);
          }
        },
      })
    );
  }
}
