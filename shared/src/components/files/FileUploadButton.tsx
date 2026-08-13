import { useRef } from 'react'

interface Props {
  currentPath: string
  onUpload: (file: File, targetDir: string) => void
  disabled?: boolean
  onDisabledClick?: () => void
}

export default function FileUploadButton({ currentPath, onUpload, disabled, onDisabledClick }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClick = () => {
    if (disabled) {
      onDisabledClick?.()
      return
    }
    inputRef.current?.click()
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    for (let i = 0; i < files.length; i++) {
      onUpload(files[i], currentPath)
    }
    // 重置 input 以便再次选择同一文件
    e.target.value = ''
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleChange}
      />
      <button
        onClick={handleClick}
        className={`p-2 transition-colors ${
          disabled
            ? 'text-t-muted/50 cursor-not-allowed'
            : 'text-t-muted hover:text-t-secondary active:text-t-primary'
        }`}
        aria-label="上传文件"
      >
        <svg className="w-4.5 h-4.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
      </button>
    </>
  )
}
