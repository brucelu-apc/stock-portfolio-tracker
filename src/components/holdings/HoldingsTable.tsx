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
} from '@chakra-ui/react'
import { EditIcon, DeleteIcon, ChevronDownIcon, ChevronUpIcon } from '@chakra-ui/icons'
import { MouseEvent } from 'react'
import { AggregatedHolding, aggregateHoldings, calculateTPSL, Holding } from '../../utils/calculations'

interface Props {
  holdings: Holding[]
  priceMap: { [ticker: string]: number }
}

const HoldingRow = ({ group, key: _key }: { group: AggregatedHolding; key?: string }) => {
  const { isOpen, onToggle } = useDisclosure()
  const { tp, sl } = calculateTPSL(group)

  // Logic moved to aggregateHoldings, now just display parameters
  const isProfit = group.unrealizedPnl >= 0

  return (
    <>
      <Tr cursor="pointer" onClick={onToggle} _hover={{ bg: 'gray.50' }}>
        <Td>
          <HStack>
            {group.isMultiple ? (isOpen ? <ChevronUpIcon /> : <ChevronDownIcon />) : null}
            <VStack align="start" spacing={0}>
              <Text fontWeight="bold">{group.ticker}</Text>
              <Badge size="xs" colorScheme={group.region === 'TPE' ? 'teal' : 'orange'}>
                {group.region}
              </Badge>
            </VStack>
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
            <IconButton aria-label="Edit" icon={<EditIcon />} size="sm" variant="ghost" />
            <IconButton aria-label="Delete" icon={<DeleteIcon />} size="sm" variant="ghost" colorScheme="red" />
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

export const HoldingsTable = ({ holdings, priceMap }: Props) => {
  const aggregatedData = aggregateHoldings(holdings, priceMap)

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
              <HoldingRow key={group.ticker} group={group} />
            ))
          )}
        </Tbody>
      </Table>
    </TableContainer>
  )
}
