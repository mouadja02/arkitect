#!/usr/bin/env bash
# Builds the fixture this case reads. `scaffold_script` names a file inside the
# case directory, so this must stay a real script, not inline YAML.
set -euo pipefail

mkdir -p eval-input
cat > eval-input/existing.drawio <<'EOF'
<mxfile host="Electron" version="29.0.3">
  <diagram name="Page-1" id="p1">
    <mxGraphModel dx="800" dy="600" grid="0" pageWidth="850" pageHeight="1100">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="a" value="Service A" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="80" y="80" width="160" height="60" as="geometry" />
        </mxCell>
        <mxCell id="b" value="Service B" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">
          <mxGeometry x="400" y="80" width="160" height="60" as="geometry" />
        </mxCell>
        <mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;dashed=1;" edge="1" parent="1" source="a" target="b">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
EOF
