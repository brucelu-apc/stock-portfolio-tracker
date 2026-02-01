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
} from '@chakra-ui/react'
import { EditIcon, DeleteIcon, ChevronDownIcon, ChevronUpIcon } from '@chakra-ui/icons'
import { MouseEvent } from 'react'
import { AggregatedHolding, aggregateHoldings, calculateTPSL, Holding } from '../../utils/calculations'
import { supabase } from '../../services/supabase'

interface Props {
  holdings: Holding[]
  priceMap: { [ticker: string]: number }
  onDataChange?: () => void
}

interface HoldingRowProps {
  group: AggregatedHolding
  onEdit: (holding: Holding) => void
  onDelete: (id: string) => void
}

const HoldingRow = ({ group, onEdit, onDelete }: HoldingRowProps) => {
  const { isOpen, onToggle } = useDisclosure()
  const { tp, sl } = calculateTPSL(group)

  const isProfit = group.unrealizedPnl >= 0
  const latestItem = group.items[0]

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
        <Td isNumeric>{group.region === 'US' ? '$' : ''}{group.avgCost.toFixed(2)}</Td>
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
            <Text color="orange.600">利: {tp.toFixed(1)}</Text>
            <Text color="blue.600">損: {sl.toFixed(1)}</Text>
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
              onClick={() => onDelete(latestItem.id)}
            />
          </HStack>
        </Td>
      </Tr>

      {group.isMultiple && (
        <Tr>
          <Td colSpan={8} p={0} borderBottom={isOpen ? '1px solid' : 'none'} borderColor="gray.100">
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
                        <HStack spacing={1}>
                          <IconButton
                            aria-label="Edit"
                            icon={<EditIcon />}
                            size="xs"
                            variant="ghost"
                            onClick={() => onEdit(item)}
                          />
                          <IconButton
                            aria-label="Delete"
                            icon={<DeleteIcon />}
                            size="xs"
                            variant="ghost"
                            colorScheme="red"
                            onClick={() => onDelete(item.id)}
                          />
                        </HStack>
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

export const HoldingsTable = ({ holdings, priceMap, onDataChange }: Props) => {
  const aggregatedData = aggregateHoldings(holdings, priceMap)
  const toast = useToast()

  const handleEdit = (holding: Holding) => {
    // TODO: Open edit modal with holding data
    toast({
      title: '編輯功能開發中',
      description: `編輯 ${holding.ticker} (${holding.buy_date})`,
      status: 'info'
    })
  }

  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除這筆持股記錄嗎？')) return

    const { error } = await supabase
      .from('portfolio_holdings')
      .delete()
      .eq('id', id)

    if (error) {
      toast({ title: '刪除失敗', description: error.message, status: 'error' })
    } else {
      toast({ title: '刪除成功', status: 'success' })
      onDataChange?.()
    }
  }

  return (
    <TableContainer bg="white" rounded="lg" shadow="sm" border="1px" borderColor="gray.100">
      <Table variant="simple">
        <Thead bg="gray.50">
          <Tr>
            <Th>代碼/地區</Th>
            <Th>名稱</Th>
            <Th isNumeric>總股數</Th>
            <Th isNumeric>加權均價</Th>
            <Th isNumeric>市值 (TWD)</Th>
            <Th isNumeric>總損益</Th>
            <Th isNumeric>停利/損</Th>
            <Th>操作</Th>
          </Tr>
        </Thead>
        <Tbody>
          {aggregatedData.length === 0 ? (
            <Tr>
              <Td colSpan={8} textAlign="center" py={10}>
                目前沒有持股，請點擊「新增持股」按鈕。
              </Td>
            </Tr>
          ) : (
            aggregatedData.map((group) => (
              <HoldingRow
                key={group.ticker}
                group={group}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))
          )}
        </Tbody>
      </Table>
    </TableContainer>
  )
}
