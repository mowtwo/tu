// M1.0 demo, refreshed for M5: a static greeting component.
// `Greeting` is capitalized — Tu treats it as a real function (not an HTML
// tag), so consumers can `import { Greeting }` and invoke it with named
// props: `Greeting(name: "World")`.

interface GreetingProps { name?: string }
export let Greeting = (props: GreetingProps) => .greet() {
  h1 { "Hello, " props.name "!" }
  p { "Welcome to Tu" }

  style {
    .greet { font-family: system-ui, sans-serif; }
  }
}
