import {
  Box,
  Flex,
  Text,
  Button,
  Stack,
  useColorModeValue,
  Container,
} from '@chakra-ui/react'
import { supabase } from '../../services/supabase'

export const Navbar = ({ userEmail }: { userEmail: string | undefined }) => {
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
          <Box>
            <Text fontWeight="bold" fontSize="xl" color="blue.500">
              StockTracker
            </Text>
          </Box>

          <Flex alignItems={'center'}>
            <Stack direction={'row'} spacing={7} alignItems="center">
              <Text fontSize="sm" display={{ base: 'none', md: 'block' }}>
                {userEmail}
              </Text>
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
