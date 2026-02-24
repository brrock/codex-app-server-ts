# Codex App Server TS

This is a TypeScript client library for the Codex App Server.

## Commands

```bash
# Generate schemas from Codex CLI
bun run generate

# Typecheck
bun run typecheck

# Build
bun run build

# Run example
bun run example
```

## Code Style

- Use Bun APIs (Bun.spawn, TextReader, etc.)
- Prefer async/await over callbacks
- Keep the API clean and minimal
- Use TypeScript with strict mode

## Testing

Write tests using `bun test`. Test the client against a real or mocked Codex process.
