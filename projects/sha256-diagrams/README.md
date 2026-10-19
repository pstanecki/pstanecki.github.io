# SHA-256 diagram viewer

`page-1.png` and `page-3.png` are unchanged copies of the supplied diagrams.net
exports. They retain the embedded draw.io document. The viewer displays one
region of an original image at a time using an SVG viewBox, with native HTML
buttons positioned over modules that have a child diagram.

The hierarchy, image bounds, hotspot bounds, and accessible descriptions are
defined in `viewer.js`. All bounds are `[x, y, width, height]` in original PNG
pixels, not coordinates in the embedded draw.io document. If a diagram is
re-exported with a different layout or scale, update those bounds and the image
dimensions in `sources`. Also update the default top view in the HTML, which is
displayed when JavaScript is unavailable.

Hierarchy:

- Top module
  - Accelerator
    - FSM
    - Hash Computation
      - Message Scheduler
      - Data Compression
  - Preprocessing
  - Interface
    - SPI Interface

The viewer has no build step or external dependencies. Open
`projects/sha256-accelerator.html` directly or serve the repository with a static
HTTP server. Check every branch and its parent control, breadcrumbs, zoom/fit,
keyboard navigation, narrow screens, and the original-image links when updating.
