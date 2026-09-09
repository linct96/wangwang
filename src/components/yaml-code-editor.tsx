import type { ComponentProps } from 'react'
import { yaml } from '@codemirror/lang-yaml'
import { linter, lintGutter } from '@codemirror/lint'
import CodeMirror from '@uiw/react-codemirror'
import { parseDocument } from 'yaml'
import { cn } from '@/lib/utils'

const extensions = [
  yaml(),
  linter((view) =>
    parseDocument(view.state.doc.toString()).errors.map((error) => ({
      from: error.pos[0],
      to: error.pos[1],
      severity: 'error',
      message: error.message,
    })),
  ),
  lintGutter(),
]

export default function YamlCodeEditor({ className, ...props }: Omit<ComponentProps<typeof CodeMirror>, 'extensions'>) {
  return (
    <CodeMirror
      {...props}
      extensions={extensions}
      className={cn(
        'w-full max-w-full min-w-0 [&_.cm-editor]:h-full [&_.cm-editor]:w-full [&_.cm-editor]:max-w-full [&_.cm-editor]:min-w-0 [&_.cm-scroller]:overflow-auto',
        className,
      )}
    />
  )
}
