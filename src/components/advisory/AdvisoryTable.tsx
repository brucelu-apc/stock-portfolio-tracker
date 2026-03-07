/**
 * AdvisoryTable — Displays advisory-tracked stocks with defense/target prices.
 *
 * Shows:
 *  - Checkbox for multi-select delete
 *  - Stock ticker/name with message type badge
 *  - Current price (live via Realtime) with change indicator
 *  - Defense price + distance % (red when close)
 *  - Min target range + distance %
 *  - Reasonable target range
 *  - Entry price
 *  - 導入日期 (effective_date from price_targets)
 *  - Tracking status (watching/entered/exited/ignored)
 *  - Delete action (single row)
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
  Checkbox,
  Button,
  IconButton,
  AlertDialog,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogContent,
  AlertDialogOverlay,
  useDisclosure,
  Input,
} from '@chakra-ui/react'
import {
  TriangleUpIcon,
  TriangleDownIcon,
  CheckIcon,
  DeleteIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
} from '@chakra-ui/icons'
import { useRef } from 'react'
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

const PRESET_PAGE_SIZES = [10, 20, 50]
const DEFAULT_PAGE_SIZE = 20

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

/** Format effective_date to a compact zh-TW string, e.g. 2025/3/15 */
function formatDate(dateStr: string): string {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
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

  // ── Pagination state ──
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE)
  const [currentPageNum, setCurrentPageNum] = useState<number>(1)
  const [customPageSize, setCustomPageSize] = useState<string>('')
  const [showCustomInput, setShowCustomInput] = useState(false)

  // ── Multi-select delete state ──
  const [selectedTickers, setSelectedTickers] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)
  const [pendingDeleteTickers, setPendingDeleteTickers] = useState<string[]>([])
  const { isOpen: isConfirmOpen, onOpen: onConfirmOpen, onClose: onConfirmClose } = useDisclosure()
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Set of tickers held in portfolio
  const heldTickers = useMemo(
    () => new Set(holdings.map((h: any) => h.ticker)),
    [holdings]
  )

  // Fallback name lookup from portfolio holdings
  const holdingsNameMap = useMemo(() => {
    const map: Record<string, string> = {}
    holdings.forEach((h: any) => {
      if (h.name && h.ticker) map[h.ticker] = h.name
    })
    return map
  }, [holdings])

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

  // ── Delete targets ──

  const confirmDelete = (tickers: string[]) => {
    setPendingDeleteTickers(tickers)
    onConfirmOpen()
  }

  const executeDelete = async () => {
    const tickers = pendingDeleteTickers
    if (tickers.length === 0) return
    onConfirmClose()
    setIsDeleting(true)

    try {
      // Delete from both price_targets (all records) and advisory_tracking
      const [targetsRes, trackingRes] = await Promise.all([
        supabase.from('price_targets').delete().in('ticker', tickers),
        supabase.from('advisory_tracking').delete().in('ticker', tickers).eq('user_id', userId),
      ])

      if (targetsRes.error || trackingRes.error) {
        toast({
          title: '刪除失敗',
          description: targetsRes.error?.message || trackingRes.error?.message,
          status: 'error',
          duration: 3000,
        })
      } else {
        // Update local state — remove deleted tickers immediately
        setPriceTargets((prev) => prev.filter((t) => !tickers.includes(t.ticker)))
        setTrackingMap((prev) => {
          const updated = { ...prev }
          tickers.forEach((t) => delete updated[t])
          return updated
        })
        setSelectedTickers(new Set())
        toast({
          title: `已刪除 ${tickers.length} 檔標的`,
          status: 'success',
          duration: 2500,
        })
      }
    } catch (err) {
      console.error('Delete error:', err)
      toast({ title: '刪除失敗', status: 'error', duration: 3000 })
    } finally {
      setIsDeleting(false)
      setPendingDeleteTickers([])
    }
  }

  // ── Checkbox selection helpers ──

  const toggleSelectTicker = (ticker: string) => {
    setSelectedTickers((prev) => {
      const next = new Set(prev)
      if (next.has(ticker)) {
        next.delete(ticker)
      } else {
        next.add(ticker)
      }
      return next
    })
  }

  const toggleSelectAll = () => {
    const allTickers = paginatedTargets.map((t) => t.ticker)
    const allSelected = allTickers.every((t) => selectedTickers.has(t))
    if (allSelected) {
      setSelectedTickers(new Set())
    } else {
      setSelectedTickers(new Set(allTickers))
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

  // ── Pagination computed values ──

  const totalItems = filteredTargets.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))

  // Clamp current page to valid range
  const safePage = Math.min(currentPageNum, totalPages)

  const paginatedTargets = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return filteredTargets.slice(start, start + pageSize)
  }, [filteredTargets, safePage, pageSize])

  // ── Pagination handlers ──

  const handlePageSizeChange = (value: string) => {
    if (value === 'custom') {
      setShowCustomInput(true)
      return
    }
    setShowCustomInput(false)
    const size = parseInt(value, 10)
    if (!isNaN(size) && size > 0) {
      setPageSize(size)
      setCurrentPageNum(1)
    }
  }

  const handleCustomPageSizeSubmit = () => {
    const size = parseInt(customPageSize, 10)
    if (!isNaN(size) && size >= 5 && size <= 200) {
      setPageSize(size)
      setCurrentPageNum(1)
      setShowCustomInput(false)
    } else {
      toast({
        title: '請輸入 5-200 之間的數字',
        status: 'warning',
        duration: 2000,
      })
    }
  }

  // Selection state derived values
  const isCustomSize = !PRESET_PAGE_SIZES.includes(pageSize)
  const allSelected = paginatedTargets.length > 0 && paginatedTargets.every((t) => selectedTickers.has(t.ticker))
  const someSelected = paginatedTargets.some((t) => selectedTickers.has(t.ticker))
  const selectedCount = filteredTargets.filter((t) => selectedTickers.has(t.ticker)).length

  // Total columns: ✓ + 股票 + 現價 + 防守價 + 距防守% + 最小漲幅 + 距目標% + 合理漲幅 + 建議買進 + 導入日期 + 狀態 + 操作 = 12
  const COL_COUNT = 12

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
        <HStack spacing={3} w={{ base: 'full', md: 'auto' }} flexWrap="wrap">
          {/* Bulk delete button — only visible when rows are selected */}
          {selectedCount > 0 && (
            <Button
              size="sm"
              colorScheme="red"
              variant="outline"
              leftIcon={<DeleteIcon />}
              rounded="xl"
              isLoading={isDeleting}
              onClick={() => confirmDelete(filteredTargets.filter((t) => selectedTickers.has(t.ticker)).map((t) => t.ticker))}
            >
              刪除選取 ({selectedCount})
            </Button>
          )}
          <Select
            size="sm"
            rounded="xl"
            w={{ base: 'full', md: '140px' }}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setSelectedTickers(new Set())
              setCurrentPageNum(1)  // reset to first page on filter change
            }}
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

      {/* Table with vertical scroll */}
      <Box overflowX="auto" overflowY="auto" maxH="600px">
        <Table variant="simple" size="sm">
          <Thead bg="gray.50" position="sticky" top={0} zIndex={1}>
            <Tr>
              {/* Select-all checkbox */}
              <Th w="40px" px={2}>
                <Checkbox
                  isChecked={allSelected}
                  isIndeterminate={someSelected && !allSelected}
                  onChange={toggleSelectAll}
                  isDisabled={paginatedTargets.length === 0}
                  colorScheme="blue"
                />
              </Th>
              <Th>股票</Th>
              <Th isNumeric>現價</Th>
              <Th isNumeric>防守價</Th>
              <Th isNumeric>距防守%</Th>
              <Th isNumeric>最小漲幅</Th>
              <Th isNumeric>距目標%</Th>
              <Th isNumeric>合理漲幅</Th>
              <Th isNumeric>建議買進</Th>
              <Th>導入日期</Th>
              <Th>狀態</Th>
              <Th w="50px" px={2}>操作</Th>
            </Tr>
          </Thead>
          <Tbody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <Tr key={i}>
                  {[...Array(COL_COUNT)].map((_, j) => (
                    <Td key={j}><Skeleton h="18px" /></Td>
                  ))}
                </Tr>
              ))
            ) : paginatedTargets.length === 0 ? (
              <Tr>
                <Td colSpan={COL_COUNT} textAlign="center" py={10} color="ui.slate">
                  {totalItems === 0
                    ? '尚未匯入投顧追蹤標的。請先在上方貼上通知文字並匯入。'
                    : '此頁無資料。'}
                </Td>
              </Tr>
            ) : (
              paginatedTargets.map((target) => {
                const price = marketPrices[target.ticker]
                const currentPrice = price?.current_price || 0
                const prevClose = price?.prev_close || currentPrice
                const hasPriceData = currentPrice > 0
                const isSelected = selectedTickers.has(target.ticker)

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
                    bg={isSelected ? 'blue.50' : undefined}
                    opacity={status === 'ignored' || status === 'exited' ? 0.5 : 1}
                    transition="background 0.15s"
                  >
                    {/* Row checkbox */}
                    <Td px={2}>
                      <Checkbox
                        isChecked={isSelected}
                        onChange={() => toggleSelectTicker(target.ticker)}
                        colorScheme="blue"
                      />
                    </Td>

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
                          {(target.stock_name || holdingsNameMap[target.ticker]) && (
                            <Text fontSize="xs" color="gray.500" noOfLines={1}>
                              {target.stock_name || holdingsNameMap[target.ticker]}
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

                    {/* 導入日期 (effective_date) */}
                    <Td>
                      <Text fontSize="xs" color="ui.slate" whiteSpace="nowrap">
                        {formatDate(target.effective_date)}
                      </Text>
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

                    {/* Delete action */}
                    <Td px={2}>
                      <Tooltip label={`刪除 ${target.ticker}`} placement="left">
                        <IconButton
                          aria-label={`刪除 ${target.ticker}`}
                          icon={<DeleteIcon />}
                          size="xs"
                          variant="ghost"
                          colorScheme="red"
                          rounded="full"
                          isLoading={isDeleting && pendingDeleteTickers.includes(target.ticker)}
                          onClick={() => confirmDelete([target.ticker])}
                        />
                      </Tooltip>
                    </Td>
                  </Tr>
                )
              })
            )}
          </Tbody>
        </Table>
      </Box>

      {/* ── Pagination Controls ── */}
      {!isLoading && totalItems > 0 && (
        <Flex
          justify="space-between"
          align="center"
          px={1}
          pt={4}
          mt={2}
          borderTop="1px"
          borderColor="gray.100"
          flexWrap="wrap"
          gap={2}
        >
          {/* Left: page size selector */}
          <HStack spacing={2}>
            <Text fontSize="sm" color="gray.600" whiteSpace="nowrap">每頁顯示:</Text>
            <Select
              size="sm"
              w="auto"
              value={(showCustomInput || isCustomSize) ? 'custom' : String(pageSize)}
              onChange={(e) => handlePageSizeChange(e.target.value)}
              rounded="md"
            >
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="custom">{isCustomSize && !showCustomInput ? `自訂 (${pageSize})` : '自訂'}</option>
            </Select>
            {showCustomInput && (
              <HStack spacing={1}>
                <Input
                  size="sm"
                  w="70px"
                  type="number"
                  min={5}
                  max={200}
                  placeholder="5-200"
                  value={customPageSize}
                  onChange={(e) => setCustomPageSize(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCustomPageSizeSubmit()}
                  rounded="md"
                />
                <Button size="sm" onClick={handleCustomPageSizeSubmit} colorScheme="blue" variant="outline" rounded="md">
                  確定
                </Button>
              </HStack>
            )}
            <Text fontSize="sm" color="gray.500">
              共 {totalItems} 筆
            </Text>
          </HStack>

          {/* Right: page navigation */}
          {totalPages > 1 && (
            <HStack spacing={1}>
              <Tooltip label="第一頁">
                <IconButton
                  aria-label="First page"
                  icon={<ArrowLeftIcon boxSize={3} />}
                  size="sm"
                  variant="ghost"
                  isDisabled={safePage <= 1}
                  onClick={() => setCurrentPageNum(1)}
                />
              </Tooltip>
              <Tooltip label="上一頁">
                <IconButton
                  aria-label="Previous page"
                  icon={<ChevronLeftIcon />}
                  size="sm"
                  variant="ghost"
                  isDisabled={safePage <= 1}
                  onClick={() => setCurrentPageNum(safePage - 1)}
                />
              </Tooltip>
              <Text fontSize="sm" color="gray.700" px={2} whiteSpace="nowrap">
                {safePage} / {totalPages}
              </Text>
              <Tooltip label="下一頁">
                <IconButton
                  aria-label="Next page"
                  icon={<ChevronRightIcon />}
                  size="sm"
                  variant="ghost"
                  isDisabled={safePage >= totalPages}
                  onClick={() => setCurrentPageNum(safePage + 1)}
                />
              </Tooltip>
              <Tooltip label="最後一頁">
                <IconButton
                  aria-label="Last page"
                  icon={<ArrowRightIcon boxSize={3} />}
                  size="sm"
                  variant="ghost"
                  isDisabled={safePage >= totalPages}
                  onClick={() => setCurrentPageNum(totalPages)}
                />
              </Tooltip>
            </HStack>
          )}
        </Flex>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        isOpen={isConfirmOpen}
        leastDestructiveRef={cancelRef}
        onClose={onConfirmClose}
        isCentered
      >
        <AlertDialogOverlay>
          <AlertDialogContent rounded="2xl">
            <AlertDialogHeader fontSize="lg" fontWeight="bold" color="ui.navy">
              確認刪除
            </AlertDialogHeader>
            <AlertDialogBody>
              {pendingDeleteTickers.length === 1 ? (
                <>確定要刪除 <Text as="span" fontWeight="bold">{pendingDeleteTickers[0]}</Text> 的追蹤資料嗎？</>
              ) : (
                <>確定要刪除 <Text as="span" fontWeight="bold">{pendingDeleteTickers.length} 檔</Text> 標的的追蹤資料嗎？</>
              )}
              <Text fontSize="sm" color="red.500" mt={2}>
                此操作將一併刪除價格目標與追蹤狀態，且無法復原。
              </Text>
            </AlertDialogBody>
            <AlertDialogFooter gap={2}>
              <Button ref={cancelRef} onClick={onConfirmClose} rounded="xl" size="sm">
                取消
              </Button>
              <Button colorScheme="red" onClick={executeDelete} rounded="xl" size="sm" isLoading={isDeleting}>
                確認刪除
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  )
}
