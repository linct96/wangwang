import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

function PasswordInput({ className, disabled, ...props }: React.ComponentProps<typeof Input>) {
  const [showPassword, setShowPassword] = React.useState(false)

  return (
    <div className="relative w-full">
      <Input
        type={showPassword ? 'text' : 'password'}
        disabled={disabled}
        className={cn('pr-8', className)}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={showPassword ? '隐藏密码' : '显示密码'}
        disabled={disabled}
        onClick={() => setShowPassword((prev) => !prev)}
        className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 flex cursor-pointer items-center justify-center border-none bg-transparent p-0 transition-colors focus:outline-none disabled:pointer-events-none disabled:opacity-50"
      >
        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

export { PasswordInput }
