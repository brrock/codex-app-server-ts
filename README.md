# codex-app-server-ts

TypeScript client for Codex App Server with a clean, modern API.

## Install

```bash
bun add codex-app-server-ts
```

## Usage
See the full documentation in [./docs.md](./docs.md)
full docs in 
```typescript
import { CodexClient } from "codex-app-server-ts";

const client = await CodexClient.create({
  clientInfo: { name: "my-app", title: "My App", version: "1.0" },
});

const { textStream } = await client.createThread().send("Hello!");

for await (const part of textStream) {
  process.stdout.write(part.text);
}

await client.disconnect();
```

## API

### Create Client

```typescript
await CodexClient.create({
  codexHome: "~/.codex",      // custom codex home
  clientInfo: { name, title, version },
  capabilities: { experimentalApi: true },
  debug: true,
});
```

### Threads

```typescript
const thread = await client.createThread({ model: "gpt-5.1-codex" });
await thread.send("message");
client.thread(); // current thread
await client.listThreads();
```

### Events

```typescript
client.on("turn.completed", (turn) => {});
client.on("error", (err) => {});
client.onStateChange((state) => {});
```

## Dev

```bash
bun run generate  # generate schemas
bun run build     # build with tsdown
bun run typecheck
bun run example
```

## License

MIT
