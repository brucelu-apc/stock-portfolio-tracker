import {
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  Select,
  useToast,
  Badge,
  Heading,
  Box,
  Switch,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  VStack,
} from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { supabase } from '../../services/supabase'
import { AnnouncementEditor } from './AnnouncementEditor'
import { AdminEmailConfig } from './AdminEmailConfig'

interface UserProfile {
  id: string
  email: string
  role: 'admin' | 'user'
  status: 'pending' | 'enabled' | 'rejected' | 'disabled'
  can_access_advisory: boolean
  updated_at: string
}

export const UserManagement = () => {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const toast = useToast()

  const fetchUsers = async () => {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .order('updated_at', { ascending: false })

    if (error) {
      toast({ title: '獲取用戶列表失敗', description: error.message, status: 'error' })
    } else {
      setUsers(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const handleUpdate = async (id: string, field: string, value: string | boolean) => {
    const { error } = await supabase
      .from('user_profiles')
      .update({ [field]: value })
      .eq('id', id)

    if (error) {
      toast({ title: '更新失敗', description: error.message, status: 'error' })
    } else {
      toast({ title: '更新成功', status: 'success' })
      fetchUsers()
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'enabled': return 'green'
      case 'pending': return 'yellow'
      case 'rejected': return 'red'
      case 'disabled': return 'gray'
      default: return 'blue'
    }
  }

  return (
    <Box>
      <Heading size="lg" mb={6}>管理後台</Heading>

      <Tabs variant="soft-rounded" colorScheme="blue">
        <TabList bg="gray.100" p={1} rounded="xl" mb={6}>
          <Tab fontWeight="bold" _selected={{ bg: 'white', shadow: 'md' }}>用戶管理</Tab>
          <Tab fontWeight="bold" _selected={{ bg: 'white', shadow: 'md' }}>系統公告</Tab>
          <Tab fontWeight="bold" _selected={{ bg: 'white', shadow: 'md' }}>通知設定</Tab>
        </TabList>

        <TabPanels>
          {/* Tab 1: User Management */}
          <TabPanel p={0}>
            <VStack spacing={6} align="stretch">
              <Heading size="md">用戶帳號管理</Heading>
              <TableContainer bg="white" p={4} rounded="lg" shadow="sm">
                <Table variant="simple" size="sm">
                  <Thead>
                    <Tr>
                      <Th>電子郵件</Th>
                      <Th>目前狀態</Th>
                      <Th>權限角色</Th>
                      <Th>投顧權限</Th>
                      <Th>修改狀態</Th>
                      <Th>修改角色</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {users.map((u) => (
                      <Tr key={u.id}>
                        <Td fontSize="sm">{u.email}</Td>
                        <Td>
                          <Badge colorScheme={getStatusColor(u.status)}>{u.status.toUpperCase()}</Badge>
                        </Td>
                        <Td>
                          <Badge colorScheme={u.role === 'admin' ? 'purple' : 'blue'}>{u.role.toUpperCase()}</Badge>
                        </Td>
                        <Td>
                          <Switch
                            size="sm"
                            colorScheme="green"
                            isChecked={u.can_access_advisory}
                            onChange={() => handleUpdate(u.id, 'can_access_advisory', !u.can_access_advisory)}
                          />
                        </Td>
                        <Td>
                          <Select
                            size="sm"
                            value={u.status}
                            onChange={(e) => handleUpdate(u.id, 'status', e.target.value)}
                          >
                            <option value="pending">申請中</option>
                            <option value="enabled">啟用</option>
                            <option value="rejected">拒絕</option>
                            <option value="disabled">停用</option>
                          </Select>
                        </Td>
                        <Td>
                          <Select
                            size="sm"
                            value={u.role}
                            onChange={(e) => handleUpdate(u.id, 'role', e.target.value)}
                          >
                            <option value="user">一般使用者</option>
                            <option value="admin">管理者</option>
                          </Select>
                        </Td>
                      </Tr>
                    ))}
                  </Tbody>
                </Table>
              </TableContainer>
            </VStack>
          </TabPanel>

          {/* Tab 2: Announcement Editor */}
          <TabPanel p={0}>
            <AnnouncementEditor />
          </TabPanel>

          {/* Tab 3: Admin Email Config */}
          <TabPanel p={0}>
            <AdminEmailConfig />
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Box>
  )
}
