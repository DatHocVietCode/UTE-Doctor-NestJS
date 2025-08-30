export interface DataResponse<T = any>
{
    code: number,
    message: string,
    data: T | null
}