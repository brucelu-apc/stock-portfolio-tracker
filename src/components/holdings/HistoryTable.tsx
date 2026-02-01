import {
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  Text,
  Badge,
  VStack,
} from '@chakra-ui/react'

interface HistoricalHolding {
  id: string
  ticker: string
  shares: number
  cost_price: number
  sell_price: number
  archived_at: string
  archive_reason: string
}

interface Props {
  history: HistoricalHolding[]
}

export const HistoryTable = ({ history }: Props) => {
  const getReasonColor = (reason: string) => {
    return reason === 'sold' ? 'blue' : 'orange'
  }

  return (
    <TableContainer bg="white" rounded="lg" shadow="sm" border="1px" borderColor="gray.100">
      <Table variant="simple">
        <Thead bg="gray.50">
          <Tr>
            <Th>代碼</Th>
            <Th isNumeric>股數</Th>
            <Th isNumeric>買入價格</Th>
            <Th isNumeric>結算價格</Th>
            <Th isNumeric>損益</Th>
            <Th>日期</Th>
            <Th>原因</Th>
          </Tr>
        </Thead>
        <Tbody>
          {history.length === 0 ? (
            <Tr>
              <Td colSpan={7} textAlign="center" py={10}>
                尚無歷史成交紀錄。
              </Td>
            </Tr>
          ) : (
            history.map((h) => {
              const pnl = (h.sell_price - h.cost_price) * h.shares
              const isProfit = pnl >= 0
              return (
                <Tr key={h.id}>
                  <Td fontWeight="bold">{h.ticker}</Td>
                  <Td isNumeric>{h.shares}</Td>
                  <Td isNumeric>${h.cost_price.toFixed(2)}</Td>
                  <Td isNumeric>${h.sell_price.toFixed(2)}</Td>
                  <Td isNumeric>
                    <Text color={isProfit ? 'red.500' : 'green.500'} fontWeight="bold">
                      {isProfit ? '+' : ''}{pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </Text>
                  </Td>
                  <Td fontSize="sm" color="gray.600">
                    {new Date(h.archived_at).toLocaleDateString()}
                  </Td>
                  <Td>
                    <Badge colorScheme={getReasonColor(h.archive_reason)}>
                      {h.archive_reason === 'sold' ? '已賣出' : '已調整'}
                    </Badge>
                  </Td>
                </Tr>
              )
            })
          )}
        </Tbody>
      </Table>
    </TableContainer>
  )
}
