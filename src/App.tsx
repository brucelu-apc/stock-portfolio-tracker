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
  StatArrow,
  Alert,
  AlertIcon,
} from '@chakra-ui/react'
import { AddIcon } from '@chakra-ui/icons'
import { supabase } from './services/supabase'
import { AuthPage } from './components/auth/AuthPage'
import { Navbar } from './components/common/Navbar'
import { AddHoldingModal } from './components/holdings/AddHoldingModal'
import { HoldingsTable } from './components/holdings/HoldingsTable'
import { UserManagement } from './components/admin/UserManagement'
import { SettingsPage } from './components/settings/SettingsPage'
import { Session } from '@supabase/supabase-js'
import { aggregateHoldings } from './utils/calculations'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<any>(null)
  const [holdings, setHoldings] = useState<any[]>([])
  const [marketData, setMarketData] = useState<{ [ticker: string]: number }>({})
  const [currentPage, setCurrentPage] = useState('dashboard')
  const { isOpen, onOpen, onClose } = useDisclosure()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) {
        fetchProfile(session.user.id)
        fetchHoldings()
        fetchMarketData()
      }
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) {
        fetchProfile(session.user.id)
        fetchHoldings()
        fetchMarketData()
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchProfile = async (userId: string) => {
    const { data } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', userId)
      .single()
    setProfile(data)
  }

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
      .select('ticker, current_price')

    if (error) {
      console.error('Error fetching market data:', error)
    } else {
      const priceMap: { [ticker: string]: number } = {}
      data?.forEach((item: any) => {
        priceMap[item.ticker] = item.current_price
      })
      setMarketData(priceMap)
    }
  }

  const summary = useMemo(() => {
    const aggregated = aggregateHoldings(holdings, marketData)
    let totalCost = 0
    let totalValue = 0

    aggregated.forEach(g => {
      totalCost += g.totalCost
      totalValue += g.marketValue
    })

    const totalPnl = totalValue - totalCost
    const totalRoi = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0

    return { totalCost, totalValue, totalPnl, totalRoi, aggregated }
  }, [holdings, marketData])

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

  const renderContent = () => {
    if (profile?.status !== 'enabled' && profile?.role !== 'admin') {
      return (
        <Center mt={10}>
          <Alert status="warning" variant="subtle" flexDir="column" alignItems="center" justifyContent="center" textAlign="center" height="200px" rounded="lg" maxW="md">
            <AlertIcon boxSize="40px" mr={0} />
            <Box mt={4} fontWeight="bold">
              您的帳號狀態為：{profile?.status?.toUpperCase() || 'PENDING'}
            </Box>
            <Box mt={2}>請等待管理員審核啟用後才能開始使用。</Box>
          </Alert>
        </Center>
      )
    }

    switch (currentPage) {
      case 'admin':
        return <UserManagement />
      case 'settings':
        return <SettingsPage userEmail={session.user.email} status={profile?.status} onNavigate={(page) => setCurrentPage(page)} />
      default:
        return (
          <>
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

            <HoldingsTable holdings={holdings} priceMap={marketData} onDataChange={fetchHoldings} />

            <AddHoldingModal
              isOpen={isOpen}
              onClose={onClose}
              onSuccess={() => {
                fetchHoldings()
                fetchMarketData()
              }}
            />
          </>
        )
    }
  }

  return (
    <Box minH="100vh" bg="gray.50">
      <Navbar
        userEmail={session.user.email}
        role={profile?.role}
        onNavigate={(page) => setCurrentPage(page)}
      />
      <Container maxW="container.xl" py={8}>
        {renderContent()}
      </Container>
    </Box>
  )
}

export default App
