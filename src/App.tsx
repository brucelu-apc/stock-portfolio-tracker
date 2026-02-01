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
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  useToast,
} from '@chakra-ui/react'
import { RepeatIcon, AddIcon } from '@chakra-ui/icons'
import { supabase } from './services/supabase'
import { AuthPage } from './components/auth/AuthPage'
import { Navbar } from './components/common/Navbar'
import { AddHoldingModal } from './components/holdings/AddHoldingModal'
import { HoldingsTable } from './components/holdings/HoldingsTable'
import { AllocationCharts } from './components/dashboard/AllocationCharts'
import { ProfitOverview } from './components/dashboard/ProfitOverview'
import { HistoryTable } from './components/holdings/HistoryTable'
import { HistorySummary } from './components/holdings/HistorySummary'
import { UserManagement } from './components/admin/UserManagement'
import { SettingsPage } from './components/settings/SettingsPage'
import { Session } from '@supabase/supabase-js'
import { aggregateHoldings } from './utils/calculations'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<any>(null)
  const [holdings, setHoldings] = useState<any[]>([])
  const [history, setHistory] = useState<any[]>([])
  const [marketData, setMarketData] = useState<{ [ticker: string]: any }>({})
  const [currentPage, setCurrentPage] = useState('dashboard')
  const [refreshing, setRefreshing] = useState(false)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const toast = useToast()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) {
        fetchProfile(session.user.id)
        fetchHoldings()
        fetchHistory()
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
        fetchHistory()
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

  const fetchHistory = async () => {
    const { data, error } = await supabase
      .from('historical_holdings')
      .select('*')
      .order('archived_at', { ascending: false })

    if (error) {
      console.error('Error fetching history:', error)
    } else {
      setHistory(data || [])
    }
  }

  const fetchMarketData = async () => {
    const { data, error } = await supabase
      .from('market_data')
      .select('*')

    if (error) {
      console.error('Error fetching market data:', error)
    } else {
      const priceMap: { [ticker: string]: any } = {}
      data?.forEach((item: any) => {
        priceMap[item.ticker] = item
      })
      setMarketData(priceMap)
    }
  }

  const handleManualRefresh = async () => {
    setRefreshing(true)
    await fetchMarketData()
    await fetchHoldings()
    await fetchHistory()
    setRefreshing(false)
    toast({
      title: '數據已更新',
      description: '已從伺服器獲取最新市場資訊。',
      status: 'success',
      duration: 3000,
    })
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
      case 'profit':
        return <ProfitOverview history={history} />
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

            {/* Added Charts */}
            <AllocationCharts data={summary.aggregated} />

            <Tabs variant="enclosed" colorScheme="blue">
              <TabList mb={4}>
                <Tab fontWeight="bold">我的持股</Tab>
                <Tab fontWeight="bold">歷史成交</Tab>
              </TabList>

              <TabPanels>
                <TabPanel p={0}>
                  <Flex justify="flex-end" mb={4} gap={2}>
                    <Button 
                      leftIcon={<RepeatIcon />} 
                      variant="outline" 
                      size="sm"
                      onClick={handleManualRefresh}
                      isLoading={refreshing}
                    >
                      更新股價
                    </Button>
                    <Button 
                      leftIcon={<AddIcon />} 
                      colorScheme="blue" 
                      size="sm"
                      onClick={onOpen}
                    >
                      新增持股
                    </Button>
                  </Flex>
                  <HoldingsTable 
                    holdings={holdings} 
                    marketData={marketData} 
                    onDataChange={() => { fetchHoldings(); fetchHistory(); }} 
                  />
                </TabPanel>
                
                <TabPanel p={0}>
                  <HistorySummary history={history} />
                  <HistoryTable history={history} />
                </TabPanel>
              </TabPanels>
            </Tabs>

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
