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
      addE(...args: unknown[]): GraphTraversal;
      V(...args: unknown[]): GraphTraversal;
      E(...args: unknown[]): GraphTraversal;
      mergeV(...args: unknown[]): GraphTraversal;
      mergeE(...args: unknown[]): GraphTraversal;
      inject(...args: unknown[]): GraphTraversal;
      io(...args: unknown[]): GraphTraversal;
      union(...args: unknown[]): GraphTraversal;
    }
    class GraphTraversal {
      constructor(graph: unknown, traversalStrategies: unknown, bytecode: unknown);
      bytecode: unknown;
      property(...args: unknown[]): GraphTraversal;
      properties(...args: unknown[]): GraphTraversal;
      has(...args: unknown[]): GraphTraversal;
      hasNot(...args: unknown[]): GraphTraversal;
      hasLabel(...args: unknown[]): GraphTraversal;
      hasId(...args: unknown[]): GraphTraversal;
      hasKey(...args: unknown[]): GraphTraversal;
      hasValue(...args: unknown[]): GraphTraversal;
      addV(...args: unknown[]): GraphTraversal;
      addE(...args: unknown[]): GraphTraversal;
      mergeV(...args: unknown[]): GraphTraversal;
      mergeE(...args: unknown[]): GraphTraversal;
      filter(traversal: GraphTraversal): GraphTraversal;
      where(...args: unknown[]): GraphTraversal;
      not(traversal: GraphTraversal): GraphTraversal;
      count(): GraphTraversal;
      next(): Promise<{ value: unknown; done: boolean }>;
      toList(): Promise<unknown[]>;
      iterate(): Promise<void>;
      is(predicate: unknown): GraphTraversal;
      or(...traversals: GraphTraversal[]): GraphTraversal;
      and(...traversals: GraphTraversal[]): GraphTraversal;
      label(): GraphTraversal;
      values(...args: unknown[]): GraphTraversal;
      valueMap(...args: unknown[]): GraphTraversal;
      elementMap(...args: unknown[]): GraphTraversal;
      propertyMap(...args: unknown[]): GraphTraversal;
      from_(...args: unknown[]): GraphTraversal;
      to(...args: unknown[]): GraphTraversal;
      in_(...args: unknown[]): GraphTraversal;
      out(...args: unknown[]): GraphTraversal;
      both(...args: unknown[]): GraphTraversal;
      inE(...args: unknown[]): GraphTraversal;
      outE(...args: unknown[]): GraphTraversal;
      bothE(...args: unknown[]): GraphTraversal;
      inV(...args: unknown[]): GraphTraversal;
      outV(...args: unknown[]): GraphTraversal;
      bothV(...args: unknown[]): GraphTraversal;
      select(...args: unknown[]): GraphTraversal;
      as(...args: unknown[]): GraphTraversal;
      by(...args: unknown[]): GraphTraversal;
      fold(): GraphTraversal;
      unfold(): GraphTraversal;
      group(...args: unknown[]): GraphTraversal;
      groupCount(...args: unknown[]): GraphTraversal;
      order(...args: unknown[]): GraphTraversal;
      limit(...args: unknown[]): GraphTraversal;
      range(...args: unknown[]): GraphTraversal;
      dedup(...args: unknown[]): GraphTraversal;
      drop(): GraphTraversal;
      path(): GraphTraversal;
      map(...args: unknown[]): GraphTraversal;
      flatMap(...args: unknown[]): GraphTraversal;
      sideEffect(...args: unknown[]): GraphTraversal;
      cap(...args: unknown[]): GraphTraversal;
      id(): GraphTraversal;
      key(): GraphTraversal;
      value(): GraphTraversal;
      sum(...args: unknown[]): GraphTraversal;
      mean(...args: unknown[]): GraphTraversal;
      min(...args: unknown[]): GraphTraversal;
      max(...args: unknown[]): GraphTraversal;
      coalesce(...args: unknown[]): GraphTraversal;
      constant(...args: unknown[]): GraphTraversal;
      choose(...args: unknown[]): GraphTraversal;
      optional(...args: unknown[]): GraphTraversal;
      repeat(...args: unknown[]): GraphTraversal;
      until(...args: unknown[]): GraphTraversal;
      emit(...args: unknown[]): GraphTraversal;
      times(...args: unknown[]): GraphTraversal;
      tail(...args: unknown[]): GraphTraversal;
      skip(...args: unknown[]): GraphTraversal;
      project(...args: unknown[]): GraphTraversal;
      aggregate(...args: unknown[]): GraphTraversal;
      store(...args: unknown[]): GraphTraversal;
      coin(...args: unknown[]): GraphTraversal;
      math(...args: unknown[]): GraphTraversal;
      identity(): GraphTraversal;
      clone(): GraphTraversal;
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
