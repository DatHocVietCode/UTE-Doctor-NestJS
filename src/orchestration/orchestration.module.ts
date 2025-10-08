import { Module } from "@nestjs/common";
import { AuthSaga } from "./sagas/auth.saga";

@Module({
    providers: [AuthSaga]
})
export class OrchestrationModule {}
