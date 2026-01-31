import {
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  Badge,
  Text,
  IconButton,
  HStack,
} from '@chakra-ui/react'
import { EditIcon, DeleteIcon } from '@chakra-ui/icons'

interface Holding {
  id: string
  ticker: string
  name: string
  region: string
  shares: number
  cost_price: number
  is_multiple: boolean
  buy_date: string
}

interface Props {
  holdings: Holding[]
}

export const HoldingsTable = ({ holdings }: Props) => {
  return (
    <TableContainer bg="white" rounded="lg" shadow="sm" border="1px" borderColor="gray.100">
      <Table variant="simple">
        <Thead bg="gray.50">
          <Tr>
            <Th>代碼</Th>
            <Th>名稱</Th>
            <Th isNumeric>股數</Th>
            <Th isNumeric>均價</Th>
            <Th isNumeric>市值 (TWD)</Th>
            <Th isNumeric>損益</Th>
            <Th>操作</Th>
          </Tr>
        </Thead>
        <Tbody>
          {holdings.length === 0 ? (
            <Tr>
              <Td colSpan={7} textAlign="center" py={10}>
                目前沒有持股，請點擊「新增持股」按鈕。
              </Td>
            </Tr>
          ) : (
            holdings.map((h) => (
              <Tr key={h.id}>
                <Td>
                  <HStack>
                    <Text fontWeight="bold">{h.ticker}</Text>
                    {h.is_multiple && (
                      <Badge colorScheme="purple" variant="subtle">多筆</Badge>
                    )}
                  </HStack>
                </Td>
                <Td>{h.name}</Td>
                <Td isNumeric>{h.shares}</Td>
                <Td isNumeric>${h.cost_price.toLocaleString()}</Td>
                <Td isNumeric>計算中...</Td>
                <Td isNumeric>
                  <Text color="red.500">+0.00%</Text>
                </Td>
                <Td>
                  <HStack spacing={2}>
                    <IconButton
                      aria-label="Edit"
                      icon={<EditIcon />}
                      size="sm"
                      variant="ghost"
                    />
                    <IconButton
                      aria-label="Delete"
                      icon={<DeleteIcon />}
                      size="sm"
                      variant="ghost"
                      colorScheme="red"
                    />
                  </HStack>
                </Td>
              </Tr>
            ))
          )}
        </Tbody>
      </Table>
    </TableContainer>
  )
}
