import {
  Box,
  SimpleGrid,
  Text,
  VStack,
  HStack,
  Heading,
  Divider,
} from '@chakra-ui/react'
import { useMemo } from 'react'

interface HistoricalHolding {
  id: string
  ticker: string
  shares: number
  cost_price: number
  sell_price: number
  fee: number
  tax: number
  archived_at: string
}

interface Props {
  history: HistoricalHolding[]
}

export const HistorySummary = ({ history }: Props) => {
  const summary = useMemo(() => {
    let totalBuy = 0
    let totalSell = 0
    let totalFee = 0
    let totalTax = 0

    history.forEach((h) => {
      totalBuy += h.cost_price * h.shares
      totalSell += h.sell_price * h.shares
      totalFee += (h.fee || 0)
      totalTax += (h.tax || 0)
    })

    const totalPnl = totalSell - totalBuy - totalFee - totalTax
    const pnlPercent = totalBuy > 0 ? (totalPnl / totalBuy) * 100 : 0

    return { totalBuy, totalSell, totalFee, totalTax, totalPnl, pnlPercent }
  }, [history])

  return (
    <Box bg="white" p={8} rounded="3xl" shadow="xl" mb={10} border="1px" borderColor="gray.50">
      <Heading size="md" mb={8} fontWeight="extrabold" color="ui.navy" letterSpacing="tight">
        已實現損益彙總 (Realized P&L)
      </Heading>
      
      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={12}>
        <VStack align="stretch" spacing={4}>
          <Box>
            <Text color="ui.slate" fontWeight="bold" fontSize="xs" textTransform="uppercase" letterSpacing="widest" mb={2}>
              本年度淨損益
            </Text>
            <Text fontWeight="900" fontSize="3xl" color={summary.totalPnl >= 0 ? 'profit' : 'loss'}>
              {summary.totalPnl >= 0 ? '+' : ''}{summary.totalPnl.toLocaleString()} 
              <Text as="span" fontSize="lg" ml={2}>({summary.pnlPercent.toFixed(2)}%)</Text>
            </Text>
          </Box>
          
          <Divider borderColor="gray.100" />
          
          <SimpleGrid columns={2} spacing={4}>
            <Box>
              <Text color="ui.slate" fontWeight="bold" fontSize="xs" mb={1}>累計買進</Text>
              <Text fontWeight="extrabold" fontSize="md">${summary.totalBuy.toLocaleString()}</Text>
            </Box>
            <Box>
              <Text color="ui.slate" fontWeight="bold" fontSize="xs" mb={1}>累計賣出</Text>
              <Text fontWeight="extrabold" fontSize="md">${summary.totalSell.toLocaleString()}</Text>
            </Box>
          </SimpleGrid>
        </VStack>

        <Box bg="gray.50" p={6} rounded="2xl">
          <VStack align="stretch" spacing={4}>
            <HStack justify="space-between">
              <Text color="ui.slate" fontWeight="bold" fontSize="sm">累計交易手續費</Text>
              <Text fontWeight="extrabold" color="ui.navy">${summary.totalFee.toLocaleString()}</Text>
            </HStack>
            <HStack justify="space-between">
              <Text color="ui.slate" fontWeight="bold" fontSize="sm">累計證券交易稅</Text>
              <Text fontWeight="extrabold" color="ui.navy">${summary.totalTax.toLocaleString()}</Text>
            </HStack>
            <Divider borderColor="gray.200" />
            <Text fontSize="xs" color="ui.slate" fontStyle="italic">
              * 數據包含所有已結算之台股與美股交易紀錄。
            </Text>
          </VStack>
        </Box>
      </SimpleGrid>
    </Box>
  )
}
