#!/usr/bin/env python3
"""
Export data from AWS Neptune to a JSON file for import into neptune-tinker sandbox.

Usage:
    python export-neptune.py --endpoint wss://your-neptune:8182/gremlin --output data.json
    python export-neptune.py --endpoint wss://your-neptune:8182/gremlin --org-id test-org-001 --output data.json

Then import into the sandbox:
    npx neptune-tinker import data.json

Requirements:
    pip install gremlin-python boto3 botocore
"""

import argparse
import json
import sys
from datetime import datetime

try:
    from gremlin_python.driver import serializer
    from gremlin_python.driver.driver_remote_connection import DriverRemoteConnection
    from gremlin_python.process.anonymous_traversal import traversal
    from gremlin_python.process.graph_traversal import __
    from gremlin_python.process.traversal import T  # noqa: F401
except ImportError:
    print("Error: gremlin-python not installed. Run: pip install gremlin-python")
    sys.exit(1)


def get_aws_headers(url: str) -> dict:
    """Generate AWS Signature v4 headers for Neptune IAM auth."""
    try:
        from botocore.auth import SigV4Auth
        from botocore.awsrequest import AWSRequest
        from botocore.session import Session as BotocoreSession

        session = BotocoreSession()
        credentials = session.get_credentials().get_frozen_credentials()
        region = session.get_config_variable("region") or "us-east-1"

        request = AWSRequest(method="GET", url=url, headers={"Host": url.split("//")[1].split(":")[0]})
        SigV4Auth(credentials, "neptune-db", region).add_auth(request)
        return dict(request.headers)
    except ImportError:
        print("Warning: boto3/botocore not available. Connecting without IAM auth.", flush=True)
        return {}
    except Exception as e:
        print(f"Warning: AWS auth failed ({e}). Connecting without IAM auth.", flush=True)
        return {}


def connect(endpoint: str) -> object:
    """Connect to Neptune and return the traversal source."""
    headers = {}
    if endpoint.startswith("wss://"):
        headers = get_aws_headers(endpoint)
        print("  SigV4 headers generated", flush=True)

    conn = DriverRemoteConnection(
        endpoint,
        "g",
        message_serializer=serializer.GraphSONSerializersV2d0(),
        headers=headers,
    )
    return traversal().with_remote(conn), conn


def export_graph(g, org_id: str | None = None, limit: int | None = None) -> dict:
    """Export all vertices and edges to the import format."""
    import time

    batch_size = 500

    # Query vertices in batches
    print("  Querying vertices...", flush=True)
    t0 = time.time()
    raw_vertices = []
    offset = 0
    while True:
        v_query = g.V()
        if org_id:
            v_query = v_query.hasLabel(org_id)
        batch = v_query.range_(offset, offset + batch_size).elementMap().toList()
        raw_vertices.extend(batch)
        print(f"    vertices: {len(raw_vertices)} fetched...", flush=True)
        if len(batch) < batch_size:
            break
        if limit and len(raw_vertices) >= limit:
            break
        offset += batch_size
    if limit:
        raw_vertices = raw_vertices[:limit]
    print(f"  Total: {len(raw_vertices)} vertices ({time.time() - t0:.1f}s)", flush=True)

    vertices = []
    for v in raw_vertices:
        vertex = {
            "id": str(v["id"]),
            "label": str(v["label"]),
            "properties": {},
        }
        for key, value in v.items():
            if key in ("id", "label"):
                continue
            # Handle list/set values
            if isinstance(value, (list, set)):
                vertex["properties"][key] = list(value)
            else:
                vertex["properties"][key] = value
        vertices.append(vertex)

    # Query edges in batches
    print("  Querying edges...", flush=True)
    t0 = time.time()
    raw_edges = []
    offset = 0
    while True:
        if org_id:
            batch = g.V().hasLabel(org_id).bothE().range_(offset, offset + batch_size).elementMap().toList()
        else:
            batch = g.E().range_(offset, offset + batch_size).elementMap().toList()
        raw_edges.extend(batch)
        print(f"    edges: {len(raw_edges)} fetched...", flush=True)
        if len(batch) < batch_size:
            break
        if limit and len(raw_edges) >= limit:
            break
        offset += batch_size
    if limit:
        raw_edges = raw_edges[:limit]
    print(f"  Total: {len(raw_edges)} edges ({time.time() - t0:.1f}s)", flush=True)

    vertex_ids = {v["id"] for v in vertices}
    edges = []
    seen_edge_ids = set()
    for e in raw_edges:
        eid = str(e["id"])
        if eid in seen_edge_ids:
            continue  # deduplicate (bothE produces duplicates)
        seen_edge_ids.add(eid)

        out_v = str(e["OUT_V"] if "OUT_V" in e else e.get("outV", ""))
        in_v = str(e["IN_V"] if "IN_V" in e else e.get("inV", ""))

        # Skip edges referencing vertices we didn't export
        if out_v not in vertex_ids or in_v not in vertex_ids:
            continue

        edge = {
            "id": eid,
            "label": str(e["label"]),
            "outV": out_v,
            "inV": in_v,
            "properties": {},
        }
        for key, value in e.items():
            if key in ("id", "label", "OUT_V", "IN_V", "outV", "inV"):
                continue
            edge["properties"][key] = value
        edges.append(edge)

    return {"vertices": vertices, "edges": edges}


def main():
    parser = argparse.ArgumentParser(description="Export Neptune graph data for neptune-tinker sandbox")
    parser.add_argument("--endpoint", required=True, help="Neptune WebSocket endpoint (wss://... or ws://...)")
    parser.add_argument("--org-id", help="Filter to a specific org ID (multi-tenant label prefix)")
    parser.add_argument("--limit", type=int, help="Max vertices/edges to export")
    parser.add_argument("--output", "-o", default="neptune-export.json", help="Output JSON file path")
    args = parser.parse_args()

    print(f"Connecting to {args.endpoint}...", flush=True)
    g, conn = connect(args.endpoint)
    print("Connected.", flush=True)

    print(f"Exporting graph data{' for org ' + args.org_id if args.org_id else ''}...", flush=True)
    data = export_graph(g, args.org_id, args.limit)

    print(f"Found {len(data['vertices'])} vertices, {len(data['edges'])} edges", flush=True)

    with open(args.output, "w") as f:
        json.dump(data, f, indent=2, default=str)

    print(f"Exported to {args.output}")
    print(f"\nTo import into sandbox:")
    print(f"  npx neptune-tinker start")
    print(f"  npx neptune-tinker import {args.output}")

    conn.close()


if __name__ == "__main__":
    main()
