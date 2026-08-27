import { Toaster as Sonner, type ToasterProps } from 'sonner'

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="top-right"
      richColors
      closeButton
      toastOptions={{ classNames: { toast: 'font-sans', title: 'text-sm font-semibold', description: 'text-xs' } }}
      {...props}
    />
  )
}

export { Toaster }
