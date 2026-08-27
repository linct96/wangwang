import { useEffect, useState } from 'react'
import { Laptop, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" className={className} disabled aria-label="主题切换">
        <Sun className="h-4 w-4 opacity-50" />
      </Button>
    )
  }

  function toggleNext() {
    if (theme === 'system') setTheme('light')
    else if (theme === 'light') setTheme('dark')
    else setTheme('system')
  }

  const label = theme === 'system' ? '跟随系统' : theme === 'dark' ? '深色模式' : '浅色模式'

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      onClick={toggleNext}
      title={`当前主题: ${label} (点击切换)`}
      aria-label={`切换主题，当前: ${label}`}
    >
      {theme === 'system' && <Laptop className="h-4 w-4" />}
      {theme === 'light' && <Sun className="h-4 w-4" />}
      {theme === 'dark' && <Moon className="h-4 w-4" />}
    </Button>
  )
}
