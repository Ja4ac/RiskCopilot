import React from 'react'

interface TagProps {
  variant: 'danger' | 'warning' | 'ok'
  children: React.ReactNode
}

export const Tag: React.FC<TagProps> = ({ variant, children }) => {
  return <span className={`tag ${variant}`}>{children}</span>
}
