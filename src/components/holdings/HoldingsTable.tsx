import {
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  Badge,
  Text,
  IconButton,
  HStack,
  Collapse,
  Box,
  useDisclosure,
  VStack,
  useToast,
  Skeleton,
  Select,
  Input,
  Flex,
  Button,
  Tooltip,
} from '@chakra-ui/react'
import {
  EditIcon,
  DeleteIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  TriangleUpIcon,
  TriangleDownIcon,
  UpDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
} from '@chakra-ui/icons'
import { MouseEvent, useState, useMemo } from 'react'
import { AggregatedHolding, aggregateHoldings, calculateTPSL, Holding } from '../../utils/calculations'
import { supabase } from '../../services/supabase'
import { EditHoldingModal } from './EditHoldingModal'
import { SellHoldingModal } from './SellHoldingModal'

interface Props {
  holdings: Holding[]
  marketData: { [ticker: string]: any }
  onDataChange?: () => void
  isLoading?: boolean
}

// Sort fields including new change point fields
type SortField =
  | 'ticker' | 'name' | 'totalShares' | 'avgCost'
  | 'realtimePrice' | 'realtimeChangePct'
  | 'closePrice' | 'closeChangePct'
  | 'marketValue' | 'unrealizedPnl'
type SortOrder = 'asc' | 'desc' | null

interface SortConfig {
  field: SortField
  order: SortOrder
}

// Aggregate context passed when editing from the top-level row
export interface AggregateEditInfo {
  totalShares: number
  avgCost: number
}

interface HoldingRowProps {
  group: AggregatedHolding
  marketData: { [ticker: string]: any }
  onEdit: (holding: Holding, aggregateInfo?: AggregateEditInfo) => void
  onDelete: (holding: Holding) => void
}

const HoldingRow = ({ group, marketData, onEdit, onDelete }: HoldingRowProps) => {
  const { isOpen, onToggle } = useDisclosure()
  const { tp, sl } = calculateTPSL(group)

  const isProfit = group.unrealizedPnl > 0.001
  const isLoss = group.unrealizedPnl < -0.001
  const latestItem = group.items[0]

  // Weighted Avg Price Color — TW convention: red=profit, green=loss
  const getAvgCostColor = () => {
    if (group.avgCost < group.currentPrice) return 'red.500'    // 獲利 (成本低於現價)
    if (group.avgCost > group.currentPrice) return 'green.500'  // 虧損 (成本高於現價)
    return 'black'
  }

  // --- Realtime price logic ---
  const hasRealtimePrice = group.realtimePrice !== null && group.realtimePrice !== undefined
  const realtimePriceUp = hasRealtimePrice && group.realtimeChangePct !== null && group.realtimeChangePct > 0.001
  const realtimePriceDown = hasRealtimePrice && group.realtimeChangePct !== null && group.realtimeChangePct < -0.001

  const getRealtimePriceColor = () => {
    if (!hasRealtimePrice) return 'gray.400'
    if (realtimePriceUp) return 'red.500'
    if (realtimePriceDown) return 'green.500'
    return 'black'
  }

  // --- Close price logic ---
  const hasCloseData = group.closePrice > 0
  const isCloseFlat = hasCloseData && Math.abs(group.closeChangePct) < 0.001
  const isCloseUp = hasCloseData && !isCloseFlat && group.closeChangePct > 0
  const isCloseDown = hasCloseData && !isCloseFlat && group.closeChangePct < 0

  const getClosePriceColor = () => {
    if (!hasCloseData) return 'black'
    if (isCloseUp) return 'red.500'
    if (isCloseDown) return 'green.500'
    return 'black'
  }

  const getCloseSymbol = () => {
    if (isCloseUp) return <TriangleUpIcon mr={1} />
    if (isCloseDown) return <TriangleDownIcon mr={1} />
    return null
  }

  // Helper: format change points with sign
  const formatChange = (val: number, isUS: boolean) => {
    const prefix = val > 0 ? '+' : ''
    const currency = isUS ? '$' : ''
    return `${prefix}${currency}${val.toFixed(2)}`
  }

  return (
    <>
      <Tr cursor="pointer" onClick={onToggle} _hover={{ bg: 'gray.50' }}>
        <Td>
          <HStack spacing={2}>
            <VStack align="start" spacing={0}>
              <Text fontWeight="bold">{group.ticker}</Text>
              <Badge size="xs" colorScheme={group.region === 'TPE' ? 'teal' : 'orange'}>
                {group.region}
              </Badge>
            </VStack>
            {group.isMultiple && (
              <Box color="gray.400">
                {isOpen ? <ChevronUpIcon /> : <ChevronDownIcon />}
              </Box>
            )}
          </HStack>
        </Td>
        <Td>{group.name}</Td>
        <Td isNumeric>{group.totalShares.toLocaleString()}</Td>
        <Td isNumeric color={getAvgCostColor()} fontWeight="medium">
          {group.region === 'US' ? '$' : ''}{group.avgCost.toFixed(2)}
        </Td>

        {/* 即時股價 (Realtime Price) */}
        <Td isNumeric fontWeight="bold" color={getRealtimePriceColor()}>
          <HStack justify="flex-end" spacing={0}>
            {hasRealtimePrice && realtimePriceUp && <TriangleUpIcon mr={1} />}
            {hasRealtimePrice && realtimePriceDown && <TriangleDownIcon mr={1} />}
            <Text>
              {hasRealtimePrice
                ? `${group.region === 'US' ? '$' : ''}${group.realtimePrice!.toFixed(2)}`
                : '休市'}
            </Text>
          </HStack>
        </Td>

        {/* 即時漲跌幅 (Realtime Change: points + %) — stacked vertically */}
        <Td isNumeric>
          {hasRealtimePrice && group.realtimeChange !== null && group.realtimeChangePct !== null ? (
            <VStack
              align="end"
              spacing={0}
              color={realtimePriceUp ? 'red.500' : realtimePriceDown ? 'green.500' : 'black'}
            >
              <HStack spacing={1} justify="flex-end">
                {realtimePriceUp && <TriangleUpIcon boxSize={2.5} />}
                {realtimePriceDown && <TriangleDownIcon boxSize={2.5} />}
                <Text fontWeight="bold" fontSize="sm">
                  {formatChange(group.realtimeChange, group.region === 'US')}
                </Text>
              </HStack>
              <Text fontSize="xs">
                {group.realtimeChangePct > 0 ? '+' : ''}{group.realtimeChangePct.toFixed(2)}%
              </Text>
            </VStack>
          ) : (
            <Text color="gray.400">-</Text>
          )}
        </Td>

        {/* 最新收盤價 (Close Price) */}
        <Td isNumeric fontWeight="bold" color={getClosePriceColor()}>
          <HStack justify="flex-end" spacing={0}>
            {hasCloseData && getCloseSymbol()}
            <Text>
              {hasCloseData ? `${group.region === 'US' ? '$' : ''}${group.closePrice.toFixed(2)}` : '-'}
            </Text>
          </HStack>
        </Td>

        {/* 收盤漲跌幅 (Close Change: points + %) — stacked vertically */}
        <Td isNumeric>
          {hasCloseData ? (
            <VStack
              align="end"
              spacing={0}
              color={isCloseUp ? 'red.500' : isCloseDown ? 'green.500' : 'black'}
            >
              <HStack spacing={1} justify="flex-end">
                {isCloseUp && <TriangleUpIcon boxSize={2.5} />}
                {isCloseDown && <TriangleDownIcon boxSize={2.5} />}
                <Text fontWeight="bold" fontSize="sm">
                  {formatChange(group.closeChange, group.region === 'US')}
                </Text>
              </HStack>
              <Text fontSize="xs">
                {group.closeChangePct > 0 ? '+' : ''}{group.closeChangePct.toFixed(2)}%
              </Text>
            </VStack>
          ) : '-'}
        </Td>

        <Td isNumeric fontWeight="semibold">
          {group.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </Td>
        <Td isNumeric>
          <Tooltip
            label={
              group.region === 'TPE'
                ? `持有成本: ${group.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}\n` +
                  `├ 買進手續費: ${group.totalBuyFee.toLocaleString(undefined, { maximumFractionDigits: 0 })}\n` +
                  `預估賣出成本: ${group.estimatedSellCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}\n` +
                  `├ 賣出手續費: ${group.estimatedSellCommission.toLocaleString(undefined, { maximumFractionDigits: 0 })}\n` +
                  `└ 證交稅: ${group.estimatedSellTax.toLocaleString(undefined, { maximumFractionDigits: 0 })}\n` +
                  `預估淨收入: ${group.estimatedNetProceeds.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                : `持有成本: ${group.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })} TWD`
            }
            whiteSpace="pre-line"
            fontSize="xs"
            placement="left"
          >
            <VStack align="end" spacing={0}>
              <Text color={isProfit ? 'red.500' : isLoss ? 'green.500' : 'black'} fontWeight="bold">
                {isProfit ? '+' : ''}{group.unrealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </Text>
              <Text fontSize="xs" color={isProfit ? 'red.500' : isLoss ? 'green.500' : 'black'}>
                {isProfit ? '+' : ''}{group.roi.toFixed(2)}%
              </Text>
            </VStack>
          </Tooltip>
        </Td>
        <Td isNumeric>
          <VStack align="end" spacing={0} fontSize="xs">
            <Text color="red.500">利: {tp.toFixed(1)}</Text>
            <Text color="green.500" fontWeight="bold">損: {sl.toFixed(1)}</Text>
          </VStack>
        </Td>
        <Td onClick={(e: MouseEvent) => e.stopPropagation()}>
          <HStack spacing={2}>
            <IconButton
              aria-label="Edit"
              icon={<EditIcon />}
              size="sm"
              variant="ghost"
              onClick={() => onEdit(latestItem, group.isMultiple ? { totalShares: group.totalShares, avgCost: group.avgCost } : undefined)}
            />
            <IconButton
              aria-label="Delete"
              icon={<DeleteIcon />}
              size="sm"
              variant="ghost"
              colorScheme="red"
              onClick={() => onDelete(group)}
            />
          </HStack>
        </Td>
      </Tr>

      {group.isMultiple && (
        <Tr>
          <Td colSpan={12} p={0} borderBottom={isOpen ? '1px solid' : 'none'} borderColor="gray.100">
            <Collapse in={isOpen}>
              <Box p={4} bg="gray.50" fontSize="sm">
                <Text fontWeight="bold" mb={2} color="gray.600">買入明細</Text>
                <VStack align="stretch" spacing={2}>
                  {group.items.map((item) => (
                    <HStack key={item.id} justify="space-between" px={4} py={1} _hover={{ bg: 'gray.100' }} rounded="md">
                      <HStack spacing={4}>
                        <Text color="gray.500" w="100px">{item.buy_date}</Text>
                        <Text w="100px">股數: {item.shares}</Text>
                        <Text w="100px">價格: ${item.cost_price}</Text>
                      </HStack>
                      <HStack spacing={2}>
                        <IconButton
                          aria-label="Edit Item"
                          icon={<EditIcon />}
                          size="xs"
                          variant="ghost"
                          onClick={() => onEdit(item)}
                        />
                        <IconButton
                          aria-label="Delete Item"
                          icon={<DeleteIcon />}
                          size="xs"
                          variant="ghost"
                          colorScheme="red"
                          onClick={() => onDelete(item)}
                        />
                      </HStack>
                    </HStack>
                  ))}
                </VStack>
              </Box>
            </Collapse>
          </Td>
        </Tr>
      )}
    </>
  )
}

export const HoldingsTable = ({ holdings, marketData, onDataChange, isLoading }: Props) => {
  const [sortConfig, setSortConfig] = useState<SortConfig>({ field: 'marketValue', order: 'desc' })

  // --- Pagination state ---
  const [pageSize, setPageSize] = useState<number>(10)
  const [currentPageNum, setCurrentPageNum] = useState<number>(1)
  const [customPageSize, setCustomPageSize] = useState<string>('')
  const [showCustomInput, setShowCustomInput] = useState(false)

  const aggregatedData = useMemo(() => {
    const data = aggregateHoldings(holdings, marketData)

    if (!sortConfig.order) return data

    return [...data].sort((a, b) => {
      const aVal: any = a[sortConfig.field]
      const bVal: any = b[sortConfig.field]

      // Handle null for realtime fields
      if (aVal === null && bVal === null) return 0
      if (aVal === null) return sortConfig.order === 'asc' ? -1 : 1
      if (bVal === null) return sortConfig.order === 'asc' ? 1 : -1

      if (sortConfig.field === 'ticker') {
        return sortConfig.order === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }

      if (sortConfig.field === 'name') {
        return sortConfig.order === 'asc'
          ? aVal.localeCompare(bVal, 'zh-Hant')
          : bVal.localeCompare(aVal, 'zh-Hant')
      }

      // Default numeric sort
      if (sortConfig.order === 'asc') {
        return aVal - bVal
      } else {
        return bVal - aVal
      }
    })
  }, [holdings, marketData, sortConfig])

  // --- Pagination computed values ---
  const totalItems = aggregatedData.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))

  // Clamp current page
  const safePage = Math.min(currentPageNum, totalPages)
  if (safePage !== currentPageNum) {
    setCurrentPageNum(safePage)
  }

  const paginatedData = useMemo(() => {
    const start = (safePage - 1) * pageSize
    return aggregatedData.slice(start, start + pageSize)
  }, [aggregatedData, safePage, pageSize])

  const toast = useToast()
  const [editHolding, setEditHolding] = useState<Holding | null>(null)
  const [editAggregateInfo, setEditAggregateInfo] = useState<AggregateEditInfo | null>(null)
  const [sellHolding, setSellHolding] = useState<AggregatedHolding | Holding | null>(null)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const { isOpen: isSellOpen, onOpen: onSellOpen, onClose: onSellClose } = useDisclosure()

  const handleEdit = (holding: Holding, aggregateInfo?: AggregateEditInfo) => {
    setEditHolding(holding)
    setEditAggregateInfo(aggregateInfo || null)
    onOpen()
  }

  const handleDelete = (holding: AggregatedHolding | Holding) => {
    setSellHolding(holding)
    onSellOpen()
  }

  const requestSort = (field: SortField) => {
    let order: SortOrder = 'desc'
    if (sortConfig.field === field && sortConfig.order === 'desc') {
      order = 'asc'
    } else if (sortConfig.field === field && sortConfig.order === 'asc') {
      order = null
    }
    setSortConfig({ field, order })
  }

  const SortIndicator = ({ field }: { field: SortField }) => {
    if (sortConfig.field !== field || !sortConfig.order) {
      return <UpDownIcon ml={1} color="gray.300" boxSize={3} />
    }
    return sortConfig.order === 'asc'
      ? <ChevronUpIcon ml={1} color="blue.500" />
      : <ChevronDownIcon ml={1} color="blue.500" />
  }

  const SortableTh = ({ field, children, isNumeric = false }: { field: SortField, children: React.ReactNode, isNumeric?: boolean }) => (
    <Th
      cursor="pointer"
      onClick={() => requestSort(field)}
      _hover={{ bg: 'gray.100' }}
      isNumeric={isNumeric}
      whiteSpace="nowrap"
    >
      <HStack spacing={1} justify={isNumeric ? 'flex-end' : 'flex-start'}>
        <Text>{children}</Text>
        <SortIndicator field={field} />
      </HStack>
    </Th>
  )

  // --- Pagination handlers ---
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

  const PRESET_SIZES = [10, 20, 100]
  const isCustomSize = !PRESET_SIZES.includes(pageSize)
  const COL_COUNT = 12

  return (
    <>
      <TableContainer bg="white" rounded="lg" shadow="sm" border="1px" borderColor="gray.100">
        <Table variant="simple" size="sm">
          <Thead bg="gray.50">
            <Tr>
              <SortableTh field="ticker">代碼/地區</SortableTh>
              <SortableTh field="name">名稱</SortableTh>
              <SortableTh field="totalShares" isNumeric>總股數</SortableTh>
              <SortableTh field="avgCost" isNumeric>加權均價</SortableTh>
              <SortableTh field="realtimePrice" isNumeric>即時股價</SortableTh>
              <SortableTh field="realtimeChangePct" isNumeric>即時漲跌幅</SortableTh>
              <SortableTh field="closePrice" isNumeric>最新收盤價</SortableTh>
              <SortableTh field="closeChangePct" isNumeric>收盤漲跌幅</SortableTh>
              <SortableTh field="marketValue" isNumeric>市值 (TWD)</SortableTh>
              <SortableTh field="unrealizedPnl" isNumeric>總損益</SortableTh>
              <Th isNumeric>停利/損</Th>
              <Th>操作</Th>
            </Tr>
          </Thead>
          <Tbody>
            {isLoading ? (
              [...Array(3)].map((_, i) => (
                <Tr key={i}>
                  {[...Array(COL_COUNT)].map((_, j) => (
                    <Td key={j}><Skeleton h="20px" /></Td>
                  ))}
                </Tr>
              ))
            ) : paginatedData.length === 0 ? (
              <Tr>
                <Td colSpan={COL_COUNT} textAlign="center" py={10}>
                  {totalItems === 0
                    ? '目前沒有持股，請點擊「新增持股」按鈕。'
                    : '此頁無資料。'}
                </Td>
              </Tr>
            ) : (
              paginatedData.map((group) => (
                <HoldingRow
                  key={group.ticker}
                  group={group}
                  marketData={marketData}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              ))
            )}
          </Tbody>
        </Table>

        {/* ── Pagination Controls ── */}
        {!isLoading && totalItems > 0 && (
          <Flex justify="space-between" align="center" px={4} py={3} borderTop="1px" borderColor="gray.100" flexWrap="wrap" gap={2}>
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
                <option value="100">100</option>
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
      </TableContainer>

      <EditHoldingModal
        isOpen={isOpen}
        onClose={onClose}
        holding={editHolding}
        aggregateInfo={editAggregateInfo}
        onSuccess={onDataChange || (() => {})}
      />

      <SellHoldingModal
        isOpen={isSellOpen}
        onClose={onSellClose}
        holding={sellHolding}
        currentPrice={sellHolding ? (marketData[sellHolding.ticker]?.current_price) : undefined}
        onSuccess={onDataChange || (() => {})}
      />
    </>
  )
}
