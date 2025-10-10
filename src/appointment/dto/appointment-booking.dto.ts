import { Type } from "class-transformer";
import { IsDecimal, IsEnum, IsOptional, IsString, ValidateNested } from "class-validator";
import { DichVuKham } from "src/common/enum/dich-vu-kham.enum";
import { HinhThucThanhToan } from "src/common/enum/hinh-thuc-thanh-toan.enum";
import { KhungGio } from "src/common/enum/khung-gio.enum";

export class AppointmentBookingDto {
    
    @IsString()
    tenBenhvien: string;

    @IsOptional()
    @IsString()
    chuyenkhoa?: string;

    @IsEnum(KhungGio)
    khungGio: KhungGio;

    @ValidateNested()
    @Type(()=>BacSiDto)
    @IsOptional()
    bacSi: BacSiDto | null;

    @IsEnum(DichVuKham)
    dichVuKham: DichVuKham;

    @IsEnum(HinhThucThanhToan)
    hinhThucThanhToan: HinhThucThanhToan

    @IsOptional()
    @IsDecimal()
    amount?: number;
}

export class BacSiDto {
    @IsString()
    id: string;

    @IsString()
    name: string
}