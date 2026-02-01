import {
  Box,
  Flex,
  Text,
  Button,
  Stack,
  HStack,
  Container,
  Avatar,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  MenuDivider,
} from '@chakra-ui/react'
import { supabase } from '../../services/supabase'

interface NavbarProps {
  userEmail: string | undefined
  role: string | undefined
  onNavigate: (page: string) => void
}

export const Navbar = ({ userEmail, role, onNavigate }: NavbarProps) => {
  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

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
        <Flex h={20} alignItems={'center'} justifyContent={'space-between'}>
          <HStack spacing={10}>
            <Text 
              fontWeight="900" 
              fontSize="2xl" 
              bgGradient="linear(to-r, brand.500, brand.900)" 
              bgClip="text"
              cursor="pointer" 
              onClick={() => onNavigate('dashboard')}
              letterSpacing="tighter"
            >
              STOCK DANGO
            </Text>
            <HStack spacing={6} display={{ base: 'none', md: 'flex' }}>
              <Text 
                fontWeight="bold" 
                fontSize="sm" 
                color="ui.navy" 
                cursor="pointer" 
                _hover={{ color: 'brand.500' }}
                onClick={() => onNavigate('dashboard')}
              >
                資產儀表板
              </Text>
              <Text 
                fontWeight="bold" 
                fontSize="sm" 
                color="ui.navy" 
                cursor="pointer" 
                _hover={{ color: 'brand.500' }}
                onClick={() => onNavigate('profit')}
              >
                獲利總覽
              </Text>
              {role === 'admin' && (
                <Text 
                  fontWeight="bold" 
                  fontSize="sm" 
                  color="purple.600" 
                  cursor="pointer" 
                  _hover={{ color: 'purple.400' }}
                  onClick={() => onNavigate('admin')}
                >
                  管理後台
                </Text>
              )}
            </HStack>
          </HStack>

          <Flex alignItems={'center'}>
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
