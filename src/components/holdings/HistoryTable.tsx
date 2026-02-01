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
  Box,
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
    <Box bg="white" rounded="3xl" shadow="xl" border="1px" borderColor="gray.50" overflow="hidden">
      <TableContainer>
        <Table variant="simple">
          <Thead bg="gray.50">
            <Tr>
              <Th py={5}>代碼</Th>
              <Th isNumeric>股數</Th>
              <Th isNumeric>買入價格</Th>
              <Th isNumeric>結算價格</Th>
              <Th isNumeric>結算損益</Th>
              <Th>成交日期</Th>
              <Th>紀錄原因</Th>
            </Tr>
          </Thead>
          <Tbody>
            {history.length === 0 ? (
              <Tr>
                <Td colSpan={7} textAlign="center" py={12}>
                  <Text color="ui.slate" fontWeight="medium">尚無歷史成交紀錄。</Text>
                </Td>
              </Tr>
            ) : (
              history.map((h) => {
                const pnl = (h.sell_price - h.cost_price) * h.shares
                const isProfit = pnl >= 0
                return (
                  <Tr key={h.id} _hover={{ bg: 'gray.50' }}>
                    <Td fontWeight="bold" color="ui.navy">{h.ticker}</Td>
                    <Td isNumeric fontWeight="medium">{h.shares.toLocaleString()}</Td>
                    <Td isNumeric color="ui.slate">${h.cost_price.toFixed(2)}</Td>
                    <Td isNumeric fontWeight="bold">${h.sell_price.toFixed(2)}</Td>
                    <Td isNumeric>
                      <Text color={isProfit ? 'profit' : 'loss'} fontWeight="extrabold">
                        {isProfit ? '+' : ''}{pnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </Text>
                    </Td>
                    <Td fontSize="sm" color="ui.slate">
                      {new Date(h.archived_at).toLocaleDateString()}
                    </Td>
                    <Td>
                      <Badge 
                        variant="subtle" 
                        colorScheme={getReasonColor(h.archive_reason)}
                        rounded="full"
                        px={3}
                      >
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
    </Box>
  )
}
