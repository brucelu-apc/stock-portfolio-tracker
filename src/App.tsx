import { useState, useEffect, useMemo } from 'react'
import {
  Box,
  Spinner,
  Center,
  Container,
  Button,
  Flex,
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
  Skeleton,
  Text,
} from '@chakra-ui/react'
import { RepeatIcon, AddIcon } from '@chakra-ui/icons'
import { supabase } from './services/supabase'
import { AuthPage } from './components/auth/AuthPage'
import { ResetPasswordPage } from './components/auth/ResetPasswordPage'
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
import { motion, AnimatePresence } from 'framer-motion'

const MotionGrid = motion(SimpleGrid)

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<any>(null)
  const [holdings, setHoldings] = useState<any[]>([])
  const [history, setHistory] = useState<any[]>([])
  const [marketData, setMarketData] = useState<{ [ticker: string]: any }>({})
  const [currentPage, setCurrentPage] = useState(window.location.pathname === '/reset-password' ? 'reset-password' : 'dashboard')
  const [refreshing, setRefreshing] = useState(false)
  const [isDataLoading, setIsDataLoading] = useState(true)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const toast = useToast()

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) {
        Promise.all([
          fetchProfile(session.user.id),
          fetchHoldings(),
          fetchHistory(),
          fetchMarketData()
        ]).then(() => {
          setIsDataLoading(false)
          setLoading(false)
        })
      } else {
        setLoading(false)
      }
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
      <Center h="100vh" bg="ui.bg">
        <Spinner size="xl" color="brand.500" thickness="4px" />
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
          <Alert status="warning" variant="subtle" flexDir="column" alignItems="center" justifyContent="center" textAlign="center" height="200px" rounded="2xl" maxW="md" shadow="xl">
            <AlertIcon boxSize="40px" mr={0} />
            <Box mt={4} fontWeight="bold">
              您的帳號狀態為：{profile?.status?.toUpperCase() || 'PENDING'}
            </Box>
            <Box mt={2}>請等待管理員審核啟用後才能開始使用。</Box>
          </Alert>
        </Center>
      )
    }

    const totalValueColor = summary.totalValue > summary.totalCost ? "profit" : summary.totalValue < summary.totalCost ? "loss" : "ui.navy";
    const totalPnlColor = summary.totalPnl > 0 ? "profit" : summary.totalPnl < 0 ? "loss" : "ui.navy";
    const totalRoiColor = summary.totalRoi > 0 ? "profit" : summary.totalRoi < 0 ? "loss" : "ui.navy";

    switch (currentPage) {
      case 'admin':
        return <UserManagement />
      case 'settings':
        return <SettingsPage userEmail={session.user.email} status={profile?.status} onNavigate={(page) => setCurrentPage(page)} />
      case 'profit':
        return <ProfitOverview history={history} />
      case 'reset-password':
        return <ResetPasswordPage onComplete={() => setCurrentPage('dashboard')} />
      default:
        return (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
            <MotionGrid 
              columns={{ base: 1, md: 4 }} 
              spacing={6} 
              mb={10}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.1 }}
            >
              {[
                { label: '總投資成本', value: summary.totalCost, color: 'ui.navy' },
                { label: '目前總市值', value: summary.totalValue, color: totalValueColor },
                { label: '預估總損益', value: summary.totalPnl, color: totalPnlColor },
                { label: '總投報率', value: summary.totalRoi, color: totalRoiColor, isPercent: true }
              ].map((s, idx) => (
                <Stat key={idx} bg="white" p={6} rounded="3xl" shadow="xl" border="1px" borderColor="gray.50">
                  <StatLabel color="ui.slate" fontWeight="bold" fontSize="xs" textTransform="uppercase" letterSpacing="widest" mb={2}>
                    {s.label}
                  </StatLabel>
                  <Skeleton isLoaded={!isDataLoading}>
                    <StatNumber fontSize="2xl" fontWeight="extrabold" color={s.color} display="flex" alignItems="center">
                      {s.isPercent ? (
                        <>
                          {s.value > 0 ? (
                            <StatArrow type="increase" color="profit" />
                          ) : s.value < 0 ? (
                            <StatArrow type="decrease" color="loss" />
                          ) : (
                            <Box as="span" mr={2} color="ui.navy">-</Box>
                          )}
                          {s.value.toFixed(2)}%
                        </>
                      ) : (
                        `$${s.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                      )}
                    </StatNumber>
                  </Skeleton>
                </Stat>
              ))}
            </MotionGrid>

            <AllocationCharts data={summary.aggregated} />

            <Box bg="white" p={8} rounded="3xl" shadow="2xl" border="1px" borderColor="gray.50">
              <Tabs variant="soft-rounded" colorScheme="blue">
                <Flex justify="space-between" align="center" mb={6}>
                  <TabList bg="gray.100" p={1} rounded="xl">
                    <Tab fontWeight="bold" _selected={{ bg: 'white', shadow: 'md' }}>我的持股</Tab>
                    <Tab fontWeight="bold" _selected={{ bg: 'white', shadow: 'md' }}>歷史成交</Tab>
                  </TabList>
                  
                  <HStack spacing={3}>
                    <Button 
                      leftIcon={<RepeatIcon />} 
                      variant="ghost" 
                      size="sm"
                      onClick={handleManualRefresh}
                      isLoading={refreshing}
                      rounded="xl"
                    >
                      更新
                    </Button>
                    <Button 
                      leftIcon={<AddIcon />} 
                      colorScheme="blue" 
                      size="sm"
                      onClick={onOpen}
                      rounded="xl"
                      px={6}
                      bgGradient="linear(to-r, brand.500, brand.600)"
                      _hover={{ bgGradient: "linear(to-r, brand.600, brand.900)" }}
                    >
                      新增持股
                    </Button>
                  </HStack>
                </Flex>

                <TabPanels>
                  <TabPanel p={0}>
                    <HoldingsTable 
                      holdings={holdings} 
                      marketData={marketData} 
                      isLoading={isDataLoading}
                      onDataChange={() => { fetchHoldings(); fetchHistory(); }} 
                    />
                  </TabPanel>
                  <TabPanel p={0}>
                    <HistorySummary history={history} />
                    <HistoryTable history={history} />
                  </TabPanel>
                </TabPanels>
              </Tabs>
            </Box>

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
    <Box minH="100vh" bg="ui.bg">
      <Navbar 
        userEmail={session.user.email} 
        role={profile?.role} 
        currentPage={currentPage}
        onNavigate={(page) => setCurrentPage(page)}
      />
      <Container maxW="container.xl" py={12}>
        <AnimatePresence mode="wait">
          {renderContent()}
        </AnimatePresence>
      </Container>
    </Box>
  )
}

export default App
