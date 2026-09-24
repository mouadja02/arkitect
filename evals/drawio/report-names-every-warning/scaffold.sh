#!/usr/bin/env bash
# The spec this case builds. Drawn as it stands it gives validate exactly two
# warnings: write-edge runs through the queue icon, which sits in its line with
# no gap to route through, and retention-note lies across the border of
# acct-boundary. The prompt forbids changing the layout, so both are still
# there when the agent reports.
set -euo pipefail

mkdir -p eval-input
cat > eval-input/pipeline.spec.json <<'EOF'
{
  "title": "Order pipeline",
  "boundaries": [
    { "id": "acct-boundary", "kind": "aws-cloud", "label": "Orders account", "col": 0, "row": 0, "cols": 2, "rows": 2 }
  ],
  "nodes": [
    { "id": "producer", "kind": "icon", "icon": "aws/aws-lambda", "label": "Order handler", "col": 0, "row": 0, "parent": "acct-boundary" },
    { "id": "queue", "kind": "icon", "icon": "aws/amazon-simple-queue-service", "label": "Order queue", "col": 0.5, "row": 0, "parent": "acct-boundary" },
    { "id": "table", "kind": "icon", "icon": "aws/amazon-dynamodb", "label": "Orders table", "col": 1, "row": 0, "parent": "acct-boundary" },
    { "id": "worker", "kind": "icon", "icon": "aws/aws-lambda", "label": "Order worker", "col": 0.5, "row": 1, "parent": "acct-boundary" },
    { "id": "retention-note", "kind": "text", "label": "Retention: 7 days", "col": 1.25, "row": 1 }
  ],
  "edges": [
    { "id": "enqueue-edge", "from": "producer", "to": "queue", "label": "enqueue" },
    { "id": "write-edge", "from": "producer", "to": "table", "label": "write" },
    { "id": "consume-edge", "from": "queue", "to": "worker", "label": "consume" }
  ]
}
EOF
