import { useState, useEffect, useMemo } from 'react'
import {
  Box,
  Spinner,
  Center,
  Container,
  Button,
  Flex,
  HStack,
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
} from '@chakra-ui/react'
import { RepeatIcon, AddIcon, DownloadIcon, ExternalLinkIcon } from '@chakra-ui/icons'
import { supabase } from './services/supabase'
import { AuthPage } from './components/auth/AuthPage'
import { ResetPasswordPage } from './components/auth/ResetPasswordPage'
import { Navbar } from './components/common/Navbar'
import { AnnouncementModal } from './components/common/AnnouncementModal'
import { PersonalInfoModal } from './components/auth/PersonalInfoModal'
import { AddHoldingModal } from './components/holdings/AddHoldingModal'
import { HoldingsTable } from './components/holdings/HoldingsTable'
import { AllocationCharts } from './components/dashboard/AllocationCharts'
import { ProfitOverview } from './components/dashboard/ProfitOverview'
import { HistoryTable } from './components/holdings/HistoryTable'
import { HistorySummary } from './components/holdings/HistorySummary'
import { UserManagement } from './components/admin/UserManagement'
import { SettingsPage } from './components/settings/SettingsPage'
import { ImportDataModal } from './components/holdings/ImportDataModal'
import { NotificationInput } from './components/advisory/NotificationInput'
import { AdvisoryTable } from './components/advisory/AdvisoryTable'
import { AlertPanel } from './components/advisory/AlertPanel'
import { AdvisoryHistory } from './components/advisory/AdvisoryHistory'
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
  const {
    isOpen: isImportOpen,
    onOpen: onImportOpen,
    onClose: onImportClose
  } = useDisclosure()
  const toast = useToast()

  // --- Announcement state ---
  const [announcement, setAnnouncement] = useState<any>(null)
  const {
    isOpen: isAnnouncementOpen,
    onOpen: onAnnouncementOpen,
    onClose: onAnnouncementClose,
  } = useDisclosure()

  // --- Personal info modal state (first-time login) ---
  const [showPersonalInfo, setShowPersonalInfo] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) {
        Promise.all([
          fetchProfile(session.user.id),
          fetchHoldings(),
          fetchHistory(),
          fetchMarketData(),
          fetchAnnouncement(),
          checkRegistrationInfo(session.user.id),
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
        fetchAnnouncement()
        checkRegistrationInfo(session.user.id)
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

  // --- Feature 1: Fetch latest active announcement ---
  const fetchAnnouncement = async () => {
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (data) {
      setAnnouncement(data)
      // Auto-show on login (only once per session)
      const dismissedId = sessionStorage.getItem('dismissed_announcement')
      if (dismissedId !== data.id) {
        onAnnouncementOpen()
      }
    }
  }

  const handleAnnouncementClose = () => {
    if (announcement) {
      sessionStorage.setItem('dismissed_announcement', announcement.id)
    }
    onAnnouncementClose()
  }

  // --- Feature 3: Check if user has filled in registration info ---
  const checkRegistrationInfo = async (userId: string) => {
    const { data } = await supabase
      .from('user_registration_info')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle()

    if (!data) {
      // First-time login — show personal info modal
      setShowPersonalInfo(true)
    }
  }

  const handleManualRefresh = async () => {
    setRefreshing(true)

    try {
      const ghToken = import.meta.env.VITE_GITHUB_TOKEN
      const ghOwner = import.meta.env.VITE_GITHUB_OWNER
      const ghRepo = import.meta.env.VITE_GITHUB_REPO

      if (ghToken && ghOwner && ghRepo) {
        // Trigger GitHub Action via workflow_dispatch
        const response = await fetch(
          `https://api.github.com/repos/${ghOwner}/${ghRepo}/actions/workflows/market-update.yml/dispatches`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${ghToken}`,
              'Accept': 'application/vnd.github+json',
            },
            body: JSON.stringify({ ref: 'master' }),
          }
        )

        if (response.ok) {
          toast({
            title: '更新指令已發送',
            description: 'GitHub Actions 正在背景抓取最新數據，請稍候 1-2 分鐘再重新整理。',
            status: 'info',
            duration: 5000,
          })
        } else {
          console.error('GitHub API error:', await response.text())
        }
      }
    } catch (err) {
      console.error('Failed to trigger update:', err)
    }

    await fetchMarketData()
    await fetchHoldings()
    await fetchHistory()
    setRefreshing(false)
  }

  const handleExportCSV = () => {
    if (holdings.length === 0) {
      toast({
        title: '沒有資料可導出',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    // Define CSV headers
    const headers = ['ticker', 'region', 'name', 'shares', 'cost_price', 'strategy_mode', 'buy_date']

    // Create rows
    const rows = holdings.map(h => [
      h.ticker,
      h.region,
      h.name,
      h.shares,
      h.cost_price,
      h.strategy_mode,
      h.buy_date
    ].map(val => `"${val}"`).join(','))

    const csvContent = [headers.join(','), ...rows].join('\n')
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)

    const link = document.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('download', `portfolio_export_${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    toast({
      title: '導出成功',
      description: '持股資料已轉為 CSV 檔案下載。',
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
        return <SettingsPage userId={session.user.id} userEmail={session.user.email} status={profile?.status} onNavigate={(page) => setCurrentPage(page)} />
      case 'profit':
        return <ProfitOverview history={history} />
      case 'advisory':
        // Feature 2: Check advisory access permission
        if (!profile?.can_access_advisory && profile?.role !== 'admin') {
          return (
            <Center mt={10}>
              <Alert status="info" variant="subtle" flexDir="column" alignItems="center" justifyContent="center" textAlign="center" height="200px" rounded="2xl" maxW="md" shadow="xl">
                <AlertIcon boxSize="40px" mr={0} />
                <Box mt={4} fontWeight="bold">
                  投顧追蹤功能尚未開通
                </Box>
                <Box mt={2}>請聯繫管理員開啟此功能的使用權限。</Box>
              </Alert>
            </Center>
          )
        }
        return (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }}>
            <SimpleGrid columns={{ base: 1, lg: 3 }} spacing={6} mb={6}>
              <Box gridColumn={{ base: '1', lg: '1 / 3' }}>
                <NotificationInput
                  userId={session.user.id}
                  onImportSuccess={() => {
                    fetchMarketData()
                  }}
                />
              </Box>
              <Box>
                <AlertPanel userId={session.user.id} />
              </Box>
            </SimpleGrid>
            <Box mb={6}>
              <AdvisoryTable
                userId={session.user.id}
                holdings={holdings}
              />
            </Box>
            <Box mb={6}>
              <AdvisoryHistory userId={session.user.id} />
            </Box>
          </motion.div>
        )
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
                      leftIcon={<ExternalLinkIcon />}
                      variant="ghost"
                      size="sm"
                      onClick={onImportOpen}
                      rounded="xl"
                    >
                      導入 CSV
                    </Button>
                    <Button
                      leftIcon={<DownloadIcon />}
                      variant="ghost"
                      size="sm"
                      onClick={handleExportCSV}
                      rounded="xl"
                    >
                      導出 CSV
                    </Button>
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
            <ImportDataModal
              isOpen={isImportOpen}
              onClose={onImportClose}
              onSuccess={() => {
                fetchHoldings()
                fetchMarketData()
              }}
            />
          </motion.div>
        )
    }
  }

  return (
    <Box minH="100vh" bg="ui.bg">
      <Navbar
        userEmail={session.user.email}
        role={profile?.role}
        canAccessAdvisory={profile?.can_access_advisory || false}
        hasAnnouncement={!!announcement}
        currentPage={currentPage}
        onNavigate={(page) => setCurrentPage(page)}
        onOpenAnnouncement={onAnnouncementOpen}
      />
      <Container maxW="container.xl" py={12}>
        <AnimatePresence mode="wait">
          {renderContent()}
        </AnimatePresence>
      </Container>

      {/* Feature 1: Announcement Modal */}
      <AnnouncementModal
        isOpen={isAnnouncementOpen}
        onClose={handleAnnouncementClose}
        announcement={announcement}
      />

      {/* Feature 3: Personal Info Modal (first-time login) */}
      {session && showPersonalInfo && (
        <PersonalInfoModal
          isOpen={showPersonalInfo}
          onClose={() => setShowPersonalInfo(false)}
          userId={session.user.id}
          userEmail={session.user.email || ''}
        />
      )}
    </Box>
  )
}

export default App
