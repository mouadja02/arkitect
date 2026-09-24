#!/usr/bin/env bash
# The spec this case builds. Drawn as it stands it gives validate exactly two
# warnings: the dlq icon overlaps worker, and retention-note lies across the
# border of acct-boundary. Neither is one the builder can route round, so a
# better router does not empty the case (it did in #288). The prompt forbids
# changing the layout, so both are still there when the agent reports.
set -euo pipefail

mkdir -p eval-input
cat > eval-input/pipeline.spec.json <<'EOF'
{
  "title": "Order pipeline",
  "boundaries": [
    { "id": "acct-boundary", "kind": "aws-cloud", "label": "Orders account", "col": 0, "row": 0, "cols": 3, "rows": 2 }
  ],
  "nodes": [
    { "id": "producer", "kind": "icon", "icon": "aws/aws-lambda", "label": "Order handler", "col": 0, "row": 0, "parent": "acct-boundary" },
    { "id": "queue", "kind": "icon", "icon": "aws/amazon-simple-queue-service", "label": "Order queue", "col": 1, "row": 0, "parent": "acct-boundary" },
    { "id": "table", "kind": "icon", "icon": "aws/amazon-dynamodb", "label": "Orders table", "col": 2, "row": 0, "parent": "acct-boundary" },
    { "id": "worker", "kind": "icon", "icon": "aws/aws-lambda", "label": "Order worker", "col": 1, "row": 1, "parent": "acct-boundary" },
    { "id": "dlq", "kind": "icon", "icon": "aws/amazon-simple-queue-service", "label": "Dead letters", "col": 1.15, "row": 1.1, "parent": "acct-boundary" },
    { "id": "retention-note", "kind": "text", "label": "Retention: 7 days", "col": 2.25, "row": 1 }
  ],
  "edges": [
    { "id": "enqueue-edge", "from": "producer", "to": "queue", "label": "enqueue" },
    { "id": "write-edge", "from": "producer", "to": "table", "label": "write" },
    { "id": "consume-edge", "from": "queue", "to": "worker", "label": "consume" },
    { "id": "retry-edge", "from": "dlq", "to": "queue", "label": "retry" }
  ]
}
EOF
