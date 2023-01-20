import { Key } from "aws-sdk/clients/dynamodb"

export type Action = 
'$connect' | 
'$disconnect' | 
'getMessages' | 
'sendMessage' | 
'getClients'

export type Client = {
  connectionId: string,
  nickname: string
}
export type SendMessageBody = {
  message: string,
  recipientNickname: 'string',
}
export type GetMessagesBody = {
  targetNickname: string, 
  limit: number,
  startKey: Key | undefined
}