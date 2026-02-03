import React, { useRef } from 'react'
import {
  Button,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalFooter,
  ModalBody,
  ModalCloseButton,
  useToast,
  Text,
  VStack,
  HStack,
  Icon,
  Input,
  Box,
  Link,
} from '@chakra-ui/react'
import { AttachmentIcon, InfoOutlineIcon } from '@chakra-ui/icons'
import { supabase } from '../../services/supabase'

interface ImportDataModalProps {
  isOpen: boolean
  onClose: boolean | any
  onSuccess: () => void
}

export const ImportDataModal: React.FC<ImportDataModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const [isImporting, setIsImporting] = React.useState(false)

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setIsImporting(true)
    const reader = new FileReader()

    reader.onload = async (e) => {
      try {
        const text = e.target?.result as string
        const rows = text.split('\n').filter(row => row.trim() !== '')
        
        if (rows.length < 2) {
          throw new Error('CSV 檔案格式不正確或沒有資料')
        }

        // Parse headers to get indexes
        const headers = rows[0].split(',').map(h => h.trim().replace(/"/g, ''))
        const dataRows = rows.slice(1)

        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('未登入用戶')

        const importedItems = dataRows.map(row => {
          // Handle quoted commas if necessary, but simple split for now
          const values = row.split(',').map(v => v.trim().replace(/"/g, ''))
          const item: any = { user_id: user.id }
          
          headers.forEach((header, index) => {
            if (values[index] !== undefined) {
              // Map CSV headers to DB columns
              item[header] = values[index]
            }
          })
          
          // Basic validation/cleanup
          if (item.shares) item.shares = parseFloat(item.shares)
          if (item.cost_price) item.cost_price = parseFloat(item.cost_price)
          if (!item.buy_date) item.buy_date = new Date().toISOString()
          
          return item
        })

        // Filter out empty/invalid items
        const validItems = importedItems.filter(item => item.ticker && item.shares > 0)

        if (validItems.length === 0) {
          throw new Error('沒有有效的持股資料可導入')
        }

        const { error } = await supabase
          .from('portfolio_holdings')
          .upsert(validItems, { onConflict: 'user_id,ticker' })

        if (error) throw error

        // Trigger market update
        try {
          const ghToken = import.meta.env.VITE_GITHUB_TOKEN
          const ghOwner = import.meta.env.VITE_GITHUB_OWNER
          const ghRepo = import.meta.env.VITE_GITHUB_REPO

          if (ghToken && ghOwner && ghRepo) {
            await fetch(
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
          }
        } catch (ghErr) {
          console.error('Failed to trigger market update:', ghErr)
        }

        toast({
          title: '導入成功',
          description: `成功導入/更新 ${validItems.length} 筆持股資料，並已觸發市價同步。`,
          status: 'success',
          duration: 3000,
        })
        onSuccess()
        onClose()
      } catch (err: any) {
        toast({
          title: '導入失敗',
          description: err.message,
          status: 'error',
          duration: 5000,
        })
      } finally {
        setIsImporting(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    }

    reader.readAsText(file)
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalOverlay backdropFilter="blur(4px)" />
      <ModalContent rounded="3xl" p={4}>
        <ModalHeader fontWeight="extrabold">導入持股資料 (CSV)</ModalHeader>
        <ModalCloseButton rounded="full" />
        <ModalBody>
          <VStack spacing={6} align="stretch">
            <Box bg="blue.50" p={4} rounded="2xl" border="1px" borderColor="blue.100">
              <HStack spacing={3}>
                <Icon as={InfoOutlineIcon} color="blue.500" />
                <Text fontSize="sm" color="blue.700" fontWeight="bold">
                  CSV 格式說明
                </Text>
              </HStack>
              <Text fontSize="xs" color="blue.600" mt={2}>
                請確保 CSV 包含以下標題欄位：<br />
                <b>ticker, region, name, shares, cost_price, strategy_mode, buy_date</b><br />
                (推薦先執行「導出 CSV」作為範本修改)
              </Text>
            </Box>

            <VStack
              border="2px dashed"
              borderColor="gray.200"
              rounded="2xl"
              p={10}
              spacing={4}
              cursor="pointer"
              _hover={{ borderColor: 'blue.400', bg: 'gray.50' }}
              onClick={() => fileInputRef.current?.click()}
            >
              <Icon as={AttachmentIcon} boxSize={8} color="gray.400" />
              <Text fontWeight="bold">點擊選擇 CSV 檔案</Text>
              <Text fontSize="xs" color="gray.500">支援 .csv 格式文件</Text>
              <Input
                type="file"
                accept=".csv"
                display="none"
                ref={fileInputRef}
                onChange={handleFileUpload}
              />
            </VStack>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" mr={3} onClick={onClose} rounded="xl">
            取消
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
