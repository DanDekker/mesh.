# mesh.

```sh
bun run dev
```

Open http://127.0.0.1:3000. Bun rebuilds the browser files when source changes;
refresh the page to see them.

```sh
bun run check   # build, numerical and server tests, public-asset audit
bun run build   # static browser files in dist/
bun start       # build and serve
```

Bun, TypeScript, HTML, CSS, Web Components and raw WebGL 2. No external packages,
font downloads, CDNs, or runtime services.

Silk, Orbit, Knot, Sphere and Cube are closed. Wave is open. Mouse and touch disturb the
field; dragging pulls it, a tap releases a ripple, and scrolling winds or unwinds
the surface; flick a drag to throw it, hold a press to deepen the ripple, and
tap twice for a stronger one. Keys 1–6 or the arrow keys change the
form, Space pauses, and R resets. Reduced-motion preferences start it paused.

The public checkout includes an independent browser simulation. An optional
private provider can run behind the Bun server. Set `MESH_PRIVATE_ADAPTER` in
an untracked `.env` to an absolute adapter path **outside this repository**.
The provider implements [this data contract](src/server/provider.ts); only
particle coordinates cross the WebSocket connection. Its source, native
libraries and assets never enter the browser build or static file routes.

Private implementations and generated binaries belong outside this checkout.
The build audit checks the public output and tracked files for private assets.
