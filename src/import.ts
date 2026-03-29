import { readFileSync } from "node:fs";
import gremlin from "gremlin";
import type { NeptuneSandbox } from "./index.js";

const { process: gprocess } = gremlin;
const { t, cardinality } = gprocess;

export interface ImportVertex {
  id: string;
  label: string;
  properties: Record<string, unknown>;
}

export interface ImportEdge {
  id?: string;
  label: string;
  outV: string;
  inV: string;
  properties?: Record<string, unknown>;
}

export interface ImportData {
  vertices: ImportVertex[];
  edges: ImportEdge[];
}

export interface ImportOptions {
  batchSize?: number;
  onProgress?: (msg: string) => void;
}

/**
 * Import graph data into the sandbox.
 * Creates all vertices first, then all edges.
 */
export async function importData(
  sandbox: NeptuneSandbox,
  data: ImportData,
  opts: ImportOptions = {},
): Promise<{ vertices: number; edges: number }> {
  const batchSize = opts.batchSize ?? 50;
  const log = opts.onProgress ?? console.log;
  const g = sandbox.g;

  // --- Vertices ---
  let vCount = 0;
  for (let i = 0; i < data.vertices.length; i += batchSize) {
    const batch = data.vertices.slice(i, i + batchSize);
    for (const v of batch) {
      let traversal = g.addV(v.label).property(t.id, v.id);
      for (const [key, value] of Object.entries(v.properties)) {
        if (Array.isArray(value)) {
          for (const item of value) {
            traversal = traversal.property(cardinality.set, key, item);
          }
        } else {
          traversal = traversal.property(key, value);
        }
      }
      await traversal.next();
      vCount++;
    }
    log(`  vertices: ${vCount}/${data.vertices.length}`);
  }

  // --- Edges ---
  let eCount = 0;
  const __ = sandbox.__;
  for (let i = 0; i < data.edges.length; i += batchSize) {
    const batch = data.edges.slice(i, i + batchSize);
    for (const e of batch) {
      let traversal = g.addE(e.label)
        .from_(__.V(e.outV))
        .to(__.V(e.inV));
      if (e.id) {
        traversal = traversal.property(t.id, e.id);
      }
      if (e.properties) {
        for (const [key, value] of Object.entries(e.properties)) {
          traversal = traversal.property(key, value);
        }
      }
      await traversal.next();
      eCount++;
    }
    log(`  edges: ${eCount}/${data.edges.length}`);
  }

  log(`imported ${vCount} vertices, ${eCount} edges`);
  return { vertices: vCount, edges: eCount };
}

/**
 * Import graph data from a JSON file into the sandbox.
 */
export async function importFile(
  sandbox: NeptuneSandbox,
  filePath: string,
  opts: ImportOptions = {},
): Promise<{ vertices: number; edges: number }> {
  const raw = readFileSync(filePath, "utf-8");
  const data: ImportData = JSON.parse(raw);

  if (!Array.isArray(data.vertices) || !Array.isArray(data.edges)) {
    throw new Error('Invalid import file: expected { "vertices": [...], "edges": [...] }');
  }

  return importData(sandbox, data, opts);
}
