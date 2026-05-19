import React from 'react'
import ReactEChartsCore from 'echarts-for-react/lib/core'
import * as echarts from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

interface DonutData {
  name: string
  value: number
  color: string
}

interface DonutChartProps {
  data: DonutData[]
  height?: number
}

export const DonutChart: React.FC<DonutChartProps> = ({ data, height = 300 }) => {
  const option = {
    tooltip: {
      trigger: 'item' as const,
      formatter: '{b}: {c} ({d}%)'
    },
    legend: {
      orient: 'vertical' as const,
      right: 10,
      top: 'center',
      textStyle: { fontSize: 13, color: '#687887' }
    },
    series: [
      {
        type: 'pie',
        radius: ['55%', '80%'],
        center: ['40%', '50%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 4,
          borderColor: '#fff',
          borderWidth: 2
        },
        label: { show: false },
        emphasis: {
          label: { show: true, fontSize: 14, fontWeight: 'bold' }
        },
        data: data.map((d) => ({
          name: d.name,
          value: d.value,
          itemStyle: { color: d.color }
        }))
      }
    ]
  }

  return <ReactEChartsCore echarts={echarts} option={option} style={{ height, width: '100%' }} />
}
