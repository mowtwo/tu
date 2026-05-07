import {
  renderPageAsync,
  renderToStream,
  renderToStringAsync,
  type Child,
  type RenderPageOptions,
  type RenderToStreamOptions,
} from '@tu-lang/runtime'

export interface RouteContext {
  /** Original URL/path passed to the router. */
  url: string
  /** Pathname after base stripping and normalization. Always starts with `/`. */
  path: string
  /** Query params from the URL. */
  query: URLSearchParams
  /** Dynamic params captured from `:name` or `*name` route segments. */
  params: Record<string, string>
  /** The matched route pattern. */
  pattern: string
}

export type RouteHandler = (ctx: RouteContext) => Child | Promise<Child>

export interface Route {
  /** Pattern such as `/`, `/users/:id`, `/docs/*slug`, or `/assets/*`. */
  path: string
  handler: RouteHandler
}

export interface RouterOptions {
  /** Deployment base path, e.g. `/tu`. Defaults to `/`. */
  base?: string
  /** Fallback route when no pattern matches. Defaults to a plain 404 page. */
  notFound?: RouteHandler
}

export interface Router {
  readonly base: string
  readonly routes: readonly Route[]
  match(url: string): RouteMatch | null
  resolve(url: string): RouteMatch
}

export interface RouteMatch {
  route: Route | null
  ctx: RouteContext
  handler: RouteHandler
}

export function createRouter(routes: readonly Route[], options: RouterOptions = {}): Router {
  const base = normalizeBase(options.base ?? '/')
  const compiled = routes
    .map((route) => ({ route, ...compileRoute(route.path) }))
    .sort((a, b) => b.score - a.score)
  const notFound = options.notFound ?? defaultNotFound
  return {
    base,
    routes: [...routes],
    match(url: string): RouteMatch | null {
      const loc = parseRouteUrl(url, base)
      for (const entry of compiled) {
        const params = entry.match(loc.path)
        if (params === null) continue
        return {
          route: entry.route,
          handler: entry.route.handler,
          ctx: {
            url,
            path: loc.path,
            query: loc.query,
            params,
            pattern: entry.route.path,
          },
        }
      }
      return null
    },
    resolve(url: string): RouteMatch {
      const matched = this.match(url)
      if (matched !== null) return matched
      const loc = parseRouteUrl(url, base)
      return {
        route: null,
        handler: notFound,
        ctx: {
          url,
          path: loc.path,
          query: loc.query,
          params: {},
          pattern: '*',
        },
      }
    },
  }
}

export async function renderRouteToString(router: Router, url: string): Promise<string> {
  const match = router.resolve(url)
  return renderToStringAsync(match.handler(match.ctx))
}

export async function renderRoute(
  router: Router,
  url: string,
  options: RenderPageOptions = {}
): Promise<string> {
  const match = router.resolve(url)
  return renderPageAsync(() => match.handler(match.ctx), options)
}

export function renderRouteToStream(
  router: Router,
  url: string,
  options: RenderToStreamOptions = {}
): ReadableStream<Uint8Array> {
  const match = router.resolve(url)
  return renderToStream(() => match.handler(match.ctx), options)
}

/** Convert a docs/app file path into a conventional route path. */
export function filePathToRoutePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\.(tu|md|tsx?|jsx?)$/, '')
  if (normalized === 'index') return '/'
  if (normalized.endsWith('/index')) return '/' + normalized.slice(0, -'/index'.length) + '/'
  return '/' + normalized.replace(/^\/+/, '')
}

export function joinRoutePaths(base: string, path: string): string {
  const b = normalizeBase(base)
  const p = normalizePath(path)
  if (b === '/') return p
  if (p === '/') return b
  return b + p
}

function compileRoute(pattern: string): {
  score: number
  match: (path: string) => Record<string, string> | null
} {
  const normalized = normalizePath(pattern)
  if (normalized === '/') {
    return {
      score: 10_000,
      match: (path) => path === '/' ? {} : null,
    }
  }
  const segments = normalized.slice(1).split('/')
  const parts = segments.map((segment, index) => compileSegment(segment, index === segments.length - 1))
  const score = parts.reduce((acc, p) => acc + p.score, 0) - segments.length
  return {
    score,
    match(path: string): Record<string, string> | null {
      const pathSegments = normalizePath(path).slice(1).split('/').filter(Boolean)
      const params: Record<string, string> = {}
      let i = 0
      for (const part of parts) {
        if (part.kind === 'catchall') {
          params[part.name] = pathSegments.slice(i).map(decodeSegment).join('/')
          return params
        }
        const value = pathSegments[i]
        if (value === undefined) return null
        if (part.kind === 'static') {
          if (decodeSegment(value) !== part.value) return null
        } else {
          params[part.name] = decodeSegment(value)
        }
        i++
      }
      return i === pathSegments.length ? params : null
    },
  }
}

type CompiledSegment =
  | { kind: 'static'; value: string; score: number }
  | { kind: 'param'; name: string; score: number }
  | { kind: 'catchall'; name: string; score: number }

function compileSegment(segment: string, isLast: boolean): CompiledSegment {
  if (segment === '*' || segment.startsWith('*')) {
    if (!isLast) throw new Error(`catch-all route segment must be last: ${segment}`)
    const name = segment === '*' ? 'splat' : segment.slice(1)
    assertParamName(name, segment)
    return { kind: 'catchall', name, score: 1 }
  }
  if (segment.startsWith(':')) {
    const name = segment.slice(1)
    assertParamName(name, segment)
    return { kind: 'param', name, score: 100 }
  }
  if (segment.length === 0) throw new Error('empty route segment')
  return { kind: 'static', value: decodeSegment(segment), score: 1000 }
}

function assertParamName(name: string, raw: string): void {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(`invalid route parameter name in segment '${raw}'`)
  }
}

function parseRouteUrl(url: string, base: string): { path: string; query: URLSearchParams } {
  const parsed = parseUrlLike(url)
  return {
    path: stripBase(normalizePath(parsed.pathname), base),
    query: parsed.searchParams,
  }
}

function parseUrlLike(url: string): URL {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url)) return new URL(url)
  return new URL(url.startsWith('/') ? url : '/' + url, 'http://tu.local')
}

function stripBase(path: string, base: string): string {
  if (base === '/') return path
  if (path === base) return '/'
  if (path.startsWith(base + '/')) return path.slice(base.length) || '/'
  return path
}

function normalizeBase(base: string): string {
  const normalized = normalizePath(base)
  return normalized === '/' ? '/' : normalized.replace(/\/+$/, '')
}

function normalizePath(path: string): string {
  const [withoutQuery] = path.split(/[?#]/, 1)
  const raw = withoutQuery ?? '/'
  const prefixed = raw.startsWith('/') ? raw : '/' + raw
  const collapsed = prefixed.replace(/\/+/g, '/')
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : '/'
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function defaultNotFound(ctx: RouteContext): Child {
  return `Not found: ${ctx.path}`
}
