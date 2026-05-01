// Live editor — thin wrapper that renders an anchor div into #mount.
// All real UI (sidebar, editor, preview pane with Preview / JS / DTS
// tabs) is plain DOM owned by live-demo.tu's `attachLiveCompiler`.
// Tu doesn't need to participate in the chrome — letting it would re-
// render the whole thing on every state cell change, wiping Monaco
// and the preview-mount.

export let LiveEditor = () => div(class: "live-anchor") {}
