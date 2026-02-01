import {
  Box,
  SimpleGrid,
  Text,
  VStack,
  HStack,
  Heading,
  Divider,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
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
    <Box bg="white" p={6} rounded="lg" shadow="sm" mb={6} border="1px" borderColor="gray.100">
      <Heading size="sm" mb={4} color="gray.600">已實現彙總</Heading>
      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={10}>
        <VStack align="stretch" spacing={2}>
          <HStack justify="space-between">
            <Text color="gray.500">總損益 (TWD)</Text>
            <Text fontWeight="bold" fontSize="xl" color={summary.totalPnl >= 0 ? 'red.500' : 'green.500'}>
              {summary.totalPnl >= 0 ? '+' : ''}{summary.totalPnl.toLocaleString()} ({summary.pnlPercent.toFixed(2)}%)
            </Text>
          </HStack>
          
          <Divider />
          
          <HStack justify="space-between">
            <Text color="gray.500">總買進</Text>
            <Text fontWeight="semibold">{summary.totalBuy.toLocaleString()}</Text>
          </HStack>
          <HStack justify="space-between">
            <Text color="gray.500">總賣出</Text>
            <Text fontWeight="semibold">{summary.totalSell.toLocaleString()}</Text>
          </HStack>
        </VStack>

        <VStack align="stretch" spacing={2}>
          <HStack justify="space-between">
            <Text color="gray.500">總手續費</Text>
            <Text fontWeight="semibold">{summary.totalFee.toLocaleString()}</Text>
          </HStack>
          <HStack justify="space-between">
            <Text color="gray.500">總交易稅</Text>
            <Text fontWeight="semibold">{summary.totalTax.toLocaleString()}</Text>
          </HStack>
        </VStack>
      </SimpleGrid>
    </Box>
  )
}
