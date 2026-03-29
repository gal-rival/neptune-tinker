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
    from gremlin_python.process.traversal import T
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
        print("Warning: boto3/botocore not available. Connecting without IAM auth.")
        return {}
    except Exception as e:
        print(f"Warning: AWS auth failed ({e}). Connecting without IAM auth.")
        return {}


def connect(endpoint: str) -> object:
    """Connect to Neptune and return the traversal source."""
    headers = {}
    if endpoint.startswith("wss://"):
        headers = get_aws_headers(endpoint)

    conn = DriverRemoteConnection(
        endpoint,
        "g",
        message_serializer=serializer.GraphSONSerializersV2d0(),
        headers=headers,
    )
    return traversal().with_remote(conn), conn


def export_graph(g, org_id: str | None = None) -> dict:
    """Export all vertices and edges to the import format."""

    # Query vertices
    v_query = g.V()
    if org_id:
        v_query = v_query.hasLabel(org_id)
    raw_vertices = v_query.elementMap().toList()

    vertices = []
    for v in raw_vertices:
        vertex = {
            "id": str(v[T.id]),
            "label": str(v[T.label]),
            "properties": {},
        }
        for key, value in v.items():
            if key in (T.id, T.label):
                continue
            # Handle list/set values
            if isinstance(value, (list, set)):
                vertex["properties"][key] = list(value)
            else:
                vertex["properties"][key] = value
        vertices.append(vertex)

    # Query edges
    e_query = g.E()
    if org_id:
        # Filter edges connected to org vertices
        e_query = g.V().hasLabel(org_id).bothE()
    raw_edges = e_query.elementMap().toList()

    edges = []
    seen_edge_ids = set()
    for e in raw_edges:
        eid = str(e[T.id])
        if eid in seen_edge_ids:
            continue  # deduplicate (bothE produces duplicates)
        seen_edge_ids.add(eid)

        edge = {
            "id": eid,
            "label": str(e[T.label]),
            "outV": str(e["OUT_V"] if "OUT_V" in e else e.get("outV", "")),
            "inV": str(e["IN_V"] if "IN_V" in e else e.get("inV", "")),
            "properties": {},
        }
        for key, value in e.items():
            if key in (T.id, T.label, "OUT_V", "IN_V", "outV", "inV"):
                continue
            edge["properties"][key] = value
        edges.append(edge)

    return {"vertices": vertices, "edges": edges}


def main():
    parser = argparse.ArgumentParser(description="Export Neptune graph data for neptune-tinker sandbox")
    parser.add_argument("--endpoint", required=True, help="Neptune WebSocket endpoint (wss://... or ws://...)")
    parser.add_argument("--org-id", help="Filter to a specific org ID (multi-tenant label prefix)")
    parser.add_argument("--output", "-o", default="neptune-export.json", help="Output JSON file path")
    args = parser.parse_args()

    print(f"Connecting to {args.endpoint}...")
    g, conn = connect(args.endpoint)

    print(f"Exporting graph data{' for org ' + args.org_id if args.org_id else ''}...")
    data = export_graph(g, args.org_id)

    print(f"Found {len(data['vertices'])} vertices, {len(data['edges'])} edges")

    with open(args.output, "w") as f:
        json.dump(data, f, indent=2, default=str)

    print(f"Exported to {args.output}")
    print(f"\nTo import into sandbox:")
    print(f"  npx neptune-tinker start")
    print(f"  npx neptune-tinker import {args.output}")

    conn.close()


if __name__ == "__main__":
    main()
