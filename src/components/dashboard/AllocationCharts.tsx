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
} from '@chakra-ui/react'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Label,
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

  const isMarketView = viewMode === 'marketValue'

  // Format currency compactly (e.g. $1.2M, $450K)
  const formatCompact = (val: number) => {
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`
    if (val >= 1_000) return `$${(val / 1_000).toFixed(0)}K`
    return `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  }

  // Format full currency with commas
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

  // 3. Symbol Allocation (Top 7 + Others)
  const sortedSymbolData = [...data]
    .map(i => ({
      name: i.ticker,
      value: isMarketView ? i.marketValue : i.totalCost,
    }))
    .sort((a, b) => b.value - a.value)

  const symbolData = sortedSymbolData.slice(0, 7)
  if (sortedSymbolData.length > 7) {
    const othersValue = sortedSymbolData.slice(7).reduce((sum, i) => sum + i.value, 0)
    symbolData.push({ name: '其他', value: othersValue })
  }

  // Totals for center labels
  const regionTotal = regionData.reduce((s, i) => s + i.value, 0)
  const sectorTotal = sectorData.reduce((s, i) => s + i.value, 0)
  const symbolTotal = symbolData.reduce((s, i) => s + i.value, 0)

  // ── Custom Tooltip ────────────────────────────────────────────

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const pct = ((payload[0].percent || 0) * 100).toFixed(1)
      return (
        <Box bg="white" p={3} rounded="xl" shadow="2xl" border="1px" borderColor="gray.100" minW="140px">
          <Text fontWeight="bold" color="ui.navy" mb={1}>{payload[0].name}</Text>
          <Text color="brand.500" fontWeight="extrabold" fontSize="md">{formatFull(payload[0].value)}</Text>
          <Text fontSize="sm" color="ui.slate" mt={0.5}>{pct}% 占比</Text>
        </Box>
      )
    }
    return null
  }

  // ── Center Label (SVG text inside donut hole) ─────────────────

  const CenterLabel = ({ viewBox, total, label }: any) => {
    const { cx, cy } = viewBox || { cx: 0, cy: 0 }
    return (
      <g>
        <text
          x={cx} y={cy - 8}
          textAnchor="middle" dominantBaseline="central"
          fontSize={10} fill="#94A3B8"
        >
          {label}
        </text>
        <text
          x={cx} y={cy + 10}
          textAnchor="middle" dominantBaseline="central"
          fontSize={15} fontWeight="bold" fill="#0F172A"
        >
          {formatCompact(total)}
        </text>
      </g>
    )
  }

  // ── Active Slice (hover highlight) ───────────────────────────

  const renderActiveShape = (props: any) => {
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props
    return (
      <g>
        <Sector
          cx={cx} cy={cy}
          innerRadius={innerRadius - 3}
          outerRadius={outerRadius + 6}
          startAngle={startAngle}
          endAngle={endAngle}
          fill={fill}
        />
      </g>
    )
  }

  // Recharts 3.x activeShape/onMouseEnter props — spread as `any` to bypass strict types
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
    const shown = chartData.slice(0, 5)
    const rest = chartData.length - shown.length

    return (
      <VStack spacing={1.5} align="stretch" mt={4} pt={3} borderTop="1px solid" borderColor="gray.100">
        {shown.map((item, index) => (
          <Flex key={item.name} justify="space-between" align="center">
            <HStack spacing={2} minW={0} flex={1}>
              <Box
                w={2.5} h={2.5} rounded="full" flexShrink={0}
                bg={COLORS[(index + colorOffset) % COLORS.length]}
              />
              <Text
                fontSize="xs" color="ui.navy" fontWeight="medium"
                isTruncated maxW="110px" title={item.name}
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
        {rest > 0 && (
          <Text fontSize="10px" color="ui.slate" textAlign="right" fontStyle="italic">
            +{rest} 個項目
          </Text>
        )}
      </VStack>
    )
  }

  // ── Render ────────────────────────────────────────────────────

  return (
    <Box mb={8}>
      {/* View mode toggle */}
      <Flex justify="flex-end" mb={6}>
        <FormControl
          display="flex" alignItems="center" w="auto"
          bg="white" px={4} py={2} rounded="full" shadow="sm"
        >
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
                  innerRadius={62} outerRadius={85} paddingAngle={5}
                  dataKey="value" stroke="none"
                  {...hoverProps(activeRegion, (_, i) => setActiveRegion(i), () => setActiveRegion(undefined))}
                >
                  {regionData.map((_entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                  <Label
                    content={(props: any) => (
                      <CenterLabel viewBox={props.viewBox} total={regionTotal} label="總市值" />
                    )}
                    position="center"
                  />
                </Pie>
                <Tooltip content={<CustomTooltip />} />
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
                  innerRadius={62} outerRadius={85} paddingAngle={5}
                  dataKey="value" stroke="none"
                  {...hoverProps(activeSector, (_, i) => setActiveSector(i), () => setActiveSector(undefined))}
                >
                  {sectorData.map((_entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[(index + 2) % COLORS.length]} />
                  ))}
                  <Label
                    content={(props: any) => (
                      <CenterLabel viewBox={props.viewBox} total={sectorTotal} label="總市值" />
                    )}
                    position="center"
                  />
                </Pie>
                <Tooltip content={<CustomTooltip />} />
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
                  innerRadius={62} outerRadius={85} paddingAngle={5}
                  dataKey="value" stroke="none"
                  {...hoverProps(activeSymbol, (_, i) => setActiveSymbol(i), () => setActiveSymbol(undefined))}
                >
                  {symbolData.map((_entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[(index + 4) % COLORS.length]} />
                  ))}
                  <Label
                    content={(props: any) => (
                      <CenterLabel viewBox={props.viewBox} total={symbolTotal} label="持倉總值" />
                    )}
                    position="center"
                  />
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </Box>
          <CustomLegend chartData={symbolData} colorOffset={4} />
        </MotionBox>

      </SimpleGrid>
    </Box>
  )
}
