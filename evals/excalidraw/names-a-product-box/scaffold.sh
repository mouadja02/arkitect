#!/usr/bin/env bash
# The spec this case builds. The database is a plain cylinder labelled
# PostgreSQL, a product with a bundled mark, so the build lists it under
# namesAProduct with the node to paste over it (#287).
set -euo pipefail

mkdir -p eval-input
cat > eval-input/orders.spec.json <<'EOF'
{
  "title": "Orders",
  "nodes": [
    { "id": "web", "kind": "box", "label": "Web shop", "col": 0, "row": 0 },
    { "id": "api", "kind": "box", "label": "Orders API", "col": 1, "row": 0 },
    { "id": "db", "kind": "cylinder", "label": "PostgreSQL", "col": 2, "row": 0 }
  ],
  "edges": [
    { "from": "web", "to": "api", "label": "place order" },
    { "from": "api", "to": "db", "label": "write" }
  ]
}
EOF
