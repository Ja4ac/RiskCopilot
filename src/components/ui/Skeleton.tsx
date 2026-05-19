import React from 'react'

interface SkeletonProps {
  width?: string | number
  height?: string | number
  borderRadius?: string
}

export const Skeleton: React.FC<SkeletonProps> = ({ width = '100%', height = 16, borderRadius = '6px' }) => {
  return <div className="skeleton" style={{ width, height, borderRadius }} />
}
