/**
 * AdvisoryHistory — Historical view of advisory tracking activity.
 *
 * Three tabs:
 *  1. Alert History — All triggered price alerts with filters
 *  2. Target Archive — Past price targets (is_latest = false)
 *  3. Forward Logs — History of forwarded stock messages
 *
 * Features:
 *  - Stock name display alongside ticker codes
 *  - Admin bulk delete with checkbox selection + confirmation
 *
 * Data sources:
 *  - price_alerts (triggered_at DESC, with type/ticker filters)
 *  - price_targets (is_latest = false for archived targets; also used for name lookup)
 *  - forward_logs (with forward_targets join for names)
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  Box,
  VStack,
  HStack,
  Text,
  Flex,
  Badge,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Select,
  Spinner,
  Stat,
  StatLabel,
  StatNumber,
  StatGroup,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  Tag,
  TagLabel,
  Checkbox,
  Button,
  AlertDialog,
  AlertDialogBody,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogContent,
  AlertDialogOverlay,
  useDisclosure,
  useToast,
} from '@chakra-ui/react'
import { DeleteIcon } from '@chakra-ui/icons'
import { supabase } from '../../services/supabase'

// ─── Types ──────────────────────────────────────────────────

interface AlertRecord {
  id: string
  ticker: string
  alert_type: string
  trigger_price: number
  current_price: number
  notified_via: string[]
  triggered_at: string
  acknowledged: boolean
}

interface ArchivedTarget {
  id: string
  ticker: string
  stock_name?: string | null
  defense_price: number | null
  min_target_low: number | null
  min_target_high: number | null
  reasonable_target_low: number | null
  reasonable_target_high: number | null
  effective_date: string
  created_at: string
}

interface ForwardLog {
  id: string
  tickers: string[]
  message_content: any
  forwarded_at: string
  forward_targets?: {
    target_name: string
    platform: string
  } | null
}

// ─── Config ─────────────────────────────────────────────────

const ALERT_CONFIG: Record<string, { label: string; color: string; emoji: string }> = {
  defense_breach: { label: '跌破防守', color: 'red', emoji: '🔴' },
  min_target_reached: { label: '達最小目標', color: 'green', emoji: '🟢' },
  reasonable_target_reached: { label: '達合理目標', color: 'yellow', emoji: '🟡' },
  tp_triggered: { label: '停利', color: 'blue', emoji: '🔵' },
  sl_triggered: { label: '停損', color: 'red', emoji: '🔴' },
}

// ─── Helpers ────────────────────────────────────────────────

function formatDate(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleDateString('zh-TW', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function formatDateTime(ts: string): string {
  const d = new Date(ts)
  return d.toLocaleDateString('zh-TW', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ─── Component ──────────────────────────────────────────────

interface AdvisoryHistoryProps {
  userId: string
  role?: string
}

export const AdvisoryHistory = ({ userId: _userId, role }: AdvisoryHistoryProps) => {
  const toast = useToast()
  const [alerts, setAlerts] = useState<AlertRecord[]>([])
  const [archived, setArchived] = useState<ArchivedTarget[]>([])
  const [forwardLogs, setForwardLogs] = useState<ForwardLog[]>([])
  const [nameMap, setNameMap] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [alertFilter, setAlertFilter] = useState('all')
  const [period, setPeriod] = useState('30')

  // Admin bulk-delete state
  const isAdmin = role === 'admin'
  const [selectedAlerts, setSelectedAlerts] = useState<Set<string>>(new Set())
  const [selectedArchived, setSelectedArchived] = useState<Set<string>>(new Set())
  const [selectedLogs, setSelectedLogs] = useState<Set<string>>(new Set())
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<'alerts' | 'archived' | 'logs' | null>(null)
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure()
  const cancelRef = useRef<HTMLButtonElement>(null)

  // ── Fetch all history data ──

  const fetchHistory = useCallback(async () => {
    setIsLoading(true)

    const daysAgo = parseInt(period)
    const since = new Date()
    since.setDate(since.getDate() - daysAgo)
    const sinceStr = since.toISOString()

    try {
      const [alertsRes, archivedRes, logsRes, namesRes] = await Promise.all([
        // Alert history
        supabase
          .from('price_alerts')
          .select('*')
          .gte('triggered_at', sinceStr)
          .order('triggered_at', { ascending: false })
          .limit(100),
        // Archived price targets (include stock_name)
        supabase
          .from('price_targets')
          .select('id, ticker, stock_name, defense_price, min_target_low, min_target_high, reasonable_target_low, reasonable_target_high, effective_date, created_at')
          .eq('is_latest', false)
          .order('created_at', { ascending: false })
          .limit(50),
        // Forward logs
        supabase
          .from('forward_logs')
          .select('*, forward_targets(target_name, platform)')
          .gte('forwarded_at', sinceStr)
          .order('forwarded_at', { ascending: false })
          .limit(50),
        // Name lookup: fetch all price_targets (both latest & archived) for ticker→name mapping
        supabase
          .from('price_targets')
          .select('ticker, stock_name')
          .not('stock_name', 'is', null)
          .order('created_at', { ascending: false }),
      ])

      if (alertsRes.data) setAlerts(alertsRes.data)
      if (archivedRes.data) setArchived(archivedRes.data)
      if (logsRes.data) setForwardLogs(logsRes.data)

      // Build ticker → name map (latest name wins due to DESC ordering)
      if (namesRes.data) {
        const map: Record<string, string> = {}
        namesRes.data.forEach((row: any) => {
          if (row.stock_name && !map[row.ticker]) {
            map[row.ticker] = row.stock_name
          }
        })
        setNameMap(map)
      }
    } catch (err) {
      console.error('History fetch error:', err)
    } finally {
      setIsLoading(false)
    }
  }, [period])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  // Clear selections when data refreshes
  useEffect(() => {
    setSelectedAlerts(new Set())
    setSelectedArchived(new Set())
    setSelectedLogs(new Set())
  }, [alerts, archived, forwardLogs])

  // ── Statistics ──

  const totalAlerts = alerts.length
  const defenseBreaches = alerts.filter((a) => a.alert_type === 'defense_breach').length
  const targetsReached = alerts.filter(
    (a) => a.alert_type === 'min_target_reached' || a.alert_type === 'reasonable_target_reached'
  ).length
  const uniqueTickers = new Set(alerts.map((a) => a.ticker)).size

  // ── Filter alerts ──

  const filteredAlerts =
    alertFilter === 'all'
      ? alerts
      : alerts.filter((a) => a.alert_type === alertFilter)

  // ── Selection helpers ──

  const toggleSelection = (
    set: Set<string>,
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string
  ) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setter(next)
  }

  const toggleSelectAll = (
    items: { id: string }[],
    set: Set<string>,
    setter: React.Dispatch<React.SetStateAction<Set<string>>>
  ) => {
    if (set.size === items.length) {
      setter(new Set())
    } else {
      setter(new Set(items.map((i) => i.id)))
    }
  }

  // ── Bulk delete ──

  const currentDeleteCount = useMemo(() => {
    if (deleteTarget === 'alerts') return selectedAlerts.size
    if (deleteTarget === 'archived') return selectedArchived.size
    if (deleteTarget === 'logs') return selectedLogs.size
    return 0
  }, [deleteTarget, selectedAlerts, selectedArchived, selectedLogs])

  const deleteTableName = useMemo(() => {
    if (deleteTarget === 'alerts') return '警示紀錄'
    if (deleteTarget === 'archived') return '已歸檔標的'
    if (deleteTarget === 'logs') return '轉發紀錄'
    return ''
  }, [deleteTarget])

  const handleDeleteConfirm = async () => {
    setIsDeleting(true)
    try {
      let ids: string[] = []
      let table = ''

      if (deleteTarget === 'alerts') {
        ids = Array.from(selectedAlerts)
        table = 'price_alerts'
      } else if (deleteTarget === 'archived') {
        ids = Array.from(selectedArchived)
        table = 'price_targets'
      } else if (deleteTarget === 'logs') {
        ids = Array.from(selectedLogs)
        table = 'forward_logs'
      }

      if (ids.length === 0 || !table) return

      const { error } = await supabase
        .from(table)
        .delete()
        .in('id', ids)

      if (error) {
        toast({
          title: '刪除失敗',
          description: error.message,
          status: 'error',
          duration: 4000,
        })
      } else {
        toast({
          title: '刪除成功',
          description: `已刪除 ${ids.length} 筆${deleteTableName}`,
          status: 'success',
          duration: 3000,
        })
        // Refresh data
        fetchHistory()
      }
    } catch (err) {
      console.error('Delete error:', err)
      toast({ title: '刪除時發生錯誤', status: 'error', duration: 3000 })
    } finally {
      setIsDeleting(false)
      onDeleteClose()
    }
  }

  const openDeleteDialog = (target: 'alerts' | 'archived' | 'logs') => {
    setDeleteTarget(target)
    onDeleteOpen()
  }

  // ── Render helper: stock name display ──

  const renderTickerName = (ticker: string, stockName?: string | null) => {
    const name = stockName || nameMap[ticker]
    return (
      <VStack align="start" spacing={0}>
        <Text fontWeight="bold" fontSize="sm">{ticker}</Text>
        {name && (
          <Text fontSize="xs" color="gray.500" noOfLines={1}>{name}</Text>
        )}
      </VStack>
    )
  }

  // ── Render ──

  return (
    <Box bg="white" p={{ base: 4, md: 8 }} rounded="3xl" shadow="2xl" border="1px" borderColor="gray.50">
      {/* Header */}
      <Flex
        justify="space-between"
        align={{ base: 'start', md: 'center' }}
        direction={{ base: 'column', md: 'row' }}
        gap={3}
        mb={6}
      >
        <VStack align="start" spacing={1}>
          <Text fontSize="lg" fontWeight="extrabold" color="ui.navy">
            投顧追蹤歷史
          </Text>
          <Text fontSize="xs" color="ui.slate">
            歷史警示、已歸檔標的、轉發紀錄
          </Text>
        </VStack>
        <Select
          size="sm"
          rounded="xl"
          w={{ base: 'full', md: '130px' }}
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
        >
          <option value="7">近 7 天</option>
          <option value="30">近 30 天</option>
          <option value="90">近 90 天</option>
          <option value="365">近一年</option>
        </Select>
      </Flex>

      {/* Summary Stats */}
      <StatGroup
        mb={6}
        p={4}
        bg="gray.50"
        rounded="2xl"
        gap={4}
        flexWrap="wrap"
      >
        <Stat minW="80px">
          <StatLabel fontSize="xs" color="ui.slate">警示總數</StatLabel>
          <StatNumber fontSize="2xl" color="ui.navy">{totalAlerts}</StatNumber>
        </Stat>
        <Stat minW="80px">
          <StatLabel fontSize="xs" color="ui.slate">跌破防守</StatLabel>
          <StatNumber fontSize="2xl" color="red.500">{defenseBreaches}</StatNumber>
        </Stat>
        <Stat minW="80px">
          <StatLabel fontSize="xs" color="ui.slate">達目標</StatLabel>
          <StatNumber fontSize="2xl" color="green.500">{targetsReached}</StatNumber>
        </Stat>
        <Stat minW="80px">
          <StatLabel fontSize="xs" color="ui.slate">涉及標的</StatLabel>
          <StatNumber fontSize="2xl" color="blue.500">{uniqueTickers}</StatNumber>
        </Stat>
      </StatGroup>

      {isLoading ? (
        <Flex justify="center" py={10}>
          <Spinner color="blue.500" size="lg" />
        </Flex>
      ) : (
        <Tabs variant="soft-rounded" colorScheme="blue" size="sm">
          <TabList mb={4}>
            <Tab rounded="xl">
              警示紀錄
              {totalAlerts > 0 && (
                <Badge colorScheme="red" rounded="full" ml={2} fontSize="9px">
                  {totalAlerts}
                </Badge>
              )}
            </Tab>
            <Tab rounded="xl">
              已歸檔標的
              {archived.length > 0 && (
                <Badge colorScheme="gray" rounded="full" ml={2} fontSize="9px">
                  {archived.length}
                </Badge>
              )}
            </Tab>
            <Tab rounded="xl">
              轉發紀錄
              {forwardLogs.length > 0 && (
                <Badge colorScheme="blue" rounded="full" ml={2} fontSize="9px">
                  {forwardLogs.length}
                </Badge>
              )}
            </Tab>
          </TabList>

          <TabPanels>
            {/* ─── Tab 1: Alert History ─── */}
            <TabPanel px={0}>
              <Flex mb={3} justify="space-between" align="center">
                {isAdmin && selectedAlerts.size > 0 ? (
                  <Button
                    size="xs"
                    colorScheme="red"
                    leftIcon={<DeleteIcon />}
                    rounded="lg"
                    onClick={() => openDeleteDialog('alerts')}
                  >
                    刪除 {selectedAlerts.size} 筆
                  </Button>
                ) : (
                  <Box />
                )}
                <Select
                  size="xs"
                  rounded="lg"
                  w="140px"
                  value={alertFilter}
                  onChange={(e) => setAlertFilter(e.target.value)}
                >
                  <option value="all">全部類型</option>
                  <option value="defense_breach">跌破防守</option>
                  <option value="min_target_reached">達最小目標</option>
                  <option value="reasonable_target_reached">達合理目標</option>
                  <option value="tp_triggered">停利</option>
                  <option value="sl_triggered">停損</option>
                </Select>
              </Flex>

              {filteredAlerts.length === 0 ? (
                <Box py={8} textAlign="center">
                  <Text color="gray.400" fontSize="sm">
                    此期間沒有觸發的警示紀錄
                  </Text>
                </Box>
              ) : (
                <TableContainer maxH="400px" overflowY="auto">
                  <Table variant="simple" size="sm">
                    <Thead bg="gray.50" position="sticky" top={0} zIndex={1}>
                      <Tr>
                        {isAdmin && (
                          <Th w="40px" px={2}>
                            <Checkbox
                              isChecked={selectedAlerts.size === filteredAlerts.length && filteredAlerts.length > 0}
                              isIndeterminate={selectedAlerts.size > 0 && selectedAlerts.size < filteredAlerts.length}
                              onChange={() => toggleSelectAll(filteredAlerts, selectedAlerts, setSelectedAlerts)}
                              colorScheme="red"
                              size="sm"
                            />
                          </Th>
                        )}
                        <Th>時間</Th>
                        <Th>股票</Th>
                        <Th>類型</Th>
                        <Th isNumeric>觸發價</Th>
                        <Th isNumeric>當時現價</Th>
                        <Th>通知</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {filteredAlerts.map((alert) => {
                        const cfg = ALERT_CONFIG[alert.alert_type] || ALERT_CONFIG.defense_breach
                        return (
                          <Tr key={alert.id} _hover={{ bg: 'gray.50' }}>
                            {isAdmin && (
                              <Td px={2}>
                                <Checkbox
                                  isChecked={selectedAlerts.has(alert.id)}
                                  onChange={() => toggleSelection(selectedAlerts, setSelectedAlerts, alert.id)}
                                  colorScheme="red"
                                  size="sm"
                                />
                              </Td>
                            )}
                            <Td fontSize="xs" color="gray.600" whiteSpace="nowrap">
                              {formatDateTime(alert.triggered_at)}
                            </Td>
                            <Td>
                              {renderTickerName(alert.ticker)}
                            </Td>
                            <Td>
                              <Tag size="sm" colorScheme={cfg.color} rounded="full">
                                <TagLabel fontSize="xs">{cfg.emoji} {cfg.label}</TagLabel>
                              </Tag>
                            </Td>
                            <Td isNumeric>
                              <Text fontWeight="semibold" fontSize="sm" color={cfg.color + '.600'}>
                                {alert.trigger_price}
                              </Text>
                            </Td>
                            <Td isNumeric>
                              <Text fontSize="sm">{alert.current_price}</Text>
                            </Td>
                            <Td>
                              <HStack spacing={1}>
                                {(alert.notified_via || []).map((via) => (
                                  <Badge
                                    key={via}
                                    size="sm"
                                    variant="outline"
                                    fontSize="9px"
                                    rounded="full"
                                    colorScheme={via === 'telegram' ? 'blue' : 'green'}
                                  >
                                    {via}
                                  </Badge>
                                ))}
                              </HStack>
                            </Td>
                          </Tr>
                        )
                      })}
                    </Tbody>
                  </Table>
                </TableContainer>
              )}
            </TabPanel>

            {/* ─── Tab 2: Archived Targets ─── */}
            <TabPanel px={0}>
              {isAdmin && selectedArchived.size > 0 && (
                <Flex mb={3} justify="flex-start">
                  <Button
                    size="xs"
                    colorScheme="red"
                    leftIcon={<DeleteIcon />}
                    rounded="lg"
                    onClick={() => openDeleteDialog('archived')}
                  >
                    刪除 {selectedArchived.size} 筆
                  </Button>
                </Flex>
              )}
              {archived.length === 0 ? (
                <Box py={8} textAlign="center">
                  <Text color="gray.400" fontSize="sm">
                    沒有已歸檔的追蹤標的
                  </Text>
                  <Text color="gray.300" fontSize="xs" mt={1}>
                    當新的投顧通知更新價格目標時，舊的會自動歸檔
                  </Text>
                </Box>
              ) : (
                <TableContainer maxH="400px" overflowY="auto">
                  <Table variant="simple" size="sm">
                    <Thead bg="gray.50" position="sticky" top={0} zIndex={1}>
                      <Tr>
                        {isAdmin && (
                          <Th w="40px" px={2}>
                            <Checkbox
                              isChecked={selectedArchived.size === archived.length && archived.length > 0}
                              isIndeterminate={selectedArchived.size > 0 && selectedArchived.size < archived.length}
                              onChange={() => toggleSelectAll(archived, selectedArchived, setSelectedArchived)}
                              colorScheme="red"
                              size="sm"
                            />
                          </Th>
                        )}
                        <Th>股票</Th>
                        <Th isNumeric>防守價</Th>
                        <Th isNumeric>最小漲幅</Th>
                        <Th isNumeric>合理漲幅</Th>
                        <Th>生效日</Th>
                        <Th>匯入日</Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {archived.map((target) => (
                        <Tr key={target.id} _hover={{ bg: 'gray.50' }} opacity={0.75}>
                          {isAdmin && (
                            <Td px={2}>
                              <Checkbox
                                isChecked={selectedArchived.has(target.id)}
                                onChange={() => toggleSelection(selectedArchived, setSelectedArchived, target.id)}
                                colorScheme="red"
                                size="sm"
                              />
                            </Td>
                          )}
                          <Td>
                            {renderTickerName(target.ticker, target.stock_name)}
                          </Td>
                          <Td isNumeric>
                            {target.defense_price ? (
                              <Text color="red.500" fontSize="sm">{target.defense_price}</Text>
                            ) : (
                              <Text color="gray.400">—</Text>
                            )}
                          </Td>
                          <Td isNumeric>
                            {target.min_target_low ? (
                              <Text color="green.600" fontSize="xs">
                                {target.min_target_low}~{target.min_target_high}
                              </Text>
                            ) : (
                              <Text color="gray.400">—</Text>
                            )}
                          </Td>
                          <Td isNumeric>
                            {target.reasonable_target_low ? (
                              <Text color="orange.600" fontSize="xs">
                                {target.reasonable_target_low}~{target.reasonable_target_high}
                              </Text>
                            ) : (
                              <Text color="gray.400">—</Text>
                            )}
                          </Td>
                          <Td>
                            <Text fontSize="xs" color="gray.600">
                              {target.effective_date || '—'}
                            </Text>
                          </Td>
                          <Td>
                            <Text fontSize="xs" color="gray.500">
                              {formatDate(target.created_at)}
                            </Text>
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                </TableContainer>
              )}
            </TabPanel>

            {/* ─── Tab 3: Forward Logs ─── */}
            <TabPanel px={0}>
              {isAdmin && selectedLogs.size > 0 && (
                <Flex mb={3} justify="flex-start">
                  <Button
                    size="xs"
                    colorScheme="red"
                    leftIcon={<DeleteIcon />}
                    rounded="lg"
                    onClick={() => openDeleteDialog('logs')}
                  >
                    刪除 {selectedLogs.size} 筆
                  </Button>
                </Flex>
              )}
              {forwardLogs.length === 0 ? (
                <Box py={8} textAlign="center">
                  <Text color="gray.400" fontSize="sm">
                    尚無轉發紀錄
                  </Text>
                  <Text color="gray.300" fontSize="xs" mt={1}>
                    從解析結果中選擇股票並轉發給 LINE/Telegram 聯絡人
                  </Text>
                </Box>
              ) : (
                <VStack spacing={3} align="stretch" maxH="400px" overflowY="auto">
                  {forwardLogs.map((log) => {
                    const target = log.forward_targets
                    const platform = target?.platform || 'unknown'
                    return (
                      <Box
                        key={log.id}
                        p={3}
                        bg={selectedLogs.has(log.id) ? 'red.50' : 'gray.50'}
                        rounded="xl"
                        border="1px solid"
                        borderColor={selectedLogs.has(log.id) ? 'red.200' : 'gray.100'}
                        transition="all 0.15s"
                      >
                        <Flex justify="space-between" align="start" mb={2}>
                          <HStack spacing={2}>
                            {isAdmin && (
                              <Checkbox
                                isChecked={selectedLogs.has(log.id)}
                                onChange={() => toggleSelection(selectedLogs, setSelectedLogs, log.id)}
                                colorScheme="red"
                                size="sm"
                              />
                            )}
                            <Badge
                              colorScheme={platform === 'telegram' ? 'blue' : 'green'}
                              rounded="full"
                              fontSize="10px"
                            >
                              {platform === 'telegram' ? '✈️ Telegram' : '💬 LINE'}
                            </Badge>
                            {target?.target_name && (
                              <Text fontSize="sm" fontWeight="bold" color="ui.navy">
                                {target.target_name}
                              </Text>
                            )}
                          </HStack>
                          <Text fontSize="xs" color="gray.500">
                            {formatDateTime(log.forwarded_at)}
                          </Text>
                        </Flex>
                        <Flex wrap="wrap" gap={1}>
                          {(log.tickers || []).map((t: string) => (
                            <Badge
                              key={t}
                              colorScheme="blue"
                              variant="subtle"
                              fontSize="xs"
                              rounded="md"
                            >
                              {t}{nameMap[t] ? ` ${nameMap[t]}` : ''}
                            </Badge>
                          ))}
                        </Flex>
                      </Box>
                    )
                  })}
                </VStack>
              )}
            </TabPanel>
          </TabPanels>
        </Tabs>
      )}

      {/* ─── Delete Confirmation Dialog ─── */}
      <AlertDialog
        isOpen={isDeleteOpen}
        leastDestructiveRef={cancelRef as any}
        onClose={onDeleteClose}
        isCentered
      >
        <AlertDialogOverlay>
          <AlertDialogContent rounded="2xl">
            <AlertDialogHeader fontSize="lg" fontWeight="bold">
              確認刪除{deleteTableName}
            </AlertDialogHeader>
            <AlertDialogBody>
              確定要刪除選取的 <Text as="span" fontWeight="bold" color="red.500">{currentDeleteCount}</Text> 筆{deleteTableName}嗎？
              此操作無法復原。
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button ref={cancelRef} onClick={onDeleteClose} rounded="xl" size="sm">
                取消
              </Button>
              <Button
                colorScheme="red"
                onClick={handleDeleteConfirm}
                ml={3}
                rounded="xl"
                size="sm"
                isLoading={isDeleting}
                leftIcon={<DeleteIcon />}
              >
                確認刪除
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>
    </Box>
  )
}
