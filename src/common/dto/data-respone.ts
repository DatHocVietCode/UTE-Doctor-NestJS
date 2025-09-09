import {  ResponseCode } from "../enum/reponse-code-enum";
export interface DataResponse<T = any>
{
    code: ResponseCode,
    message: string,
    data: T | null
}