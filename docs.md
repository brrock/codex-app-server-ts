# Codex App Server TS

A TypeScript client library for the Codex App Server with a clean, modern API.

## Installation

```bash
npm install codex-app-server-ts
# or
bun add codex-app-server-ts
```

## Quick Start

```typescript
import { CodexClient } from "codex-app-server-ts";

const client = await CodexClient.create({
  clientInfo: {
    name: "my_client",
    title: "My Client",
    version: "1.0.0",
  },
});

const { textStream } = await client.createThread().send("Hello!");

for await (const part of textStream) {
  process.stdout.write(part.text);
}

await client.disconnect();
```

## API Reference

### Creating a Client

```typescript
const client = await CodexClient.create(options);
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `codexHome` | `string` | `~/.codex` | Custom Codex home directory |
| `codexPath` | `string` | `"codex"` | Path to codex binary |
| `listen` | `string` | `"stdio://"` | Transport (stdio://, ws://host:port) |
| `clientInfo` | `ClientInfo` | See below | Client identification |
| `capabilities` | `InitializeCapabilities` | `{}` | Server capabilities |
| `autoStart` | `boolean` | `true` | Auto-start process and initialize |
| `debug` | `boolean` | `false` | Log all JSON-RPC messages |
| `env` | `Record<string, string>` | `{}` | Additional environment variables |

**Default clientInfo:**
```typescript
{
  name: "codex-client",
  title: "Codex Client",
  version: "1.0.0"
}
```

### Manual Initialization

```typescript
// Create without auto-starting
const client = new CodexClient({ autoStart: false });

client.start();
await client.initialize({ clientInfo: {...} });
```

---

## Threads

### Create a Thread

```typescript
const thread = await client.createThread({
  model: "gpt-5.1-codex",
  cwd: "/path/to/project",
  personality: "friendly",
  sandboxPolicy: { type: "workspaceWrite" },
});

// Or with explicit turn
const thread = await client.createThread({
  model: "gpt-5.1-codex",
  input: [{ type: "text", text: "Hello!" }],
});
```

### Get Current Thread

```typescript
const thread = client.thread();
if (thread) {
  await thread.send("Hello!");
}
```

### List Threads

```typescript
const result = await client.listThreads({
  limit: 25,
  sortKey: "created_at",
  archived: false,
});

for (const thread of result.data ?? []) {
  console.log(thread.id, thread.name);
}
```

### Resume a Thread

```typescript
const thread = await client.resumeThread("thr_123");
```

### Fork a Thread

```typescript
const forked = await client.forkThread("thr_123");
```

### Archive/Unarchive

```typescript
await client.archiveThread("thr_123");
await client.unarchiveThread("thr_123");
```

---

## Sending Messages

### AI SDK-Style Streaming

```typescript
const { textStream, commandOutputs } = await thread.send("Hello!");

// Stream text like AI SDK
for await (const part of textStream) {
  process.stdout.write(part.text);
}

// Get complete result
const result = await textStream.waitForComplete();
console.log(result.text);
```

**CodexStream Methods:**

| Method | Returns | Description |
|--------|---------|-------------|
| `[Symbol.asyncIterator]` | `AsyncIterator<TextDelta>` | Iterate text chunks |
| `fullText` | `string` | Accumulated text |
| `commandOutputs` | `CommandOutput[]` | All command outputs |
| `isComplete` | `boolean` | Check if finished |
| `waitForComplete()` | `Promise<TurnResult>` | Wait for completion |
| `onText(callback)` | `void` | Register text handler |

### With Custom Thread

```typescript
const { textStream } = await client.createThread().send("Hello!");

// Or on existing thread
await thread.send("Follow-up question?");
```

---

## Events

### Event Types

```typescript
client.on("ready", () => {
  console.log("Client ready");
});

client.on("disconnected", () => {
  console.log("Client disconnected");
});

client.on("error", (error) => {
  console.error(error.message);
});

// Turn events
client.on("turn.started", (turn) => {...});
client.on("turn.completed", (turn) => {...});

// Item events
client.on("item.started", (item) => {...});
client.on("item.completed", (item) => {...});

// Text streaming (also available via CodexStream)
client.on("message.delta", (text) => {...});
client.on("message.complete", (text) => {...});

// Command output
client.on("command.output", (output) => {...});

// Approvals
client.on("approval.request", async (params) => {
  // Auto-accept
  await client.sendApprovalResponse({
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: params.itemId,
    decision: { accept: {} },
  });
});
```

**All Events:**

- `ready` - Client initialized
- `disconnected` - Client stopped
- `error` - Error occurred
- `state.change` - Connection state changed
- `thread.started` - Thread created
- `thread.archived` - Thread archived
- `thread.unarchived` - Thread unarchived
- `turn.started` - Turn started
- `turn.completed` - Turn completed
- `turn.interrupted` - Turn interrupted
- `item.started` - Item started
- `item.completed` - Item completed
- `message.delta` - Text delta received
- `message.complete` - Full message complete
- `command.started` - Command execution started
- `command.output` - Command output received
- `command.completed` - Command completed
- `approval.request` - Approval requested

### Connection State

```typescript
client.onStateChange((state) => {
  console.log(state); // "connecting" | "ready" | "disconnected"
});
```

---

## Models & Account

### List Models

```typescript
const models = await client.models({ limit: 20 });

for (const model of models.data ?? []) {
  console.log(model.id, model.displayName);
}
```

### Get Account

```typescript
const account = await client.account();

if (account.requiresOpenaiAuth) {
  if (account.account) {
    console.log("Logged in as:", account.account.email);
  } else {
    // Need to login
  }
}
```

### Login

```typescript
// API Key
await client.loginWithApiKey("sk-...");

// ChatGPT OAuth
const { authUrl } = await client.loginWithChatGpt();
// Open authUrl in browser, wait for completion
```

---

## Other Methods

### Interrupt Current Turn

```typescript
await client.interrupt();
```

### List Skills

```typescript
const skills = await client.skills({ cwd: process.cwd() });
```

### Get Config

```typescript
const config = await client.getConfig();
```

### Update Config

```typescript
await client.setConfig("apps.google_drive.enabled", false);
```

---

## Error Handling

```typescript
import { CodexClient, CodexError } from "codex-app-server-ts";

try {
  const client = await CodexClient.create();
  await client.createThread().send("Hello!");
} catch (error) {
  if (error instanceof CodexError) {
    console.log(error.code, error.message);
  }
}
```

**Error Codes:**

- `NOT_INITIALIZED` - Client not initialized
- `ALREADY_INITIALIZED` - Already initialized
- `NO_ACTIVE_THREAD` - No current thread
- `NO_ACTIVE_TURN` - No active turn
- `CONNECTION_FAILED` - Failed to connect
- `REQUEST_FAILED` - JSON-RPC request failed

---

## Custom CodeX Home

```typescript
const client = await CodexClient.create({
  codexHome: "/custom/path/to/codex/home",
});
```

Or via environment:

```typescript
const client = await CodexClient.create({
  env: {
    CODEX_HOME: "/custom/path",
  },
});
```

---

## WebSocket Transport

```typescript
const client = await CodexClient.create({
  listen: "ws://127.0.0.1:4500",
});
```

---

## TypeScript Types

The library re-exports all Codex schemas:

```typescript
import type {
  ClientInfo,
  InitializeCapabilities,
  ThreadStartParams,
  TurnStartParams,
  ServerNotification,
} from "codex-app-server-ts";
```
