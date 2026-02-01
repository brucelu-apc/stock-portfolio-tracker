import {
  Box,
  SimpleGrid,
  Text,
  Heading,
  Flex,
  HStack,
  Icon,
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
import { motion } from 'framer-motion'

interface Props {
  data: AggregatedHolding[]
}

const COLORS = [
  '#0EA5E9', '#8B5CF6', '#EC4899', '#F59E0B', 
  '#10B981', '#6366F1', '#D946EF', '#14B8A6'
]

const MotionBox = motion(Box)

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
    <SimpleGrid columns={{ base: 1, md: 2 }} spacing={8} mb={8}>
      {/* Region Chart */}
      <MotionBox 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        bg="white" p={8} rounded="3xl" shadow="xl" border="1px" borderColor="gray.50"
      >
        <Heading size="sm" mb={6} fontWeight="extrabold" letterSpacing="tight">資產分佈 (市場)</Heading>
        <Box h="300px" w="full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={regionData}
                innerRadius={70}
                outerRadius={90}
                paddingAngle={8}
                dataKey="value"
                stroke="none"
              >
                {regionData.map((_entry: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ borderRadius: '15px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}
                formatter={(value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} 
              />
              <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
            </PieChart>
          </ResponsiveContainer>
        </Box>
      </MotionBox>

      {/* Symbol Chart */}
      <MotionBox 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        bg="white" p={8} rounded="3xl" shadow="xl" border="1px" borderColor="gray.50"
      >
        <Heading size="sm" mb={6} fontWeight="extrabold" letterSpacing="tight">投資權重 (股票)</Heading>
        <Box h="300px" w="full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={symbolData}
                innerRadius={70}
                outerRadius={90}
                paddingAngle={8}
                dataKey="value"
                stroke="none"
              >
                {symbolData.map((_entry: any, index: number) => (
                  <Cell key={`cell-${index}`} fill={COLORS[(index + 3) % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ borderRadius: '15px', border: 'none', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}
                formatter={(value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} 
              />
              <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
            </PieChart>
          </ResponsiveContainer>
        </Box>
      </MotionBox>
    </SimpleGrid>
  )
}
