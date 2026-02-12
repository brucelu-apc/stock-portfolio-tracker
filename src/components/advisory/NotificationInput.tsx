/**
 * NotificationInput — Large text area for pasting advisory notifications.
 *
 * Flow:
 *  1. User pastes notification text from LINE
 *  2. Clicks "解析通知" to send to backend
 *  3. ParsePreview renders the structured result
 *  4. User selects stocks to import/forward
 */
import { useState } from 'react'
import {
  Box,
  Button,
  Textarea,
  VStack,
  HStack,
  Text,
  Alert,
  AlertIcon,
  useToast,
  Flex,
  Badge,
} from '@chakra-ui/react'
import { parseNotification, type ParseResponse } from '../../services/backend'
import { ParsePreview } from './ParsePreview'

interface NotificationInputProps {
  userId: string
  onImportSuccess?: () => void
}

export const NotificationInput = ({ userId, onImportSuccess }: NotificationInputProps) => {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [parseResult, setParseResult] = useState<ParseResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()

  const handleParse = async () => {
    if (!text.trim()) {
      toast({
        title: '請先貼上通知文字',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    setLoading(true)
    setError(null)
    setParseResult(null)

    try {
      const result = await parseNotification(text.trim())
      setParseResult(result)

      if (result.total_stocks === 0) {
        toast({
          title: '未偵測到股票資訊',
          description: '請確認通知文字格式是否正確。',
          status: 'info',
          duration: 4000,
        })
      } else {
        toast({
          title: `解析完成`,
          description: `找到 ${result.total_stocks} 檔股票，涵蓋 ${result.dates_found.length} 天`,
          status: 'success',
          duration: 3000,
        })
      }
    } catch (err: any) {
      console.error('Parse error:', err)
      setError(err.message || '解析失敗，請確認後端服務是否運行中。')
      toast({
        title: '解析失敗',
        description: '無法連接後端服務，請確認 Railway 服務狀態。',
        status: 'error',
        duration: 5000,
      })
    } finally {
      setLoading(false)
    }
  }

  const handleClear = () => {
    setText('')
    setParseResult(null)
    setError(null)
  }

  const handleImportDone = () => {
    handleClear()
    onImportSuccess?.()
  }

  return (
    <VStack spacing={6} align="stretch">
      {/* Input Section */}
      <Box bg="white" p={{ base: 4, md: 8 }} rounded="3xl" shadow="2xl" border="1px" borderColor="gray.50">
        <Flex justify="space-between" align={{ base: 'start', md: 'center' }} mb={4} direction={{ base: 'column', md: 'row' }} gap={2}>
          <VStack align="start" spacing={1}>
            <Text fontSize="lg" fontWeight="extrabold" color="ui.navy">
              投顧通知輸入
            </Text>
            <Text fontSize="xs" color="ui.slate">
              從 LINE 複製投顧通知文字，貼上後點擊解析
            </Text>
          </VStack>
          {parseResult && (
            <HStack spacing={2}>
              <Badge colorScheme="blue" rounded="full" px={3} py={1}>
                {parseResult.total_stocks} 檔股票
              </Badge>
              <Badge colorScheme="green" rounded="full" px={3} py={1}>
                {parseResult.dates_found.length} 天
              </Badge>
            </HStack>
          )}
        </Flex>

        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`貼上 LINE 投顧通知文字...\n\n範例：\n楊少凱贏家2\n億光（2393）目標價補充：\n技術面：低檔有主力進場的跡象...\n最小漲幅68~69.5元附近，合理漲幅75~77元附近。\n操作策略：手中持股部位目前可以53元為防守價...`}
          minH="200px"
          maxH="400px"
          resize="vertical"
          bg="gray.50"
          border="2px dashed"
          borderColor="gray.200"
          rounded="2xl"
          p={4}
          fontSize="sm"
          fontFamily="mono"
          _focus={{
            borderColor: 'brand.500',
            bg: 'white',
          }}
          mb={4}
        />

        <HStack spacing={3}>
          <Button
            colorScheme="blue"
            onClick={handleParse}
            isLoading={loading}
            loadingText="解析中..."
            rounded="xl"
            px={8}
            bgGradient="linear(to-r, brand.500, brand.600)"
            _hover={{ bgGradient: "linear(to-r, brand.600, brand.900)" }}
          >
            解析通知
          </Button>
          <Button
            variant="ghost"
            onClick={handleClear}
            rounded="xl"
            isDisabled={!text && !parseResult}
          >
            清除
          </Button>
        </HStack>
      </Box>

      {/* Error Alert */}
      {error && (
        <Alert status="error" rounded="2xl">
          <AlertIcon />
          <Text fontSize="sm">{error}</Text>
        </Alert>
      )}

      {/* Parse Result Preview */}
      {parseResult && parseResult.total_stocks > 0 && (
        <ParsePreview
          result={parseResult}
          userId={userId}
          rawText={text}
          onImportDone={handleImportDone}
        />
      )}
    </VStack>
  )
}
