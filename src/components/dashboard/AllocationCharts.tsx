import {
  Box,
  SimpleGrid,
  Text,
  Heading,
  Flex,
  HStack,
  Switch,
  FormControl,
  FormLabel,
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
import { useState } from 'react'

interface Props {
  data: AggregatedHolding[]
}

const COLORS = [
  '#0EA5E9', '#8B5CF6', '#EC4899', '#F59E0B', 
  '#10B981', '#6366F1', '#D946EF', '#14B8A6'
]

const MotionBox = motion(Box)

export const AllocationCharts = ({ data }: Props) => {
  const [viewMode, setViewMode] = useState<'marketValue' | 'totalCost'>('marketValue')

  const isMarketView = viewMode === 'marketValue'

  // Helper to format currency
  const formatValue = (val: number) => 
    `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

  // 1. Region Allocation
  const regionData = data.reduce((acc: any[], curr) => {
    const value = isMarketView ? curr.marketValue : curr.totalCost
    const name = curr.region === 'TPE' ? '台股' : '美股'
    const existing = acc.find(i => i.name === name)
    if (existing) {
      existing.value += value
    } else {
      acc.push({ name, value })
    }
    return acc
  }, [])

  // 2. Sector Allocation
  const sectorDataMap = data.reduce((acc: any, curr) => {
    const value = isMarketView ? curr.marketValue : curr.totalCost
    const sector = curr.sector || "Unknown"
    acc[sector] = (acc[sector] || 0) + value
    return acc
  }, {})

  const sectorData = Object.keys(sectorDataMap).map(name => ({
    name,
    value: sectorDataMap[name]
  })).sort((a, b) => b.value - a.value)

  // 3. Symbol Allocation (Top 7 + Others)
  const sortedSymbolData = [...data]
    .map(i => ({ 
      name: i.ticker, 
      value: isMarketView ? i.marketValue : i.totalCost 
    }))
    .sort((a, b) => b.value - a.value)

  const symbolData = sortedSymbolData.slice(0, 7)
  if (sortedSymbolData.length > 7) {
    const othersValue = sortedSymbolData.slice(7).reduce((sum, i) => sum + i.value, 0)
    symbolData.push({ name: '其他', value: othersValue })
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <Box bg="white" p={3} rounded="xl" shadow="2xl" border="1px" borderColor="gray.100">
          <Text fontWeight="bold" color="ui.navy">{payload[0].name}</Text>
          <Text color="brand.500" fontWeight="extrabold">{formatValue(payload[0].value)}</Text>
        </Box>
      )
    }
    return null
  }

  return (
    <Box mb={8}>
      <Flex justify="flex-end" mb={6}>
        <FormControl display="flex" alignItems="center" w="auto" bg="white" px={4} py={2} rounded="full" shadow="sm">
          <FormLabel htmlFor="view-mode" mb="0" fontSize="xs" fontWeight="bold" color="ui.slate">
            {isMarketView ? '顯示市值占比' : '顯示成本占比'}
          </FormLabel>
          <Switch 
            id="view-mode" 
            isChecked={isMarketView} 
            onChange={(e) => setViewMode(e.target.checked ? 'marketValue' : 'totalCost')}
          />
        </FormControl>
      </Flex>

      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={6}>
        {/* Region Donut */}
        <MotionBox 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          bg="white" p={6} rounded="3xl" shadow="xl" border="1px" borderColor="gray.50"
        >
          <Heading size="xs" mb={4} color="ui.slate" textTransform="uppercase" letterSpacing="widest">市場比例</Heading>
          <Box h="250px" w="full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={regionData} innerRadius={60} outerRadius={80} paddingAngle={5}
                  dataKey="value" stroke="none"
                >
                  {regionData.map((_entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="bottom" align="center" iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </Box>
        </MotionBox>

        {/* Sector Donut */}
        <MotionBox 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
          bg="white" p={6} rounded="3xl" shadow="xl" border="1px" borderColor="gray.50"
        >
          <Heading size="xs" mb={4} color="ui.slate" textTransform="uppercase" letterSpacing="widest">產業分布</Heading>
          <Box h="250px" w="full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={sectorData} innerRadius={60} outerRadius={80} paddingAngle={5}
                  dataKey="value" stroke="none"
                >
                  {sectorData.map((_entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="bottom" align="center" iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </Box>
        </MotionBox>

        {/* Symbol Donut */}
        <MotionBox 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          bg="white" p={6} rounded="3xl" shadow="xl" border="1px" borderColor="gray.50"
        >
          <Heading size="xs" mb={4} color="ui.slate" textTransform="uppercase" letterSpacing="widest">持倉權重</Heading>
          <Box h="250px" w="full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={symbolData} innerRadius={60} outerRadius={80} paddingAngle={5}
                  dataKey="value" stroke="none"
                >
                  {symbolData.map((_entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[(index + 4) % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
                <Legend verticalAlign="bottom" align="center" iconType="circle" />
              </PieChart>
            </ResponsiveContainer>
          </Box>
        </MotionBox>
      </SimpleGrid>
    </Box>
  )
}
