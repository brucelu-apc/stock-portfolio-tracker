import {
  Box,
  Flex,
  Text,
  Button,
  HStack,
  Container,
  Avatar,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  MenuDivider,
  VStack,
  IconButton,
  Tooltip,
} from '@chakra-ui/react'
import { BellIcon } from '@chakra-ui/icons'
import { supabase } from '../../services/supabase'

interface NavbarProps {
  userEmail: string | undefined
  role: string | undefined
  canAccessAdvisory: boolean
  hasAnnouncement: boolean
  currentPage: string
  onNavigate: (page: string) => void
  onOpenAnnouncement: () => void
}

export const Navbar = ({
  userEmail,
  role,
  canAccessAdvisory,
  hasAnnouncement,
  currentPage,
  onNavigate,
  onOpenAnnouncement,
}: NavbarProps) => {
  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  const navItems = [
    { label: '資產儀表板', value: 'dashboard' },
    // Only show advisory tab if user has permission or is admin
    ...(canAccessAdvisory || role === 'admin'
      ? [{ label: '投顧追蹤', value: 'advisory' }]
      : []),
    { label: '獲利總覽', value: 'profit' },
    ...(role === 'admin' ? [{ label: '管理後台', value: 'admin' }] : []),
  ]

  return (
    <Box
      bg="rgba(255, 255, 255, 0.8)"
      backdropFilter="blur(10px)"
      px={4}
      position="sticky"
      top={0}
      zIndex="sticky"
      borderBottom="1px solid"
      borderColor="gray.100"
    >
      <Container maxW="container.xl">
        <Flex h={24} alignItems={'center'} justifyContent={'space-between'}>
          <HStack spacing={10}>
            <VStack align="start" spacing={0} cursor="pointer" onClick={() => onNavigate('dashboard')}>
              <Text
                fontWeight="900"
                fontSize="2xl"
                bgGradient="linear(to-r, brand.500, brand.900)"
                bgClip="text"
                letterSpacing="tighter"
                lineHeight="shorter"
              >
                STOCK DANGO
              </Text>
              <Text fontSize="10px" fontWeight="bold" color="ui.slate" letterSpacing="0.2em">
                台美股票持股追蹤器
              </Text>
            </VStack>

            <HStack spacing={6} display={{ base: 'none', md: 'flex' }}>
              {navItems.map((item) => {
                const isActive = currentPage === item.value
                return (
                  <Box
                    key={item.value}
                    fontWeight="bold"
                    fontSize="sm"
                    color={isActive ? 'brand.500' : 'ui.navy'}
                    cursor="pointer"
                    position="relative"
                    _hover={{ color: 'brand.500' }}
                    onClick={() => onNavigate(item.value)}
                  >
                    {item.label}
                    {isActive && (
                      <Box
                        position="absolute"
                        bottom="-4px"
                        left="0"
                        right="0"
                        h="2px"
                        bg="brand.500"
                        rounded="full"
                      />
                    )}
                  </Box>
                )
              })}
            </HStack>
          </HStack>

          <Flex alignItems={'center'} gap={2}>
            {/* Announcement bell icon — only show if there's an active announcement */}
            {hasAnnouncement && (
              <Tooltip label="查看系統公告" placement="bottom">
                <IconButton
                  aria-label="查看公告"
                  icon={<BellIcon />}
                  variant="ghost"
                  size="sm"
                  color="orange.400"
                  onClick={onOpenAnnouncement}
                  _hover={{ bg: 'orange.50' }}
                />
              </Tooltip>
            )}

            <Menu>
              <MenuButton
                as={Button}
                rounded={'full'}
                variant={'link'}
                cursor={'pointer'}
                minW={0}>
                <HStack spacing={3}>
                  <Box textAlign="right" display={{ base: 'none', md: 'block' }}>
                    <Text fontSize="xs" fontWeight="bold" color="ui.slate" textTransform="uppercase">Personal Account</Text>
                    <Text fontSize="sm" fontWeight="extrabold" color="ui.navy">{userEmail?.split('@')[0]}</Text>
                  </Box>
                  <Avatar
                    size={'sm'}
                    src={''}
                    bg="brand.500"
                  />
                </HStack>
              </MenuButton>
              <MenuList rounded="2xl" shadow="2xl" border="none" p={2}>
                <MenuItem rounded="xl" fontWeight="bold" onClick={() => onNavigate('settings')}>帳號設定</MenuItem>
                <MenuItem rounded="xl" fontWeight="bold">隱私權原則</MenuItem>
                <MenuDivider />
                <MenuItem rounded="xl" fontWeight="bold" color="red.500" onClick={handleSignOut}>登出系統</MenuItem>
              </MenuList>
            </Menu>
          </Flex>
        </Flex>
      </Container>
    </Box>
  )
}
