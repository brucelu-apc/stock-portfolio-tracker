import {
  Box,
  SimpleGrid,
  Text,
  Heading,
  VStack,
} from '@chakra-ui/react'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { AggregatedHolding } from '../../utils/calculations'

interface Props {
  data: AggregatedHolding[]
}

const COLORS = [
  '#3182CE', '#38A169', '#E53E3E', '#D69E2E', 
  '#805AD5', '#319795', '#D53F8C', '#2B6CB0'
]

export const AllocationCharts = ({ data }: Props) => {
  // 1. Region Allocation
  const regionData = data.reduce((acc: any[], curr) => {
    const existing = acc.find(i => i.name === curr.region)
    if (existing) {
      existing.value += curr.marketValue
    } else {
      acc.push({ name: curr.region === 'TPE' ? '台股' : '美股', value: curr.marketValue })
    }
    return acc
  }, [])

  // 2. Symbol Allocation (Top 8 + Others)
  const sortedData = [...data]
    .sort((a, b) => b.marketValue - a.marketValue)
    .map(i => ({ name: i.ticker, value: i.marketValue }))

  const symbolData = sortedData.slice(0, 7)
  if (sortedData.length > 7) {
    const othersValue = sortedData.slice(7).reduce((sum, i) => sum + i.value, 0)
    symbolData.push({ name: '其他', value: othersValue })
  }

  return (
    <SimpleGrid columns={{ base: 1, md: 2 }} spacing={6} mb={8}>
      {/* Region Chart */}
      <Box bg="white" p={6} rounded="lg" shadow="sm">
        <Heading size="sm" mb={4} color="gray.600">市場比例 (地區)</Heading>
        <Box h="300px">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={regionData}
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
              >
                {regionData.map((_entry: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </Box>
      </Box>

      {/* Symbol Chart */}
      <Box bg="white" p={6} rounded="lg" shadow="sm">
        <Heading size="sm" mb={4} color="gray.600">持倉占比 (股票)</Heading>
        <Box h="300px">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={symbolData}
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
              >
                {symbolData.map((_entry: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </Box>
      </Box>
    </SimpleGrid>
  )
}
