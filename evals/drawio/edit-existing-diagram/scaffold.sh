#!/usr/bin/env bash
# A diagram drawn in a style that is deliberately NOT the house style: rounded
# corners, a non-house font colour and a thin grey stroke. An edit that matches
# the file keeps those; an edit that reaches for the style guide will not.
set -euo pipefail

mkdir -p eval-input
cat > eval-input/checkout.drawio <<'EOF'
<mxfile host="Electron" version="29.0.3">
  <diagram name="Checkout" id="p1">
    <mxGraphModel dx="1400" dy="900" grid="0" pageWidth="1600" pageHeight="900">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="web" value="Web App" style="rounded=1;whiteSpace=wrap;html=1;fontColor=#1A1A1A;strokeColor=#9E9E9E;fillColor=#FFFFFF;" vertex="1" parent="1">
          <mxGeometry x="80" y="200" width="160" height="60" as="geometry" />
        </mxCell>
        <mxCell id="api" value="Checkout API" style="rounded=1;whiteSpace=wrap;html=1;fontColor=#1A1A1A;strokeColor=#9E9E9E;fillColor=#FFFFFF;" vertex="1" parent="1">
          <mxGeometry x="400" y="200" width="160" height="60" as="geometry" />
        </mxCell>
        <mxCell id="db" value="Orders DB" style="rounded=1;whiteSpace=wrap;html=1;fontColor=#1A1A1A;strokeColor=#9E9E9E;fillColor=#FFFFFF;" vertex="1" parent="1">
          <mxGeometry x="720" y="200" width="160" height="60" as="geometry" />
        </mxCell>
        <mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#9E9E9E;" edge="1" parent="1" source="web" target="api">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
        <mxCell id="e2" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#9E9E9E;" edge="1" parent="1" source="api" target="db">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
EOF
