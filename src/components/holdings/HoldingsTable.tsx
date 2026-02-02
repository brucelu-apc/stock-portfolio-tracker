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
import { EditIcon, DeleteIcon, ChevronDownIcon, ChevronUpIcon, TriangleUpIcon, TriangleDownIcon } from '@chakra-ui/icons'
import { MouseEvent, useState } from 'react'
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

interface HoldingRowProps {
  group: AggregatedHolding
  marketData: { [ticker: string]: any }
  onEdit: (holding: Holding) => void
  onDelete: (holding: Holding) => void
}

const HoldingRow = ({ group, marketData, onEdit, onDelete }: HoldingRowProps) => {
  const { isOpen, onToggle } = useDisclosure()
  const { tp, sl } = calculateTPSL(group)

  const isProfit = group.unrealizedPnl >= 0
  const isUp = group.change >= 0
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

  const getChangeSymbol = () => {
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
            {hasPriceData && getChangeSymbol()}
            <Text>
              {hasPriceData ? `${group.region === 'US' ? '$' : ''}${group.currentPrice.toFixed(2)}` : '-'}
            </Text>
          </HStack>
        </Td>
        <Td isNumeric>
          {hasPriceData ? (
            <HStack justify="flex-end" spacing={1} color={isPriceUp ? 'red.500' : isPriceDown ? 'green.500' : 'black'}>
              <Text fontWeight="bold">
                {isFlat ? '' : (isPriceUp ? '' : '')}{Math.abs(group.change).toFixed(2)}
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
            <Text color={isProfit ? 'red.500' : 'green.500'} fontWeight="bold">
              {isProfit ? '+' : ''}{group.unrealizedPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </Text>
            <Text fontSize="xs" color={isProfit ? 'red.500' : 'green.500'}>
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
  const aggregatedData = aggregateHoldings(holdings, marketData)
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

  return (
    <>
      <TableContainer bg="white" rounded="lg" shadow="sm" border="1px" borderColor="gray.100">
        <Table variant="simple">
          <Thead bg="gray.50">
            <Tr>
              <Th>代碼/地區</Th>
              <Th>名稱</Th>
              <Th isNumeric>總股數</Th>
              <Th isNumeric>加權均價</Th>
              <Th isNumeric>最新股價</Th>
              <Th isNumeric>漲跌</Th>
              <Th isNumeric>市值 (TWD)</Th>
              <Th isNumeric>總損益</Th>
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
