import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  Button,
  FormControl,
  FormLabel,
  Input,
  VStack,
  HStack,
  useToast,
  Text,
  Divider,
  Box,
  Alert,
  AlertIcon,
} from '@chakra-ui/react'
import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { AggregatedHolding, Holding } from '../../utils/calculations'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  holding: AggregatedHolding | Holding | null
  currentPrice?: number
}

export const SellHoldingModal = ({ isOpen, onClose, onSuccess, holding, currentPrice }: Props) => {
  const [sellPrice, setSellPrice] = useState('')
  const [sellShares, setSellShares] = useState('')
  const [sellFee, setSellFee] = useState('')
  const [tax, setTax] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  // Helper to get values whether it's aggregated or single
  const isAggregated = holding && 'totalShares' in holding
  const totalShares = isAggregated 
    ? (holding as AggregatedHolding).totalShares 
    : (holding as Holding)?.shares || 0
  const avgCost = isAggregated 
    ? (holding as AggregatedHolding).avgCost 
    : (holding as Holding)?.cost_price || 0
  const buyFee = isAggregated
    ? (holding as AggregatedHolding).items.reduce((sum, i) => sum + i.buy_fee, 0)
    : (holding as Holding)?.buy_fee || 0

  useEffect(() => {
    if (holding) {
      const price = currentPrice || avgCost
      setSellPrice(price?.toString() || '0')
      setSellShares(totalShares?.toString() || '0')

      // Auto estimate Fee & Tax for TPE
      if (holding.region === 'TPE') {
        const volume = (price || 0) * (totalShares || 0)
        const estimatedFee = Math.max(20, Math.floor(volume * 0.001425 * 0.6))
        const estimatedTax = Math.floor(volume * 0.003)
        setSellFee(estimatedFee.toString())
        setTax(estimatedTax.toString())
      } else {
        setSellFee('0')
        setTax('0')
      }
    }
  }, [holding, currentPrice, totalShares, avgCost])

  const handleSell = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!holding) return
    const sharesToSell = parseFloat(sellShares)
    
    if (sharesToSell <= 0 || sharesToSell > totalShares) {
      toast({ title: '數量錯誤', status: 'error' })
      return
    }

    // Currently partial sell of aggregated holdings is complex, 
    // we encourage full sell or selling individual items
    if (isAggregated && sharesToSell < totalShares) {
      toast({ 
        title: '不支援彙整部分賣出', 
        description: '多筆買入的股票請至「買入明細」中單筆結算，或執行全數出清。', 
        status: 'warning' 
      })
      return
    }

    setLoading(true)

    try {
      const totalSellFee = parseFloat(sellFee) || 0
      const totalTax = parseFloat(tax) || 0

      // 1. Move to history
      const { error: archiveError } = await supabase
        .from('historical_holdings')
        .insert({
          user_id: holding.user_id,
          ticker: holding.ticker,
          shares: sharesToSell,
          cost_price: avgCost,
          sell_price: parseFloat(sellPrice),
          fee: buyFee + totalSellFee,
          tax: totalTax,
          archive_reason: 'sold'
        })

      if (archiveError) throw archiveError

      // 2. Update or Delete
      if (sharesToSell === totalShares) {
        // Full sell: Delete all records for this ticker (or single record)
        const query = supabase.from('portfolio_holdings').delete()
        if (isAggregated) {
          query.eq('ticker', holding.ticker).eq('user_id', holding.user_id)
        } else {
          query.eq('id', (holding as Holding).id)
        }
        const { error: deleteError } = await query
        if (deleteError) throw deleteError
      } else {
        // Single record partial sell
        const h = holding as Holding
        const { error: updateError } = await supabase
          .from('portfolio_holdings')
          .update({
            shares: h.shares - sharesToSell,
            buy_fee: h.buy_fee * ((h.shares - sharesToSell) / h.shares)
          })
          .eq('id', h.id)
        if (updateError) throw updateError
      }

      toast({ title: '已結算並歸檔', status: 'success' })
      onSuccess()
      onClose()
    } catch (error: any) {
      toast({ title: '結算失敗', description: error.message, status: 'error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>結算賣出 - {holding?.ticker}</ModalHeader>
        <ModalCloseButton />
        <form onSubmit={handleSell}>
          <ModalBody>
            <VStack spacing={4} align="stretch">
              {isAggregated && totalShares > 0 && (
                <Alert status="info" fontSize="sm" rounded="md">
                  <AlertIcon />
                  這是彙整後的數據，全數結算將刪除此標的所有買入紀錄。
                </Alert>
              )}

              <Box bg="blue.50" p={3} rounded="md">
                <HStack justify="space-between">
                  <Text size="sm">目前持有股數:</Text>
                  <Text fontWeight="bold">{totalShares.toLocaleString()}</Text>
                </HStack>
                <HStack justify="space-between">
                  <Text size="sm">加權買入成本:</Text>
                  <Text fontWeight="bold">${avgCost.toFixed(2)}</Text>
                </HStack>
              </Box>

              <HStack w="full">
                <FormControl isRequired>
                  <FormLabel>賣出數量</FormLabel>
                  <Input
                    type="number"
                    step="any"
                    value={sellShares}
                    onChange={(e) => setSellShares(e.target.value)}
                  />
                </FormControl>
                <FormControl isRequired>
                  <FormLabel>賣出價格</FormLabel>
                  <Input
                    type="number"
                    step="any"
                    value={sellPrice}
                    onChange={(e) => setSellPrice(e.target.value)}
                  />
                </FormControl>
              </HStack>

              <HStack w="full">
                <FormControl>
                  <FormLabel>賣出手續費</FormLabel>
                  <Input
                    type="number"
                    value={sellFee}
                    onChange={(e) => setSellFee(e.target.value)}
                  />
                </FormControl>
                <FormControl>
                  <FormLabel>交易稅</FormLabel>
                  <Input
                    type="number"
                    value={tax}
                    onChange={(e) => setTax(e.target.value)}
                  />
                </FormControl>
              </HStack>

              <Divider />

              <Box>
                <Text fontSize="xs" color="gray.500">
                  * 結算利潤將計入歷史紀錄。手續費包含買入時的 ${buyFee.toFixed(2)} 與本次賣出費用。
                </Text>
              </Box>
            </VStack>
          </ModalBody>

          <ModalFooter>
            <Button variant="ghost" mr={3} onClick={onClose}>取消</Button>
            <Button colorScheme="red" type="submit" isLoading={loading}>
              確認結算
            </Button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  )
}
