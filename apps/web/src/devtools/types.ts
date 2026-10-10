/**
 * Minimal types for the chrome-devtools-mcp third-party developer tools API
 * (https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/third-party-developer-tools.md).
 *
 * Inlined instead of imported so the dev module has no runtime dependency on
 * chrome-devtools-mcp (its TS types are not part of a published API). The
 * shapes here match the docs as of the flag-gated experimental feature.
 *
 * DEV-only entrypoint: see `register.ts` for the listener wiring. Everything
 * in this directory is dead-code-eliminated from production builds because
 * `main.tsx` only imports `register` behind `import.meta.env.DEV`.
 */

/** Subset of JSON Schema 7 we actually author — kept loose to avoid the dep. */
export interface ToolInputSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  execute: (args: Record<string, unknown>) => unknown;
}

export interface ToolGroup {
  name: string;
  description: string;
  tools: ToolDefinition[];
}

export interface DevtoolsToolDiscoveryEvent extends Event {
  respondWith: (group: ToolGroup) => void;
}

declare global {
  interface WindowEventMap {
    devtoolstooldiscovery: DevtoolsToolDiscoveryEvent;
  }
}
