// M1.0 demo, refreshed for M5: a static greeting component.
// `Greeting` is capitalized — Tu treats it as a real function (not an HTML
// tag), so consumers can `import { Greeting }` and invoke as either
// `Greeting("World")` or `Greeting("World") { … }` (children block).

export let Greeting = (name: string) => .greet() {
  h1 { "Hello, " name "!" }
  p { "Welcome to Tu" }

  style {
    .greet { font-family: system-ui, sans-serif; }
  }
}
