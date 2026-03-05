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
  VStack,
  Badge,
  Button,
  Collapse,
} from '@chakra-ui/react'
import { ChevronDownIcon, ChevronUpIcon } from '@chakra-ui/icons'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Sector,
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
  const [activeRegion, setActiveRegion] = useState<number | undefined>()
  const [activeSector, setActiveSector] = useState<number | undefined>()
  const [activeSymbol, setActiveSymbol] = useState<number | undefined>()
  const [isExpanded, setIsExpanded] = useState(true)

  const isMarketView = viewMode === 'marketValue'

  // Format currency compactly (e.g. $1.2M, $450K)
  const formatCompact = (val: number) => {
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
    if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`
    return `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  }

  // Format full currency with commas for tooltip
  const formatFull = (val: number) =>
    `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

  // ── Data preparation ──────────────────────────────────────────

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
    const sector = curr.sector || 'Unknown'
    acc[sector] = (acc[sector] || 0) + value
    return acc
  }, {})

  const sectorData = Object.keys(sectorDataMap)
    .map(name => ({ name, value: sectorDataMap[name] }))
    .sort((a, b) => b.value - a.value)

  // 3. Symbol Allocation (Top 7 + Others) — display as "公司名稱(代碼)"
  const sortedSymbolData = [...data]
    .map(i => ({
      name: i.name ? `${i.name}(${i.ticker})` : i.ticker,
      value: isMarketView ? i.marketValue : i.totalCost,
    }))
    .sort((a, b) => b.value - a.value)

  const symbolData = sortedSymbolData.slice(0, 7)
  if (sortedSymbolData.length > 7) {
    const othersValue = sortedSymbolData.slice(7).reduce((sum, i) => sum + i.value, 0)
    symbolData.push({ name: '其他', value: othersValue })
  }

  // Totals for percentage calculation (Recharts 3.x no longer injects percent into payload)
  const regionTotal = regionData.reduce((s, i) => s + i.value, 0)
  const sectorTotal = sectorData.reduce((s, i) => s + i.value, 0)
  const symbolTotal = symbolData.reduce((s, i) => s + i.value, 0)

  // ── Tooltip factory — each chart gets its own total via closure ─

  const makeTooltip = (total: number) => ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const pct = total > 0 ? ((payload[0].value / total) * 100).toFixed(1) : '0.0'
      return (
        <Box bg="white" p={3} rounded="xl" shadow="2xl" border="1px" borderColor="gray.100" minW="150px">
          <Text fontWeight="bold" color="ui.navy" mb={1} fontSize="sm">{payload[0].name}</Text>
          <Text color="brand.500" fontWeight="extrabold" fontSize="md">{formatFull(payload[0].value)}</Text>
          <Text fontSize="xs" color="ui.slate" mt={0.5}>{pct}% 占比</Text>
        </Box>
      )
    }
    return null
  }

  // ── Active Slice (hover highlight — solid pie version) ────────

  const renderActiveShape = (props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props
    return (
      <g>
        <Sector
          cx={cx} cy={cy}
          innerRadius={innerRadius}
          outerRadius={outerRadius + 7}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
        />
      </g>
    )
  }

  // Recharts 3.x: spread hover props as `any` to bypass strict types
  const hoverProps = (
    activeIndex: number | undefined,
    onEnter: (_: any, i: number) => void,
    onLeave: () => void,
  ) => ({
    activeIndex,
    activeShape: renderActiveShape,
    onMouseEnter: onEnter,
    onMouseLeave: onLeave,
  } as any)

  // ── Custom Legend below each chart ────────────────────────────

  const CustomLegend = ({
    chartData,
    colorOffset = 0,
  }: {
    chartData: { name: string; value: number }[]
    colorOffset?: number
  }) => {
    const total = chartData.reduce((s, i) => s + i.value, 0)

    return (
      <Box
        mt={4} pt={3}
        borderTop="1px solid" borderColor="gray.100"
        maxH="130px"
        overflowY="auto"
        sx={{
          '&::-webkit-scrollbar': { width: '4px' },
          '&::-webkit-scrollbar-track': { background: 'transparent' },
          '&::-webkit-scrollbar-thumb': { background: '#CBD5E0', borderRadius: '2px' },
          '&::-webkit-scrollbar-thumb:hover': { background: '#A0AEC0' },
        }}
      >
        <VStack spacing={1.5} align="stretch" pr={1}>
          {chartData.map((item, index) => (
            <Flex key={item.name} justify="space-between" align="center">
              <HStack spacing={2} minW={0} flex={1}>
                <Box
                  w={2.5} h={2.5} rounded="full" flexShrink={0}
                  bg={COLORS[(index + colorOffset) % COLORS.length]}
                />
                <Text
                  fontSize="xs" color="ui.navy" fontWeight="medium"
                  isTruncated maxW="120px" title={item.name}
                >
                  {item.name}
                </Text>
              </HStack>
              <HStack spacing={2} flexShrink={0}>
                <Text fontSize="xs" color="ui.slate" fontWeight="medium">
                  {((item.value / total) * 100).toFixed(1)}%
                </Text>
                <Badge fontSize="10px" colorScheme="blue" variant="subtle" px={1.5}>
                  {formatCompact(item.value)}
                </Badge>
              </HStack>
            </Flex>
          ))}
        </VStack>
      </Box>
    )
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <Box mb={8}>
      {/* Header row: title + view-mode toggle + collapse button */}
      <Flex justify="space-between" align="center" mb={isExpanded ? 6 : 2}>
        <HStack spacing={3}>
          <Text fontWeight="extrabold" fontSize="sm" color="ui.navy" letterSpacing="wide">
            資產配置分析
          </Text>
          <Button
            size="xs"
            variant="ghost"
            color="ui.slate"
            rightIcon={isExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
            onClick={() => setIsExpanded(v => !v)}
            _hover={{ bg: 'gray.100' }}
            fontWeight="medium"
          >
            {isExpanded ? '收起' : '展開'}
          </Button>
        </HStack>

        {isExpanded && (
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
        )}
      </Flex>

      <Collapse in={isExpanded} animateOpacity>
        <SimpleGrid columns={{ base: 1, md: 3 }} spacing={6}>

          {/* ── 市場比例 ── */}
          <MotionBox
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
            bg="white" p={6} rounded="3xl" shadow="xl" border="1px" borderColor="gray.50"
          >
            <Heading size="xs" mb={4} color="ui.slate" textTransform="uppercase" letterSpacing="widest">
              市場比例
            </Heading>
            <Box h="210px" w="full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={regionData}
                    innerRadius={0} outerRadius={85} paddingAngle={3}
                    dataKey="value" stroke="white" strokeWidth={2}
                    {...hoverProps(activeRegion, (_, i) => setActiveRegion(i), () => setActiveRegion(undefined))}
                  >
                    {regionData.map((_entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={makeTooltip(regionTotal)} />
                </PieChart>
              </ResponsiveContainer>
            </Box>
            <CustomLegend chartData={regionData} colorOffset={0} />
          </MotionBox>

          {/* ── 產業分布 ── */}
          <MotionBox
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            bg="white" p={6} rounded="3xl" shadow="xl" border="1px" borderColor="gray.50"
          >
            <Heading size="xs" mb={4} color="ui.slate" textTransform="uppercase" letterSpacing="widest">
              產業分布
            </Heading>
            <Box h="210px" w="full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sectorData}
                    innerRadius={0} outerRadius={85} paddingAngle={3}
                    dataKey="value" stroke="white" strokeWidth={2}
                    {...hoverProps(activeSector, (_, i) => setActiveSector(i), () => setActiveSector(undefined))}
                  >
                    {sectorData.map((_entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={makeTooltip(sectorTotal)} />
                </PieChart>
              </ResponsiveContainer>
            </Box>
            <CustomLegend chartData={sectorData} colorOffset={2} />
          </MotionBox>

          {/* ── 持倉權重 ── */}
          <MotionBox
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            bg="white" p={6} rounded="3xl" shadow="xl" border="1px" borderColor="gray.50"
          >
            <Heading size="xs" mb={4} color="ui.slate" textTransform="uppercase" letterSpacing="widest">
              持倉權重
            </Heading>
            <Box h="210px" w="full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={symbolData}
                    innerRadius={0} outerRadius={85} paddingAngle={3}
                    dataKey="value" stroke="white" strokeWidth={2}
                    {...hoverProps(activeSymbol, (_, i) => setActiveSymbol(i), () => setActiveSymbol(undefined))}
                  >
                    {symbolData.map((_entry: any, index: number) => (
                      <Cell key={`cell-${index}`} fill={COLORS[(index + 4) % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={makeTooltip(symbolTotal)} />
                </PieChart>
              </ResponsiveContainer>
            </Box>
            <CustomLegend chartData={symbolData} colorOffset={4} />
          </MotionBox>

        </SimpleGrid>
      </Collapse>
    </Box>
  )
}
