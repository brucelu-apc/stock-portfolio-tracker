import {
  Box,
  Flex,
  Text,
  Button,
  Stack,
  HStack,
  useColorModeValue,
  Container,
  Link as ChakraLink,
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
      bg={useColorModeValue('white', 'gray.800')}
      px={4}
      borderBottom={1}
      borderStyle={'solid'}
      borderColor={useColorModeValue('gray.200', 'gray.900')}
    >
      <Container maxW="container.xl">
        <Flex h={16} alignItems={'center'} justifyContent={'space-between'}>
          <HStack spacing={8}>
            <Text fontWeight="bold" fontSize="xl" color="blue.500" cursor="pointer" onClick={() => onNavigate('dashboard')}>
              StockTracker
            </Text>
            <HStack spacing={4} display={{ base: 'none', md: 'flex' }}>
              <ChakraLink onClick={() => onNavigate('dashboard')}>儀表板</ChakraLink>
              {role === 'admin' && (
                <ChakraLink onClick={() => onNavigate('admin')}>管理後台</ChakraLink>
              )}
            </HStack>
          </HStack>

          <Flex alignItems={'center'}>
            <Stack direction={'row'} spacing={7} alignItems="center">
              <ChakraLink fontSize="sm" onClick={() => onNavigate('settings')}>
                {userEmail}
              </ChakraLink>
              <Button size="sm" onClick={handleSignOut}>
                登出
              </Button>
            </Stack>
          </Flex>
        </Flex>
      </Container>
    </Box>
  )
}
