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
} from '@chakra-ui/react'
import { EditIcon, DeleteIcon, ChevronDownIcon, ChevronUpIcon, TriangleUpIcon, TriangleDownIcon, UpDownIcon } from '@chakra-ui/icons'
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

type SortField = 'ticker' | 'name' | 'totalShares' | 'avgCost' | 'currentPrice' | 'changePercent' | 'marketValue' | 'unrealizedPnl'
type SortOrder = 'asc' | 'desc' | null

interface SortConfig {
  field: SortField
  order: SortOrder
}

interface HoldingRowProps {
  group: AggregatedHolding
  marketData: { [ticker: string]: any }
  onEdit: (holding: Holding) => void
  onDelete: (holding: Holding) => void
}

const HoldingRow = ({ group, marketData, onEdit, onDelete }: HoldingRowProps) => {
  const { isOpen, onToggle } = useDisclosure()
  const { tp, sl } = calculateTPSL(group)

  const isProfit = group.unrealizedPnl > 0.001
  const isLoss = group.unrealizedPnl < -0.001
  const isPnlFlat = !isProfit && !isLoss
  const latestItem = group.items[0]

  // Logic 1: Weighted Avg Price Color
  // 紅色：加權均價 > 最新股價 (套牢)
  // 綠色：加權均價 < 最新股價 (獲利/有優勢)
  const getAvgCostColor = () => {
    if (!marketData[group.ticker]?.current_price) return 'black'
    if (group.avgCost > group.currentPrice) return 'red.500'
    if (group.avgCost < group.currentPrice) return 'green.500'
    return 'black'
  }

  // Logic 2: Current Price Color & Placeholder
  const hasPriceData = !!marketData[group.ticker]?.current_price
  const currentPrice = marketData[group.ticker]?.current_price
  const prevClose = marketData[group.ticker]?.prev_close
  
  // 使用誤差範圍處理浮點數比較，判斷是否為平盤
  const isFlat = hasPriceData && Math.abs(currentPrice - prevClose) < 0.0001
  const isPriceUp = hasPriceData && !isFlat && currentPrice > prevClose
  const isPriceDown = hasPriceData && !isFlat && currentPrice < prevClose
  
  const getPriceColor = () => {
    if (!hasPriceData) return 'black'
    if (isPriceUp) return 'red.500'
    if (isPriceDown) return 'green.500'
    return 'black'
  }

  const getPriceSymbol = () => {
    if (isPriceUp) return <TriangleUpIcon mr={1} />
    if (isPriceDown) return <TriangleDownIcon mr={1} />
    return null
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
        
        {/* Latest Price Column */}
        <Td isNumeric fontWeight="bold" color={getPriceColor()}>
          <HStack justify="flex-end" spacing={0}>
            {hasPriceData && getPriceSymbol()}
            <Text>
              {hasPriceData ? `${group.region === 'US' ? '$' : ''}${group.currentPrice.toFixed(2)}` : '-'}
            </Text>
          </HStack>
        </Td>
        <Td isNumeric>
          {hasPriceData ? (
            <HStack justify="flex-end" spacing={1} color={isPriceUp ? 'red.500' : isPriceDown ? 'green.500' : 'black'}>
              {/* 漲跌數值前的符號：上漲用正三角，下跌用倒三角，平盤不顯示 */}
              {isPriceUp && <TriangleUpIcon />}
              {isPriceDown && <TriangleDownIcon />}
              <Text fontWeight="bold">
                {Math.abs(group.change).toFixed(2)}
              </Text>
              <Text fontSize="xs">
                ({isPriceUp ? '+' : (isPriceDown ? '-' : '')}{Math.abs(group.changePercent).toFixed(2)}%)
              </Text>
            </HStack>
          ) : '-'}
        </Td>

        <Td isNumeric fontWeight="semibold">
          {group.marketValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </Td>
        <Td isNumeric>
          <VStack align="end" spacing={0}>
            <Text color={isProfit ? 'red.500' : isLoss ? 'green.500' : 'black'} fontWeight="bold">
              {isProfit ? '+' : ''}{group.unrealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </Text>
            <Text fontSize="xs" color={isProfit ? 'red.500' : isLoss ? 'green.500' : 'black'}>
              {isProfit ? '+' : ''}{group.roi.toFixed(2)}%
            </Text>
          </VStack>
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
              onClick={() => onEdit(latestItem)}
            />
            <IconButton
              aria-label="Delete"
              icon={<DeleteIcon />}
              size="sm"
              variant="ghost"
              colorScheme="red"
              onClick={() => onDelete(latestItem)}
            />
          </HStack>
        </Td>
      </Tr>

      {group.isMultiple && (
        <Tr>
          <Td colSpan={10} p={0} borderBottom={isOpen ? '1px solid' : 'none'} borderColor="gray.100">
            <Collapse in={isOpen}>
              <Box p={4} bg="gray.50" fontSize="sm">
                <Text fontWeight="bold" mb={2} color="gray.600">買入明細</Text>
                <VStack align="stretch" spacing={2}>
                  {group.items.map((item) => (
                    <HStack key={item.id} justify="space-between" px={4}>
                      <Text color="gray.500">{item.buy_date}</Text>
                      <HStack spacing={8}>
                        <Text>股數: {item.shares}</Text>
                        <Text>價格: ${item.cost_price}</Text>
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
  
  const aggregatedData = useMemo(() => {
    const data = aggregateHoldings(holdings, marketData)
    
    if (!sortConfig.order) return data

    return [...data].sort((a, b) => {
      let aVal: any = a[sortConfig.field]
      let bVal: any = b[sortConfig.field]

      // Handle specific fields if needed
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

  const toast = useToast()
  const [selectedHolding, setSelectedHolding] = useState<Holding | null>(null)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const { isOpen: isSellOpen, onOpen: onSellOpen, onClose: onSellClose } = useDisclosure()

  const handleEdit = (holding: Holding) => {
    setSelectedHolding(holding)
    onOpen()
  }

  const handleDelete = (holding: Holding) => {
    setSelectedHolding(holding)
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

  return (
    <>
      <TableContainer bg="white" rounded="lg" shadow="sm" border="1px" borderColor="gray.100">
        <Table variant="simple">
          <Thead bg="gray.50">
            <Tr>
              <SortableTh field="ticker">代碼/地區</SortableTh>
              <SortableTh field="name">名稱</SortableTh>
              <SortableTh field="totalShares" isNumeric>總股數</SortableTh>
              <SortableTh field="avgCost" isNumeric>加權均價</SortableTh>
              <SortableTh field="currentPrice" isNumeric>最新股價</SortableTh>
              <SortableTh field="changePercent" isNumeric>漲跌</SortableTh>
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
                  <Td><Skeleton h="20px" /></Td>
                  <Td><Skeleton h="20px" /></Td>
                  <Td><Skeleton h="20px" /></Td>
                  <Td><Skeleton h="20px" /></Td>
                  <Td><Skeleton h="20px" /></Td>
                  <Td><Skeleton h="20px" /></Td>
                  <Td><Skeleton h="20px" /></Td>
                  <Td><Skeleton h="20px" /></Td>
                  <Td><Skeleton h="20px" /></Td>
                  <Td><Skeleton h="20px" /></Td>
                </Tr>
              ))
            ) : aggregatedData.length === 0 ? (
              <Tr>
                <Td colSpan={10} textAlign="center" py={10}>
                  目前沒有持股，請點擊「新增持股」按鈕。
                </Td>
              </Tr>
            ) : (
              aggregatedData.map((group) => (
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
      </TableContainer>

      <EditHoldingModal 
        isOpen={isOpen} 
        onClose={onClose} 
        holding={selectedHolding} 
        onSuccess={onDataChange || (() => {})} 
      />

      <SellHoldingModal
        isOpen={isSellOpen}
        onClose={onSellClose}
        holding={selectedHolding}
        currentPrice={selectedHolding ? (marketData[selectedHolding.ticker]?.current_price) : undefined}
        onSuccess={onDataChange || (() => {})}
      />
    </>
  )
}
