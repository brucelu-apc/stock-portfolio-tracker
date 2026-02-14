/**
 * AdminEmailConfig — Admin component for managing notification email recipients.
 * These emails receive notifications when new users register.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  VStack,
  HStack,
  Text,
  Heading,
  Input,
  Button,
  Switch,
  Badge,
  useToast,
  Spinner,
  Flex,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  IconButton,
} from '@chakra-ui/react'
import { DeleteIcon, AddIcon } from '@chakra-ui/icons'
import { supabase } from '../../services/supabase'

interface EmailEntry {
  id: string
  email: string
  label: string
  is_active: boolean
  created_at: string
}

export const AdminEmailConfig = () => {
  const toast = useToast()
  const [entries, setEntries] = useState<EmailEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)

  // New entry form
  const [newEmail, setNewEmail] = useState('')
  const [newLabel, setNewLabel] = useState('')

  const fetchEntries = useCallback(async () => {
    const { data, error } = await supabase
      .from('admin_email_config')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      toast({ title: '載入 Email 清單失敗', description: error.message, status: 'error' })
    } else {
      setEntries(data || [])
    }
    setLoading(false)
  }, [toast])

  useEffect(() => {
    fetchEntries()
  }, [fetchEntries])

  const handleAdd = async () => {
    if (!newEmail.trim()) {
      toast({ title: '請輸入 Email', status: 'warning' })
      return
    }

    setAdding(true)
    try {
      const { error } = await supabase.from('admin_email_config').insert({
        email: newEmail.trim(),
        label: newLabel.trim(),
        is_active: true,
      })

      if (error) throw error

      toast({ title: '已新增 Email', status: 'success' })
      setNewEmail('')
      setNewLabel('')
      fetchEntries()
    } catch (err: any) {
      toast({ title: '新增失敗', description: err.message, status: 'error' })
    } finally {
      setAdding(false)
    }
  }

  const handleToggle = async (id: string, currentActive: boolean) => {
    const { error } = await supabase
      .from('admin_email_config')
      .update({ is_active: !currentActive })
      .eq('id', id)

    if (error) {
      toast({ title: '更新失敗', description: error.message, status: 'error' })
    } else {
      fetchEntries()
    }
  }

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('admin_email_config').delete().eq('id', id)
    if (error) {
      toast({ title: '刪除失敗', description: error.message, status: 'error' })
    } else {
      toast({ title: '已刪除', status: 'success' })
      fetchEntries()
    }
  }

  if (loading) {
    return (
      <Flex justify="center" py={8}>
        <Spinner color="blue.500" />
      </Flex>
    )
  }

  return (
    <Box>
      <Heading size="md" mb={2}>
        管理者通知 Email
      </Heading>
      <Text fontSize="sm" color="gray.500" mb={6}>
        新用戶註冊時，系統會發送通知信到以下啟用中的 Email 帳號
      </Text>

      {/* Add new entry */}
      <Box bg="white" p={4} rounded="xl" shadow="sm" mb={6}>
        <HStack spacing={3}>
          <Input
            placeholder="email@example.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            size="sm"
            rounded="xl"
            flex={2}
          />
          <Input
            placeholder="標籤（選填）"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            size="sm"
            rounded="xl"
            flex={1}
          />
          <Button
            leftIcon={<AddIcon />}
            size="sm"
            colorScheme="blue"
            onClick={handleAdd}
            isLoading={adding}
            rounded="xl"
          >
            新增
          </Button>
        </HStack>
      </Box>

      {/* Email list */}
      <TableContainer bg="white" p={4} rounded="lg" shadow="sm">
        <Table variant="simple" size="sm">
          <Thead>
            <Tr>
              <Th>Email</Th>
              <Th>標籤</Th>
              <Th>狀態</Th>
              <Th>操作</Th>
            </Tr>
          </Thead>
          <Tbody>
            {entries.map((entry) => (
              <Tr key={entry.id}>
                <Td fontWeight="bold">{entry.email}</Td>
                <Td color="gray.500">{entry.label || '-'}</Td>
                <Td>
                  <HStack spacing={2}>
                    <Switch
                      size="sm"
                      colorScheme="green"
                      isChecked={entry.is_active}
                      onChange={() => handleToggle(entry.id, entry.is_active)}
                    />
                    <Badge colorScheme={entry.is_active ? 'green' : 'gray'} fontSize="xs">
                      {entry.is_active ? '啟用' : '停用'}
                    </Badge>
                  </HStack>
                </Td>
                <Td>
                  <IconButton
                    aria-label="刪除"
                    icon={<DeleteIcon />}
                    size="xs"
                    variant="ghost"
                    colorScheme="red"
                    onClick={() => handleDelete(entry.id)}
                  />
                </Td>
              </Tr>
            ))}
            {entries.length === 0 && (
              <Tr>
                <Td colSpan={4} textAlign="center" color="gray.400">
                  尚未設定任何通知 Email
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      </TableContainer>
    </Box>
  )
}
