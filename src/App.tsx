import { useState, useEffect, useMemo } from 'react'
import { 
  Box, 
  Spinner, 
  Center, 
  Container, 
  Button, 
  Flex, 
  Heading, 
  useDisclosure,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  StatArrow,
} from '@chakra-ui/react'
import { AddIcon } from '@chakra-ui/icons'
import { supabase } from './services/supabase'
import { AuthPage } from './components/auth/AuthPage'
import { Navbar } from './components/common/Navbar'
import { AddHoldingModal } from './components/holdings/AddHoldingModal'
import { HoldingsTable } from './components/holdings/HoldingsTable'
import { Session } from '@supabase/supabase-js'
import { aggregateHoldings } from './utils/calculations'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [holdings, setHoldings] = useState<any[]>([])
  const [marketData, setMarketData] = useState<{ [key: string]: any }>({})
  const { isOpen, onOpen, onClose } = useDisclosure()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
      if (session) {
        fetchHoldings()
        fetchMarketData()
      }
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) {
        fetchHoldings()
        fetchMarketData()
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchHoldings = async () => {
    const { data, error } = await supabase
      .from('portfolio_holdings')
      .select('*')
      .order('buy_date', { ascending: false })

    if (error) {
      console.error('Error fetching holdings:', error)
    } else {
      setHoldings(data || [])
    }
  }

  const fetchMarketData = async () => {
    const { data, error } = await supabase
      .from('market_data')
      .select('*')

    if (error) {
      console.error('Error fetching market data:', error)
    } else {
      const mapping = (data || []).reduce((acc: any, curr: any) => {
        acc[curr.ticker] = curr
        return acc
      }, {})
      setMarketData(mapping)
    }
  }

  const summary = useMemo(() => {
    const aggregated = aggregateHoldings(holdings)
    let totalCost = 0
    let totalValue = 0

    const fxRate = marketData['USDTWD']?.current_price || 32.5 // Fallback to 32.5

    aggregated.forEach(g => {
      totalCost += g.totalCost
      const currentPrice = marketData[g.ticker]?.current_price || g.avgCost
      const value = currentPrice * g.totalShares
      
      // If US stock, convert to TWD
      if (g.region === 'US') {
        totalValue += value * fxRate
      } else {
        totalValue += value
      }
    })

    const totalPnl = totalValue - totalCost
    const totalRoi = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0

    return { totalCost, totalValue, totalPnl, totalRoi }
  }, [holdings])

  if (loading) {
    return (
      <Center h="100vh">
        <Spinner size="xl" color="blue.500" />
      </Center>
    )
  }

  if (!session) {
    return <AuthPage />
  }

  return (
    <Box minH="100vh" bg="gray.50">
      <Navbar userEmail={session.user.email} />
      
      <Container maxW="container.xl" py={8}>
        <SimpleGrid columns={{ base: 1, md: 4 }} spacing={6} mb={8}>
          <Stat bg="white" p={4} rounded="lg" shadow="sm">
            <StatLabel color="gray.500">總投資成本</StatLabel>
            <StatNumber>${summary.totalCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</StatNumber>
          </Stat>
          <Stat bg="white" p={4} rounded="lg" shadow="sm">
            <StatLabel color="gray.500">目前總市值</StatLabel>
            <StatNumber>${summary.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</StatNumber>
          </Stat>
          <Stat bg="white" p={4} rounded="lg" shadow="sm">
            <StatLabel color="gray.500">預估總損益</StatLabel>
            <StatNumber color={summary.totalPnl >= 0 ? "red.500" : "green.500"}>
              {summary.totalPnl >= 0 ? '+' : ''}
              {summary.totalPnl.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </StatNumber>
          </Stat>
          <Stat bg="white" p={4} rounded="lg" shadow="sm">
            <StatLabel color="gray.500">總投報率</StatLabel>
            <StatNumber color={summary.totalRoi >= 0 ? "red.500" : "green.500"}>
              <StatArrow type={summary.totalRoi >= 0 ? 'increase' : 'decrease'} />
              {summary.totalRoi.toFixed(2)}%
            </StatNumber>
          </Stat>
        </SimpleGrid>

        <Flex justify="space-between" align="center" mb={6}>
          <Heading size="lg">我的持股</Heading>
          <Button 
            leftIcon={<AddIcon />} 
            colorScheme="blue" 
            onClick={onOpen}
          >
            新增持股
          </Button>
        </Flex>

        <HoldingsTable holdings={holdings} marketData={marketData} />

        <AddHoldingModal 
          isOpen={isOpen} 
          onClose={onClose} 
          onSuccess={fetchHoldings} 
        />
      </Container>
    </Box>
  )
}

export default App
