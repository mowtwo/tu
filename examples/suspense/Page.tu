// M6.11 demo — async + Suspense in a real Tu page.
//
// `UserCard` is an async component: its body awaits a fake fetch before
// returning a vnode. The top-level `Page` wraps each card in `Suspense`
// with a fallback so the SSR walk emits the placeholder when the boundary
// hasn't resolved yet (streaming) or the resolved body when it has
// (renderToStringAsync). Both pipelines are exercised by run.mjs.

import { Suspense } from "@tu-lang/runtime"

interface User { id: string; name: string; bio: string }

let fakeFetchUser = async (id: string, delayMs: number): Promise<User> => {
  await new Promise((res: (v: void) => void) => setTimeout(() => res(), delayMs))
  if (id == "alice") {
    return { id, name: "Alice", bio: "Tu language enthusiast" }
  }
  return { id, name: "Bob", bio: "Loves async + Suspense" }
}

interface UserCardProps { id?: string; delayMs?: number }
let UserCard = async (props: UserCardProps) => {
  let user = await fakeFetchUser(props.id ?? "alice", props.delayMs ?? 0)
  div(class: "card") {
    h2 { user.name }
    p { user.bio }
    small { "id: " user.id }
  }
}

interface SpinnerProps { label?: string }
let Spinner = (props: SpinnerProps) => div(class: "spinner") {
  span { "⏳ " props.label "…" }
}

export let Page = () => main(class: "page") {
  h1 { "Tu Suspense demo" }
  p(class: "intro") {
    "Two cards loaded asynchronously. The first resolves fast, the second slower. "
    "With renderToStream, the fast one flushes first; with renderToStringAsync, "
    "we await both before emitting."
  }
  div(class: "grid") {
    Suspense(fallback: Spinner({ label: "alice" })) {
      UserCard(id: "alice", delayMs: 5)
    }
    Suspense(fallback: Spinner({ label: "bob" })) {
      UserCard(id: "bob", delayMs: 30)
    }
  }
}
