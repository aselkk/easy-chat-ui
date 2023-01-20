import { AWSError } from 'aws-sdk'
import {Client} from './types';

export const sendResponse = (code:number, message:string) => {
    return {
    statusCode: code,
    body: message
    }
}

export const isConnectionNotExistError = (e: unknown) =>
(e as AWSError).statusCode === 410;

export const createClientsMessage = (clients: Client[]): string => JSON.stringify({ type: 'clients', value: {clients} })

export const getNicknameToNickname = (nicknames: string[]) =>
nicknames.sort().join("#");
