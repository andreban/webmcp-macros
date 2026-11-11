# WebMCP Macros

A Chrome extension that runs deterministic, shareable automations ("macros")
against the [WebMCP](https://github.com/webmachinelearning/webmcp) tools a
website registers. No model is in the loop: a macro is a small program of tool
calls, branches and loops, built from blocks, saved locally, and shared as a
single string.

## Requirements

- Node.js 22+
- Chrome with WebMCP available: a site in the WebMCP origin trial, or
  `chrome://flags/#enable-webmcp-testing` enabled.

## Develop

```bash
npm install
npm run dev        # Vite dev build with HMR, output in dist/
npm run build      # type-check and production build to dist/
npm test           # unit tests (Vitest)
npm run test:e2e   # loads dist/ into Chromium and runs a macro (after a build)
```

Load the extension from `chrome://extensions` with **Developer mode** on,
**Load unpacked**, and pick the `dist/` folder.

## Contributing

See [AGENTS.md](AGENTS.md) for the architecture, conventions and workflow.
