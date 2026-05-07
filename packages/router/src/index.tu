import {
  renderPageAsync,
  renderToStream,
  renderToStringAsync,
} from "@tu-lang/runtime"

export interface RouteContext {
  url: string
  path: string
  query: URLSearchParams
  params: Record<string, string>
  pattern: string
}

export type RouteHandler = (ctx: RouteContext) => Child | Promise<Child>

export interface Route {
  path: string
  handler: RouteHandler
}

export interface RouterOptions {
  base?: string
  notFound?: RouteHandler
}

export interface Router {
  base: string
  routes: Route[]
  match: (url: string) => RouteMatch | null
  resolve: (url: string) => RouteMatch
}

export interface RouteMatch {
  route?: Route | null
  ctx: RouteContext
  handler: RouteHandler
}

export interface RenderPageOptions {
  lang?: string
  title?: string
  meta?: Record<string, string>
  links?: Record<string, string>[]
  scripts?: {
    src?: string
    type?: "module" | "text/javascript" | "importmap"
    defer?: boolean
    async?: boolean
    body?: string
  }[]
  headRaw?: string
  bodyClass?: string
  inlineScript?: string
}

export interface RenderToStreamOptions {
  lang?: string
  title?: string
  meta?: Record<string, string>
  links?: Record<string, string>[]
  scripts?: {
    src?: string
    type?: "module" | "text/javascript" | "importmap"
    defer?: boolean
    async?: boolean
    body?: string
  }[]
  headRaw?: string
  bodyClass?: string
  inlineScript?: string
  onShellReady?: () => void
}

interface ParsedRouteUrl {
  path: string
  query: URLSearchParams
}

interface CompiledRoute {
  route: Route
  score: number
  match: (path: string) => Record<string, string> | null
}

interface CompiledRoutePattern {
  score: number
  match: (path: string) => Record<string, string> | null
}

type CompiledSegment =
  | { kind: "static"; value: string; score: number }
  | { kind: "param"; name: string; score: number }
  | { kind: "catchall"; name: string; score: number }

export let createRouter = (routes: Route[], options?: RouterOptions): Router => {
  let opts: RouterOptions = options ?? {}
  let base = normalizeBase(opts.base ?? "/")
  let compiled: CompiledRoute[] = routes.map((route: Route): CompiledRoute => {
    let compiledRoute = compileRoute(route.path)
    return {
      route: route,
      score: compiledRoute.score,
      match: compiledRoute.match,
    }
  }).sort((a: CompiledRoute, b: CompiledRoute): number => b.score - a.score)
  let notFound = opts.notFound ?? defaultNotFound

  let matchUrl = (url: string): RouteMatch | null => {
    let loc = parseRouteUrl(url, base)
    let findMatch = (idx: number): RouteMatch | null => {
      if (idx >= compiled.length) { return null }
      let entry = compiled[idx]
      let params = entry.match(loc.path)
      if (params != null) {
        return {
          route: entry.route,
          handler: entry.route.handler,
          ctx: {
            url: url,
            path: loc.path,
            query: loc.query,
            params: params,
            pattern: entry.route.path,
          },
        }
      }
      return findMatch(idx + 1)
    }
    return findMatch(0)
  }

  let resolveUrl = (url: string): RouteMatch => {
    let matched = matchUrl(url)
    if (matched != null) { return matched }
    let loc = parseRouteUrl(url, base)
    return {
      route: null,
      handler: notFound,
      ctx: {
        url: url,
        path: loc.path,
        query: loc.query,
        params: {},
        pattern: "*",
      },
    }
  }

  return {
    base: base,
    routes: [...routes],
    match: matchUrl,
    resolve: resolveUrl,
  }
}

export let renderRouteToString = async (router: Router, url: string): Promise<string> => {
  let match = router.resolve(url)
  return renderToStringAsync(match.handler(match.ctx))
}

export let renderRoute = async (router: Router, url: string, options?: RenderPageOptions): Promise<string> => {
  let match = router.resolve(url)
  return renderPageAsync(() => match.handler(match.ctx), options ?? {})
}

export let renderRouteToStream = (router: Router, url: string, options?: RenderToStreamOptions): ReadableStream<Uint8Array> => {
  let match = router.resolve(url)
  return renderToStream(() => match.handler(match.ctx), options ?? {})
}

export let filePathToRoutePath = (path: string): string => {
  let normalized = path.split("\\").join("/").replace(/\.(tu|md|tsx?|jsx?)$/, "")
  if (normalized == "index") { return "/" }
  if (normalized.endsWith("/index")) {
    return "/" + normalized.slice(0, -6) + "/"
  }
  return "/" + normalized.replace(/^\/+/, "")
}

export let joinRoutePaths = (base: string, path: string): string => {
  let b = normalizeBase(base)
  let p = normalizePath(path)
  if (b == "/") { return p }
  if (p == "/") { return b }
  return b + p
}

let compileRoute = (pattern: string): CompiledRoutePattern => {
  let normalized = normalizePath(pattern)
  if (normalized == "/") {
    return {
      score: 10000,
      match: (path: string): Record<string, string> | null =>
        if (path == "/") { {} } else { null },
    }
  }
  let segments = normalized.slice(1).split("/")
  let parts = segments.map((segment: string, index: number): CompiledSegment =>
    compileSegment(segment, index == segments.length - 1)
  )
  let scoreParts = (idx: number, total: number): number =>
    if (idx >= parts.length) { total } else { scoreParts(idx + 1, total + parts[idx].score) }
  let score = scoreParts(0, 0) - segments.length
  return {
    score: score,
    match: (path: string): Record<string, string> | null => {
      let pathSegments = normalizePath(path).slice(1).split("/").filter((value: string): boolean => value.length > 0)
      let params: Record<string, string> = {}
      let matchAt = (partIndex: number, segmentIndex: number): Record<string, string> | null => {
        if (partIndex >= parts.length) {
          if (segmentIndex == pathSegments.length) { return params }
          return null
        }
        let part = parts[partIndex]
        if (part.kind == "catchall") {
          params[part.name] = pathSegments.slice(segmentIndex).map(decodeSegment).join("/")
          return params
        }
        if (segmentIndex >= pathSegments.length) { return null }
        let value = pathSegments[segmentIndex]
        if (part.kind == "static") {
          if (decodeSegment(value) != part.value) { return null }
        } else {
          params[part.name] = decodeSegment(value)
        }
        return matchAt(partIndex + 1, segmentIndex + 1)
      }
      return matchAt(0, 0)
    },
  }
}

let compileSegment = (segment: string, isLast: boolean): CompiledSegment => {
  if (segment == "*" || segment.startsWith("*")) {
    if (!isLast) { throw new Error("catch-all route segment must be last: " + segment) }
    let name = if (segment == "*") { "splat" } else { segment.slice(1) }
    assertParamName(name, segment)
    return { kind: "catchall", name: name, score: 1 }
  }
  if (segment.startsWith(":")) {
    let name = segment.slice(1)
    assertParamName(name, segment)
    return { kind: "param", name: name, score: 100 }
  }
  if (segment.length == 0) { throw new Error("empty route segment") }
  return { kind: "static", value: decodeSegment(segment), score: 1000 }
}

let assertParamName = (name: string, raw: string): void => {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) == false) {
    throw new Error("invalid route parameter name in segment '" + raw + "'")
  }
}

let parseRouteUrl = (url: string, base: string): ParsedRouteUrl => {
  let parsed = parseUrlLike(url)
  return {
    path: stripBase(normalizePath(parsed.pathname), base),
    query: parsed.searchParams,
  }
}

let parseUrlLike = (url: string): URL =>
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url)) {
    new URL(url)
  } else {
    new URL(if (url.startsWith("/")) { url } else { "/" + url }, "http://tu.local")
  }

let stripBase = (path: string, base: string): string => {
  if (base == "/") { return path }
  if (path == base) { return "/" }
  if (path.startsWith(base + "/")) { return path.slice(base.length) || "/" }
  return path
}

let normalizeBase = (base: string): string => {
  let normalized = normalizePath(base)
  if (normalized == "/") { return "/" }
  return normalized.replace(/\/+$/, "")
}

let normalizePath = (path: string): string => {
  let raw = path.split(/[?#]/)[0]
  let prefixed = if (raw.startsWith("/")) { raw } else { "/" + raw }
  let collapsed = prefixed.replace(/\/+/g, "/")
  if (collapsed.length > 1) { return collapsed.replace(/\/+$/, "") }
  return "/"
}

let decodeSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment)
  } catch (e: unknown) {
    return segment
  }
}

let defaultNotFound = (ctx: RouteContext): Child => `Not found: ${ctx.path}`
