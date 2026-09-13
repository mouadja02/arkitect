### Fixed

- **Draw.io edges no longer run through an icon's caption** (#45). Captions
  hang below the icon, and an orthogonal edge attached to the icon's bottom
  left or arrived straight through them: in the committed starter, the lines
  through "Ingestion function", "Search index" and "Analysis model". The
  builder now attaches an edge that leaves an icon downward, or enters one from
  below, in the same column, below the caption (`exitY=1;exitDy=34;
  exitPerimeter=0`, more for a caption on several lines). It stays connected
  and moves with the icon in the editor; horizontal and diagonal edges are left
  to the router. `validate` warns when an edge's estimated route crosses a
  caption, naming the edge and the icon, and counts crossings per page. The
  starter example is rebuilt and re-rendered.
