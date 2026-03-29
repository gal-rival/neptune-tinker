declare module "gremlin" {
  export namespace driver {
    class DriverRemoteConnection {
      constructor(url: string, options?: Record<string, unknown>);
      close(): Promise<void>;
    }
    class Client {
      constructor(url: string, options?: Record<string, unknown>);
      submit(query: string): Promise<{ toArray(): unknown[] }>;
      close(): Promise<void>;
    }
  }

  export namespace process {
    class GraphTraversalSource {
      constructor(
        graph: unknown,
        traversalStrategies: unknown,
        bytecode?: unknown,
        graphTraversalSourceClass?: unknown,
        graphTraversalClass?: unknown,
      );
      graph: unknown;
      traversalStrategies: unknown;
      bytecode: unknown;
      graphTraversalSourceClass: unknown;
      graphTraversalClass: unknown;
      addV(...args: unknown[]): GraphTraversal;
      V(...args: unknown[]): GraphTraversal;
      E(...args: unknown[]): GraphTraversal;
    }
    class GraphTraversal {
      constructor(graph: unknown, traversalStrategies: unknown, bytecode: unknown);
      bytecode: unknown;
      property(...args: unknown[]): GraphTraversal;
      has(...args: unknown[]): GraphTraversal;
      hasLabel(...args: unknown[]): GraphTraversal;
      addV(...args: unknown[]): GraphTraversal;
      filter(traversal: GraphTraversal): GraphTraversal;
      count(): GraphTraversal;
      next(): Promise<{ value: unknown; done: boolean }>;
      toList(): Promise<unknown[]>;
      is(predicate: unknown): GraphTraversal;
      or(...traversals: GraphTraversal[]): GraphTraversal;
      label(): GraphTraversal;
    }
    const t: { id: unknown; label: unknown; key: unknown; value: unknown };
    const cardinality: { single: unknown; set: unknown };
    const statics: {
      label(): GraphTraversal;
      or(...traversals: GraphTraversal[]): GraphTraversal;
      and(...traversals: GraphTraversal[]): GraphTraversal;
      [key: string]: (...args: unknown[]) => GraphTraversal;
    };
    class P {
      static eq(value: unknown): P;
      static neq(value: unknown): P;
      static within(...values: unknown[]): P;
    }
    class TextP {
      static containing(value: string): TextP;
      static startingWith(value: string): TextP;
      static endingWith(value: string): TextP;
    }
    function traversal(
      traversalSourceClass?: unknown,
      traversalClass?: unknown,
    ): AnonymousTraversalSource;
    class AnonymousTraversalSource {
      constructor(traversalSourceClass?: unknown, traversalClass?: unknown);
      withRemote(connection: driver.DriverRemoteConnection): GraphTraversalSource;
      with_(connection: driver.DriverRemoteConnection): GraphTraversalSource;
    }
  }

  export namespace structure {
    class Graph {
      constructor();
      traversal(): process.GraphTraversalSource;
    }
  }

  const gremlin: {
    driver: typeof driver;
    process: typeof process;
    structure: typeof structure;
  };

  export default gremlin;
}
