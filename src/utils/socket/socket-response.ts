// utils/socket-response.ts

import { DataResponse } from "src/common/dto/data-respone";
import { ResponseCode } from "src/common/enum/reponse-code.enum";

export class SocketResponse {
  static success<T>(data: T, message = "Success"): DataResponse<T> {
    return {
      code: ResponseCode.SUCCESS,
      message,
      data,
    };
  }

  static error(message = "Error", code: ResponseCode = ResponseCode.ERROR): DataResponse<null> {
    return {
      code,
      message,
      data: null,
    };
  }

  static pending(message = "Pending"): DataResponse<null> {
    return {
      code: ResponseCode.PENDING,
      message,
      data: null,
    };
  }
}
