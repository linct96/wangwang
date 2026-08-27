import { useState } from 'react'
import { Activity, CircleGauge, Database, FileCode2, Menu, Network, X } from 'lucide-react'
import { Link, Outlet } from '@tanstack/react-router'
import { ThemeToggle } from '@/components/theme-toggle'
import { IconButton } from '@/components/app-primitives'

const navigation = [
  { to: '/dashboard', label: '概览', icon: CircleGauge },
  { to: '/sources', label: '节点源', icon: Database },
  { to: '/nodes', label: '节点', icon: Network },
  { to: '/profiles', label: '配置', icon: FileCode2 },
]

export function Layout() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  return (
    <div className="shell">
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <Link to="/dashboard" className="brand-link" onClick={() => setMobileMenuOpen(false)}>
              <span className="brand-icon">W</span>
              <strong className="brand-title">Wangwang</strong>
            </Link>
          </div>

          <nav className="header-nav">
            {navigation.map(({ to, label, icon: Icon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === '/dashboard' }}
                activeProps={{ className: 'active' }}
                className="nav-link"
              >
                <Icon />
                <span>{label}</span>
              </Link>
            ))}
          </nav>

          <div className="header-actions">
            <div className="worker-status">
              <span className="status-dot" />
              <Activity className="status-icon" />
              <span className="status-text">Cloudflare Worker</span>
            </div>
            <ThemeToggle className="theme-toggle-btn" />
            <IconButton
              className="mobile-toggle"
              label={mobileMenuOpen ? '关闭菜单' : '打开菜单'}
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X /> : <Menu />}
            </IconButton>
          </div>
        </div>

        {mobileMenuOpen && (
          <div className="mobile-nav">
            <div className="mobile-nav-list">
              {navigation.map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  activeOptions={{ exact: to === '/dashboard' }}
                  activeProps={{ className: 'active' }}
                  onClick={() => setMobileMenuOpen(false)}
                  className="mobile-nav-link"
                >
                  <Icon />
                  <span>{label}</span>
                </Link>
              ))}
            </div>
            <div className="mobile-nav-foot">
              <div className="mobile-nav-foot-status">
                <span className="status-dot" />
                <Activity className="status-icon" />
                <span>Cloudflare Worker</span>
              </div>
              <ThemeToggle className="theme-toggle-btn" />
            </div>
          </div>
        )}
      </header>
      {mobileMenuOpen && (
        <button type="button" className="mobile-mask" aria-label="关闭菜单" onClick={() => setMobileMenuOpen(false)} />
      )}
      <main>
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
