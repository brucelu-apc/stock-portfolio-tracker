/**
 * AnnouncementEditor — Admin component for creating/editing system announcements.
 * Part of the admin panel. Only one announcement can be "active" at a time.
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Box,
  VStack,
  HStack,
  Text,
  Heading,
  Input,
  Textarea,
  Button,
  Switch,
  Badge,
  useToast,
  Spinner,
  Flex,
  Divider,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  IconButton,
} from '@chakra-ui/react'
import { EditIcon, DeleteIcon } from '@chakra-ui/icons'
import { supabase } from '../../services/supabase'

interface Announcement {
  id: string
  title: string
  content: string
  is_active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export const AnnouncementEditor = () => {
  const toast = useToast()
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Form state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [isActive, setIsActive] = useState(true)

  const fetchAnnouncements = useCallback(async () => {
    const { data, error } = await supabase
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      toast({ title: '載入公告失敗', description: error.message, status: 'error' })
    } else {
      setAnnouncements(data || [])
    }
    setLoading(false)
  }, [toast])

  useEffect(() => {
    fetchAnnouncements()
  }, [fetchAnnouncements])

  const resetForm = () => {
    setEditingId(null)
    setTitle('')
    setContent('')
    setIsActive(true)
  }

  const handleEdit = (ann: Announcement) => {
    setEditingId(ann.id)
    setTitle(ann.title)
    setContent(ann.content)
    setIsActive(ann.is_active)
  }

  const handleSave = async () => {
    if (!title.trim()) {
      toast({ title: '請輸入公告標題', status: 'warning' })
      return
    }

    setSaving(true)
    try {
      // If marking as active, deactivate all others first
      if (isActive) {
        await supabase
          .from('announcements')
          .update({ is_active: false })
          .neq('id', editingId || '')
      }

      if (editingId) {
        // Update existing
        const { error } = await supabase
          .from('announcements')
          .update({
            title: title.trim(),
            content: content.trim(),
            is_active: isActive,
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingId)

        if (error) throw error
        toast({ title: '公告已更新', status: 'success' })
      } else {
        // Create new
        const { error } = await supabase
          .from('announcements')
          .insert({
            title: title.trim(),
            content: content.trim(),
            is_active: isActive,
          })

        if (error) throw error
        toast({ title: '公告已建立', status: 'success' })
      }

      resetForm()
      fetchAnnouncements()
    } catch (err: any) {
      toast({ title: '儲存失敗', description: err.message, status: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('announcements').delete().eq('id', id)
    if (error) {
      toast({ title: '刪除失敗', description: error.message, status: 'error' })
    } else {
      toast({ title: '公告已刪除', status: 'success' })
      if (editingId === id) resetForm()
      fetchAnnouncements()
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
      <Heading size="md" mb={6}>
        系統公告管理
      </Heading>

      {/* Editor Form */}
      <Box bg="white" p={6} rounded="xl" shadow="sm" mb={6}>
        <VStack spacing={4} align="stretch">
          <Text fontWeight="bold" fontSize="sm" color="ui.slate">
            {editingId ? '編輯公告' : '新增公告'}
          </Text>
          <Input
            placeholder="公告標題"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            fontWeight="bold"
            rounded="xl"
          />
          <Textarea
            placeholder="公告內容（支援多行文字）"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={5}
            rounded="xl"
          />
          <HStack justify="space-between">
            <HStack spacing={3}>
              <Text fontSize="sm" fontWeight="bold">
                啟用狀態
              </Text>
              <Switch
                colorScheme="green"
                isChecked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <Badge colorScheme={isActive ? 'green' : 'gray'}>
                {isActive ? '啟用中' : '停用'}
              </Badge>
            </HStack>
            <HStack spacing={2}>
              {editingId && (
                <Button size="sm" variant="ghost" onClick={resetForm} rounded="xl">
                  取消
                </Button>
              )}
              <Button
                size="sm"
                colorScheme="blue"
                onClick={handleSave}
                isLoading={saving}
                rounded="xl"
              >
                {editingId ? '更新' : '建立'}
              </Button>
            </HStack>
          </HStack>
        </VStack>
      </Box>

      <Divider mb={6} />

      {/* Announcement History */}
      <Text fontWeight="bold" mb={4}>
        公告記錄
      </Text>
      <TableContainer bg="white" p={4} rounded="lg" shadow="sm">
        <Table variant="simple" size="sm">
          <Thead>
            <Tr>
              <Th>標題</Th>
              <Th>狀態</Th>
              <Th>建立時間</Th>
              <Th>操作</Th>
            </Tr>
          </Thead>
          <Tbody>
            {announcements.map((ann) => (
              <Tr key={ann.id}>
                <Td fontWeight="bold">{ann.title}</Td>
                <Td>
                  <Badge colorScheme={ann.is_active ? 'green' : 'gray'}>
                    {ann.is_active ? '啟用中' : '停用'}
                  </Badge>
                </Td>
                <Td fontSize="xs" color="gray.500">
                  {new Date(ann.created_at).toLocaleDateString('zh-TW')}
                </Td>
                <Td>
                  <HStack spacing={1}>
                    <IconButton
                      aria-label="編輯"
                      icon={<EditIcon />}
                      size="xs"
                      variant="ghost"
                      onClick={() => handleEdit(ann)}
                    />
                    <IconButton
                      aria-label="刪除"
                      icon={<DeleteIcon />}
                      size="xs"
                      variant="ghost"
                      colorScheme="red"
                      onClick={() => handleDelete(ann.id)}
                    />
                  </HStack>
                </Td>
              </Tr>
            ))}
            {announcements.length === 0 && (
              <Tr>
                <Td colSpan={4} textAlign="center" color="gray.400">
                  尚無公告
                </Td>
              </Tr>
            )}
          </Tbody>
        </Table>
      </TableContainer>
    </Box>
  )
}
