// Vitest executes server modules directly, outside Next's react-server resolver.
// This empty module preserves the production `server-only` import boundary while
// preventing the marker package's browser-side sentinel from throwing in tests.
export {};
