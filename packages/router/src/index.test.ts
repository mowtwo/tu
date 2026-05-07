import { describe, expect, it } from 'vitest'
import { h } from '@tu-lang/runtime'
import {
  createRouter,
  filePathToRoutePath,
  joinRoutePaths,
  renderRoute,
  renderRouteToString,
} from '../dist/index.js'

describe('@tu-lang/router', () => {
  it('matches static routes and renders route bodies', async () => {
    const router = createRouter([
      { path: '/', handler: () => h('h1', {}, ['Home']) },
      { path: '/about', handler: () => h('p', {}, ['About']) },
    ])
    expect(router.match('/about')?.ctx.pattern).toBe('/about')
    expect(await renderRouteToString(router, '/about')).toBe('<p>About</p>')
  })

  it('extracts params and query strings', async () => {
    const router = createRouter([
      {
        path: '/users/:id',
        handler: ({ params, query }) => h('p', {}, [params.id, ':', query.get('tab')]),
      },
    ])
    const match = router.resolve('/users/alice?tab=settings')
    expect(match.ctx.params).toEqual({ id: 'alice' })
    expect(match.ctx.query.get('tab')).toBe('settings')
    expect(await renderRouteToString(router, '/users/alice?tab=settings')).toBe(
      '<p>alice:settings</p>'
    )
  })

  it('prefers static routes over dynamic routes', () => {
    const router = createRouter([
      { path: '/users/:id', handler: () => 'dynamic' },
      { path: '/users/new', handler: () => 'static' },
    ])
    expect(router.resolve('/users/new').handler(router.resolve('/users/new').ctx)).toBe('static')
  })

  it('supports trailing catch-all routes', () => {
    const router = createRouter([
      { path: '/docs/*slug', handler: ({ params }) => params.slug },
    ])
    expect(router.resolve('/docs/guide/intro').ctx.params).toEqual({ slug: 'guide/intro' })
  })

  it('strips the deployment base before matching', async () => {
    const router = createRouter(
      [{ path: '/playground', handler: () => h('main', {}, ['Playground']) }],
      { base: '/tu' }
    )
    expect(router.resolve('/tu/playground').ctx.path).toBe('/playground')
    const html = await renderRoute(router, '/tu/playground', { title: 'Tu' })
    expect(html).toContain('<title>Tu</title>')
    expect(html).toContain('<main>Playground</main>')
  })

  it('falls back to a notFound handler', async () => {
    const router = createRouter([], {
      notFound: ({ path }) => h('p', {}, ['missing ', path]),
    })
    expect(router.resolve('/missing').route).toBeNull()
    expect(await renderRouteToString(router, '/missing')).toBe('<p>missing /missing</p>')
  })

  it('converts file paths to conventional route paths', () => {
    expect(filePathToRoutePath('index.tu')).toBe('/')
    expect(filePathToRoutePath('guide/index.md')).toBe('/guide/')
    expect(filePathToRoutePath('guide/intro.tu')).toBe('/guide/intro')
    expect(joinRoutePaths('/tu/', '/guide')).toBe('/tu/guide')
  })
})
