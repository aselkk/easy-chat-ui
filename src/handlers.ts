import { APIGatewayProxyEvent, APIGatewayProxyEventQueryStringParameters, APIGatewayProxyResult } from "aws-lambda"
import AWS, { AWSError } from 'aws-sdk'

type Action = '$connect' | '$disconnect' | 'getMessages' | 'sendMessage' | 'getClients'
type Client = {
  connectionId: string,
  nickname: string
}
const docClient = new AWS.DynamoDB.DocumentClient()
const CLIENTS_TABLE_NAME = `${process.env.clients_table_name}`
const apiGw = new AWS.ApiGatewayManagementApi({
  endpoint: process.env['WSSAPIGATEWAYENDPOINT']
})
const sendResponse = (code:number, message:string) => {
  return {
    statusCode: code,
    body: message
  }
}

export const handle = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const routeKey = event.requestContext.routeKey as Action
  const connectionId = event.requestContext.connectionId as string 

  switch(routeKey) {
    case '$connect': 
      return handleConnect(connectionId, event.queryStringParameters)
    case '$disconnect': 
      return handleDisconnect(connectionId)
    case 'getClients': 
      return handleGetClients(connectionId)

    default: 
      return sendResponse(500, '') 
  }
};

const handleConnect = async (connectionId: string, queryParams: APIGatewayProxyEventQueryStringParameters | null): Promise<APIGatewayProxyResult> => {
  if(!queryParams || !queryParams['nickname']) {
    return sendResponse(403, '')
  }

  await docClient
    .put({
      TableName: CLIENTS_TABLE_NAME, 
      Item: {
        connectionId,
        nickname: queryParams['nickname']
      }
    })
    .promise()

  await notifyClients(connectionId)
  
  return sendResponse(200, 'ok')
}

const handleDisconnect = async (connectionId: string): Promise<APIGatewayProxyResult> => {
  await docClient
    .delete({
      TableName: CLIENTS_TABLE_NAME, 
      Key: {
        connectionId
      }
    })
    .promise()
  
  await notifyClients(connectionId)

  return sendResponse(200, 'ok')
}

const notifyClients = async (connectionIdToExclude: string) => {
  const clients = await getAllClients()
  await Promise.all(
    clients
      .filter((client) => client.connectionId !== connectionIdToExclude)
      .map(async(client) => { await postToConnection(client.connectionId, JSON.stringify(client)) })
  )
}

const getAllClients = async (): Promise<Client[]> => {
  const output = await docClient
    .scan({
      TableName: CLIENTS_TABLE_NAME
    })
    .promise()

  const clients = output.Items || []
  return clients as Client[]
}

const postToConnection = async (connectionId: string, data: string) => {
  try {
    await apiGw
      .postToConnection({
        ConnectionId: connectionId,
        Data: data
      })
      .promise()
  } catch (e) {
    if((e as AWSError).statusCode !== 410) {
      throw e
    }
    await docClient
      .delete({
        TableName: CLIENTS_TABLE_NAME, 
        Key: {
          connectionId
        }
      })
      .promise()
  }
}

const handleGetClients = async (connectionId: string): Promise<APIGatewayProxyResult> => {
  const clients = getAllClients()
  postToConnection(connectionId, JSON.stringify(clients))
  
  return sendResponse(200, 'ok')
}