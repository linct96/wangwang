import { createRootRoute, createRoute, createRouter, Navigate, Outlet } from '@tanstack/react-router'
import { Layout } from './layout'
import { DashboardPage } from '@/features/dashboard/page'
import { SourcesPage } from '@/features/sources/page'
import { NodesPage } from '@/features/nodes/page'
import { ProfilesPage } from '@/features/profiles/page'
import { ProfileDetailPage } from '@/features/profiles/profile-detail'
import { EditTemplatePage, NewTemplatePage } from '@/features/templates/editor'
import { TemplatesPage } from '@/features/templates/page'

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: () => <Navigate to="/dashboard" replace /> })
const appRoute = createRoute({ getParentRoute: () => rootRoute, id: 'app', component: Layout })
const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  component: () => <Navigate to="/dashboard" replace />,
})
const dashboardRoute = createRoute({ getParentRoute: () => appRoute, path: '/dashboard', component: DashboardPage })
const sourcesRoute = createRoute({ getParentRoute: () => appRoute, path: '/sources', component: SourcesPage })
const nodesRoute = createRoute({ getParentRoute: () => appRoute, path: '/nodes', component: NodesPage })
const profilesRoute = createRoute({ getParentRoute: () => appRoute, path: '/profiles', component: ProfilesPage })
const templatesRoute = createRoute({ getParentRoute: () => appRoute, path: '/templates', component: TemplatesPage })
const newTemplateRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/templates/new',
  validateSearch: (search: Record<string, unknown>) => ({
    source: ['builtin:minimal', 'builtin:standard', 'builtin:full', 'import', 'blank'].includes(String(search.source))
      ? (String(search.source) as 'builtin:minimal' | 'builtin:standard' | 'builtin:full' | 'import' | 'blank')
      : ('blank' as const),
  }),
  component: NewTemplatePage,
})
const editTemplateRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/templates/$id/edit',
  component: EditTemplatePage,
})
const profileDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/profiles/$id',
  component: ProfileDetailPage,
})
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: () => <Navigate to="/dashboard" replace />,
})
const routeTree = rootRoute.addChildren([
  appRoute.addChildren([
    indexRoute,
    dashboardRoute,
    sourcesRoute,
    nodesRoute,
    profilesRoute,
    profileDetailRoute,
    templatesRoute,
    newTemplateRoute,
    editTemplateRoute,
  ]),
  loginRoute,
])

export const router = createRouter({
  routeTree,
  basepath: window.location.pathname.startsWith('/admin') ? '/admin' : '/',
  defaultPreload: 'intent',
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
