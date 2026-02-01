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
} from '@chakra-ui/react'
import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { Holding } from '../../utils/calculations'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  holding: Holding | null
  currentPrice?: number
}

export const SellHoldingModal = ({ isOpen, onClose, onSuccess, holding, currentPrice }: Props) => {
  const [sellPrice, setSellPrice] = useState('')
  const [sellShares, setSellShares] = useState('') // Added sell shares
  const [sellFee, setSellFee] = useState('')
  const [tax, setTax] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  useEffect(() => {
    if (holding) {
      const price = currentPrice || holding.cost_price
      setSellPrice(price.toString())
      setSellShares(holding.shares.toString()) // Default to full sell

      // Auto estimate Fee & Tax for TPE
      if (holding.region === 'TPE') {
        const volume = price * holding.shares
        const estimatedFee = Math.max(20, Math.floor(volume * 0.001425 * 0.6))
        const estimatedTax = Math.floor(volume * 0.003)
        setSellFee(estimatedFee.toString())
        setTax(estimatedTax.toString())
      } else {
        setSellFee('0')
        setTax('0')
      }
    }
  }, [holding, currentPrice])

  const handleSell = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!holding) return
    const sharesToSell = parseFloat(sellShares)
    if (sharesToSell <= 0 || sharesToSell > holding.shares) {
      toast({ title: '數量錯誤', status: 'error' })
      return
    }

    setLoading(true)

    try {
      const totalFee = (holding.buy_fee * (sharesToSell / holding.shares)) + (parseFloat(sellFee) || 0)
      const totalTax = parseFloat(tax) || 0

      // 1. Move the sold portion to history
      const { error: archiveError } = await supabase
        .from('historical_holdings')
        .insert({
          user_id: holding.user_id,
          ticker: holding.ticker,
          shares: sharesToSell,
          cost_price: holding.cost_price,
          sell_price: parseFloat(sellPrice),
          fee: totalFee,
          tax: totalTax,
          archive_reason: 'sold'
        })

      if (archiveError) throw archiveError

      // 2. Update or Delete from portfolio_holdings
      if (sharesToSell === holding.shares) {
        const { error: deleteError } = await supabase
          .from('portfolio_holdings')
          .delete()
          .eq('id', holding.id)
        if (deleteError) throw deleteError
      } else {
        const { error: updateError } = await supabase
          .from('portfolio_holdings')
          .update({
            shares: holding.shares - sharesToSell,
            // Pro-rate the buy_fee for the remaining shares
            buy_fee: holding.buy_fee * ((holding.shares - sharesToSell) / holding.shares)
          })
          .eq('id', holding.id)
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
              <Box bg="blue.50" p={3} rounded="md">
                <HStack justify="space-between">
                  <Text size="sm">目前持有股數:</Text>
                  <Text fontWeight="bold">{holding?.shares}</Text>
                </HStack>
                <HStack justify="space-between">
                  <Text size="sm">買入成本:</Text>
                  <Text fontWeight="bold">${holding?.cost_price}</Text>
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
                  * 手續費包含買入時的 ${holding?.buy_fee || 0} 與本次賣出費用。
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
