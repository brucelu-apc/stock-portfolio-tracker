import {
  Box,
  Heading,
  SimpleGrid,
  Select,
  HStack,
  Text,
  VStack,
  Divider,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  StatArrow,
} from '@chakra-ui/react'
import { useState, useMemo } from 'react'
import { HistorySummary } from '../holdings/HistorySummary'
import { HistoryTable } from '../holdings/HistoryTable'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'

interface Props {
  history: any[]
}

export const ProfitOverview = ({ history }: Props) => {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear().toString())

  const years = useMemo(() => {
    const y = new Set(history.map(h => new Date(h.archived_at).getFullYear().toString()))
    if (y.size === 0) y.add(new Date().getFullYear().toString())
    return Array.from(y).sort((a, b) => b.localeCompare(a))
  }, [history])

  const filteredHistory = useMemo(() => {
    return history.filter(h => new Date(h.archived_at).getFullYear().toString() === selectedYear)
  }, [history, selectedYear])

  const monthlyData = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      name: `${i + 1}月`,
      pnl: 0,
    }))

    filteredHistory.forEach(h => {
      const month = new Date(h.archived_at).getMonth()
      const pnl = (h.sell_price - h.cost_price) * h.shares - (h.fee || 0) - (h.tax || 0)
      months[month].pnl += pnl
    })

    return months
  }, [filteredHistory])

  return (
    <Box>
      <Flex justify="space-between" align="center" mb={6}>
        <Heading size="md">獲利總覽</Heading>
        <Select 
          w="150px" 
          value={selectedYear} 
          onChange={(e) => setSelectedYear(e.target.value)}
          bg="white"
        >
          {years.map(y => <option key={y} value={y}>{y} 年</option>)}
        </Select>
      </Flex>

      <HistorySummary history={filteredHistory} />

      <Box bg="white" p={6} rounded="lg" shadow="sm" mb={6} border="1px" borderColor="gray.100">
        <Heading size="sm" mb={6} color="gray.600">{selectedYear} 年 月度獲利分佈 (TWD)</Heading>
        <Box h="300px">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip 
                formatter={(value: number) => [`$${value.toLocaleString()}`, '淨損益']}
              />
              <Bar dataKey="pnl">
                {monthlyData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#E53E3E' : '#38A169'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Box>
      </Box>

      <Heading size="sm" mb={4} color="gray.600">本年度成交明細</Heading>
      <HistoryTable history={filteredHistory} />
    </Box>
  )
}

import { Flex } from '@chakra-ui/react'
