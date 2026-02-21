/**
 * AdvisoryTable — Displays advisory-tracked stocks with defense/target prices.
 *
 * Shows:
 *  - Stock ticker/name with message type badge
 *  - Current price (live via Realtime) with change indicator
 *  - Defense price + distance % (red when close)
 *  - Min target range + distance %
 *  - Reasonable target range
 *  - Entry price
 *  - Tracking status (watching/entered/exited/ignored)
 *  - Link indicator if stock is also in portfolio_holdings
 *
 * Data sources:
 *  - price_targets (where is_latest = true)
 *  - market_data (current prices)
 *  - advisory_tracking (user status per ticker)
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Box,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  Badge,
  Text,
  HStack,
  VStack,
  Flex,
  Select,
  Skeleton,
  Tooltip,
  useToast,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  Tag,
  TagLabel,
} from '@chakra-ui/react'
import { TriangleUpIcon, TriangleDownIcon, CheckIcon } from '@chakra-ui/icons'
import { supabase } from '../../services/supabase'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'

// ─── Types ──────────────────────────────────────────────────

interface PriceTarget {
  id: string
  ticker: string
  stock_name?: string | null
  defense_price: number | null
  min_target_low: number | null
  min_target_high: number | null
  reasonable_target_low: number | null
  reasonable_target_high: number | null
  entry_price: number | null
  strategy_notes: string | null
  effective_date: string
  created_at: string
}

interface TrackingStatus {
  ticker: string
  tracking_status: 'watching' | 'entered' | 'exited' | 'ignored'
  notes: string | null
}

interface MarketPrice {
  ticker: string
  current_price: number
  prev_close: number
  day_high: number | null
  day_low: number | null
  updated_at: string
}

// ─── Config ─────────────────────────────────────────────────

const TRACKING_STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  watching: { label: '觀察中', color: 'blue' },
  entered: { label: '已進場', color: 'green' },
  exited: { label: '已出場', color: 'gray' },
  ignored: { label: '略過', color: 'gray' },
}

// ─── Helpers ────────────────────────────────────────────────

/** Calculate distance percentage from current price to target price */
function distancePct(current: number, target: number): number {
  if (!target || target === 0) return 0
  return ((current - target) / target) * 100
}

/** Color for defense distance: red if within 5%, orange if within 10% */
function defenseDistColor(pct: number): string {
  if (pct <= 0) return 'red.600'      // Below defense — DANGER
  if (pct <= 3) return 'red.500'      // Very close
  if (pct <= 5) return 'orange.500'   // Approaching
  return 'ui.slate'                    // Safe distance
}

/** Color for target distance: green if close to target */
function targetDistColor(pct: number): string {
  if (pct >= 0) return 'green.600'    // Reached target
  if (pct >= -3) return 'green.500'   // Very close
  if (pct >= -5) return 'teal.500'    // Approaching
  return 'ui.slate'                    // Far from target
}

// ─── Component ──────────────────────────────────────────────

interface AdvisoryTableProps {
  userId: string
  holdings?: any[]  // portfolio_holdings for cross-reference
}

export const AdvisoryTable = ({ userId, holdings = [] }: AdvisoryTableProps) => {
  const toast = useToast()
  const [priceTargets, setPriceTargets] = useState<PriceTarget[]>([])
  const [trackingMap, setTrackingMap] = useState<Record<string, TrackingStatus>>({})
  const [marketPrices, setMarketPrices] = useState<Record<string, MarketPrice>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Set of tickers held in portfolio
  const heldTickers = useMemo(
    () => new Set(holdings.map((h: any) => h.ticker)),
    [holdings]
  )

  // ── Fetch initial data ──

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [targetsRes, trackingRes, marketRes] = await Promise.all([
        supabase
          .from('price_targets')
          .select('*')
          .eq('is_latest', true)
          .order('created_at', { ascending: false }),
        supabase
          .from('advisory_tracking')
          .select('*'),
        supabase
          .from('market_data')
          .select('*'),
      ])

      if (targetsRes.data) setPriceTargets(targetsRes.data)
      if (trackingRes.data) {
        const map: Record<string, TrackingStatus> = {}
        trackingRes.data.forEach((t: TrackingStatus) => { map[t.ticker] = t })
        setTrackingMap(map)
      }
      if (marketRes.data) {
        const map: Record<string, MarketPrice> = {}
        marketRes.data.forEach((m: any) => { map[m.ticker] = m })
        setMarketPrices(map)
      }
    } catch (err) {
      console.error('Failed to fetch advisory data:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // ── Realtime subscriptions ──

  useRealtimeSubscription({
    onMarketDataChange: (payload) => {
      const row = payload.new
      if (row?.ticker) {
        setMarketPrices((prev) => ({
          ...prev,
          [row.ticker]: row,
        }))
      }
    },
    onPriceTargetChange: () => {
      // Re-fetch targets when they change
      supabase
        .from('price_targets')
        .select('*')
        .eq('is_latest', true)
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          if (data) setPriceTargets(data)
        })
    },
    onTrackingChange: (payload) => {
      const row = payload.new
      if (row?.ticker) {
        setTrackingMap((prev) => ({
          ...prev,
          [row.ticker]: row,
        }))
      }
    },
  })

  // ── Update tracking status ──

  const updateTrackingStatus = async (
    ticker: string,
    status: 'watching' | 'entered' | 'exited' | 'ignored'
  ) => {
    const { error } = await supabase
      .from('advisory_tracking')
      .upsert(
        { user_id: userId, ticker, tracking_status: status },
        { onConflict: 'user_id,ticker' }
      )

    if (error) {
      toast({ title: '更新失敗', description: error.message, status: 'error', duration: 3000 })
    } else {
      setTrackingMap((prev) => ({
        ...prev,
        [ticker]: { ticker, tracking_status: status, notes: prev[ticker]?.notes || null },
      }))
      toast({
        title: '狀態已更新',
        description: `${ticker} → ${TRACKING_STATUS_CONFIG[status].label}`,
        status: 'success',
        duration: 2000,
      })
    }
  }

  // ── Filtered & sorted data ──

  const filteredTargets = useMemo(() => {
    if (statusFilter === 'all') return priceTargets
    return priceTargets.filter((t) => {
      const status = trackingMap[t.ticker]?.tracking_status || 'watching'
      return status === statusFilter
    })
  }, [priceTargets, trackingMap, statusFilter])

  // ── Render ──

  return (
    <Box bg="white" p={{ base: 4, md: 8 }} rounded="3xl" shadow="2xl" border="1px" borderColor="gray.50">
      {/* Header */}
      <Flex justify="space-between" align={{ base: 'start', md: 'center' }} mb={6} direction={{ base: 'column', md: 'row' }} gap={3}>
        <VStack align="start" spacing={1}>
          <Text fontSize="lg" fontWeight="extrabold" color="ui.navy">
            投顧追蹤清單
          </Text>
          <Text fontSize="xs" color="ui.slate">
            即時監控防守價與目標價距離
          </Text>
        </VStack>
        <HStack spacing={3} w={{ base: 'full', md: 'auto' }}>
          <Select
            size="sm"
            rounded="xl"
            w={{ base: 'full', md: '140px' }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">全部狀態</option>
            <option value="watching">觀察中</option>
            <option value="entered">已進場</option>
            <option value="exited">已出場</option>
            <option value="ignored">略過</option>
          </Select>
          <Badge colorScheme="blue" rounded="full" px={3} py={1} fontSize="xs">
            {filteredTargets.length} 檔
          </Badge>
        </HStack>
      </Flex>

      {/* Table */}
      <TableContainer>
        <Table variant="simple" size="sm">
          <Thead bg="gray.50">
            <Tr>
              <Th>股票</Th>
              <Th isNumeric>現價</Th>
              <Th isNumeric>防守價</Th>
              <Th isNumeric>距防守%</Th>
              <Th isNumeric>最小漲幅</Th>
              <Th isNumeric>距目標%</Th>
              <Th isNumeric>合理漲幅</Th>
              <Th isNumeric>建議買進</Th>
              <Th>狀態</Th>
            </Tr>
          </Thead>
          <Tbody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <Tr key={i}>
                  {[...Array(9)].map((_, j) => (
                    <Td key={j}><Skeleton h="18px" /></Td>
                  ))}
                </Tr>
              ))
            ) : filteredTargets.length === 0 ? (
              <Tr>
                <Td colSpan={9} textAlign="center" py={10} color="ui.slate">
                  尚未匯入投顧追蹤標的。請先在上方貼上通知文字並匯入。
                </Td>
              </Tr>
            ) : (
              filteredTargets.map((target) => {
                const price = marketPrices[target.ticker]
                const currentPrice = price?.current_price || 0
                const prevClose = price?.prev_close || currentPrice
                const hasPriceData = currentPrice > 0

                // Price change indicators
                const priceChange = hasPriceData ? currentPrice - prevClose : 0
                const isUp = priceChange > 0.001
                const isDown = priceChange < -0.001

                // Distance calculations
                const defDist = target.defense_price && hasPriceData
                  ? distancePct(currentPrice, target.defense_price)
                  : null

                const minTargetMid = target.min_target_low && target.min_target_high
                  ? (target.min_target_low + target.min_target_high) / 2
                  : null
                const minDist = minTargetMid && hasPriceData
                  ? distancePct(currentPrice, minTargetMid)
                  : null

                // Tracking status
                const tracking = trackingMap[target.ticker]
                const status = tracking?.tracking_status || 'watching'
                const statusConfig = TRACKING_STATUS_CONFIG[status]

                // Is held in portfolio?
                const isHeld = heldTickers.has(target.ticker)

                return (
                  <Tr
                    key={target.id}
                    _hover={{ bg: 'gray.50' }}
                    opacity={status === 'ignored' || status === 'exited' ? 0.5 : 1}
                  >
                    {/* Ticker + Name */}
                    <Td>
                      <HStack spacing={2}>
                        <VStack align="start" spacing={0}>
                          <HStack spacing={1}>
                            <Text fontWeight="bold" fontSize="sm">{target.ticker}</Text>
                            {isHeld && (
                              <Tooltip label="此股票也在您的投資組合中">
                                <Badge colorScheme="purple" fontSize="9px" rounded="full">
                                  持有
                                </Badge>
                              </Tooltip>
                            )}
                          </HStack>
                          {target.stock_name && (
                            <Text fontSize="xs" color="gray.500" noOfLines={1}>
                              {target.stock_name}
                            </Text>
                          )}
                        </VStack>
                      </HStack>
                    </Td>

                    {/* Current Price */}
                    <Td isNumeric>
                      {hasPriceData ? (
                        <HStack justify="flex-end" spacing={0}>
                          {isUp && <TriangleUpIcon color="red.500" boxSize={2} mr={1} />}
                          {isDown && <TriangleDownIcon color="green.500" boxSize={2} mr={1} />}
                          <Text
                            fontWeight="bold"
                            color={isUp ? 'red.500' : isDown ? 'green.500' : 'ui.navy'}
                          >
                            {currentPrice.toFixed(2)}
                          </Text>
                        </HStack>
                      ) : (
                        <Text color="gray.400">—</Text>
                      )}
                    </Td>

                    {/* Defense Price */}
                    <Td isNumeric>
                      {target.defense_price ? (
                        <Text fontWeight="semibold" color="red.500">
                          {target.defense_price.toFixed(1)}
                        </Text>
                      ) : (
                        <Text color="gray.400">—</Text>
                      )}
                    </Td>

                    {/* Distance to Defense */}
                    <Td isNumeric>
                      {defDist !== null ? (
                        <Tooltip label={defDist <= 0 ? '已跌破防守價！' : `距離防守價 ${defDist.toFixed(1)}%`}>
                          <Text fontWeight="bold" color={defenseDistColor(defDist)} fontSize="sm">
                            {defDist > 0 ? '+' : ''}{defDist.toFixed(1)}%
                          </Text>
                        </Tooltip>
                      ) : (
                        <Text color="gray.400">—</Text>
                      )}
                    </Td>

                    {/* Min Target Range */}
                    <Td isNumeric>
                      {target.min_target_low ? (
                        <Text fontSize="xs" color="green.600" fontWeight="medium">
                          {target.min_target_low}~{target.min_target_high}
                        </Text>
                      ) : (
                        <Text color="gray.400">—</Text>
                      )}
                    </Td>

                    {/* Distance to Min Target */}
                    <Td isNumeric>
                      {minDist !== null ? (
                        <Tooltip label={minDist >= 0 ? '已達最小目標！' : `距最小目標 ${Math.abs(minDist).toFixed(1)}%`}>
                          <Text fontWeight="bold" color={targetDistColor(minDist)} fontSize="sm">
                            {minDist > 0 ? '+' : ''}{minDist.toFixed(1)}%
                          </Text>
                        </Tooltip>
                      ) : (
                        <Text color="gray.400">—</Text>
                      )}
                    </Td>

                    {/* Reasonable Target Range */}
                    <Td isNumeric>
                      {target.reasonable_target_low ? (
                        <Text fontSize="xs" color="orange.600" fontWeight="medium">
                          {target.reasonable_target_low}~{target.reasonable_target_high}
                        </Text>
                      ) : (
                        <Text color="gray.400">—</Text>
                      )}
                    </Td>

                    {/* Entry Price */}
                    <Td isNumeric>
                      {target.entry_price ? (
                        <Text fontSize="sm" color="blue.600" fontWeight="medium">
                          ≤{target.entry_price}
                        </Text>
                      ) : (
                        <Text color="gray.400">—</Text>
                      )}
                    </Td>

                    {/* Tracking Status */}
                    <Td>
                      <Menu>
                        <MenuButton as={Tag} size="sm" colorScheme={statusConfig.color} rounded="full" cursor="pointer" _hover={{ opacity: 0.8 }}>
                          <TagLabel fontSize="xs">{statusConfig.label}</TagLabel>
                        </MenuButton>
                        <MenuList rounded="xl" shadow="xl" minW="120px" p={1}>
                          {Object.entries(TRACKING_STATUS_CONFIG).map(([key, cfg]) => (
                            <MenuItem
                              key={key}
                              rounded="lg"
                              fontSize="sm"
                              fontWeight={status === key ? 'bold' : 'normal'}
                              onClick={() => updateTrackingStatus(target.ticker, key as any)}
                            >
                              <Badge colorScheme={cfg.color} mr={2} rounded="full" px={2}>
                                {cfg.label}
                              </Badge>
                              {status === key && <CheckIcon boxSize={3} color="green.500" />}
                            </MenuItem>
                          ))}
                        </MenuList>
                      </Menu>
                    </Td>
                  </Tr>
                )
              })
            )}
          </Tbody>
        </Table>
      </TableContainer>
    </Box>
  )
}
