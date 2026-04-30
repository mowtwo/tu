// Reactive stage header — shows the active demo's title + blurb.
//
// `title` and `blurb` are imported as state cells; main.js sets them on
// every demo activation, and the keyed-diff runtime patches just the text
// nodes that changed.

export let title = ""
export let blurb = ""

export let StageHeader = () => header(class: "stage__header") {
  h2 { title }
  p { blurb }
}
