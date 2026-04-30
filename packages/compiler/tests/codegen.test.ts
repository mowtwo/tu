import { describe, expect, it } from 'vitest'
import { compile } from '../src/index.js'

describe('codegen', () => {
  it('emits a runtime import header', () => {
    expect(compile('')).toContain(`import { h } from '@tu/runtime'`)
  })

  it('exports a top-level let as const', () => {
    const js = compile('let greeting = "hi"')
    expect(js).toContain(`export const greeting = "hi"`)
  })

  it('emits a parameterless lambda calling h()', () => {
    const js = compile('let App = () => div { "Hi" }')
    expect(js).toContain(`export const App = () => h("div", {}, ["Hi"])`)
  })

  it('forwards typed parameters as plain JS params', () => {
    const js = compile('let G = (name: string) => div { name }')
    expect(js).toContain(`export const G = (name) => h("div", {}, [name])`)
  })

  it('emits props with quoted keys', () => {
    const js = compile('let App = () => div(class: "g") { "x" }')
    expect(js).toContain(`h("div", { "class": "g" }, ["x"])`)
  })

  it('flattens block-bodied lambdas to expression form when single child', () => {
    const js = compile(`
      let App = () => {
        div { "hi" }
      }
    `)
    // Single-statement block: unwraps to (expr)
    expect(js).toContain(`export const App = () => (h("div", {}, ["hi"]))`)
  })

  it('compiles the canonical greeting example', () => {
    const js = compile(`
      let Greeting = (name: string) => {
        div(class: "greet") {
          h1 { "Hello, " name "!" }
          p { "Welcome to Tu" }
        }
      }
    `)
    expect(js).toContain(`export const Greeting = (name) => (h(`)
    expect(js).toContain(`h("h1", {}, ["Hello, ", name, "!"])`)
    expect(js).toContain(`h("p", {}, ["Welcome to Tu"])`)
  })
})
