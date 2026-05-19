import React from 'react'

interface SegmentedControlProps {
  options: { label: string; value: string }[]
  selected: string
  onChange: (value: string) => void
}

export const SegmentedControl: React.FC<SegmentedControlProps> = ({ options, selected, onChange }) => {
  return (
    <div className="segmented">
      {options.map((opt) => (
        <button
          key={opt.value}
          className={selected === opt.value ? 'selected' : ''}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
