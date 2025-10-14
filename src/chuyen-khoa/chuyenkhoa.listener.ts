import { Injectable } from "@nestjs/common";
import { OnEvent } from "@nestjs/event-emitter";
import { ChuyenKhoaService } from "./chuyenkhoa.service";

@Injectable()
export class ChuyenKhoaListener {
    constructor(private readonly chuyenKhoaService: ChuyenKhoaService) {}
    @OnEvent('specialty.get-all')
    async handleGetAllSpecialties() {
        const specialties = await this.chuyenKhoaService.findAll();
        console.log('[ChuyenKhoaListener] Fetched specialties:', specialties);
        return specialties;
    }
}