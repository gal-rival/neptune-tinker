export type GuardMode = "strict" | "loose";

export interface NeptuneTinkerConfig {
  /** Gremlin Server host. Default: "localhost" */
  host?: string;

  /** Gremlin Server port. Default: 8182 */
  port?: number;

  /**
   * Full WebSocket endpoint URL. Overrides host/port if provided.
   * Default: derived as `ws://${host}:${port}/gremlin`
   */
  endpoint?: string;

  /** "strict" throws on unsupported Neptune patterns, "loose" warns */
  guardMode?: GuardMode;
}

export const DEFAULT_HOST = "localhost";
export const DEFAULT_PORT = 8182;

export function resolveEndpoint(config: NeptuneTinkerConfig): string {
  if (config.endpoint) return config.endpoint;
  const host = config.host ?? DEFAULT_HOST;
  const port = config.port ?? DEFAULT_PORT;
  return `ws://${host}:${port}/gremlin`;
}

export type ResolvedConfig = {
  host: string;
  port: number;
  endpoint: string;
  guardMode: GuardMode;
};

export function resolveConfig(config: NeptuneTinkerConfig = {}): ResolvedConfig {
  const host = config.host ?? DEFAULT_HOST;
  const port = config.port ?? DEFAULT_PORT;
  return {
    host,
    port,
    endpoint: config.endpoint ?? `ws://${host}:${port}/gremlin`,
    guardMode: config.guardMode ?? "strict",
  };
}

// -------------------------------------------------------------------
// Neptune Gremlin Constraints (source of truth for guard + skills)
// -------------------------------------------------------------------

export const NEPTUNE_UNSUPPORTED = {
  steps: [
    "io().write()",
  ],
  methods: [
    "program(VertexProgram)",
    "sideEffect(Consumer)",
    "from(Vertex)",   // from resolved Vertex object, not from(string) or from(traversal)
    "to(Vertex)",     // same
  ],
  features: {
    noLambdas: true,
    noGroovy: true,
    noVariables: true,
    noGraphObject: true,
    noListCardinality: true,
    noMetaProperties: true,
    noMaterializeProperties: true,
    idsAreStrings: true,
  },
  /** Default cardinality in Neptune is Set (TinkerGraph defaults to List) */
  defaultCardinality: "set" as const,
} as const;
