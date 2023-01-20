import { APIGatewayProxyEvent, APIGatewayProxyEventQueryStringParameters, APIGatewayProxyResult } from "aws-lambda"
import AWS, { AWSError } from 'aws-sdk'
import { Key } from "aws-sdk/clients/dynamodb"
import { v4 } from "uuid"

type Action = '$connect' | '$disconnect' | 'getMessages' | 'sendMessage' | 'getClients'
type Client = {
  connectionId: string,
  nickname: string
}
type SendMessageBody = {
  message: string,
  recipientNickname: 'string',
}
type GetMessagesBody = {
  targetNickname: string, 
  limit: number,
  startKey: Key | undefined
}
const docClient = new AWS.DynamoDB.DocumentClient()
const CLIENTS_TABLE_NAME = `${process.env.clients_table}`
const MESSAGES_TABLE_NAME = `${process.env.messages_table}`
class HandleError extends Error{}
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

  try {
    switch(routeKey) {
      case '$connect': 
        return handleConnect(connectionId, event.queryStringParameters)
      case '$disconnect': 
        return handleDisconnect(connectionId)
      case 'getClients': 
        return handleGetClients(connectionId)
      case "sendMessage":
        return handleSendMessage(
          await getClient(connectionId),
          parseSendMessageBody(event.body),
        );
      case 'getMessages':
        return handleGetMessages(
          await getClient(connectionId),
          parseGetMessageBody(event.body),
        );
      default: 
        return sendResponse(500, '') 
      
    }
  } catch (e) {
    if (e instanceof HandleError) {
      await postToConnection(connectionId,  JSON.stringify({ type: "error", message: e.message }))
      return sendResponse(200, 'ok')
    }

    throw e
  }
};

const parseSendMessageBody = (body: string | null): SendMessageBody => {
  const sendMsgBody = JSON.parse(body || "{}") as SendMessageBody;

  if (!sendMsgBody || !sendMsgBody.recipientNickname || !sendMsgBody.message) {
    throw new HandleError("invalid SendMessageBody");
  }

  return sendMsgBody;
};

const parseGetMessageBody = (body: string | null) => {
  const getMessagesBody = JSON.parse(body || "{}") as GetMessagesBody;

  if (
    !getMessagesBody ||
    !getMessagesBody.targetNickname ||
    !getMessagesBody.limit
  ) {
    throw new HandleError("invalid GetMessageBody");
  }

  return getMessagesBody;
};

const handleConnect = async (connectionId: string, queryParams: APIGatewayProxyEventQueryStringParameters | null): Promise<APIGatewayProxyResult> => {
  if(!queryParams || !queryParams['nickname']) {
    return sendResponse(403, '')
  }

  const existingConnectionId = await getConnectionIdByNickname(queryParams['nickname'])
  
  if (
    existingConnectionId && 
    (await postToConnection(existingConnectionId, JSON.stringify({type: 'ping'}))) 
  ) {
    return sendResponse(403,'')
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

const getConnectionIdByNickname = async (nickname: string): Promise<string | undefined> => {
  const output = await docClient
  .query({
    TableName: CLIENTS_TABLE_NAME,
    IndexName: 'NicknameIndex', 
    KeyConditionExpression: "#nickname = :nickname",
    ExpressionAttributeNames: {
      "#nickname": "nickname"
    },
    ExpressionAttributeValues: {
      ":nickname": nickname
    }
  })
  .promise()

  if(output.Count && output.Count > 0) {
    const client = (output.Items as Client[])[0]
    return client.connectionId
  }

  return undefined
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
      .map(async(client) => { await postToConnection(client.connectionId, createClientsMessage(clients)); })
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

const postToConnection = async (
  connectionId: string,
  messageBody: string,
): Promise<boolean> => {
  try {
    await apiGw
      .postToConnection({
        ConnectionId: connectionId,
        Data: messageBody,
      })
      .promise();

    return true;
  } catch (e) {
    if (isConnectionNotExistError(e)) {
      await docClient
        .delete({
          TableName: CLIENTS_TABLE_NAME,
          Key: {
            connectionId: connectionId,
          },
        })
        .promise();

      return false;
    } else {
      throw e;
    }
  }
};

const isConnectionNotExistError = (e: unknown) =>
  (e as AWSError).statusCode === 410;

const handleGetClients = async (connectionId: string): Promise<APIGatewayProxyResult> => {
  const clients = getAllClients()
  await postToConnection(connectionId, createClientsMessage(await clients))
  
  return sendResponse(200, 'ok')
}

const createClientsMessage = (clients: Client[]): string => JSON.stringify({ type: 'clients', value: {clients} })

const getClient = async (connectionId: string) => {
  const output = await docClient 
    .get({
      TableName: CLIENTS_TABLE_NAME,
      Key: {
        connectionId,
      }
    })
    .promise()
  
  return output.Item as Client
}

const getNicknameToNickname = (nicknames: string[]) =>
  nicknames.sort().join("#");

const handleSendMessage = async (client: Client, body: SendMessageBody) => {
  const nicknameToNickname = getNicknameToNickname([
    client.nickname,
    body.recipientNickname,
  ]);

  await docClient
    .put({
      TableName: MESSAGES_TABLE_NAME,
      Item: {
        messageId: v4(),
        nicknameToNickname,
        message: body.message,
        sender: client.nickname,
        createdAt: new Date().getTime(),
      },
    })
    .promise();

  const recipientConnectionId = await getConnectionIdByNickname(
    body.recipientNickname,
  );

  if (recipientConnectionId) {
    await apiGw
      .postToConnection({
        ConnectionId: recipientConnectionId,
        Data: JSON.stringify({
          type: "message",
          value: {
            sender: client.nickname,
            message: body.message,
          },
        }),
      })
      .promise();
  }

  return sendResponse(200, 'ok');
};

const handleGetMessages = async (client: Client, body: GetMessagesBody) => {  
  const output = await docClient
    .query({
      TableName: MESSAGES_TABLE_NAME,
      IndexName: "NicknameToNicknameIndex",
      KeyConditionExpression: "#nicknameToNickname = :nicknameToNickname",
      ExpressionAttributeNames: {
        "#nicknameToNickname": "nicknameToNickname",
      },
      ExpressionAttributeValues: {
        ":nicknameToNickname": getNicknameToNickname([
          client.nickname,
          body.targetNickname,
        ]),
      },
      Limit: body.limit,
      ExclusiveStartKey: body.startKey,
      ScanIndexForward: false,
    })
    .promise();

  await postToConnection(
    client.connectionId,
    JSON.stringify({
      type: "messages",
      value: {
        messages: output.Items && output.Items.length > 0 ? output.Items : [],
        lastEvaluatedKey: output.LastEvaluatedKey,
      },
    }),
  );

  return sendResponse(200, 'ok');
};