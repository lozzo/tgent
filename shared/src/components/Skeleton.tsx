interface SkeletonProps {
  width?: string | number
  height?: string | number
  className?: string
  rounded?: boolean
}

export default function Skeleton({
  width,
  height,
  className = '',
  rounded = true,
}: SkeletonProps) {
  return (
    <div
      className={`bg-[var(--color-border-subtle)] animate-pulse ${
        rounded ? 'rounded-lg' : ''
      } ${className}`}
      style={{
        width: typeof width === 'number' ? `${width}px` : width,
        height: typeof height === 'number' ? `${height}px` : height,
      }}
    />
  )
}
