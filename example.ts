import { CodexClient, CodexStream, Thread } from "./src/index";

// 1. Awaitable constructor - client created and initialized
const client = await CodexClient.create({
  codexHome: "/custom/path/to/codex/home",
  clientInfo: {
    name: "my_client",
    title: "My Client",
    version: "1.0.0",
  },
  capabilities: {
    experimentalApi: true,
  },
  debug: true,
});

// 3. Typed events + AI SDK streaming
client.on("turn.completed", (turn) => {
  console.log("Turn completed:", turn.status);
});

client.on("error", (error) => {
  console.error("Error:", error.message);
});

// 4. Connection state
client.onStateChange((state) => {
  console.log("State:", state); // "connecting" | "ready" | "disconnected"
});

// 5. Shorthand - create thread and send in one go
const thread = await client.createThread({
  model: "gpt-5.1-codex",
  cwd: process.cwd(),
});

// Or use current thread shorthand
const { textStream } = await thread.send("Hello! Can you help me?");

// Stream like AI SDK
for await (const part of textStream) {
  process.stdout.write(part.text);
}

const result = await textStream.waitForComplete();

// 2. Thread abstraction - work with current thread
const current = client.thread(); // gets current thread
await current.send("Another message!");

// List threads
const threads = await client.listThreads();
console.log("Total threads:", threads.data?.length);

// Other shorthand
await client.interrupt(); // interrupt current turn
const models = await client.models(); // list models
const account = await client.account(); // get account info

// Clean shutdown
await client.disconnect();
